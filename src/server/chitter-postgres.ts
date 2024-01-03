import { Pool } from "pg";
import fs from "fs";
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
    ErrorCreateRoomAndAdmin,
    ErrorGetTransferBundleFromCode,
    ErrorCreateTransferBundle,
    ErrorCreateUserFromInviteCode,
    ErrorEditMessage,
    ErrorGetChannels,
    ErrorGetMessages,
    ErrorGetUser,
    ErrorGetUsers,
    ErrorReason,
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
    Room,
    SuccessAddUserToChannel,
    SuccessCreateChannel,
    SuccessCreateInviteCode,
    SuccessCreateMessage,
    SuccessCreateRoomAndAdmin,
    SuccessCreateUserFromInviteCode,
    SuccessEditMessage,
    SuccessGetChannels,
    SuccessGetMessages,
    SuccessGetUser,
    SuccessGetUsers,
    SuccessRemoveAttachment,
    SuccessRemoveChannel,
    SuccessRemoveUserFromChannel,
    SuccessSetUserRole,
    SuccessUpdateChannel,
    SuccessUpdateRoom,
    SuccessUpdateUser,
    SuccessUploadAttachment,
    SuccessRemoveUser,
    UUID,
    User,
    sanitizeMessageContent,
    SuccessCreateTransferBundle,
    SuccessGetTransferBundleFromCode,
    UserBasic,
    MessageContent,
    ErrorGetRoom,
    SuccessGetRoom,
    ErrorGetChannel,
} from "../common/common";
import { Chitter } from "./chitter";

type SnakeToCamelCase<S extends string> = S extends `${infer T}_${infer U}` ? `${T}${Capitalize<SnakeToCamelCase<U>>}` : S;

export function snakeToCamelCase<T extends Record<string, any>>(obj: T): { [K in keyof T as SnakeToCamelCase<K & string>]: T[K] } {
    const result: any = {};
    for (const key in obj) {
        const camelCaseKey = key.replace(/(_\w)/g, (m) => m[1].toUpperCase());
        result[camelCaseKey] = obj[key];
    }
    return result;
}

function removeNullProperties<T>(obj: T): T {
    for (const key in obj) {
        if (obj[key] === null) {
            delete obj[key];
        }
    }
    return obj;
}

export class PostgresChitterDatabase implements Chitter {
    private pool: Pool;
    private inviteCodes: Map<string, { roomId: string; expiresAt: Date }>;
    private transferCodes: Map<string, { userIds: string[]; expiresAt: Date }>;
    private closed = false;
    private cleanupCodesTimeout: any;

    constructor(pool: Pool) {
        this.pool = pool;
        this.inviteCodes = new Map();
        this.transferCodes = new Map();
        this.cleanupCodes();
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
        await this.pool.end();
        this.closed = true;
        clearTimeout(this.cleanupCodesTimeout);
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
              direct_message_user_id UUID,
              edited BOOLEAN DEFAULT false
            );
          `);

            await this.pool.query(`
            CREATE TABLE IF NOT EXISTS attachments (
              id UUID PRIMARY KEY,
              type TEXT NOT NULL CHECK (type IN ('image', 'video', 'file')),
              user_id UUID,
              file_name TEXT NOT NULL,
              path TEXT NOT NULL,
              width INT,
              height INT,
              created_at TIMESTAMPTZ NOT NULL
            );
          `);

            // Add index on 'token' column of 'users' table for fast lookup by token
            await this.pool.query(`CREATE INDEX IF NOT EXISTS idx_users_token ON users (token);`);

            // Add index on 'id' column of 'users' table for fast lookup by id
            await this.pool.query(`CREATE INDEX IF NOT EXISTS idx_users_id ON users (id);`);

            // Add index on 'id' column of 'messages' table for ordering messages
            await this.pool.query(`CREATE INDEX IF NOT EXISTS idx_messages_id ON messages (id);`);

            // Add index on 'user_id' and 'channel_id' columns of 'messages' table for fast message retrieval
            await this.pool.query(`CREATE INDEX IF NOT EXISTS idx_messages_user_id ON messages (user_id);`);
            await this.pool.query(`CREATE INDEX IF NOT EXISTS idx_messages_channel_id ON messages (channel_id);`);

            return;
        } catch (e) {
            return new ChitterError("Could not create tables", e);
        }
    }

    async createRoomAndAdmin(
        roomName: string,
        adminName: string,
        adminInviteOnly: boolean
    ): Promise<ChitterError<ErrorCreateRoomAndAdmin> | SuccessCreateRoomAndAdmin> {
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
            RETURNING id, created_at, display_name, admin_invite_only;
            `;
            const roomValues = [roomId, roomName, adminInviteOnly];
            const roomResult = await client.query(roomQuery, roomValues);
            const room: Room = roomResult.rows[0];

