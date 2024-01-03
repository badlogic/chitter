import { v4 as uuidv4 } from "uuid";
import {
    Attachment,
    Channel,
    ChitterError,
    Embed,
    ErrorAddUserToChannel,
    ErrorCreateChannel,
    ErrorCreateInviteCode,
    ErrorCreateMessage,
    ErrorCreateTransferBundle,
    ErrorCreateUserFromInviteCode,
    ErrorEditMessage,
    ErrorGetChannel,
    ErrorGetChannels,
    ErrorGetMessages,
    ErrorGetRoom,
    ErrorGetTransferBundleFromCode,
    ErrorGetUser,
    ErrorGetUsers,
    ErrorRemoveAttachment,
    ErrorRemoveChannel,
    ErrorRemoveMessage,
    ErrorRemoveUser,
    ErrorRemoveUserFromChannel,
    ErrorSetUserRole,
    ErrorUpdateChannel,
    ErrorUpdateRoom,
    ErrorUpdateUser,
    ErrorUploadAttachment,
    Facet,
    Message,
    MessageContent,
    Room,
    SuccessCreateChannel,
    SuccessCreateInviteCode,
    SuccessCreateMessage,
    SuccessCreateRoomAndAdmin,
    SuccessCreateTransferBundle,
    SuccessGetChannels,
    SuccessGetMessages,
    SuccessGetTransferBundleFromCode,
    SuccessGetUsers,
    UUID,
    User,
    UserBasic,
    UtcTimestamp,
    sanitizeMessageContent,
} from "../common/common";
import { Chitter } from "./chitter";

export type MemMessageContent = {
    text: string;
    facets: Facet[];
    embed?: Embed;
    attachmentsIds?: string[];
};

export interface MemMessage {
    id: number;
    userId: UUID;
    createdAt: UtcTimestamp;
    content: MemMessageContent;
    channelId?: UUID;
    directMessageUserId?: UUID;
}

class MemChannel {
    messages: MemMessage[] = [];
    users: User[] = [];

    constructor(readonly channel: Channel) {}
}

class MemRoom {
    users: User[] = [];
    idToUser = new Map<string, User>();
    channels = new Map<string, MemChannel>();
    attachments = new Map<string, Attachment>();
    messages: MemMessage[] = [];
    idToMessage = new Map<number, MemMessage>();
    nextMessageId: number = 0;

    constructor(readonly room: Room) {}

    addUser(user: User) {
        this.users.push(user);
        this.idToUser.set(user.id, user);
    }

    removeUser(user: User) {
        this.users = this.users.filter((other) => other.id != user.id);
        this.idToUser.delete(user.id);
        this.channels.forEach((channel) => {
            channel.users = channel.users.filter((other) => other.id != user.id);
        });
    }

    addChannel(channel: Channel) {
        const memChannel = new MemChannel(channel);
        this.channels.set(channel.id, memChannel);
        return memChannel;
    }

    serialize(): SerializedMemRoom {
        return {
            room: this.room,
            users: this.users,
            channels: Array.from(this.channels.values()).map((channel) => {
                return {
                    channel: channel.channel,
                    userIds: channel.users.map((user) => user.id),
                };
            }),
            attachments: Array.from(this.attachments.values()),
            messages: this.messages,
            nextMessageId: this.nextMessageId,
        };
    }

    static deserialize(data: SerializedMemRoom) {
        const room = new MemRoom(data.room);

        // Users
        for (const user of data.users) {
            room.users.push(user);
            room.idToUser.set(user.id, user);
        }

        // Channels without messages
        for (const channel of data.channels) {
            const memChannel = new MemChannel(channel.channel);
            for (const userId of channel.userIds) {
                const user = room.idToUser.get(userId);
                if (!user) throw new Error("Can not find user with id " + userId);
                memChannel.users.push(user);
            }
            room.channels.set(channel.channel.id, memChannel);
        }

        // Attachments
        for (const attachemnt of data.attachments) {
            room.attachments.set(attachemnt.id, attachemnt);
        }

        // Messages plus pushing messages to channels
        room.messages = [...data.messages];
        for (const message of room.messages) {
            room.idToMessage.set(message.id, message);
            if (message.channelId) {
                const channel = room.channels.get(message.channelId);
                if (!channel) throw new Error("Can not find channel " + message.channelId + " for message " + message.id);
                channel.messages.push(message);
            }
        }

        room.nextMessageId = data.nextMessageId;

        return room;
    }
}

