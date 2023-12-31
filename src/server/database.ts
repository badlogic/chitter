import { Pool } from "pg";
import { v4 as uuidv4 } from "uuid";
import {
    Channel,
    ChitterError,
    Embed,
    ErrorAddUserToChannel,
    ErrorCreateChannel,
    ErrorCreateInviteCode,
    ErrorCreateMessage,
    ErrorCreateRoomAndAdmin,
    ErrorCreateUserFromInviteCode,
    ErrorEditMessage,
    ErrorGetChannels,
    ErrorGetMessages,
    ErrorGetUser,
    ErrorGetUsers,
    ErrorReason,
    ErrorRemoveChannel,
    ErrorRemoveMessage,
    ErrorRemoveUser,
    ErrorRemoveUserFromChannel,
    ErrorSetUserRole,
    ErrorUpdateChannel,
    ErrorUpdateRoom,
    ErrorUpdateUser,
    Facet,
    Message,
    Room,
    UUID,
    User,
    sanitizeMessageContent,
} from "../common/common.js";

export class ChitterDatabase {
    private pool: Pool;
    private inviteCodes: Map<string, { roomId: string; createdAt: Date }>;

    constructor(pool: Pool) {
        this.pool = pool;
        this.inviteCodes = new Map();
        setInterval(() => this.cleanupInviteCodes(), 3600000); // Cleanup every hour
    }

    async initialize(): Promise<ChitterError<Extract<ErrorReason, "Could not create tables">> | void> {
        try {
            // FIXME add foreign key constraints
            await this.pool.query(`
            CREATE TABLE IF NOT EXISTS rooms (
              id UUID PRIMARY KEY,
              created_at TIMESTAMPTZ NOT NULL,
              display_name TEXT NOT NULL,
              description TEXT,
              logo_id UUID,
              admin_invite_only BOOLEAN NOT NULL
            );
          `);

            await this.pool.query(`
            CREATE TABLE IF NOT EXISTS users (
              id UUID PRIMARY KEY,
              room_id UUID,
              created_at TIMESTAMPTZ NOT NULL,
              token TEXT NOT NULL,
              display_name TEXT NOT NULL,
              description TEXT,
              avatar_id UUID,
              role TEXT NOT NULL CHECK (role IN ('admin', 'participant'))
            );
          `);

            await this.pool.query(`
            CREATE TABLE IF NOT EXISTS channels (
              id UUID PRIMARY KEY,
              room_id UUID,
              created_at TIMESTAMPTZ NOT NULL,
              display_name TEXT NOT NULL,
              description TEXT,
              is_private BOOLEAN NOT NULL,
              created_by UUID
            );
          `);

            await this.pool.query(`
            CREATE TABLE IF NOT EXISTS private_channel_members (
              channel_id UUID,
              user_id UUID,
              PRIMARY KEY (channel_id, user_id)
            );
          `);

            await this.pool.query(`
            CREATE TABLE IF NOT EXISTS messages (
              id BIGSERIAL PRIMARY KEY,
              user_id UUID,
              created_at TIMESTAMPTZ NOT NULL,
              content JSONB NOT NULL,
              channel_id UUID,
              direct_message_user_id UUID
            );
          `);

            await this.pool.query(`
            CREATE TABLE IF NOT EXISTS attachments (
              id UUID PRIMARY KEY,
              type TEXT NOT NULL CHECK (type IN ('image', 'video', 'file')),
              user_id UUID,
              file_name TEXT NOT NULL,
              width INT,
              height INT,
              created_at TIMESTAMPTZ NOT NULL
            );
          `);

            return;
        } catch (e) {
            return new ChitterError("Could not create tables", e);
        }
    }

