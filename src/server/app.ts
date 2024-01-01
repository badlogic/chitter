import bodyParser from "body-parser";
import * as chokidar from "chokidar";
import compression from "compression";
import cors from "cors";
import express, { Request, Response } from "express";
import * as fs from "fs";
import * as http from "http";
import WebSocket, { WebSocketServer } from "ws";
import { Pool } from "pg";
import { sleep } from "../utils/utils.js";
import { PostgresChitterDatabase } from "./database-postgres.js";
import {
    ChitterError,
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
} from "../common/common.js";
import { body, header, query, validationResult } from "express-validator";
import multer from "multer";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { fileTypeFromFile } from "file-type";

function apiSuccess<T>(res: Response, data?: T) {
    return res.json({ sucess: true, data });
}

function apiError<E extends ErrorReason = ErrorReason>(res: Response, error: E, validationErrors?: any) {
    return res.status(400).json({ success: false, error, validationErrors });
}

async function waitForDatabase(pool: Pool, maxRetries = 5, interval = 2000) {
    let retries = 0;
    while (retries < maxRetries) {
        try {
            const client = await pool.connect();
            try {
                const result = await client.query("SELECT NOW()");
                console.log("Query result:", result.rows);
                return undefined; // Successful connection, exit the function
            } finally {
                client.release();
            }
        } catch (err) {
            console.error("Connection attempt failed:", err);
            retries++;
            if (retries === maxRetries) {
                return new Error("Failed to connect to the database after retries");
            }
            await sleep(interval);
        }
    }
}

function setupLiveReload(server: http.Server) {
    const wss = new WebSocketServer({ server });
    const clients: Set<WebSocket> = new Set();
    wss.on("connection", (ws: WebSocket) => {
        clients.add(ws);
        ws.on("close", () => {
            clients.delete(ws);
        });
    });

    chokidar.watch("html/", { ignored: /(^|[\/\\])\../, ignoreInitial: true }).on("all", (event, path) => {
        clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(`File changed: ${path}`);
            }
        });
    });
    console.log("Initialized live-reload");
}