export interface SerializedMemRoom {
    room: Room;
    users: User[];
    channels: { channel: Channel; userIds: string[] }[];
    attachments: Attachment[];
    messages: MemMessage[];
    nextMessageId: number;
}

function clone<T>(obj: T): T {
    const copy = JSON.parse(JSON.stringify(obj));
    return copy;
}

export class ChitterMem implements Chitter {
    rooms = new Map<string, MemRoom>();
    tokenToUser = new Map<string, User>();
    inviteCodes = new Map<string, { roomId: string; expiresAt: Date }>();
    transferCodes = new Map<string, { userTokens: string[]; expiresAt: Date }>();
    persistanceTimeout: any;
    cleanupCodesTimeout: any;
    closed = false;

    constructor(readonly persistance?: { save: (chitter: ChitterMem) => Promise<void>; load: () => Promise<SerializedMemRoom[]> }) {}

    async initialize(): Promise<void | ChitterError<"Could not create tables">> {
        if (this.persistance) {
            const rooms = await this.persistance.load();
            for (const serializedMemRoom of rooms) {
                const memRoom = MemRoom.deserialize(serializedMemRoom);
                this.rooms.set(memRoom.room.id, memRoom);
                for (const user of memRoom.users) {
                    this.tokenToUser.set(user.token, user);
                }
            }
            this.persist();
        }

        this.cleanupCodes();
    }

    private persist() {
        if (this.closed || !this.persistance) return;
        try {
            this.persistance.save(this);
        } catch (e) {
            console.error("Couldn't persist in-memory database", e);
        } finally {
            setTimeout(() => this.persist(), 1000 * 60);
        }
    }

    private cleanupCodes() {
        if (this.closed) return;
        const now = new Date();

        // Cleanup transfer codes (expire after 1 hour)
        this.transferCodes.forEach((value, key) => {
            if (value.expiresAt < now) {
                this.transferCodes.delete(key);
            }
        });

        // Cleanup invite codes (expire after 24 hours)
        this.inviteCodes.forEach((value, key) => {
            if (value.expiresAt < now) {
                this.inviteCodes.delete(key);
            }
        });
        this.cleanupCodesTimeout = setTimeout(() => this.cleanupCodes(), 3600000);
    }

    async close() {
        this.closed = true;
        clearTimeout(this.cleanupCodesTimeout);
        clearTimeout(this.persistanceTimeout);
        if (this.persistance) {
            await this.persistance.save(this);
        }
    }

    serialize() {
        const serializedData: SerializedMemRoom[] = [];
        for (const room of this.rooms.values()) {
            serializedData.push(room.serialize());
        }
        return serializedData;
    }

    private newInvitecode(roomId: string) {
        const invite = { roomId, expiresAt: new Date(Date.now() + 86400000) };
        const code = uuidv4();
        this.inviteCodes.set(code, invite);
        // FIXME clean-up expired
        return code;
    }

    async createRoomAndAdmin(
        roomName: string,
        adminName: string,
        adminInviteOnly: boolean
    ): Promise<ChitterError<"Could not create room and admin"> | SuccessCreateRoomAndAdmin> {
        const room: Room = {
            id: uuidv4(),
            adminInviteOnly,
            createdAt: new Date().getTime(),
            displayName: roomName,
        };
        const admin: User = {
            createdAt: new Date().getTime(),
            displayName: adminName,
            id: uuidv4(),
            role: "admin",
            roomId: room.id,
            token: uuidv4(),
        };
        const channel: Channel = {
            createdAt: new Date().getTime(),
            createdBy: admin.id,
            displayName: "General",
            id: uuidv4(),
            isPrivate: false,
            roomId: room.id,
        };

        const memRoom = new MemRoom(room);
        memRoom.addUser(admin);
        this.tokenToUser.set(admin.token, admin);
        memRoom.addChannel(channel);
        this.rooms.set(room.id, memRoom);
        return { room, admin, generalChannel: channel };
    }