    async createRoomAndAdmin(
        roomName: string,
        adminName: string,
        adminInviteOnly: boolean
    ): Promise<ErrorCreateRoomAndAdmin | { room: Room; admin: User; generalChannel: Channel }> {
        const client = await this.pool.connect();
        try {
            await client.query("BEGIN");

            const roomId = uuidv4();
            const adminId = uuidv4();
            const adminToken = uuidv4();

            // Create the room
            const roomQuery = `
            INSERT INTO rooms (id, created_at, display_name, admin_invite_only)
            VALUES ($1, NOW(), $2, $3)
            RETURNING id, created_at, display_name, description, logo_id, admin_invite_only;
            `;
            const roomValues = [roomId, roomName, adminInviteOnly];
            const roomResult = await client.query(roomQuery, roomValues);
            const room: Room = roomResult.rows[0];

            // Create the admin user
            const adminQuery = `
            INSERT INTO users (id, room_id, created_at, token, display_name, role)
            VALUES ($1, $2, NOW(), $3, $4, 'admin')
            RETURNING id, room_id, created_at, token, display_name, description, avatar_id, role;
            `;
            const adminValues = [adminId, roomId, adminToken, adminName];
            const adminResult = await client.query(adminQuery, adminValues);
            const admin: User = adminResult.rows[0];

            // Create a public "General" channel
            const generalChannelId = uuidv4();
            const channelQuery = `
            INSERT INTO channels (id, room_id, created_at, display_name, is_private, created_by)
            VALUES ($1, $2, NOW(), 'General', false, $3)
            RETURNING id, room_id, created_at, display_name, description, is_private, created_by;
            `;
            const channelValues = [generalChannelId, roomId, adminId];
            const channelResult = await client.query(channelQuery, channelValues);
            const generalChannel: Channel = channelResult.rows[0];

            await client.query("COMMIT");

            return { room, admin, generalChannel };
        } catch (e) {
            await client.query("ROLLBACK");
            return new ChitterError("Could not create room and admin", e);
        } finally {
            client.release();
        }
    }

    private cleanupInviteCodes() {
        const oneDayAgo = new Date(Date.now() - 86400000); // 24 hours in milliseconds
        this.inviteCodes.forEach((value, key) => {
            if (value.createdAt < oneDayAgo) {
                this.inviteCodes.delete(key);
            }
        });
    }

    async createInviteCode(userToken: string): Promise<ErrorCreateInviteCode | string> {
        const client = await this.pool.connect();
        try {
            const userQuery = `
            SELECT u.id, u.role, r.id as room_id, r.admin_invite_only
            FROM users u
            JOIN rooms r ON u.room_id = r.id
            WHERE u.token = $1;
            `;
            const userResult = await client.query(userQuery, [userToken]);
            if (userResult.rows.length === 0) {
                return new ChitterError("User not found");
            }

            const user = userResult.rows[0];
            if (user.role !== "admin" || user.admin_invite_only) {
                return new ChitterError("User is not an admin and room is admin invite only");
            }

            const inviteCode = uuidv4(); // Generate a UUID
            this.inviteCodes.set(inviteCode, { roomId: user.room_id, createdAt: new Date() });

            return inviteCode;
        } catch (e) {
            return new ChitterError("Could not create invite code", e);
        } finally {
            client.release();
        }
    }

    async createUserFromInviteCode(inviteCode: string, displayName: string): Promise<ErrorCreateUserFromInviteCode | User> {
        const client = await this.pool.connect();
        try {
            // Check if invite code is valid
            const inviteData = this.inviteCodes.get(inviteCode);
            if (!inviteData) {
                return new ChitterError("Invalid invite code");
            }

            const roomId = inviteData.roomId;
            const userId = uuidv4();

            await client.query("BEGIN");

            // Check if displayName already exists in the room
            const existingUserQuery = `
            SELECT 1 FROM users WHERE display_name = $1 AND room_id = $2;
            `;
            const existingUserResult = await client.query(existingUserQuery, [displayName, roomId]);
            if (existingUserResult.rows.length > 0) {
                await client.query("ROLLBACK");
                return new ChitterError("Display name already exists in the room");
            }

            // Create the new user
            const userToken = uuidv4(); // Generate token for the new user
            const userQuery = `
            INSERT INTO users (id, room_id, created_at, token, display_name, role)
            VALUES ($1, $2, NOW(), $3, $4, 'participant')
            RETURNING id, room_id, created_at, token, display_name, description, avatar_id, role;
            `;
            const userValues = [userId, roomId, userToken, displayName];
            const userResult = await client.query(userQuery, userValues);
            const newUser: User = userResult.rows[0];

            await client.query("COMMIT");

            // Invalidate the invite code by removing it from the map
            this.inviteCodes.delete(inviteCode);

            return newUser;
        } catch (e) {
            await client.query("ROLLBACK");
            return new ChitterError("Could not create user from invite code", e);
        } finally {
            client.release();
        }
    }