export async function createApp(
    dbConfig: { name: string; user: string; password: string; host: string },
    uploadDirectory: string,
    port: string | number = 3333
) {
    // Initialize database
    const pool = new Pool({
        host: dbConfig.host,
        database: dbConfig.name,
        user: dbConfig.user,
        password: dbConfig.password,
        port: 5432,
    });
    const result = await waitForDatabase(pool, 5, 3000);
    if (result instanceof Error) throw result;
    const db = new PostgresChitterDatabase(pool);

    // Initialize file upload
    if (!fs.existsSync(uploadDirectory)) {
        fs.mkdirSync(uploadDirectory, { recursive: true });
    }
    const storage = multer.diskStorage({
        destination: (req, file, cb) => {
            cb(null, uploadDirectory); // Set the upload directory
        },
        filename: (req, file, cb) => {
            const fileExtension = path.extname(file.originalname);
            cb(null, uuidv4() + fileExtension); // Use UUID v4 as filename
        },
    });
    const upload = multer({
        storage: storage,
        limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
    });

    // Setup express server and endpoints
    const app = express();
    app.set("json spaces", 2);
    app.use(cors());
    app.use(compression());
    app.use(bodyParser.urlencoded({ extended: true }));
    app.use(express.json()); // Use express.json() instead of bodyParser for JSON payloads

    app.post(
        "/api/createRoomAndAdmin",
        [body("roomName").isString().trim().notEmpty(), body("adminName").isString().trim().notEmpty(), body("adminInviteOnly").isBoolean()],
        async (req: Request, res: Response) => {
            // Check for validation errors
            const errors = validationResult(req);
            if (!errors.isEmpty()) return apiError(res, "Invalid parameters", errors.array());

            try {
                const { roomName, adminName, adminInviteOnly } = req.body;
                const result = await db.createRoomAndAdmin(roomName, adminName, adminInviteOnly);
                if (result instanceof ChitterError) return apiError<ErrorCreateRoomAndAdmin>(res, result.reason);
                apiSuccess<SuccessCreateRoomAndAdmin>(res, result);
            } catch (err) {
                console.error(err);
                apiError(res, "Unknown server error");
            }
        }
    );

    app.post("/api/createInviteCode", [header("authorization").notEmpty()], async (req: Request, res: Response) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return apiError(res, "Invalid parameters", errors.array());

        try {
            const token = req.headers.authorization!;
            const inviteCode = await db.createInviteCode(token);
            if (inviteCode instanceof ChitterError) return apiError<ErrorCreateInviteCode>(res, inviteCode.reason);
            apiSuccess<SuccessCreateInviteCode>(res, inviteCode);
        } catch (err) {
            console.error(err);
            apiError(res, "Unknown server error");
        }
    });

    app.post(
        "/api/createUserFromInviteCode",
        [body("inviteCode").isString().trim().notEmpty(), body("displayName").isString().trim().notEmpty()],
        async (req: Request, res: Response) => {
            const errors = validationResult(req);
            if (!errors.isEmpty()) return apiError(res, "Invalid parameters", errors.array());

            try {
                const { inviteCode, displayName } = req.body;
                const user = await db.createUserFromInviteCode(inviteCode, displayName);
                if (user instanceof ChitterError) return apiError<ErrorCreateUserFromInviteCode>(res, user.reason);
                apiSuccess<SuccessCreateUserFromInviteCode>(res, user);
            } catch (err) {
                console.error(err);
                apiError(res, "Unknown server error");
            }
        }
    );

    app.post(
        "/api/removeUser",
        [header("authorization").notEmpty(), body("userId").isString().trim().notEmpty()],
        async (req: Request, res: Response) => {
            const errors = validationResult(req);
            if (!errors.isEmpty()) return apiError(res, "Invalid parameters", errors.array());

            try {
                const adminToken = req.headers.authorization!;
                const { userId } = req.body;
                const result = await db.removeUser(userId, adminToken);
                if (result instanceof ChitterError) return apiError<ErrorRemoveUser>(res, result.reason);
                apiSuccess<SuccessRemoveUser>(res);
            } catch (err) {
                console.error(err);
                apiError(res, "Unknown server error");
            }
        }
    );

    app.post("/api/createTransferBundle", [body("userTokens").isArray().isLength({ min: 1 })], async (req: Request, res: Response) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return apiError(res, "Invalid parameters", errors.array());

        try {
            const { userTokens } = req.body;
            const transferCode = await db.createTransferBundle(userTokens);
            if (transferCode instanceof ChitterError) return apiError<ErrorCreateTransferBundle>(res, transferCode.reason);
            apiSuccess<SuccessCreateTransferBundle>(res, transferCode);
        } catch (err) {
            console.error(err);
            apiError(res, "Unknown server error");
        }
    });

    app.post("/api/getTransferBundleFromCode", [body("transferCode").isString().trim().notEmpty()], async (req: Request, res: Response) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return apiError(res, "Invalid parameters", errors.array());

        try {
            const { transferCode } = req.body;
            const transferBundle = await db.getTransferBundleFromCode(transferCode);
            if (transferBundle instanceof ChitterError) return apiError<ErrorGetTransferBundleFromCode>(res, transferBundle.reason);
            apiSuccess<SuccessGetTransferBundleFromCode>(res, transferBundle);
        } catch (err) {
            console.error(err);
            apiError(res, "Unknown server error");
        }
    });

    app.post(
        "/api/createMessage",
        [
            header("authorization").notEmpty(),
            body("content").notEmpty(),
            body("channelId").optional().isString(),
            body("directMessageUserId").optional().isString(),
        ],
        async (req: Request, res: Response) => {
            const errors = validationResult(req);
            if (!errors.isEmpty()) return apiError(res, "Invalid parameters", errors.array());

            try {
                const token = req.headers.authorization!;
                const { content, channelId, directMessageUserId } = req.body;
                const result = await db.createMessage(token, content, channelId, directMessageUserId);
                if (result instanceof ChitterError) return apiError<ErrorCreateMessage>(res, result.reason);
                apiSuccess<SuccessCreateMessage>(res, result);
            } catch (err) {
                console.error(err);
                apiError(res, "Unknown server error");
            }
        }
    );

    app.post(
        "/api/removeMessage",
        [header("authorization").notEmpty(), body("messageId").isString().trim().notEmpty()],
        async (req: Request, res: Response) => {
            const errors = validationResult(req);
            if (!errors.isEmpty()) return apiError(res, "Invalid parameters", errors.array());

            try {
                const token = req.headers.authorization!;
                const { messageId } = req.body;
                const result = await db.removeMessage(token, messageId);
                if (result instanceof ChitterError) return apiError<ErrorRemoveMessage>(res, result.reason);
                apiSuccess<SuccessRemoveMessage>(res);
            } catch (err) {
                console.error(err);
                apiError(res, "Unknown server error");
            }
        }
    );

    app.post(
        "/api/editMessage",
        [header("authorization").notEmpty(), body("messageId").isString().trim().notEmpty(), body("content").notEmpty()],
        async (req: Request, res: Response) => {
            const errors = validationResult(req);
            if (!errors.isEmpty()) return apiError(res, "Invalid parameters", errors.array());

            try {
                const token = req.headers.authorization!;
                const { messageId, content } = req.body;
                const result = await db.editMessage(token, messageId, content);

                if (result instanceof ChitterError) return apiError<ErrorEditMessage>(res, result.reason);
                apiSuccess<SuccessEditMessage>(res);
            } catch (err) {
                console.error(err);
                apiError(res, "Unknown server error");
            }
        }
    );

    app.post(
        "/api/updateRoom",
        [
            header("authorization").notEmpty(),
            body("displayName").optional().isString().trim(),
            body("adminInviteOnly").optional().isBoolean(),
            body("description").optional().isString().trim(),
            body("logoId").optional().isString().trim(),
        ],
        async (req: Request, res: Response) => {
            const errors = validationResult(req);
            if (!errors.isEmpty()) return apiError(res, "Invalid parameters", errors.array());

            try {
                const adminToken = req.headers.authorization!;
                const { displayName, adminInviteOnly, description, logoId } = req.body;
                const result = await db.updateRoom(adminToken, displayName, adminInviteOnly, description, logoId);

                if (result instanceof ChitterError) return apiError<ErrorUpdateRoom>(res, result.reason);
                apiSuccess<SuccessUpdateRoom>(res);
            } catch (err) {
                console.error(err);
                apiError(res, "Unknown server error");
            }
        }
    );

    app.post(
        "/api/updateUser",
        [
            header("authorization").notEmpty(),
            body("displayName").optional().isString().trim(),
            body("description").optional().isString().trim(),
            body("avatar").optional().isString().trim(),
        ],
        async (req: Request, res: Response) => {
            const errors = validationResult(req);
            if (!errors.isEmpty()) return apiError(res, "Invalid parameters", errors.array());

            try {
                const userToken = req.headers.authorization!;
                const { displayName, description, avatar } = req.body;
                const result = await db.updateUser(userToken, displayName, description, avatar);

                if (result instanceof ChitterError) return apiError<ErrorUpdateUser>(res, result.reason);
                apiSuccess<SuccessUpdateUser>(res);
            } catch (err) {
                console.error(err);
                apiError(res, "Unknown server error");
            }
        }
    );

    app.post(
        "/api/setUserRole",
        [header("authorization").notEmpty(), body("userId").isString().trim().notEmpty(), body("role").isIn(["admin", "participant"])],
        async (req: Request, res: Response) => {
            const errors = validationResult(req);
            if (!errors.isEmpty()) return apiError(res, "Invalid parameters", errors.array());

            try {
                const adminToken = req.headers.authorization!;
                const { userId, role } = req.body;
                const result = await db.setUserRole(adminToken, userId, role);

                if (result instanceof ChitterError) return apiError<ErrorSetUserRole>(res, result.reason);
                apiSuccess<SuccessSetUserRole>(res);
            } catch (err) {
                console.error(err);
                apiError(res, "Unknown server error");
            }
        }
    );

    app.get(
        "/api/getMessages",
        [
            header("authorization").notEmpty(),
            query("channelId").optional().isString(),
            query("directMessageUserId").optional().isString(),
            query("cursor").optional().isString(),
            query("limit").optional().isInt({ min: 1, max: 100 }).toInt(),
        ],
        async (req: Request, res: Response) => {
            const errors = validationResult(req);
            if (!errors.isEmpty()) return apiError(res, "Invalid parameters", errors.array());

            try {
                const token = req.headers.authorization!;
                const { channelId, directMessageUserId, cursor, limit } = req.query;
                const result = await db.getMessages(
                    token,
                    channelId as string,
                    directMessageUserId as string,
                    cursor as string,
                    parseInt(limit as string)
                );

                if (result instanceof ChitterError) return apiError<ErrorGetMessages>(res, result.reason);
                apiSuccess<SuccessGetMessages>(res, result);
            } catch (err) {
                console.error(err);
                res.status(500).json({ success: false, error: "Server error occurred." });
            }
        }
    );

    app.get("/api/getUsers", [header("authorization").notEmpty(), query("channelId").optional().isString()], async (req: Request, res: Response) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return apiError(res, "Invalid parameters", errors.array());
        }

        try {
            const token = req.headers.authorization!;
            const { channelId } = req.query;
            const result = await db.getUsers(token, channelId as string);

            if (result instanceof ChitterError) return apiError<ErrorGetUsers>(res, result.reason);
            apiSuccess<SuccessGetUsers>(res, result);
        } catch (err) {
            console.error(err);
            apiError(res, "Unknown server error");
        }
    });

    app.get(
        "/api/getUser",
        [header("authorization").notEmpty(), query("userId").isString().trim().notEmpty()],
        async (req: Request, res: Response) => {
            const errors = validationResult(req);
            if (!errors.isEmpty()) return apiError(res, "Invalid parameters", errors.array());

            try {
                const token = req.headers.authorization!;
                const { userId } = req.query;
                const result = await db.getUser(token, userId as string);

                if (result instanceof ChitterError) return apiError<ErrorGetUser>(res, result.reason);
                apiSuccess<SuccessGetUser>(res, result);
            } catch (err) {
                console.error(err);
                apiError(res, "Unknown server error");
            }
        }
    );

    app.get("/api/getChannels", [header("authorization").notEmpty()], async (req: Request, res: Response) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return apiError(res, "Invalid parameters", errors.array());
        }

        try {
            const token = req.headers.authorization!;
            const result = await db.getChannels(token);
            if (result instanceof ChitterError) return apiError<ErrorGetChannels>(res, result.reason);
            apiSuccess<SuccessGetChannels>(res, result);
        } catch (err) {
            console.error(err);
            apiError(res, "Unknown server error");
        }
    });

    app.post(
        "/api/createChannel",
        [header("authorization").notEmpty(), body("displayName").isString().trim().notEmpty(), body("isPrivate").isBoolean()],
        async (req: Request, res: Response) => {
            const errors = validationResult(req);
            if (!errors.isEmpty()) return apiError(res, "Invalid parameters", errors.array());

            try {
                const adminToken = req.headers.authorization!;
                const { displayName, isPrivate } = req.body;
                const channelId = await db.createChannel(adminToken, displayName, isPrivate);

                if (channelId instanceof ChitterError) return apiError<ErrorCreateChannel>(res, channelId.reason);
                apiSuccess<SuccessCreateChannel>(res, channelId);
            } catch (err) {
                console.error(err);
                apiError(res, "Unknown server error");
            }
        }
    );

    app.post(
        "/api/removeChannel",
        [header("authorization").notEmpty(), body("channelId").isString().trim().notEmpty()],
        async (req: Request, res: Response) => {
            const errors = validationResult(req);
            if (!errors.isEmpty()) return apiError(res, "Invalid parameters", errors.array());

            try {
                const adminToken = req.headers.authorization!;
                const { channelId } = req.body;
                const result = await db.removeChannel(adminToken, channelId);

                if (result instanceof ChitterError) return apiError<ErrorRemoveChannel>(res, result.reason);
                apiSuccess<SuccessRemoveChannel>(res);
            } catch (err) {
                console.error(err);
                apiError(res, "Unknown server error");
            }
        }
    );

    app.post(
        "/api/updateChannel",
        [
            header("authorization").notEmpty(),
            body("channelId").isString().trim().notEmpty(),
            body("displayName").optional().isString().trim(),
            body("description").optional().isString().trim(),
        ],
        async (req: Request, res: Response) => {
            const errors = validationResult(req);
            if (!errors.isEmpty()) return apiError(res, "Invalid parameters", errors.array());

            try {
                const adminToken = req.headers.authorization!;
                const { channelId, displayName, description } = req.body;
                const result = await db.updateChannel(adminToken, channelId, displayName, description);

                if (result instanceof ChitterError) return apiError<ErrorUpdateChannel>(res, result.reason);
                apiSuccess<SuccessUpdateChannel>(res);
            } catch (err) {
                console.error(err);
                apiError(res, "Unknown server error");
            }
        }
    );

    app.post(
        "/api/addUserToChannel",
        [header("authorization").notEmpty(), body("userId").isString().trim().notEmpty(), body("channelId").isString().trim().notEmpty()],
        async (req: Request, res: Response) => {
            const errors = validationResult(req);
            if (!errors.isEmpty()) return apiError(res, "Invalid parameters", errors.array());

            try {
                const adminToken = req.headers.authorization!;
                const { userId, channelId } = req.body;
                const result = await db.addUserToChannel(adminToken, userId, channelId);

                if (result instanceof ChitterError) return apiError<ErrorAddUserToChannel>(res, result.reason);
                apiSuccess<SuccessAddUserToChannel>(res);
            } catch (err) {
                console.error(err);
                apiError(res, "Unknown server error");
            }
        }
    );

    app.post(
        "/api/removeUserFromChannel",
        [header("authorization").notEmpty(), body("userId").isString().trim().notEmpty(), body("channelId").isString().trim().notEmpty()],
        async (req: Request, res: Response) => {
            const errors = validationResult(req);
            if (!errors.isEmpty()) return apiError(res, "Invalid parameters", errors.array());

            try {
                const adminToken = req.headers.authorization!;
                const { userId, channelId } = req.body;
                const result = await db.removeUserFromChannel(adminToken, userId, channelId);

                if (result instanceof ChitterError) return apiError<ErrorRemoveUserFromChannel>(res, result.reason);
                apiSuccess<SuccessRemoveUserFromChannel>(res);
            } catch (err) {
                console.error(err);
                apiError(res, "Unknown server error");
            }
        }
    );

    app.post("/api/uploadAttachment", upload.single("file"), async (req: Request, res: Response) => {
        if (!req.file) {
            return res.status(400).json({ success: false, error: "No file provided" });
        }

        try {
            const filePath = req.file.path;
            const fileTypeInfo = await fileTypeFromFile(filePath);
            const type = fileTypeInfo?.mime.split("/")[0]; // 'image', 'video', etc.

            if (!type || !["image", "video", "application"].includes(type)) {
                fs.unlinkSync(filePath); // Remove the temporarily stored file
                return apiError<ErrorUploadAttachment>(res, "Invalid file type");
            }

            let width: number | undefined, height: number | undefined;
            if (type === "image" || type == "video") {
                // FIXME get image width/height
            }

            const token = req.headers.authorization!; // Assuming token is sent in authorization header

            const attachment = await db.uploadAttachment(token, {
                type: type as "image" | "video" | "file",
                fileName: req.file.filename,
                path: filePath,
                width,
                height,
                createdAt: Date.now(),
            });

            if (attachment instanceof ChitterError) {
                fs.unlinkSync(filePath); // Clean up the file if there's a database error
                return apiError<ErrorUploadAttachment>(res, attachment.reason);
            }

            apiSuccess<SuccessUploadAttachment>(res, attachment);
        } catch (err) {
            if (req.file?.path) {
                fs.unlinkSync(req.file.path); // Ensure temporary file is deleted in case of error
            }
            console.error(err);
            apiError(res, "Unknown server error");
        }
    });

    app.delete(
        "/api/removeAttachment",
        [header("authorization").notEmpty(), body("userId").isString().trim().notEmpty(), body("channelId").isString().trim().notEmpty()],
        async (req: Request, res: Response) => {
            const errors = validationResult(req);
            if (!errors.isEmpty()) return apiError(res, "Invalid parameters", errors.array());

            try {
                const token = req.headers.authorization!;
                const attachmentId = req.body.attachmentId; // Assuming the attachment ID is sent in the request body
                const result = await db.removeAttachment(token, attachmentId);
                if (result instanceof ChitterError) return apiError<ErrorRemoveAttachment>(res, result.reason);
                apiSuccess<SuccessRemoveAttachment>(res);
            } catch (error) {
                console.error(error);
                apiError(res, "Unknown server error");
            }
        }
    );

    // Start server
    const server = http.createServer(app);
    server.listen(port, async () => {
        console.log(`App listening on port ${port}`);
    });

    // Setup live reload
    setupLiveReload(server);
}