    async updateRoom(
        adminToken: string,
        displayName: string,
        adminInviteOnly: boolean,
        description?: string | undefined,
        logoId?: string | undefined
    ): Promise<void | ChitterError<ErrorUpdateRoom>> {
        const user = this.tokenToUser.get(adminToken);
        if (!user || user.role != "admin") return new ChitterError("Invalid admin token");
        const room = this.rooms.get(user.roomId);
        if (!room) return new ChitterError("Could not update room");
        if (logoId && !room.attachments.has(logoId)) return new ChitterError("Invalid or non-image logo attachment");

        room.room.displayName = displayName;
        room.room.adminInviteOnly = adminInviteOnly;
        room.room.description = description;
        room.room.logo = logoId;
    }

    async getRoom(userToken: string, roomId: string): Promise<ChitterError<ErrorGetRoom> | Room> {
        const user = this.tokenToUser.get(userToken);
        if (!user) return new ChitterError("Invalid user token");
        if (user.roomId != roomId) return new ChitterError("Room not found");
        const room = this.rooms.get(user.roomId);
        if (!room) return new ChitterError("Room not found");
        return room.room;
    }

    async createInviteCode(userToken: string): Promise<ChitterError<ErrorCreateInviteCode> | SuccessCreateInviteCode> {
        const user = this.tokenToUser.get(userToken);
        if (!user) return new ChitterError("User not found");
        const room = this.rooms.get(user.roomId);
        if (!room) return new ChitterError("Could not create invite code");
        if (room.room.adminInviteOnly && user.role != "admin") return new ChitterError("User is not an admin and room is admin invite only");
        return { inviteCode: this.newInvitecode(room.room.id) };
    }

    async createUserFromInviteCode(inviteCode: string, displayName: string): Promise<ChitterError<ErrorCreateUserFromInviteCode> | User> {
        const invite = this.inviteCodes.get(inviteCode);
        if (!invite) return new ChitterError("Invalid invite code");
        const room = this.rooms.get(invite.roomId);
        if (!room) throw new ChitterError("Could not create user from invite code");
        if (room.users.some((user) => user.displayName == displayName)) throw new ChitterError("Display name already exists in the room");
        const user: User = {
            id: uuidv4(),
            createdAt: new Date().getTime(),
            displayName,
            role: "participant",
            roomId: invite.roomId,
            token: uuidv4(),
        };
        room.addUser(user);
        return user;
    }

    async removeUser(userId: string, adminToken: string): Promise<void | ChitterError<ErrorRemoveUser>> {
        const admin = this.tokenToUser.get(adminToken);
        if (!admin || admin.role != "admin") return new ChitterError("Invalid admin token");
        const room = this.rooms.get(admin.roomId);
        if (!room) return new ChitterError("Could not remove user");
        const user = room.idToUser.get(userId);
        if (!user) throw new ChitterError("User not found in admin's room");
        room.removeUser(user);
    }

    async updateUser(
        userToken: string,
        displayName: string,
        description?: string | undefined,
        avatar?: string | undefined
    ): Promise<void | ChitterError<ErrorUpdateUser>> {
        const user = this.tokenToUser.get(userToken);
        if (!user) return new ChitterError("Invalid user token");
        const room = this.rooms.get(user.roomId);
        if (!room) return new ChitterError("Could not update user");
        if (avatar && !room.attachments.has(avatar)) return new ChitterError("Invalid or non-image avatar attachment");

        user.displayName = displayName;
        user.description = description;
        user.avatar = avatar;
    }