    async removeUser(userId: string, adminToken: string): Promise<ErrorRemoveUser | void> {
        const client = await this.pool.connect();
        try {
            await client.query("BEGIN");

            // Verify if the adminToken is valid and belongs to an admin of the user's room
            const adminQuery = `
            SELECT u.room_id
            FROM users u
            JOIN rooms r ON u.room_id = r.id
            WHERE u.token = $1 AND u.role = 'admin';
            `;
            const adminResult = await client.query(adminQuery, [adminToken]);
            if (adminResult.rows.length === 0) {
                await client.query("ROLLBACK");
                return new ChitterError("Invalid admin token");
            }

            // Check if the user to be removed is in the same room as the admin
            const adminRoomId = adminResult.rows[0].room_id;
            const userRoomQuery = `SELECT room_id FROM users WHERE id = $1;`;
            const userRoomResult = await client.query(userRoomQuery, [userId]);
            if (userRoomResult.rows.length === 0 || userRoomResult.rows[0].room_id !== adminRoomId) {
                await client.query("ROLLBACK");
                return new ChitterError("User not found in admin's room");
            }

            // Remove the user from any private channels they are a part of
            const removePrivateChannelsQuery = `DELETE FROM private_channel_members WHERE user_id = $1;`;
            await client.query(removePrivateChannelsQuery, [userId]);

            // Invalidate the user's token by replacing it with a new UUID
            const invalidateTokenQuery = `UPDATE users SET token = $1 WHERE id = $2;`;
            await client.query(invalidateTokenQuery, [uuidv4(), userId]);

            await client.query("COMMIT");
        } catch (e) {
            await client.query("ROLLBACK");
            return new ChitterError("Could not remove user", e);
        } finally {
            client.release();
        }
    }

    async createMessage(
        userToken: string,
        content: { text: string; facets: Facet[]; embed?: Embed; attachmentIds?: string[] },
        channelId?: UUID, // Optional, for channel messages
        directMessageUserId?: UUID // Optional, for direct messages
    ): Promise<ErrorCreateMessage | number> {
        const client = await this.pool.connect();
        try {
            await client.query("BEGIN");

            // Validate userToken
            const userQuery = `SELECT id, room_id FROM users WHERE token = $1;`;
            const userResult = await client.query(userQuery, [userToken]);
            if (userResult.rows.length === 0) {
                await client.query("ROLLBACK");
                return new ChitterError("Invalid user token");
            }
            const userId = userResult.rows[0].id;
            const userRoomId = userResult.rows[0].room_id;

            // Check that not both channelId and directMessageUserId are provided
            if (channelId && directMessageUserId) {
                await client.query("ROLLBACK");
                return new ChitterError("Message cannot target both a channel and a direct user");
            }

            // Validate channel message
            if (channelId) {
                const channelQuery = `SELECT is_private FROM channels WHERE id = $1 AND room_id = $2;`;
                const channelResult = await client.query(channelQuery, [channelId, userRoomId]);
                if (channelResult.rows.length === 0) {
                    await client.query("ROLLBACK");
                    return new ChitterError("Channel not found in user's room");
                }

                if (channelResult.rows[0].is_private) {
                    const memberQuery = `SELECT 1 FROM private_channel_members WHERE channel_id = $1 AND user_id = $2;`;
                    const memberResult = await client.query(memberQuery, [channelId, userId]);
                    if (memberResult.rows.length === 0) {
                        await client.query("ROLLBACK");
                        return new ChitterError("User is not a member of the private channel");
                    }
                }
            }

            // Sanitize and validate message content
            const validatedContent = sanitizeMessageContent(content);
            if (validatedContent instanceof ChitterError) {
                await client.query("ROLLBACK");
                return validatedContent;
            }

            // Insert the new message
            const insertMessageQuery = `
            INSERT INTO messages (user_id, created_at, content, channel_id, direct_message_user_id)
            VALUES ($1, NOW(), $2, $3, $4)
            RETURNING id;
            `;
            const insertMessageValues = [userId, JSON.stringify(validatedContent), channelId, directMessageUserId];
            const insertMessageResult = await client.query(insertMessageQuery, insertMessageValues);
            const newMessageId = insertMessageResult.rows[0].id;

            await client.query("COMMIT");

            return newMessageId;
        } catch (e) {
            await client.query("ROLLBACK");
            return new ChitterError("Could not create message", e);
        } finally {
            client.release();
        }
    }

