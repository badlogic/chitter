export type UtcTimestamp = number;
export type UUID = string;

export interface Room {
    id: UUID;
    createdAt: UtcTimestamp;
    displayName: string;
    description?: string;
    logo?: UUID;
    adminInviteOnly: boolean;
}

export interface Channel {
    id: UUID;
    roomId: UUID;
    createdAt: UtcTimestamp;
    displayName: string;
    description?: string;
    isPrivate: boolean;
    createdBy: UUID;
}

export interface UserBasic {
    id: UUID;
    roomId: UUID;
    createdAt: UtcTimestamp;
    displayName: string;
    description?: string;
    avatar?: UUID;
    role: "admin" | "participant";
}

export interface User extends UserBasic {
    token: string;
}

export interface Facet {
    type: "mention" | "link" | "code";
    start: number;
    end: number;
    value?: string;
}

export interface MessageEmbed {
    messageId: UUID;
    roomId: UUID;
}

export interface ExternalEmbed {
    uri: string;
    title: string;
    description: string;
    thumb?: string;
}

export type Embed = MessageEmbed | ExternalEmbed;

export type MessageContent = {
    text: string;
    facets: Facet[];
    embed?: Embed;
    attachments?: Attachment[];
};

export interface Message {
    id: number;
    user: UserBasic;
    createdAt: UtcTimestamp;
    content: MessageContent;
    channelId?: UUID;
    directMessageUserId?: UUID;
}

export interface Attachment {
    type: "image" | "video" | "file";
    id: UUID;
    userId: string;
    fileName: string;
    path: string;
    width?: number;
    height?: number;
    createdAt: UtcTimestamp;
}

export type ErrorReason =
    | "Could not create tables"
    | "Could not create room and admin"
    | "User not found"
    | "User is not an admin and room is admin invite only"
    | "Could not create invite code"
    | "Invalid invite code"
    | "Display name already exists in the room"
    | "Could not create user from invite code"
    | "Invalid admin token"
    | "User not found in admin's room"
    | "Could not remove user"
    | "Invalid content structure"
    | "Invalid text content"
    | "Invalid facet"
    | "Invalid embed"
    | "Invalid user token"
    | "Could not create message"
    | "Message not found"
    | "User not authorized to delete this message"
    | "Could not remove message"
    | "User not authorized to edit this message"
    | "Could not edit message"
    | "Invalid or non-image logo attachment"
    | "Could not update room"
    | "Could not update user"
    | "Invalid or non-image avatar attachment"
    | "Invalid attachment IDs"
    | "Could not get messages"
    | "Could not get users"
    | "Message cannot target both a channel and a direct user"
    | "Channel not found in user's room"
    | "User is not a member of the private channel"
    | "Invalid admin token or non-admin user"
    | "User not found in admin's room"
    | "Could not change user role"
    | "Either channelId or directMessageUserId must be provided"
    | "Could not retrieve user details"
    | "Could not retrieve channels"
    | "Could not create channel"
    | "Could not remove channel"
    | "Could not update channel"
    | "Channel not found or not private"
    | "Could not add user to channel"
    | "Could not remove user from channel"
    | "Could not create transfer code"
    | "No valid tokens"
    | "Invalid or expired transfer code"
    | "Could not fetch user data from transfer code"
    | "Invalid token"
    | "Could not upload attachment"
    | "Could not remove attachment"
    | "Attachment not found"
    | "Unexpected error"
    | "Unknown server error"
    | "Invalid parameters"
    | "Invalid file type"
    | "Room not found"
    | "Could not retrieve room details"
    | "Could not retrieve channel details"
    | "Channel not found";

export class ChitterError<T extends ErrorReason> extends Error {
    constructor(readonly reason: T, readonly e?: any) {
        super(reason);
        console.error(reason, e);
    }
}

export type ErrorSanitizeMessageContent = Extract<
    ErrorReason,
    "Invalid content structure" | "Invalid text content" | "Invalid facet" | "Invalid embed"
>;

export type SuccessCreateRoomAndAdmin = { room: Room; admin: User; generalChannel: Channel };
export type ErrorCreateRoomAndAdmin = Extract<ErrorReason, "Could not create room and admin">;

export type SuccessCreateInviteCode = { inviteCode: string };
export type ErrorCreateInviteCode = Extract<
    ErrorReason,
    "User not found" | "User is not an admin and room is admin invite only" | "Could not create invite code"
>;

export type SuccessCreateUserFromInviteCode = User;
export type ErrorCreateUserFromInviteCode = Extract<
    ErrorReason,
    "Invalid invite code" | "Display name already exists in the room" | "Could not create user from invite code"
