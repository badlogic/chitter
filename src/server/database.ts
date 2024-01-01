import {
    ChitterError,
    ErrorReason,
    ErrorCreateRoomAndAdmin,
    SuccessCreateRoomAndAdmin,
    ErrorCreateInviteCode,
    SuccessCreateInviteCode,
    ErrorCreateUserFromInviteCode,
    SuccessCreateUserFromInviteCode,
    ErrorRemoveUser,
    SuccessRemoveUser,
    ErrorCreateTransferBundle,
    SuccessCreateTransferBundle,
    ErrorGetTransferBundleFromCode,
    SuccessGetTransferBundleFromCode,
    Facet,
    Embed,
    UUID,
    ErrorCreateMessage,
    SuccessCreateMessage,
    ErrorRemoveMessage,
    ErrorEditMessage,
    SuccessEditMessage,
    ErrorUpdateRoom,
    SuccessUpdateRoom,
    ErrorUpdateUser,
    SuccessUpdateUser,
    ErrorSetUserRole,
    SuccessSetUserRole,
    ErrorGetMessages,
    SuccessGetMessages,
    ErrorGetUsers,
    SuccessGetUsers,
    ErrorGetUser,
    SuccessGetUser,
    ErrorGetChannels,
    SuccessGetChannels,
    ErrorCreateChannel,
    SuccessCreateChannel,
    ErrorRemoveChannel,
    SuccessRemoveChannel,
    ErrorUpdateChannel,
    SuccessUpdateChannel,
    ErrorAddUserToChannel,
    SuccessAddUserToChannel,
    ErrorRemoveUserFromChannel,
    SuccessRemoveUserFromChannel,
    ErrorUploadAttachment,
    SuccessUploadAttachment,
    ErrorRemoveAttachment,
    SuccessRemoveAttachment,
} from "../common/common";

export interface ChitterDatabase {
    initialize(): Promise<ChitterError<Extract<ErrorReason, "Could not create tables">> | void>;
    createRoomAndAdmin(
        roomName: string,
        adminName: string,
        adminInviteOnly: boolean
    ): Promise<ChitterError<ErrorCreateRoomAndAdmin> | SuccessCreateRoomAndAdmin>;
    createInviteCode(userToken: string): Promise<ChitterError<ErrorCreateInviteCode> | SuccessCreateInviteCode>;
    createUserFromInviteCode(
        inviteCode: string,
        displayName: string
    ): Promise<ChitterError<ErrorCreateUserFromInviteCode> | SuccessCreateUserFromInviteCode>;
    removeUser(userId: string, adminToken: string): Promise<ChitterError<ErrorRemoveUser> | SuccessRemoveUser>;
    createTransferBundle(userTokens: string[]): Promise<ChitterError<ErrorCreateTransferBundle> | SuccessCreateTransferBundle>;
    getTransferBundleFromCode(transferCode: string): Promise<ChitterError<ErrorGetTransferBundleFromCode> | SuccessGetTransferBundleFromCode>;
    createMessage(
        userToken: string,
        content: { text: string; facets: Facet[]; embed?: Embed; attachmentIds?: string[] },
        channelId?: UUID,
        directMessageUserId?: UUID
    ): Promise<ChitterError<ErrorCreateMessage> | SuccessCreateMessage>;
    removeMessage(userToken: string, messageId: string): Promise<ChitterError<ErrorRemoveMessage> | void>;
    editMessage(
        userToken: string,
        messageId: string,
        content: { text: string; facets: Facet[]; embed?: Embed; attachmentIds?: string[] }
    ): Promise<ChitterError<ErrorEditMessage> | SuccessEditMessage>;
    updateRoom(
        adminToken: string,
        displayName: string,
        adminInviteOnly: boolean,
        description?: string,
        logoId?: string
    ): Promise<ChitterError<ErrorUpdateRoom> | SuccessUpdateRoom>;
    updateUser(
        userToken: string,
        displayName: string,
        description?: string,
        avatar?: UUID
    ): Promise<ChitterError<ErrorUpdateUser> | SuccessUpdateUser>;
    setUserRole(adminToken: string, userId: string, role: "admin" | "participant"): Promise<ChitterError<ErrorSetUserRole> | SuccessSetUserRole>;
    getMessages(
        userToken: string,
        channelId?: UUID,
        directMessageUserId?: UUID,
        cursor?: string,
        limit?: number
    ): Promise<ChitterError<ErrorGetMessages> | SuccessGetMessages>;
    getUsers(userToken: string, channelId?: UUID): Promise<ChitterError<ErrorGetUsers> | SuccessGetUsers>;
    getUser(userToken: string, userId: UUID): Promise<ChitterError<ErrorGetUser> | SuccessGetUser>;
    getChannels(userToken: string): Promise<ChitterError<ErrorGetChannels> | SuccessGetChannels>;
    createChannel(adminToken: string, displayName: string, isPrivate: boolean): Promise<ChitterError<ErrorCreateChannel> | SuccessCreateChannel>;
    removeChannel(adminToken: string, channelId: UUID): Promise<ChitterError<ErrorRemoveChannel> | SuccessRemoveChannel>;
    updateChannel(
        adminToken: string,
        channelId: UUID,
        displayName: string,
        description: string
    ): Promise<ChitterError<ErrorUpdateChannel> | SuccessUpdateChannel>;
    addUserToChannel(adminToken: string, userId: UUID, channelId: UUID): Promise<ChitterError<ErrorAddUserToChannel> | SuccessAddUserToChannel>;
    removeUserFromChannel(
        adminToken: string,
        userId: UUID,
        channelId: UUID
    ): Promise<ChitterError<ErrorRemoveUserFromChannel> | SuccessRemoveUserFromChannel>;
    uploadAttachment(
        token: string,
        attachment: { type: "image" | "video" | "file"; fileName: string; path: string; width?: number; height?: number; createdAt: number }
    ): Promise<ChitterError<ErrorUploadAttachment> | SuccessUploadAttachment>;
    removeAttachment(token: string, attachmentId: string): Promise<ChitterError<ErrorRemoveAttachment> | SuccessRemoveAttachment>;
}