    async removeMessage(userToken: string, messageId: string): Promise<ErrorRemoveMessage | void> {
        const client = await this.pool.connect();
        try {
            await client.query("BEGIN");

            // Validate user token and get user details
            const userQuery = `SELECT id, role, room_id FROM users WHERE token = $1;`;
            const userResult = await client.query(userQuery, [userToken]);
            if (userResult.rows.length === 0) {
                await client.query("ROLLBACK");
                return new ChitterError("Invalid user token");
            }
            const userId = userResult.rows[0].id;
            const userRole = userResult.rows[0].role;
            const userRoomId = userResult.rows[0].room_id;

            // Check if the user is the author of the message or an admin in the same room
            const messageQuery = `SELECT user_id, room_id FROM messages WHERE id = $1;`;
            const messageResult = await client.query(messageQuery, [messageId]);
            if (messageResult.rows.length === 0) {
                await client.query("ROLLBACK");
                return new ChitterError("Message not found");
            }
            const { user_id: authorId, room_id: messageRoomId } = messageResult.rows[0];

            if (userId !== authorId && (userRole !== "admin" || userRoomId !== messageRoomId)) {
                await client.query("ROLLBACK");
                return new ChitterError("User not authorized to delete this message");
            }

            // Delete the message
            const deleteMessageQuery = `DELETE FROM messages WHERE id = $1;`;
            await client.query(deleteMessageQuery, [messageId]);

            await client.query("COMMIT");
        } catch (e) {
            await client.query("ROLLBACK");
            return new ChitterError("Could not remove message", e);
        } finally {
            client.release();
        }
    }

    async editMessage(
        userToken: string,
        messageId: string,
        content: { text: string; facets: Facet[]; embed?: Embed; attachmentIds?: string[] }
    ): Promise<ErrorEditMessage | void> {
        const client = await this.pool.connect();
        try {
            await client.query("BEGIN");

            // Validate userToken and get user details
            const userQuery = `SELECT id, role, room_id FROM users WHERE token = $1;`;
            const userResult = await client.query(userQuery, [userToken]);
            if (userResult.rows.length === 0) {
                await client.query("ROLLBACK");
                return new ChitterError("Invalid user token");
            }
            const userId = userResult.rows[0].id;
            const userRole = userResult.rows[0].role;
            const userRoomId = userResult.rows[0].room_id;

            // Check if the user is the author of the message or an admin in the same room
            const messageQuery = `SELECT user_id, room_id FROM messages WHERE id = $1;`;
            const messageResult = await client.query(messageQuery, [messageId]);
            if (messageResult.rows.length === 0) {
                await client.query("ROLLBACK");
                return new ChitterError("Message not found");
            }
            const { user_id: authorId, room_id: messageRoomId } = messageResult.rows[0];

            if (userId !== authorId && (userRole !== "admin" || userRoomId !== messageRoomId)) {
                await client.query("ROLLBACK");
                return new ChitterError("User not authorized to edit this message");
            }

            // Sanitize and validate message content
            const validatedContent = sanitizeMessageContent(content);
            if (validatedContent instanceof ChitterError) {
                await client.query("ROLLBACK");
                return validatedContent;
            }

            // Fetch and replace attachment IDs with full attachment info
            if (validatedContent.attachmentIds && validatedContent.attachmentIds.length > 0) {
                const attachmentQuery = `SELECT * FROM attachments WHERE id = ANY($1::uuid[]) AND user_id = $2;`;
                const attachmentResult = await client.query(attachmentQuery, [validatedContent.attachmentIds, userId]);
                if (attachmentResult.rows.length !== validatedContent.attachmentIds.length) {
                    await client.query("ROLLBACK");
                    return new ChitterError("Invalid attachment IDs");
                }
                (validatedContent as any).attachments = attachmentResult.rows; // Assuming Attachment type matches the table structure
                delete validatedContent.attachmentIds; // Remove attachmentIds field
            }

            // Update the message
            const updateMessageQuery = `UPDATE messages SET content = $1 WHERE id = $2;`;
            await client.query(updateMessageQuery, [JSON.stringify(validatedContent), messageId]);

            await client.query("COMMIT");
        } catch (e) {
            await client.query("ROLLBACK");
            return new ChitterError("Could not edit message", e);
        } finally {
            client.release();
        }
    }