>;

export type SuccessRemoveUser = void;
export type ErrorRemoveUser = Extract<ErrorReason, "Invalid admin token" | "User not found in admin's room" | "Could not remove user">;

export type SuccessCreateTransferBundle = { transferCode: string };
export type ErrorCreateTransferBundle = Extract<ErrorReason, "No valid tokens" | "Could not create transfer code">;

export type SuccessGetTransferBundleFromCode = User[];
export type ErrorGetTransferBundleFromCode = Extract<
    ErrorReason,
    "Invalid or expired transfer code" | "Could not fetch user data from transfer code"
>;

export type SuccessCreateMessage = { messageId: number };
export type ErrorCreateMessage = Extract<
    ErrorReason,
    | "Invalid user token"
    | "Could not create message"
    | "Invalid content structure"
    | "Invalid text content"
    | "Invalid facet"
    | "Invalid embed"
    | "Invalid attachment IDs"
    | "Message cannot target both a channel and a direct user"
    | "Channel not found in user's room"
    | "User is not a member of the private channel"
>;

export type SuccessRemoveMessage = void;
export type ErrorRemoveMessage = Extract<
    ErrorReason,
    "Invalid user token" | "Message not found" | "User not authorized to delete this message" | "Could not remove message"
>;

export type SuccessEditMessage = void;
export type ErrorEditMessage = Extract<
    ErrorReason,
    | "Invalid user token"
    | "Message not found"
    | "User not authorized to edit this message"
    | "Could not edit message"
    | "Invalid content structure"
    | "Invalid text content"
    | "Invalid facet"
    | "Invalid embed"
    | "Invalid attachment IDs"
>;

export type SuccessUpdateRoom = void;
export type ErrorUpdateRoom = Extract<ErrorReason, "Invalid admin token" | "Invalid or non-image logo attachment" | "Could not update room">;

export type SuccessUpdateUser = void;
export type ErrorUpdateUser = Extract<ErrorReason, "Invalid user token" | "Invalid or non-image avatar attachment" | "Could not update user">;

export type SuccessSetUserRole = void;
export type ErrorSetUserRole = Extract<
    ErrorReason,
    "Invalid admin token or non-admin user" | "User not found in admin's room" | "Could not change user role"
>;

export type SuccessGetMessages = Message[];
export type ErrorGetMessages = Extract<
    ErrorReason,
    | "Invalid user token"
    | "Could not get messages"
    | "Either channelId or directMessageUserId must be provided"
    | "User is not a member of the private channel"
    | "Channel not found in user's room"
>;

export type SuccessGetUsers = UserBasic[];
export type ErrorGetUsers = Extract<ErrorReason, "Invalid user token" | "Could not get users">;

export type SuccessGetRoom = Room;
export type ErrorGetRoom = Extract<ErrorReason, "Invalid user token" | "Room not found" | "Could not retrieve room details">;

export type SuccessGetUser = UserBasic;
export type ErrorGetUser = Extract<ErrorReason, "Invalid user token" | "User not found" | "Could not retrieve user details">;

export type SuccessGetChannels = Channel[];
export type ErrorGetChannels = Extract<ErrorReason, "Invalid user token" | "Could not retrieve channels">;

export type SuccessGetChannel = Channel;
export type ErrorGetChannel = Extract<ErrorReason, "Invalid user token" | "Channel not found" | "Could not retrieve channel details">;

export type SuccessCreateChannel = { channelId: UUID };
export type ErrorCreateChannel = Extract<ErrorReason, "Invalid admin token or non-admin user" | "Could not create channel">;

export type SuccessRemoveChannel = void;
export type ErrorRemoveChannel = Extract<ErrorReason, "Invalid admin token or non-admin user" | "Could not remove channel">;

export type SuccessUpdateChannel = void;
export type ErrorUpdateChannel = Extract<ErrorReason, "Invalid admin token or non-admin user" | "Could not update channel">;

export type SuccessAddUserToChannel = void;
export type ErrorAddUserToChannel = Extract<
    ErrorReason,
    "Invalid admin token or non-admin user" | "Channel not found or not private" | "Could not add user to channel"
>;

export type SuccessRemoveUserFromChannel = void;
export type ErrorRemoveUserFromChannel = Extract<
    ErrorReason,
    "Invalid admin token or non-admin user" | "Channel not found or not private" | "Could not remove user from channel"
>;

export type SuccessUploadAttachment = Attachment;
export type ErrorUploadAttachment = Extract<ErrorReason, "Invalid token" | "Could not upload attachment" | "Invalid file type">;