    async setUserRole(adminToken: string, userId: string, role: "admin" | "participant"): Promise<void | ChitterError<ErrorSetUserRole>> {
        const admin = this.tokenToUser.get(adminToken);
        if (!admin || admin.role != "admin") return new ChitterError("Invalid admin token or non-admin user");
        const room = this.rooms.get(admin.roomId);
        if (!room) return new ChitterError("Could not change user role");
        const user = room.idToUser.get(userId);
        if (!user) return new ChitterError("User not found in admin's room");

        user.role = role;
    }

    async getUsers(userToken: string, channelId?: string | undefined): Promise<ChitterError<ErrorGetUsers> | SuccessGetUsers> {
        const user = this.tokenToUser.get(userToken);
        if (!user) return new ChitterError("Invalid user token");
        const room = this.rooms.get(user.roomId);
        if (!room) return new ChitterError("Could not get users");

        if (channelId) {
            const channel = room.channels.get(channelId);
            if (!channel) return new ChitterError("Could not get users");
            if (!channel.channel.isPrivate) return new ChitterError("Could not get users");
            return channel.users.map((user) => {
                const copy = clone(user);
                delete (copy as any).token;
                return copy;
            });
        } else {
            return Array.from(room.users.values()).map((user) => {
                const copy = clone(user);
                delete (copy as any).token;
                return copy;
            });
        }
    }

    async getUser(userToken: string, userId: string): Promise<UserBasic | ChitterError<ErrorGetUser>> {
        const user = this.tokenToUser.get(userToken);
        if (!user) return new ChitterError("Invalid user token");
        const room = this.rooms.get(user.roomId);
        if (!room) return new ChitterError("Could not retrieve user details");
        const other = room.idToUser.get(userId);
        if (!other) return new ChitterError("User not found");
        const copy = clone(user);
        delete (copy as any).token;
        return copy;
    }

    async createTransferBundle(userTokens: string[]): Promise<ChitterError<ErrorCreateTransferBundle> | SuccessCreateTransferBundle> {
        const validUserTokens: string[] = [];
        for (const userToken of userTokens) {
            if (this.tokenToUser.has(userToken)) {
                validUserTokens.push(userToken);
            }
        }
        if (validUserTokens.length === 0) {
            return new ChitterError("No valid tokens");
        }

        const transferCode = uuidv4();
        const expiresAt = new Date(Date.now() + 3600000); // 1 hour from now

        this.transferCodes.set(transferCode, { userTokens: validUserTokens, expiresAt });

        return { transferCode };
    }

    async getTransferBundleFromCode(transferCode: string): Promise<ChitterError<ErrorGetTransferBundleFromCode> | SuccessGetTransferBundleFromCode> {
        const transferBundle = this.transferCodes.get(transferCode);
        if (!transferBundle) return new ChitterError("Invalid or expired transfer code");
        this.transferCodes.delete(transferCode);
        const users: User[] = [];
        for (const userToken of transferBundle.userTokens) {
            if (this.tokenToUser.has(userToken)) {
                users.push(this.tokenToUser.get(userToken)!);
            }
        }
        return users;
    }