    async updateRoom(
        adminToken: string,
        displayName: string,
        adminInviteOnly: boolean,
        description?: string,
        logoId?: string
    ): Promise<ErrorUpdateRoom | void> {
        const client = await this.pool.connect();
        try {
            await client.query("BEGIN");

            // Validate adminToken
            const adminQuery = `SELECT id, room_id FROM users WHERE token = $1 AND role = 'admin';`;
            const adminResult = await client.query(adminQuery, [adminToken]);
            if (adminResult.rows.length === 0) {
                await client.query("ROLLBACK");
                return new ChitterError("Invalid admin token");
            }
            const roomId = adminResult.rows[0].room_id;

            if (logoId) {
                const logoQuery = `SELECT id FROM attachments WHERE id = $1 AND type = 'image';`;
                const logoResult = await client.query(logoQuery, [logoId]);
                if (logoResult.rows.length === 0) {
                    await client.query("ROLLBACK");
                    return new ChitterError("Invalid or non-image logo attachment");
                }
            }

            // Update the room
            const updateRoomQuery = `
            UPDATE rooms
            SET display_name = $1, description = $2, logo_id = $3, admin_invite_only = $4
            WHERE id = $5;
            `;
            await client.query(updateRoomQuery, [displayName, description, logoId, adminInviteOnly, roomId]);

            await client.query("COMMIT");
        } catch (e) {
            await client.query("ROLLBACK");
            return new ChitterError("Could not update room", e);
        } finally {
            client.release();
        }
    }

    async updateUser(userToken: string, displayName: string, description?: string, avatar?: UUID): Promise<ErrorUpdateUser | void> {
        const client = await this.pool.connect();
        try {
            await client.query("BEGIN");

            // Validate userToken
            const userQuery = `SELECT id FROM users WHERE token = $1;`;
            const userResult = await client.query(userQuery, [userToken]);
            if (userResult.rows.length === 0) {
                await client.query("ROLLBACK");
                return new ChitterError("Invalid user token");
            }
            const userId = userResult.rows[0].id;

            // Check if the avatar attachment exists, belongs to the user, and is an image
            if (avatar) {
                const attachmentQuery = `SELECT id FROM attachments WHERE id = $1 AND user_id = $2 AND type = 'image';`;
                const attachmentResult = await client.query(attachmentQuery, [avatar, userId]);
                if (attachmentResult.rows.length === 0) {
                    await client.query("ROLLBACK");
                    return new ChitterError("Invalid or non-image avatar attachment");
                }
            }

            // Update the user's profile
            const updateUserQuery = `
            UPDATE users
            SET display_name = $1, description = $2, avatar_id = $3
            WHERE id = $4;
            `;
            await client.query(updateUserQuery, [displayName, description, avatar, userId]);

            await client.query("COMMIT");
        } catch (e) {
            await client.query("ROLLBACK");
            return new ChitterError("Could not update user", e);
        } finally {
            client.release();
        }
    }

    async setUserRole(adminToken: string, userId: string, role: "admin" | "participant"): Promise<ErrorSetUserRole | void> {
        const client = await this.pool.connect();
        try {
            await client.query("BEGIN");

            // Validate the admin token and get the admin's room_id
            const adminQuery = `SELECT id, room_id FROM users WHERE token = $1 AND role = 'admin';`;
            const adminResult = await client.query(adminQuery, [adminToken]);
            if (adminResult.rows.length === 0) {
                await client.query("ROLLBACK");
                return new ChitterError("Invalid admin token or non-admin user");
            }
            const adminRoomId = adminResult.rows[0].room_id;

            // Check if the target user is in the same room as the admin
            const userQuery = `SELECT room_id FROM users WHERE id = $1;`;
            const userResult = await client.query(userQuery, [userId]);
            if (userResult.rows.length === 0 || userResult.rows[0].room_id !== adminRoomId) {
                await client.query("ROLLBACK");
                return new ChitterError("User not found in admin's room");
            }

            // Update the user's role
            const updateUserRoleQuery = `UPDATE users SET role = $1 WHERE id = $2;`;
            await client.query(updateUserRoleQuery, [role, userId]);

            await client.query("COMMIT");
        } catch (e) {
            await client.query("ROLLBACK");
            return new ChitterError("Could not change user role", e);
        } finally {
            client.release();
        }
    }