export type SuccessRemoveAttachment = void;
export type ErrorRemoveAttachment = Extract<ErrorReason, "Invalid token" | "Could not remove attachment" | "Attachment not found">;

function sanitizeFacet(facet: any): Facet | undefined {
    if (!facet || typeof facet !== "object") {
        return undefined;
    }
    return {
        type: typeof facet.type === "string" ? facet.type : null,
        start: typeof facet.start === "number" ? facet.start : null,
        end: typeof facet.end === "number" ? facet.end : null,
        value: typeof facet.value === "string" ? facet.value : undefined, // Optional
    };
}

function sanitizeEmbed(embed: any): Embed | undefined {
    if (typeof embed !== "object" || !embed) {
        return undefined;
    }

    if ("messageId" in embed && "roomId" in embed) {
        return {
            messageId: typeof embed.messageId === "string" ? embed.messageId : null,
            roomId: typeof embed.roomId === "string" ? embed.roomId : null,
        };
    } else if ("uri" in embed && "title" in embed && "description" in embed) {
        return {
            uri: typeof embed.uri === "string" ? embed.uri : null,
            title: typeof embed.title === "string" ? embed.title : null,
            description: typeof embed.description === "string" ? embed.description : null,
            thumb: typeof embed.thumb === "string" ? embed.thumb : undefined, // Optional
        };
    }

    return undefined;
}

function isValidFacet(facet: Facet, textLength: number): boolean {
    const validTypes = ["mention", "link", "code"];
    if (!validTypes.includes(facet.type)) {
        return false;
    }
    if (typeof facet.start !== "number" || typeof facet.end !== "number") {
        return false;
    }
    if (facet.start < 0 || facet.end > textLength || facet.start >= facet.end) {
        return false;
    }
    if (facet.value !== undefined && typeof facet.value !== "string") {
        return false;
    }
    return true;
}

function isValidEmbed(embed: Embed): boolean {
    if ("messageId" in embed && "roomId" in embed) {
        // Validate MessageEmbed
        return isUUID(embed.messageId) && isUUID(embed.roomId) && Object.keys(embed).length === 2;
    } else if ("uri" in embed && "title" in embed && "description" in embed) {
        // Validate ExternalEmbed
        const hasValidFields = typeof embed.uri === "string" && typeof embed.title === "string" && typeof embed.description === "string";
        const hasOptionalThumb = !embed.thumb || typeof embed.thumb === "string";
        const hasOnlyValidFields = Object.keys(embed).every((key) => ["uri", "title", "description", "thumb"].includes(key));
        return hasValidFields && hasOptionalThumb && hasOnlyValidFields;
    }
    return false;
}

function isUUID(str: string): boolean {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidRegex.test(str);
}

export function sanitizeMessageContent(content: any):
    | {
          text: string;
          facets: Facet[];
          embed?: Embed;
          attachmentIds?: string[];
      }
    | ChitterError<ErrorSanitizeMessageContent> {
    if (typeof content !== "object" || content === null) {
        return new ChitterError("Invalid content structure");
    }

    const sanitizedContent: {
        text: string;
        facets: Facet[];
        embed?: Embed;
        attachmentIds?: string[];
    } = {
        text: typeof content.text === "string" ? content.text : "",
        facets: Array.isArray(content.facets)
            ? (content.facets.map((f: any) => sanitizeFacet(f)).filter((facet: Facet | undefined) => facet !== undefined) as Facet[])
            : [],
        embed: content.embed ? sanitizeEmbed(content.embed) : undefined,
        attachmentIds: Array.isArray(content.attachmentIds)
            ? content.attachmentIds.filter((id: any) => typeof id === "string" && isUUID(id))
            : undefined,
    };

    // Validate content
    if (sanitizedContent.text === "") {
        return new ChitterError("Invalid text content");
    }

    for (const facet of sanitizedContent.facets) {
        if (!isValidFacet(facet, sanitizedContent.text.length)) {
            return new ChitterError("Invalid facet");
        }
    }

    if (sanitizedContent.embed && !isValidEmbed(sanitizedContent.embed)) {
        return new ChitterError("Invalid embed");
    }

    return sanitizedContent;
}

export interface JsonValue {
    [key: string]: any;
}

export type ApiResponse<T, E extends ErrorReason = ErrorReason> = ApiResponseSuccess<T> | ApiResponseError<E>;

interface ApiResponseSuccess<T> {
    success: true;
    data: T;
}

export interface ApiResponseError<E extends ErrorReason> {
    success: false;
    error: E | "Invalid parameters" | "Unknown server error";
    validationErrors?: any;
}