    async createMessage(
        userToken: string,
        content: { text: string; facets: Facet[]; embed?: Embed | undefined; attachmentIds?: string[] | undefined },
        channelId?: string | undefined,
        directMessageUserId?: string | undefined
    ): Promise<ChitterError<ErrorCreateMessage> | SuccessCreateMessage> {
        const user = this.tokenToUser.get(userToken);
        if (!user) return new ChitterError("Invalid user token");
        const room = this.rooms.get(user.roomId);
        if (!room) return new ChitterError("Could not create message");

        if (!channelId && !directMessageUserId) return new ChitterError("Could not create message");
        if (channelId && directMessageUserId) return new ChitterError("Message cannot target both a channel and a direct user");

        const sanitizedContent = sanitizeMessageContent(content);
        if (sanitizedContent instanceof ChitterError) return sanitizedContent;
        let attachments: Attachment[] | undefined;
        if (sanitizedContent.attachmentIds) {
            attachments = [];
            for (const attachmentId of sanitizedContent.attachmentIds) {
                const attachment = room.attachments.get(attachmentId);
                if (!attachment) return new ChitterError("Invalid attachment IDs");
                attachments.push(attachment);
            }
        }

        const message: MemMessage = {
            id: room.nextMessageId++,
            createdAt: new Date().getTime(),
            userId: user.id,
            channelId,
            directMessageUserId,
            content: sanitizedContent,
        };

        if (channelId) {
            const channel = room.channels.get(channelId);
            if (!channel) return new ChitterError("Channel not found in user's room");
            if (channel.channel.isPrivate && !channel.users.some((other) => other.id == user.id))
                return new ChitterError("User is not a member of the private channel");
            channel.messages.push(message);
            room.messages.push(message);
            room.idToMessage.set(message.id, message);
        } else {
            const other = room.idToUser.get(directMessageUserId!);
            if (!other) return new ChitterError("Could not create message");
            room.messages.push(message);
            room.idToMessage.set(message.id, message);
        }
        return { messageId: message.id };
    }

    async removeMessage(userToken: string, messageId: string): Promise<void | ChitterError<ErrorRemoveMessage>> {
        try {
            const user = this.tokenToUser.get(userToken);
            if (!user) return new ChitterError("Invalid user token");
            const room = this.rooms.get(user.roomId);
            if (!room) return new ChitterError("Message not found");
            const message = room.idToMessage.get(parseInt(messageId));
            if (!message) return new ChitterError("Could not remove message");
            if (message.channelId) {
                const channel = room.channels.get(message.channelId);
                if (!channel) return new ChitterError("Could not remove message");
                channel.messages = channel.messages.filter((other) => (other.id = message.id));
            }
            room.messages = room.messages.filter((other) => other.id != message.id);
            room.idToMessage.delete(message.id);
        } catch (e) {
            return new ChitterError("Could not remove message");
        }
    }

    async editMessage(
        userToken: string,
        messageId: string,
        content: { text: string; facets: Facet[]; embed?: Embed | undefined; attachmentIds?: string[] | undefined }
    ): Promise<void | ChitterError<ErrorEditMessage>> {
        const user = this.tokenToUser.get(userToken);
        if (!user) return new ChitterError("Invalid user token");
        const room = this.rooms.get(user.roomId);
        if (!room) return new ChitterError("Message not found");
        const message = room.idToMessage.get(parseInt(messageId));
        if (!message) return new ChitterError("Could not edit message");

        if (user.role != "admin" && message.userId != user.id) return new ChitterError("Could not edit message");

        const sanitizedContent = sanitizeMessageContent(content);
        if (sanitizedContent instanceof ChitterError) return sanitizedContent;
        let attachments: Attachment[] | undefined;
        if (sanitizedContent.attachmentIds) {
            attachments = [];
            for (const attachmentId of sanitizedContent.attachmentIds) {
                const attachment = room.attachments.get(attachmentId);
                if (!attachment) return new ChitterError("Invalid attachment IDs");
                attachments.push(attachment);
            }
        }
        message.content = sanitizedContent;
    }

    filterMessages(messages: MemMessage[], cursor: number | undefined, limit: number, predicate: (message: MemMessage) => boolean): MemMessage[] {
        let startIndex: number | undefined = undefined;

        if (cursor !== undefined) {
            // Find the index of the first message with an ID less than the cursor
            for (let i = messages.length - 1; i >= 0; i--) {
                if (messages[i].id < cursor) {
                    startIndex = i;
                    break;
                }
            }
            if (!startIndex) return [];
            startIndex += 1;
        } else {
            startIndex = messages.length;
        }

        const result: MemMessage[] = [];
        for (let i = startIndex - 1; i >= 0 && result.length < limit; i--) {
            if (predicate(messages[i])) {
                result.push(messages[i]);
            }
        }

        return result;
    }