    async getMessages(
        userToken: string,
        channelId?: UUID, // Optional: for fetching messages from a specific channel
        directMessageUserId?: UUID, // Optional: for fetching direct messages between two users
        cursor?: string,
        limit: number = 25
    ): Promise<ErrorGetMessages | Message[]> {
        const client = await this.pool.connect();
        try {
            // Validate userToken
            const userQuery = `SELECT id, room_id FROM users WHERE token = $1;`;
            const userResult = await client.query(userQuery, [userToken]);
            if (userResult.rows.length === 0) {
                return new ChitterError("Invalid user token");
            }
            const userId = userResult.rows[0].id;
            const userRoomId = userResult.rows[0].room_id;

            if (!channelId && !directMessageUserId) {
                return new ChitterError("Either channelId or directMessageUserId must be provided");
            }

            let messagesQuery: string;
            let queryParameters: any[];

            if (channelId) {
                // Check if the channel is private and if the user is a member
                const channelQuery = `SELECT is_private FROM channels WHERE id = $1 AND room_id = $2;`;
                const channelResult = await client.query(channelQuery, [channelId, userRoomId]);
                if (channelResult.rows.length === 0) {
                    return new ChitterError("Channel not found in user's room");
                }
                const isPrivate = channelResult.rows[0].is_private;
                if (isPrivate) {
                    const memberQuery = `SELECT 1 FROM private_channel_members WHERE channel_id = $1 AND user_id = $2;`;
                    const memberResult = await client.query(memberQuery, [channelId, userId]);
                    if (memberResult.rows.length === 0) {
                        return new ChitterError("User is not a member of the private channel");
                    }
                }

                // Fetch messages from the channel
                messagesQuery = `
                SELECT m.id, m.content, m.created_at, u.id as user_id, u.display_name, u.description, u.avatar_id, u.role
                FROM messages m
                JOIN users u ON m.user_id = u.id
                WHERE m.channel_id = $1
                ORDER BY m.id DESC
                LIMIT $2;
                `;
                queryParameters = [channelId, limit];
            } else {
                // Fetch direct messages between two users
                messagesQuery = `
                SELECT m.id, m.content, m.created_at, u.id as user_id, u.display_name, u.description, u.avatar_id, u.role
                FROM messages m
                JOIN users u ON m.user_id = u.id
                WHERE (m.direct_message_user_id = $1 AND m.user_id = $2)
                   OR (m.direct_message_user_id = $2 AND m.user_id = $1)
                ORDER BY m.id DESC
                LIMIT $3;
                `;
                queryParameters = [directMessageUserId, userId, limit];
            }

            const messagesResult = await client.query(messagesQuery, queryParameters);

            // Construct the messages array
            const messages = messagesResult.rows.map((messageRow) => {
                return {
                    id: messageRow.id,
                    user: {
                        id: messageRow.user_id,
                        displayName: messageRow.display_name,
                        description: messageRow.description,
                        avatar: messageRow.avatar_id,
                        role: messageRow.role,
                        createdAt: messageRow.created_at,
                    },
                    createdAt: messageRow.created_at,
                    content: JSON.parse(messageRow.content),
                } as Message;
            });

            return messages;
        } catch (e) {
            return new ChitterError("Could not get messages", e);
        } finally {
            client.release();
        }
    }

    async getUsers(
        userToken: string,
        channelId?: UUID // Optional: for fetching users from a specific channel
    ): Promise<ErrorGetUsers | User[]> {
        const client = await this.pool.connect();
        try {
            // Validate userToken and retrieve the user's room_id
            const userQuery = `SELECT id, room_id FROM users WHERE token = $1;`;
            const userResult = await client.query(userQuery, [userToken]);
            if (userResult.rows.length === 0) {
                return new ChitterError("Invalid user token");
            }
            const userId = userResult.rows[0].id;
            const userRoomId = userResult.rows[0].room_id;

            let usersQuery: string;
            let queryParameters: any[];

            if (channelId) {
                // Fetch users from a specific channel
                usersQuery = `
                SELECT u.id, u.display_name, u.description, u.avatar_id, u.role, u.created_at
                FROM users u
                JOIN private_channel_members pcm ON u.id = pcm.user_id
                WHERE pcm.channel_id = $1;
                `;
                queryParameters = [channelId];
            } else {
                // Fetch all users in the user's room
                usersQuery = `
                SELECT id, display_name, description, avatar_id, role, created_at
                FROM users
                WHERE room_id = $1;
                `;
                queryParameters = [userRoomId];
            }

            const usersResult = await client.query(usersQuery, queryParameters);

            // Construct the users array
            const users = usersResult.rows.map((userRow) => {
                return {
                    id: userRow.id,
                    displayName: userRow.display_name,
                    description: userRow.description,
                    avatar: userRow.avatar_id,
                    role: userRow.role,
                    createdAt: userRow.created_at,
                } as User;
            });

            return users;
        } catch (e) {
            return new ChitterError("Could not get users", e);
        } finally {
            client.release();
        }
    }

