import {
    ApiResponse,
    ErrorAddUserToChannel,
    ErrorCreateChannel,
    ErrorCreateInviteCode,
    ErrorCreateMessage,
    ErrorCreateRoomAndAdmin,
    ErrorCreateTransferBundle,
    ErrorCreateUserFromInviteCode,
    ErrorEditMessage,
    ErrorGetChannels,
    ErrorGetMessages,
    ErrorGetTransferBundleFromCode,
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
    JsonValue,
    MessageContent,
    SuccessAddUserToChannel,
    SuccessCreateChannel,
    SuccessCreateInviteCode,
    SuccessCreateMessage,
    SuccessCreateRoomAndAdmin,
    SuccessCreateTransferBundle,
    SuccessCreateUserFromInviteCode,
    SuccessEditMessage,
    SuccessGetChannels,
    SuccessGetMessages,
    SuccessGetTransferBundleFromCode,
    SuccessGetUser,
    SuccessGetUsers,
    SuccessRemoveAttachment,
    SuccessRemoveChannel,
    SuccessRemoveMessage,
    SuccessRemoveUser,
    SuccessRemoveUserFromChannel,
    SuccessSetUserRole,
    SuccessUpdateChannel,
    SuccessUpdateRoom,
    SuccessUpdateUser,
    SuccessUploadAttachment,
} from "./common";
import { error } from "../utils/utils";

function apiBaseUrl() {
    if (typeof location === "undefined") return "http://localhost:3333/api/";
    return location.href.includes("localhost") || location.href.includes("192.168.1") ? `http://${location.hostname}:3333/api/` : "/api/";
}

export async function apiGet<T, E extends ErrorReason = ErrorReason>(
    endpoint: string,
    token?: string
): Promise<ApiResponse<T, E | "Unknown server error">> {
    try {
        const headers = token ? { headers: { Authorization: token } } : undefined;
        const result = await fetch(apiBaseUrl() + endpoint, headers);
        return (await result.json()) as ApiResponse<T, E | "Unknown server error">;
    } catch (e) {
        error(`GET request /api/${endpoint} failed`, e);
        return { success: false, error: "Unknown server error" };
    }
}

export async function apiPost<T, E extends ErrorReason = ErrorReason>(
    endpoint: string,
    params: URLSearchParams | FormData,
    token?: string
): Promise<ApiResponse<T, E | "Unknown server error">> {
    let headers: HeadersInit = {};
    let body: string | FormData;

    if (params instanceof URLSearchParams) {
        headers = { "Content-Type": "application/x-www-form-urlencoded" };
        body = params.toString();
    } else {
        body = params;
    }

    if (token) headers = { ...headers, Authorization: token };

    try {
        const result = await fetch(apiBaseUrl() + endpoint, {
            method: "POST",
            headers: headers,
            body: body,
        });
        return (await result.json()) as ApiResponse<T, E | "Unknown server error">;
    } catch (e) {
        error(`POST request /api/${endpoint} failed`, e);
        return { success: false, error: "Unknown server error" };
    }
}

export function toUrlBody(params: JsonValue) {
    const urlParams = new URLSearchParams();
    for (const key in params) {
        const value = params[key];
        const type = typeof value;
        if (type == "string" || type == "number" || type == "boolean") {
            urlParams.append(key, value.toString());
        } else if (typeof value == "object") {
            urlParams.append(key, JSON.stringify(value));
        } else {
            throw new Error("Unsupported value type: " + typeof value);
        }
    }
    return urlParams;
}

export class Api {
    static async createRoomAndAdmin(
        roomName: string,
        adminName: string,
        adminInviteOnly: boolean
    ): Promise<ApiResponse<SuccessCreateRoomAndAdmin, ErrorCreateRoomAndAdmin>> {
        try {
            const params = toUrlBody({ roomName, adminName, adminInviteOnly });
            const result = await apiPost<SuccessCreateRoomAndAdmin, ErrorCreateRoomAndAdmin>("createRoomAndAdmin", params);
            return result;
        } catch (e) {
            error("Could not create room and admin", e);
            return { success: false, error: "Could not create room and admin" };
        }
    }

    static async createInviteCode(token: string): Promise<ApiResponse<SuccessCreateInviteCode, ErrorCreateInviteCode>> {
        try {
            const result = await apiPost<SuccessCreateInviteCode, ErrorCreateInviteCode>("createInviteCode", new URLSearchParams(), token);
            return result;
        } catch (e) {
            error("Could not create invite code", e);
            return { success: false, error: "Could not create invite code" };
        }
    }

    static async createUserFromInviteCode(
        inviteCode: string,
        displayName: string
    ): Promise<ApiResponse<SuccessCreateUserFromInviteCode, ErrorCreateUserFromInviteCode>> {
        try {
            const params = toUrlBody({ inviteCode, displayName });
            const result = await apiPost<SuccessCreateUserFromInviteCode, ErrorCreateUserFromInviteCode>("createUserFromInviteCode", params);
            return result;
        } catch (e) {
            error("Could not create user from invite code", e);
            return { success: false, error: "Could not create user from invite code" };
        }
    }