    async getMessages(
        userToken: string,
        channelId?: string | undefined,
        directMessageUserId?: string | undefined,
        cursor?: string | undefined,
        limit?: number | undefined
    ): Promise<ChitterError<ErrorGetMessages> | SuccessGetMessages> {
        const user = this.tokenToUser.get(userToken);
        if (!user || user.role != "admin") return new ChitterError("Invalid user token");
        const room = this.rooms.get(user.roomId);
        if (!room) return new ChitterError("Could not get messages");

        if (!channelId && !directMessageUserId) return new ChitterError("Either channelId or directMessageUserId must be provided");
        if (!channelId && directMessageUserId) return new ChitterError("Either channelId or directMessageUserId must be provided");

        let messages: MemMessage[] = [];
        if (channelId) {
            const channel = room.channels.get(channelId);
            if (!channel) return new ChitterError("Channel not found in user's room");
            if (channel.channel.isPrivate) {
                if (!channel.users.some((other) => other.id == user.id)) return new ChitterError("User is not a member of the private channel");
            }
            messages = this.filterMessages(channel.messages, cursor ? parseInt(cursor) : undefined, limit ?? 25, (message) => true);
        } else {
            if (!directMessageUserId) throw new ChitterError("Either channelId or directMessageUserId must be provided");
            const otherUser = room.idToUser.get(directMessageUserId);
            if (!otherUser) return new ChitterError("Could not get messages");
            messages = this.filterMessages(
                room.messages,
                cursor ? parseInt(cursor) : undefined,
                limit ?? 25,
                (message) =>
                    (message.userId == user.id && message.directMessageUserId == directMessageUserId) ||
                    (message.userId == directMessageUserId && message.directMessageUserId == user.id)
            );
        }
        return messages.map((memMessage) => {
            const attachments: Attachment[] = [];
            if (memMessage.content.attachmentsIds) {
                for (const attachmentId of memMessage.content.attachmentsIds) {
                    const attachment = room.attachments.get(attachmentId);
                    if (attachment) attachments.push(attachment);
                }
            }

            const content: MessageContent = {
                text: memMessage.content.text,
                facets: memMessage.content.facets,
                embed: memMessage.content.embed,
                attachments: attachments.length > 0 ? attachments : undefined,
            };

            const message: Message = {
                id: memMessage.id,
                content: content,
                createdAt: memMessage.createdAt,
                user: room.idToUser.get(memMessage.userId)!,
                channelId: memMessage.channelId,
                directMessageUserId: memMessage.directMessageUserId,
            };
            message.user = clone(message.user);
            delete (message.user as any).token;
            return message;
        });
    }

    async createChannel(
        adminToken: string,
        displayName: string,
        isPrivate: boolean
    ): Promise<ChitterError<ErrorCreateChannel> | SuccessCreateChannel> {
        const user = this.tokenToUser.get(adminToken);
        if (!user || user.role != "admin") return new ChitterError("Invalid admin token or non-admin user");
        const room = this.rooms.get(user.roomId);
        if (!room) return new ChitterError("Could not create channel");
        const channel: Channel = {
            id: uuidv4(),
            createdAt: new Date().getTime(),
            createdBy: user.id,
            displayName,
            isPrivate,
            roomId: room.room.id,
        };
        const memChannel = room.addChannel(channel);
        if (isPrivate) memChannel.users.push(user);

        return { channelId: channel.id };
    }

    async removeChannel(adminToken: string, channelId: string): Promise<void | ChitterError<ErrorRemoveChannel>> {
        const user = this.tokenToUser.get(adminToken);
        if (!user || user.role != "admin") return new ChitterError("Invalid admin token or non-admin user");
        const room = this.rooms.get(user.roomId);
        if (!room) return new ChitterError("Could not remove channel");
        const channel = room.channels.get(channelId);
        if (!channel) return new ChitterError("Could not remove channel");
        room.channels.delete(channelId);
        const messageIds = new Set<number>();
        for (const message of channel.messages) {
            messageIds.add(message.id);
        }
        room.messages = room.messages.filter((other) => messageIds.has(other.id));
    }