    async getUser(userToken: string, userId: UUID): Promise<ErrorGetUser | User> {
        const client = await this.pool.connect();
        try {
            // Validate userToken
            const userQuery = `SELECT id FROM users WHERE token = $1;`;
            const userResult = await client.query(userQuery, [userToken]);
            if (userResult.rows.length === 0) {
                return new ChitterError("Invalid user token");
            }

            // Fetch details of the specified user
            const targetUserQuery = `
            SELECT id, display_name, description, avatar_id, role, created_at
            FROM users
            WHERE id = $1;
            `;
            const targetUserResult = await client.query(targetUserQuery, [userId]);
            if (targetUserResult.rows.length === 0) {
                return new ChitterError("User not found");
            }

            const targetUser = targetUserResult.rows[0];
            return {
                id: targetUser.id,
                displayName: targetUser.display_name,
                description: targetUser.description,
                avatar: targetUser.avatar_id,
                role: targetUser.role,
                createdAt: targetUser.created_at,
            } as User;
        } catch (e) {
            return new ChitterError("Could not retrieve user details", e);
        } finally {
            client.release();
        }
    }

    async getChannels(userToken: string): Promise<ErrorGetChannels | Channel[]> {
        const client = await this.pool.connect();
        try {
            // Validate userToken
            const userQuery = `SELECT id, room_id FROM users WHERE token = $1;`;
            const userResult = await client.query(userQuery, [userToken]);
            if (userResult.rows.length === 0) {
                return new ChitterError("Invalid user token");
            }
            const userId = userResult.rows[0].id;
            const userRoomId = userResult.rows[0].room_id;

            // Fetch all public channels and private channels where the user is a member
            const channelsQuery = `
            SELECT c.id, c.room_id, c.created_at, c.display_name, c.description, c.is_private, c.created_by
            FROM channels c
            LEFT JOIN private_channel_members pcm ON c.id = pcm.channel_id
            WHERE c.room_id = $1 AND (c.is_private = false OR pcm.user_id = $2);
            `;
            const channelsResult = await client.query(channelsQuery, [userRoomId, userId]);

            // Construct the channels array
            const channels = channelsResult.rows.map((channelRow) => {
                return {
                    id: channelRow.id,
                    roomId: channelRow.room_id,
                    createdAt: channelRow.created_at,
                    displayName: channelRow.display_name,
                    description: channelRow.description,
                    isPrivate: channelRow.is_private,
                    createdBy: channelRow.created_by,
                } as Channel;
            });

            return channels;
        } catch (e) {
            return new ChitterError("Could not retrieve channels", e);
        } finally {
            client.release();
        }
    }

    async createChannel(adminToken: string, displayName: string, isPrivate: boolean): Promise<ErrorCreateChannel | UUID> {
        const client = await this.pool.connect();
        try {
            await client.query("BEGIN");

            // Validate admin token and retrieve admin's room_id
            const adminQuery = `SELECT id, room_id FROM users WHERE token = $1 AND role = 'admin';`;
            const adminResult = await client.query(adminQuery, [adminToken]);
            if (adminResult.rows.length === 0) {
                await client.query("ROLLBACK");
                return new ChitterError("Invalid admin token or non-admin user");
            }
            const adminId = adminResult.rows[0].id;
            const adminRoomId = adminResult.rows[0].room_id;

            // Create new channel
            const channelId = uuidv4();
            const createChannelQuery = `
            INSERT INTO channels (id, room_id, created_at, display_name, is_private, created_by)
            VALUES ($1, $2, NOW(), $3, $4, $5)
            RETURNING id;
            `;
            const createChannelValues = [channelId, adminRoomId, displayName, isPrivate, adminId];
            const channelResult = await client.query(createChannelQuery, createChannelValues);
            const newChannelId = channelResult.rows[0].id;

            await client.query("COMMIT");
            return newChannelId;
        } catch (e) {
            await client.query("ROLLBACK");
            return new ChitterError("Could not create channel", e);
        } finally {
            client.release();
        }
    }

    async removeChannel(adminToken: string, channelId: UUID): Promise<ErrorRemoveChannel | void> {
        const client = await this.pool.connect();
        try {
            await client.query("BEGIN");

            // Validate admin token and retrieve admin's room_id
            const adminQuery = `SELECT id, room_id FROM users WHERE token = $1 AND role = 'admin';`;
            const adminResult = await client.query(adminQuery, [adminToken]);
            if (adminResult.rows.length === 0) {
                await client.query("ROLLBACK");
                return new ChitterError("Invalid admin token or non-admin user");
            }
            const adminId = adminResult.rows[0].id;
            const adminRoomId = adminResult.rows[0].room_id;

            // Remove the channel if it belongs to the admin's room
            const removeChannelQuery = `DELETE FROM channels WHERE id = $1 AND room_id = $2;`;
            await client.query(removeChannelQuery, [channelId, adminRoomId]);

            await client.query("COMMIT");
        } catch (e) {
            await client.query("ROLLBACK");
            return new ChitterError("Could not remove channel", e);
        } finally {
            client.release();
        }
    }