    static async removeUser(token: string, userId: string): Promise<ApiResponse<SuccessRemoveUser, ErrorRemoveUser>> {
        try {
            const params = toUrlBody({ userId });
            const result = await apiPost<SuccessRemoveUser, ErrorRemoveUser>("removeUser", params, token);
            return result;
        } catch (e) {
            error("Could not remove user", e);
            return { success: false, error: "Could not remove user" };
        }
    }

    static async createTransferBundle(
        token: string,
        userTokens: string[]
    ): Promise<ApiResponse<SuccessCreateTransferBundle, ErrorCreateTransferBundle>> {
        try {
            const params = toUrlBody({ userTokens });
            const result = await apiPost<SuccessCreateTransferBundle, ErrorCreateTransferBundle>("createTransferBundle", params, token);
            return result;
        } catch (e) {
            error("Could not create transfer code", e);
            return { success: false, error: "Could not create transfer code" };
        }
    }

    static async createTransferBundleFromCode(
        transferCode: string
    ): Promise<ApiResponse<SuccessGetTransferBundleFromCode, ErrorGetTransferBundleFromCode>> {
        try {
            const params = toUrlBody({ transferCode });
            const result = await apiPost<SuccessGetTransferBundleFromCode, ErrorGetTransferBundleFromCode>("getTransferBundleFromCode", params);
            return result;
        } catch (e) {
            error("Could not fetch user data from transfer code", e);
            return { success: false, error: "Could not fetch user data from transfer code" };
        }
    }

    static async createMessage(
        token: string,
        content: MessageContent,
        channelId?: string,
        directMessageUserId?: string
    ): Promise<ApiResponse<SuccessCreateMessage, ErrorCreateMessage>> {
        try {
            const params = toUrlBody({ content, channelId, directMessageUserId });
            const result = await apiPost<SuccessCreateMessage, ErrorCreateMessage>("createMessage", params, token);
            return result;
        } catch (e) {
            error("Could not create message", e);
            return { success: false, error: "Could not create message" };
        }
    }

    static async removeMessage(token: string, messageId: string): Promise<ApiResponse<SuccessRemoveMessage, ErrorRemoveMessage>> {
        try {
            const params = toUrlBody({ messageId });
            const result = await apiPost<SuccessRemoveMessage, ErrorRemoveMessage>("removeMessage", params, token);
            return result;
        } catch (e) {
            error("Could not remove message", e);
            return { success: false, error: "Could not remove message" };
        }
    }

    static async editMessage(token: string, messageId: string, content: MessageContent): Promise<ApiResponse<SuccessEditMessage, ErrorEditMessage>> {
        try {
            const params = toUrlBody({ messageId, content });
            const result = await apiPost<SuccessEditMessage, ErrorEditMessage>("editMessage", params, token);
            return result;
        } catch (e) {
            error("Could not edit message", e);
            return { success: false, error: "Could not edit message" };
        }
    }

    static async updateRoom(
        token: string,
        displayName: string,
        adminInviteOnly: boolean,
        description?: string,
        logoId?: string
    ): Promise<ApiResponse<SuccessUpdateRoom, ErrorUpdateRoom>> {
        try {
            const params = toUrlBody({ displayName, adminInviteOnly, description, logoId });
            const result = await apiPost<SuccessUpdateRoom, ErrorUpdateRoom>("updateRoom", params, token);
            return result;
        } catch (e) {
            error("Could not update room", e);
            return { success: false, error: "Could not update room" };
        }
    }

    static async updateUser(
        token: string,
        displayName?: string,
        description?: string,
        avatar?: string
    ): Promise<ApiResponse<SuccessUpdateUser, ErrorUpdateUser>> {
        try {
            const params = toUrlBody({ displayName, description, avatar });
            const result = await apiPost<SuccessUpdateUser, ErrorUpdateUser>("updateUser", params, token);
            return result;
        } catch (e) {
            error("Could not update user", e);
            return { success: false, error: "Could not update user" };
        }
    }

    static async setUserRole(
        token: string,
        userId: string,
        role: "admin" | "participant"
    ): Promise<ApiResponse<SuccessSetUserRole, ErrorSetUserRole>> {
        try {
            const params = toUrlBody({ userId, role });
            const result = await apiPost<SuccessSetUserRole, ErrorSetUserRole>("setUserRole", params, token);
            return result;
        } catch (e) {
            error("Could not set change role", e);
            return { success: false, error: "Could not change user role" };
        }
    }

    static async getMessages(
        token: string,
        channelId?: string,
        directMessageUserId?: string,
        cursor?: string,
        limit?: number
    ): Promise<ApiResponse<SuccessGetMessages, ErrorGetMessages>> {
        try {
            let endpoint = "getMessages";
            let queryParams = new URLSearchParams();
            if (channelId) queryParams.append("channelId", channelId);
            if (directMessageUserId) queryParams.append("directMessageUserId", directMessageUserId);
            if (cursor) queryParams.append("cursor", cursor);
            if (limit) queryParams.append("limit", limit.toString());
            if (queryParams.toString()) endpoint += `?${queryParams}`;

            const result = await apiGet<SuccessGetMessages, ErrorGetMessages>(endpoint, token);
            return result;
        } catch (e) {
            error("Could not get messages", e);
            return { success: false, error: "Could not get messages" };
        }
    }