    async updateChannel(
        adminToken: string,
        channelId: string,
        displayName: string,
        description: string
    ): Promise<void | ChitterError<ErrorUpdateChannel>> {
        const user = this.tokenToUser.get(adminToken);
        if (!user || user.role != "admin") return new ChitterError("Invalid admin token or non-admin user");
        const room = this.rooms.get(user.roomId);
        if (!room) return new ChitterError("Could not update channel");
        const channel = room.channels.get(channelId);
        if (!channel) return new ChitterError("Could not update channel");

        channel.channel.displayName = displayName;
        channel.channel.description = description;
    }

    async getChannels(userToken: string): Promise<ChitterError<ErrorGetChannels> | SuccessGetChannels> {
        const user = this.tokenToUser.get(userToken);
        if (!user) return new ChitterError("Invalid user token");
        const room = this.rooms.get(user.roomId);
        if (!room) return new ChitterError("Could not retrieve channels");
        const channels: Channel[] = [];
        for (const channel of room.channels.values()) {
            if (channel.channel.isPrivate) {
                if (channel.users.some((other) => other.id == user.id)) {
                    channels.push(channel.channel);
                }
            } else {
                channels.push(channel.channel);
            }
        }
        return channels;
    }

    async getChannel(userToken: string, channelId: string): Promise<ChitterError<ErrorGetChannel> | Channel> {
        const user = this.tokenToUser.get(userToken);
        if (!user) return new ChitterError("Invalid user token");
        const room = this.rooms.get(user.roomId);
        if (!room) return new ChitterError("Could not retrieve channel details");
        const channel = room.channels.get(channelId);
        if (!channel) return new ChitterError("Channel not found");
        if (channel.channel.isPrivate && !channel.users.some((other) => other.id == user.id))
            return new ChitterError("Could not retrieve channel details");
        return channel.channel;
    }

    async addUserToChannel(adminToken: string, userId: string, channelId: string): Promise<void | ChitterError<ErrorAddUserToChannel>> {
        const admin = this.tokenToUser.get(adminToken);
        if (!admin || admin.role != "admin") return new ChitterError("Invalid admin token or non-admin user");
        const room = this.rooms.get(admin.roomId);
        if (!room) return new ChitterError("Could not add user to channel");
        const channel = room.channels.get(channelId);
        if (!channel) return new ChitterError("Channel not found or not private");
        if (!channel.channel.isPrivate) return new ChitterError("Channel not found or not private");
        const user = room.idToUser.get(userId);
        if (!user) return new ChitterError("Could not add user to channel");
        if (channel.users.some((other) => other.id == user.id)) return;
        channel.users.push(user);
    }

    async removeUserFromChannel(adminToken: string, userId: string, channelId: string): Promise<void | ChitterError<ErrorRemoveUserFromChannel>> {
        const admin = this.tokenToUser.get(adminToken);
        if (!admin || admin.role != "admin") return new ChitterError("Invalid admin token or non-admin user");
        const room = this.rooms.get(admin.roomId);
        if (!room) return new ChitterError("Could not remove user from channel");
        const channel = room.channels.get(channelId);
        if (!channel) return new ChitterError("Channel not found or not private");
        if (!channel.channel.isPrivate) return new ChitterError("Channel not found or not private");
        const user = room.idToUser.get(userId);
        if (!user) return new ChitterError("Could not remove user from channel");
        channel.users = channel.users.filter((other) => other.id != user.id);
    }

    uploadAttachment(
        token: string,
        attachment: {
            type: "image" | "video" | "file";
            fileName: string;
            path: string;
            width?: number | undefined;
            height?: number | undefined;
            createdAt: number;
        }
    ): Promise<ChitterError<ErrorUploadAttachment> | Attachment> {
        throw new Error("Method not implemented.");
    }

    removeAttachment(token: string, attachmentId: string): Promise<void | ChitterError<ErrorRemoveAttachment>> {
        throw new Error("Method not implemented.");
    }
}