    async updateChannel(adminToken: string, channelId: UUID, displayName: string, description: string): Promise<ErrorUpdateChannel | void> {
        const client = await this.pool.connect();
        try {
            await client.query("BEGIN");

            // Validate admin token and retrieve admin's room_id
            const adminQuery = `SELECT id, room_id FROM users WHERE token = $1 AND role = 'admin';`;
            const adminResult = await client.query(adminQuery, [adminToken]);
            if (adminResult.rows.length === 0) {
                await client.query("ROLLBACK");
                return new ChitterError("Invalid admin token or non-admin user");
            }
            const adminId = adminResult.rows[0].id;
            const adminRoomId = adminResult.rows[0].room_id;

            // Update the channel details
            const updateChannelQuery = `
            UPDATE channels
            SET display_name = $1, description = $2
            WHERE id = $3 AND room_id = $4;
            `;
            await client.query(updateChannelQuery, [displayName, description, channelId, adminRoomId]);

            await client.query("COMMIT");
        } catch (e) {
            await client.query("ROLLBACK");
            return new ChitterError("Could not update channel", e);
        } finally {
            client.release();
        }
    }

    async addUserToChannel(adminToken: string, userId: UUID, channelId: UUID): Promise<ErrorAddUserToChannel | void> {
        const client = await this.pool.connect();
        try {
            await client.query("BEGIN");

            // Validate admin token and retrieve admin's room_id
            const adminQuery = `SELECT id, room_id FROM users WHERE token = $1 AND role = 'admin';`;
            const adminResult = await client.query(adminQuery, [adminToken]);
            if (adminResult.rows.length === 0) {
                await client.query("ROLLBACK");
                return new ChitterError("Invalid admin token or non-admin user");
            }
            const adminRoomId = adminResult.rows[0].room_id;

            // Ensure the channel is private and belongs to the admin's room
            const channelQuery = `SELECT is_private FROM channels WHERE id = $1 AND room_id = $2;`;
            const channelResult = await client.query(channelQuery, [channelId, adminRoomId]);
            if (channelResult.rows.length === 0 || !channelResult.rows[0].is_private) {
                await client.query("ROLLBACK");
                return new ChitterError("Channel not found or not private");
            }

            // Add user to the channel
            const addUserQuery = `INSERT INTO private_channel_members (channel_id, user_id) VALUES ($1, $2);`;
            await client.query(addUserQuery, [channelId, userId]);

            await client.query("COMMIT");
        } catch (e) {
            await client.query("ROLLBACK");
            return new ChitterError("Could not add user to channel", e);
        } finally {
            client.release();
        }
    }

    async removeUserFromChannel(adminToken: string, userId: UUID, channelId: UUID): Promise<ErrorRemoveUserFromChannel | void> {
        const client = await this.pool.connect();
        try {
            await client.query("BEGIN");

            // Validate admin token and retrieve admin's room_id
            const adminQuery = `SELECT id, room_id FROM users WHERE token = $1 AND role = 'admin';`;
            const adminResult = await client.query(adminQuery, [adminToken]);
            if (adminResult.rows.length === 0) {
                await client.query("ROLLBACK");
                return new ChitterError("Invalid admin token or non-admin user");
            }
            const adminRoomId = adminResult.rows[0].room_id;

            // Ensure the channel is private and belongs to the admin's room
            const channelQuery = `SELECT is_private FROM channels WHERE id = $1 AND room_id = $2;`;
            const channelResult = await client.query(channelQuery, [channelId, adminRoomId]);
            if (channelResult.rows.length === 0 || !channelResult.rows[0].is_private) {
                await client.query("ROLLBACK");
                return new ChitterError("Channel not found or not private");
            }

            // Remove user from the channel
            const removeUserQuery = `DELETE FROM private_channel_members WHERE channel_id = $1 AND user_id = $2;`;
            await client.query(removeUserQuery, [channelId, userId]);

            await client.query("COMMIT");
        } catch (e) {
            await client.query("ROLLBACK");
            return new ChitterError("Could not remove user from channel", e);
        } finally {
            client.release();
        }
    }
}