    static async getUsers(token: string, channelId?: string): Promise<ApiResponse<SuccessGetUsers, ErrorGetUsers>> {
        try {
            const endpoint = channelId ? `getUsers?channelId=${encodeURIComponent(channelId)}` : "getUsers";
            const result = await apiGet<SuccessGetUsers, ErrorGetUsers>(endpoint, token);
            return result;
        } catch (e) {
            error("Could not get users", e);
            return { success: false, error: "Could not get users" };
        }
    }

    static async getUser(token: string, userId: string): Promise<ApiResponse<SuccessGetUser, ErrorGetUser>> {
        try {
            const endpoint = `getUser?userId=${encodeURIComponent(userId)}`;
            const result = await apiGet<SuccessGetUser, ErrorGetUser>(endpoint, token);
            return result;
        } catch (e) {
            error("User not found", e);
            return { success: false, error: "User not found" };
        }
    }

    static async getChannels(token: string): Promise<ApiResponse<SuccessGetChannels, ErrorGetChannels>> {
        try {
            const endpoint = `getChannels`;
            const result = await apiGet<SuccessGetChannels, ErrorGetChannels>(endpoint, token);
            return result;
        } catch (e) {
            error("Could not retrieve channels", e);
            return { success: false, error: "Could not retrieve channels" };
        }
    }

    static async createChannel(
        token: string,
        displayName: string,
        isPrivate: boolean
    ): Promise<ApiResponse<SuccessCreateChannel, ErrorCreateChannel>> {
        try {
            const params = toUrlBody({ displayName, isPrivate });
            const result = await apiPost<SuccessCreateChannel, ErrorCreateChannel>("createChannel", params, token);
            return result;
        } catch (e) {
            error("Could not create channel", e);
            return { success: false, error: "Could not create channel" };
        }
    }

    static async removeChannel(token: string, channelId: string): Promise<ApiResponse<SuccessRemoveChannel, ErrorRemoveChannel>> {
        try {
            const params = toUrlBody({ channelId });
            const result = await apiPost<SuccessRemoveChannel, ErrorRemoveChannel>("removeChannel", params, token);
            return result;
        } catch (e) {
            error("Could not remove channel", e);
            return { success: false, error: "Could not remove channel" };
        }
    }

    static async updateChannel(
        token: string,
        channelId: string,
        displayName: string,
        description: string
    ): Promise<ApiResponse<SuccessUpdateChannel, ErrorUpdateChannel>> {
        try {
            const params = toUrlBody({ channelId, displayName, description });
            const result = await apiPost<SuccessUpdateChannel, ErrorUpdateChannel>("updateChannel", params, token);
            return result;
        } catch (e) {
            error("Could not update channel", e);
            return { success: false, error: "Could not update channel" };
        }
    }

    static async addUserToChannel(
        token: string,
        userId: string,
        channelId: string
    ): Promise<ApiResponse<SuccessAddUserToChannel, ErrorAddUserToChannel>> {
        try {
            const params = toUrlBody({ userId, channelId });
            const result = await apiPost<SuccessAddUserToChannel, ErrorAddUserToChannel>("addUserToChannel", params, token);
            return result;
        } catch (e) {
            error("Could not add user to channel", e);
            return { success: false, error: "Could not add user to channel" };
        }
    }

    static async removeUserFromChannel(
        token: string,
        userId: string,
        channelId: string
    ): Promise<ApiResponse<SuccessRemoveUserFromChannel, ErrorRemoveUserFromChannel>> {
        try {
            const params = toUrlBody({ userId, channelId });
            const result = await apiPost<SuccessRemoveUserFromChannel, ErrorRemoveUserFromChannel>("removeUserFromChannel", params, token);
            return result;
        } catch (e) {
            error("Could not remove user from channel", e);
            return { success: false, error: "Could not remove user from channel" };
        }
    }

    static async uploadAttachment(token: string, file: File): Promise<ApiResponse<SuccessUploadAttachment, ErrorUploadAttachment>> {
        try {
            const formData = new FormData();
            formData.append("file", file);
            const result = await apiPost<SuccessUploadAttachment, ErrorUploadAttachment>("uploadAttachment", formData, token);
            return result;
        } catch (e) {
            error("Could not upload attachment", e);
            return { success: false, error: "Could not upload attachment" };
        }
    }

    static async removeAttachment(token: string, attachmentId: string): Promise<ApiResponse<SuccessRemoveAttachment, ErrorRemoveAttachment>> {
        try {
            const params = toUrlBody({ attachmentId });
            const result = await apiPost<SuccessRemoveAttachment, ErrorRemoveAttachment>("removeAttachment", params, token);
            return result;
        } catch (e) {
            error("Could not remove attachment", e);
            return { success: false, error: "Could not remove attachment" };
        }
    }
}