            // Create the admin user
            const adminQuery = `
            INSERT INTO users (id, room_id, created_at, token, display_name, role)
            VALUES ($1, $2, NOW(), $3, $4, 'admin')
            RETURNING id, room_id, created_at, token, display_name, role;
            `;
            const adminValues = [adminId, roomId, adminToken, adminName];
            const adminResult = await client.query(adminQuery, adminValues);
            const admin: User = adminResult.rows[0];

            // Create a public "General" channel
            const generalChannelId = uuidv4();
            const channelQuery = `
            INSERT INTO channels (id, room_id, created_at, display_name, is_private, created_by)
            VALUES ($1, $2, NOW(), 'General', false, $3)
            RETURNING id, room_id, created_at, display_name, is_private, created_by;
            `;
            const channelValues = [generalChannelId, roomId, adminId];
            const channelResult = await client.query(channelQuery, channelValues);
            const generalChannel: Channel = channelResult.rows[0];

            await client.query("COMMIT");

            const result = { room: snakeToCamelCase(room), admin: snakeToCamelCase(admin), generalChannel: snakeToCamelCase(generalChannel) };
            result.room.createdAt = new Date(result.room.createdAt).getTime();
            result.admin.createdAt = new Date(result.admin.createdAt).getTime();
            result.generalChannel.createdAt = new Date(result.room.createdAt).getTime();
            return result;
        } catch (e) {
            await client.query("ROLLBACK");
            return new ChitterError("Could not create room and admin", e);
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
    ): Promise<ChitterError<ErrorUpdateRoom> | SuccessUpdateRoom> {
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

    async getRoom(userToken: string, roomId: UUID): Promise<ChitterError<ErrorGetRoom> | SuccessGetRoom> {
        const client = await this.pool.connect();
        try {
            // Validate userToken
            const userQuery = `SELECT id, room_id FROM users WHERE token = $1;`;
            const userResult = await client.query(userQuery, [userToken]);
            if (userResult.rows.length === 0) {
                return new ChitterError("Invalid user token");
            }

            if (userResult.rows[0].room_id != roomId) {
                return new ChitterError("Room not found");
            }

            // Fetch details of the specified room
            const targetRoomQuery = `
            SELECT id, created_at, display_name, admin_invite_only, description, logo_id
            FROM rooms
            WHERE id = $1;
            `;
            const targetRoomResult = await client.query(targetRoomQuery, [roomId]);
            if (targetRoomResult.rows.length === 0) {
                return new ChitterError("Room not found");
            }

            const targetRoom = targetRoomResult.rows[0];
            const room: Room = {
                id: targetRoom.id,
                createdAt: new Date(targetRoom.created_at).getTime(),
                displayName: targetRoom.display_name,
                adminInviteOnly: targetRoom.admin_invite_only,
                description: targetRoom.description,
                logo: targetRoom.logo_id,
            };
            return room;
        } catch (e) {
            return new ChitterError("Could not retrieve room details", e);
        } finally {
            client.release();
        }
    }

    async createInviteCode(userToken: string): Promise<ChitterError<ErrorCreateInviteCode> | SuccessCreateInviteCode> {
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
            if (user.admin_invite_only && user.role !== "admin") {
                return new ChitterError("User is not an admin and room is admin invite only");
            }

            const inviteCode = uuidv4(); // Generate a UUID
            const expiresAt = new Date(Date.now() + 86400000); // 24 hours from now
            this.inviteCodes.set(inviteCode, { roomId: user.room_id, expiresAt });

            return { inviteCode };
        } catch (e) {
            return new ChitterError("Could not create invite code", e);
        } finally {
            client.release();
        }
    }

    async createUserFromInviteCode(
        inviteCode: string,
        displayName: string
    ): Promise<ChitterError<ErrorCreateUserFromInviteCode> | SuccessCreateUserFromInviteCode> {
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
            const newUser = userResult.rows[0];

            await client.query("COMMIT");

            // Invalidate the invite code by removing it from the map
            this.inviteCodes.delete(inviteCode);

            return snakeToCamelCase<User>(newUser);
        } catch (e) {
            await client.query("ROLLBACK");
            return new ChitterError("Could not create user from invite code", e);
        } finally {
            client.release();
        }
    }

    async removeUser(userId: string, adminToken: string): Promise<ChitterError<ErrorRemoveUser> | SuccessRemoveUser> {
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

    async updateUser(
        userToken: string,
        displayName: string,
        description?: string,
        avatar?: UUID
    ): Promise<ChitterError<ErrorUpdateUser> | SuccessUpdateUser> {
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

    async setUserRole(
        adminToken: string,
        userId: string,
        role: "admin" | "participant"
    ): Promise<ChitterError<ErrorSetUserRole> | SuccessSetUserRole> {
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

    async getUsers(
        userToken: string,
        channelId?: UUID // Optional: for fetching users from a specific channel
    ): Promise<ChitterError<ErrorGetUsers> | SuccessGetUsers> {
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
                SELECT u.id, u.room_id, u.display_name, u.description, u.avatar_id, u.role, u.created_at
                FROM users u
                JOIN private_channel_members pcm ON u.id = pcm.user_id
                WHERE pcm.channel_id = $1;
                `;
                queryParameters = [channelId];
            } else {
                // Fetch all users in the user's room
                usersQuery = `
                SELECT id, room_id, display_name, description, avatar_id, role, created_at
                FROM users
                WHERE room_id = $1;
                `;
                queryParameters = [userRoomId];
            }

            const usersResult = await client.query(usersQuery, queryParameters);

            // Construct the users array
            const users = usersResult.rows.map((userRow) => {
                const user: UserBasic = {
                    id: userRow.id,
                    roomId: userRow.room_id,
                    displayName: userRow.display_name,
                    description: userRow.description,
                    avatar: userRow.avatar_id,
                    role: userRow.role,
                    createdAt: new Date(userRow.created_at).getTime(),
                };
                return removeNullProperties(user);
            });

            return users;
        } catch (e) {
            return new ChitterError("Could not get users", e);
        } finally {
            client.release();
        }
    }

    async getUser(userToken: string, userId: UUID): Promise<ChitterError<ErrorGetUser> | SuccessGetUser> {
        const client = await this.pool.connect();
        try {
            // Validate userToken
            const userQuery = `SELECT id, room_id FROM users WHERE token = $1;`;
            const userResult = await client.query(userQuery, [userToken]);
            if (userResult.rows.length === 0) {
                return new ChitterError("Invalid user token");
            }
            const roomId = userResult.rows[0].room_id;

            // Fetch details of the specified user
            const targetUserQuery = `
            SELECT id, room_id, display_name, description, avatar_id, role, created_at
            FROM users
            WHERE id = $1 AND room_id = $2;
            `;
            const targetUserResult = await client.query(targetUserQuery, [userId, roomId]);
            if (targetUserResult.rows.length === 0) {
                return new ChitterError("User not found");
            }

            const targetUser = targetUserResult.rows[0];
            const user: UserBasic = {
                id: targetUser.id,
                roomId: targetUser.room_id,
                displayName: targetUser.display_name,
                description: targetUser.description,
                avatar: targetUser.avatar_id,
                role: targetUser.role,
                createdAt: new Date(targetUser.created_at).getTime(),
            };
            return removeNullProperties(user);
        } catch (e) {
            return new ChitterError("Could not retrieve user details", e);
        } finally {
            client.release();
        }
    }

    async createTransferBundle(userTokens: string[]): Promise<ChitterError<ErrorCreateTransferBundle> | SuccessCreateTransferBundle> {
        const client = await this.pool.connect();
        try {
            const userQuery = `SELECT id FROM users WHERE token = ANY($1::text[]);`;
            const userResult = await client.query(userQuery, [userTokens]);

            // Extract valid user IDs
            const validUserIds = userResult.rows.map((row) => row.id);

            // Proceed only if there's at least one valid token
            if (validUserIds.length === 0) {
                return new ChitterError("No valid tokens");
            }

            const transferCode = uuidv4();
            const expiresAt = new Date(Date.now() + 3600000); // 1 hour from now

            this.transferCodes.set(transferCode, { userIds: validUserIds, expiresAt });

            return { transferCode };
        } catch (e) {
            return new ChitterError("Could not create transfer code", e);
        } finally {
            client.release();
        }
    }

    async getTransferBundleFromCode(transferCode: string): Promise<ChitterError<ErrorGetTransferBundleFromCode> | SuccessGetTransferBundleFromCode> {
        const transferData = this.transferCodes.get(transferCode);
        if (!transferData || transferData.expiresAt < new Date()) {
            return new ChitterError("Invalid or expired transfer code");
        }

        const client = await this.pool.connect();
        try {
            const usersQuery = `SELECT id, room_id, created_at, token, display_name, description, avatar_id, role FROM users WHERE id = ANY($1::uuid[]);`;
            const usersResult = await client.query(usersQuery, [transferData.userIds]);

            const users: User[] = usersResult.rows.map((row) => {
                const user: User = {
                    id: row.id,
                    roomId: row.room_id,
                    createdAt: new Date(row.created_at).getTime(),
                    token: row.token,
                    displayName: row.display_name,
                    description: row.description,
                    avatar: row.avatar_id,
                    role: row.role,
                };
                return removeNullProperties(user);
            });

            this.transferCodes.delete(transferCode);

            return users;
        } catch (e) {
            return new ChitterError("Could not fetch user data from transfer code", e);
        } finally {
            client.release();
        }
    }

    async createMessage(
        userToken: string,
        content: { text: string; facets: Facet[]; embed?: Embed; attachmentIds?: string[] },
        channelId?: UUID, // Optional, for channel messages
        directMessageUserId?: UUID // Optional, for direct messages
    ): Promise<ChitterError<ErrorCreateMessage> | SuccessCreateMessage> {
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

            return { messageId: newMessageId };
        } catch (e) {
            await client.query("ROLLBACK");
            return new ChitterError("Could not create message", e);
        } finally {
            client.release();
        }
    }

    async removeMessage(userToken: string, messageId: string): Promise<ChitterError<ErrorRemoveMessage> | void> {
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
    ): Promise<ChitterError<ErrorEditMessage> | SuccessEditMessage> {
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
            const updateMessageQuery = `UPDATE messages SET content = $1, edited = $2 WHERE id = $3;`;
            await client.query(updateMessageQuery, [JSON.stringify(validatedContent), true, messageId]);

            await client.query("COMMIT");
        } catch (e) {
            await client.query("ROLLBACK");
            return new ChitterError("Could not edit message", e);
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
    ): Promise<ChitterError<ErrorGetMessages> | SuccessGetMessages> {
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

            const select = `SELECT m.id, m.content, m.created_at, m.channel_id, m.direct_message_user_id, u.id as user_id, u.room_id, u.display_name, u.description, u.avatar_id, u.role, u.created_at as user_created_at`;
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
                queryParameters = [channelId, limit];
                messagesQuery = `
                ${select}
                FROM messages m
                JOIN users u ON m.user_id = u.id
                WHERE m.channel_id = $1
                `;
                if (cursor) {
                    messagesQuery += ` AND m.id < $3`;
                    queryParameters.push(cursor);
                }
                messagesQuery += `
                    ORDER BY m.id DESC
                    LIMIT $2;
                `;
            } else {
                // Fetch direct messages between two users
                queryParameters = [directMessageUserId, userId, limit];
                messagesQuery = `
                ${select}
                FROM messages m
                JOIN users u ON m.user_id = u.id
                WHERE (m.direct_message_user_id = $1 AND m.user_id = $2)
                   OR (m.direct_message_user_id = $2 AND m.user_id = $1)
                   `;
                if (cursor) {
                    messagesQuery += ` AND m.id < $4`;
                    queryParameters.push(cursor);
                }
                messagesQuery += `
                    ORDER BY m.id DESC
                    LIMIT $3;
                `;
            }

            const messagesResult = await client.query(messagesQuery, queryParameters);

            // Construct the messages array
            const messages: Message[] = messagesResult.rows.map((messageRow) => {
                const user: UserBasic = removeNullProperties({
                    id: messageRow.user_id,
                    roomId: messageRow.room_id,
                    displayName: messageRow.display_name,
                    description: messageRow.description,
                    avatar: messageRow.avatar_id,
                    role: messageRow.role,
                    createdAt: new Date(messageRow.user_created_at).getTime(),
                });
                return removeNullProperties({
                    id: messageRow.id,
                    user,
                    createdAt: new Date(messageRow.created_at).getTime(),
                    content: messageRow.content as MessageContent,
                    channelId: messageRow.channel_id,
                    directMessageUserId: messageRow.direct_message_user_id,
                });
            });

            return messages;
        } catch (e) {
            return new ChitterError("Could not get messages", e);
        } finally {
            client.release();
        }
    }

    async createChannel(
        adminToken: string,
        displayName: string,
        isPrivate: boolean
    ): Promise<ChitterError<ErrorCreateChannel> | SuccessCreateChannel> {
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

            // Add admin to channel if it is private
            if (isPrivate) {
                const addUserQuery = `INSERT INTO private_channel_members (channel_id, user_id) VALUES ($1, $2);`;
                await client.query(addUserQuery, [channelId, adminId]);
            }

            await client.query("COMMIT");
            return { channelId: newChannelId };
        } catch (e) {
            await client.query("ROLLBACK");
            return new ChitterError("Could not create channel", e);
        } finally {
            client.release();
        }
    }

    async removeChannel(adminToken: string, channelId: UUID): Promise<ChitterError<ErrorRemoveChannel> | SuccessRemoveChannel> {
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

    async updateChannel(
        adminToken: string,
        channelId: UUID,
        displayName: string,
        description: string
    ): Promise<ChitterError<ErrorUpdateChannel> | SuccessUpdateChannel> {
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

    async getChannels(userToken: string): Promise<ChitterError<ErrorGetChannels> | SuccessGetChannels> {
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
                const channel: Channel = {
                    id: channelRow.id,
                    roomId: channelRow.room_id,
                    createdAt: new Date(channelRow.created_at).getTime(),
                    displayName: channelRow.display_name,
                    description: channelRow.description,
                    isPrivate: channelRow.is_private,
                    createdBy: channelRow.created_by,
                };
                return removeNullProperties(channel);
            });

            return channels;
        } catch (e) {
            return new ChitterError("Could not retrieve channels", e);
        } finally {
            client.release();
        }
    }

    async getChannel(userToken: string, channelId: string): Promise<Channel | ChitterError<ErrorGetChannel>> {
        const client = await this.pool.connect();
        try {
            // Validate userToken
            const userQuery = `SELECT id, room_id FROM users WHERE token = $1;`;
            const userResult = await client.query(userQuery, [userToken]);
            if (userResult.rows.length === 0) {
                return new ChitterError("Invalid user token");
            }
            const userId = userResult.rows[0].id;
            const roomId = userResult.rows[0].room_id;

            // Fetch details of the specified channel
            const targetChannelQuery = `
            SELECT c.id, c.room_id, c.created_at, c.display_name, c.description, c.is_private, c.created_by
            FROM channels c
            LEFT JOIN private_channel_members pcm ON c.id = pcm.channel_id
            WHERE c.id = $1 AND c.room_id = $2 AND (c.is_private = false OR pcm.user_id = $3);
            `;
            const targetChannelResult = await client.query(targetChannelQuery, [channelId, roomId, userId]);
            if (targetChannelResult.rows.length === 0) {
                return new ChitterError("Channel not found");
            }

            const targetChannel = targetChannelResult.rows[0];
            const channel: Channel = {
                id: targetChannel.id,
                roomId: targetChannel.room_id,
                createdAt: new Date(targetChannel.created_at).getTime(),
                displayName: targetChannel.display_name,
                description: targetChannel.description,
                isPrivate: targetChannel.is_private,
                createdBy: targetChannel.created_by,
            };
            return removeNullProperties(channel);
        } catch (e) {
            return new ChitterError("Could not retrieve channel details", e);
        } finally {
            client.release();
        }
    }

    async addUserToChannel(
        adminToken: string,
        userId: UUID,
        channelId: UUID
    ): Promise<ChitterError<ErrorAddUserToChannel> | SuccessAddUserToChannel> {
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

    async removeUserFromChannel(
        adminToken: string,
        userId: UUID,
        channelId: UUID
    ): Promise<ChitterError<ErrorRemoveUserFromChannel> | SuccessRemoveUserFromChannel> {
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

    async uploadAttachment(
        token: string,
        attachment: {
            type: "image" | "video" | "file";
            fileName: string;
            path: string;
            width?: number;
            height?: number;
        }
    ): Promise<ChitterError<ErrorUploadAttachment> | SuccessUploadAttachment> {
        const client = await this.pool.connect();

        try {
            // Validate the user token and get the user ID
            const userQuery = `SELECT id FROM users WHERE token = $1;`;
            const userResult = await client.query(userQuery, [token]);

            if (userResult.rowCount === 0) {
                throw new ChitterError("Invalid token");
            }

            const userId = userResult.rows[0].id;

            // Insert attachment data into the database
            const insertQuery = `
                INSERT INTO attachments (id, type, user_id, file_name, path, width, height, created_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
                RETURNING id, type, user_id, file_name, path, width, height, created_at;
            `;
            const insertValues = [uuidv4(), attachment.type, userId, attachment.fileName, attachment.path, attachment.width, attachment.height];
            const insertResult = await client.query(insertQuery, insertValues);

            const row = insertResult.rows[0];
            const result: Attachment = {
                id: row.id,
                type: row.type,
                userId: row.user_id,
                fileName: row.file_name,
                path: row.path,
                width: row.width,
                height: row.height,
                createdAt: new Date(row.created_at).getTime(),
            };
            return removeNullProperties(result);
        } catch (e) {
            throw new ChitterError("Could not upload attachment", e);
        } finally {
            client.release();
        }
    }

    async removeAttachment(token: string, attachmentId: string): Promise<ChitterError<ErrorRemoveAttachment> | SuccessRemoveAttachment> {
        const client = await this.pool.connect();

        try {
            // Validate the user token and get the user ID
            const userQuery = `SELECT id FROM users WHERE token = $1;`;
            const userResult = await client.query(userQuery, [token]);
            if (userResult.rowCount === 0) {
                throw new ChitterError("Invalid token");
            }

            const userId = userResult.rows[0].id;

            // Get the attachment to verify ownership and get file path
            const attachmentQuery = `SELECT * FROM attachments WHERE id = $1 AND user_id = $2;`;
            const attachmentResult = await client.query(attachmentQuery, [attachmentId, userId]);

            if (attachmentResult.rowCount === 0) {
                throw new ChitterError("Attachment not found");
            }

            const attachment = attachmentResult.rows[0];

            // Delete the file from the filesystem
            if (fs.existsSync(attachment.path)) {
                fs.unlinkSync(attachment.path);
            }

            // Delete the attachment record from the database
            const deleteQuery = `DELETE FROM attachments WHERE id = $1;`;
            await client.query(deleteQuery, [attachmentId]);
        } catch (e) {
            throw new ChitterError("Could not remove attachment", e);
        } finally {
            client.release();
        }
    }
}
