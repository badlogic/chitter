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
import { ChitterDatabase } from "./database.js";
import { ChitterError } from "../common/common.js";
import { body, header, query, validationResult } from "express-validator";
import multer from "multer";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import fileType, { fileTypeFromFile } from "file-type";
import sharp from "sharp";

const uploadDirectory = "docker/data/uploads";

// Create the directory if it doesn't exist
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

const port = process.env.PORT ?? 3333;
const dbName = process.env.DATABASE;
if (!dbName) {
    console.error("Environment variable DATABASE missing");
    process.exit(-1);
}
const dbUser = process.env.DATABASE_USER;
if (!dbUser) {
    console.error("Environment variable DATABASE_USER missing");
    process.exit(-1);
}
const dbPassword = process.env.DATABASE_PASSWORD;
if (!dbPassword) {
    console.error("Environment variable DATABASE_PASSWORD missing");
    process.exit(-1);
}

const pool = new Pool({
    host: "db",
    database: dbName,
    user: dbUser,
    password: dbPassword,
    port: 5432,
});

const db = new ChitterDatabase(pool);

(async () => {
    const result = await connectWithRetry(5, 3000);
    if (result instanceof Error) {
        process.exit(-1);
    }

    await db.initialize(); // Initialize the database
    console.log("Database initialized successfully");

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
            if (!errors.isEmpty()) {
                return res.status(400).json({ success: false, errors: errors.array() });
            }

            try {
                const { roomName, adminName, adminInviteOnly } = req.body;
                const result = await db.createRoomAndAdmin(roomName, adminName, adminInviteOnly);

                if (result instanceof ChitterError) {
                    return res.status(400).json({ success: false, error: result.reason });
                }

                res.json({ success: true, data: result });
            } catch (err) {
                console.error(err);
                res.status(500).json({ success: false, error: "Server error occurred." });
            }
        }
    );

    app.post("/api/createInviteCode", [header("authorization").notEmpty()], async (req: Request, res: Response) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ success: false, errors: errors.array() });
        }

        try {
            const token = req.headers.authorization!;
            const inviteCode = await db.createInviteCode(token);

            if (inviteCode instanceof ChitterError) {
                return res.status(400).json({ success: false, error: inviteCode.reason });
            }

            res.json({ success: true, data: inviteCode });
        } catch (err) {
            console.error(err);
            res.status(500).json({ success: false, error: "Server error occurred." });
        }
    });

    app.post(
        "/api/createUserFromInviteCode",
        [body("inviteCode").isString().trim().notEmpty(), body("displayName").isString().trim().notEmpty()],
        async (req: Request, res: Response) => {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({ success: false, errors: errors.array() });
            }

            try {
                const { inviteCode, displayName } = req.body;
                const user = await db.createUserFromInviteCode(inviteCode, displayName);

                if (user instanceof ChitterError) {
                    return res.status(400).json({ success: false, error: user.reason });
                }

                res.json({ success: true, data: user });
            } catch (err) {
                console.error(err);
                res.status(500).json({ success: false, error: "Server error occurred." });
            }
        }
    );

    app.post(
        "/api/removeUser",
        [header("authorization").notEmpty(), body("userId").isString().trim().notEmpty()],
        async (req: Request, res: Response) => {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({ success: false, errors: errors.array() });
            }

            try {
                const adminToken = req.headers.authorization!;
                const { userId } = req.body;
                const result = await db.removeUser(userId, adminToken);

                if (result instanceof ChitterError) {
                    return res.status(400).json({ success: false, error: result.reason });
                }

                res.json({ success: true, message: "User removed successfully" });
            } catch (err) {
                console.error(err);
                res.status(500).json({ success: false, error: "Server error occurred." });
            }
        }
    );

    app.post("/api/createTransferCode", [body("userTokens").isArray().isLength({ min: 1 })], async (req: Request, res: Response) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ success: false, errors: errors.array() });
        }

        try {
            const { userTokens } = req.body;
            const transferCode = await db.createTransferCode(userTokens);

            if (transferCode instanceof ChitterError) {
                return res.status(400).json({ success: false, error: transferCode.reason });
            }

            res.json({ success: true, data: transferCode });
        } catch (err) {
            console.error(err);
            res.status(500).json({ success: false, error: "Server error occurred." });
        }
    });

    app.post("/api/createTransferBundleFromCode", [body("transferCode").isString().trim().notEmpty()], async (req: Request, res: Response) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ success: false, errors: errors.array() });
        }

        try {
            const { transferCode } = req.body;
            const transferBundle = await db.createTransferBundleFromCode(transferCode);

            if (transferBundle instanceof ChitterError) {
                return res.status(400).json({ success: false, error: transferBundle.reason });
            }

            res.json({ success: true, data: transferBundle });
        } catch (err) {
            console.error(err);
            res.status(500).json({ success: false, error: "Server error occurred." });
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
            if (!errors.isEmpty()) {
                return res.status(400).json({ success: false, errors: errors.array() });
            }

            try {
                const token = req.headers.authorization!;
                const { content, channelId, directMessageUserId } = req.body;
                const result = await db.createMessage(token, content, channelId, directMessageUserId);

                if (result instanceof ChitterError) {
                    return res.status(400).json({ success: false, error: result.reason });
                }

                res.json({ success: true, data: result });
            } catch (err) {
                console.error(err);
                res.status(500).json({ success: false, error: "Server error occurred." });
            }
        }
    );

    app.post(
        "/api/removeMessage",
        [header("authorization").notEmpty(), body("messageId").isString().trim().notEmpty()],
        async (req: Request, res: Response) => {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({ success: false, errors: errors.array() });
            }

            try {
                const token = req.headers.authorization!;
                const { messageId } = req.body;
                const result = await db.removeMessage(token, messageId);

                if (result instanceof ChitterError) {
                    return res.status(400).json({ success: false, error: result.reason });
                }

                res.json({ success: true, message: "Message removed successfully" });
            } catch (err) {
                console.error(err);
                res.status(500).json({ success: false, error: "Server error occurred." });
            }
        }
    );

    app.post(
        "/api/editMessage",
        [header("authorization").notEmpty(), body("messageId").isString().trim().notEmpty(), body("content").notEmpty()],
        async (req: Request, res: Response) => {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({ success: false, errors: errors.array() });
            }

            try {
                const token = req.headers.authorization!;
                const { messageId, content } = req.body;
                const result = await db.editMessage(token, messageId, content);

                if (result instanceof ChitterError) {
                    return res.status(400).json({ success: false, error: result.reason });
                }

                res.json({ success: true, message: "Message edited successfully" });
            } catch (err) {
                console.error(err);
                res.status(500).json({ success: false, error: "Server error occurred." });
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
            if (!errors.isEmpty()) {
                return res.status(400).json({ success: false, errors: errors.array() });
            }

            try {
                const adminToken = req.headers.authorization!;
                const { displayName, adminInviteOnly, description, logoId } = req.body;
                const result = await db.updateRoom(adminToken, displayName, adminInviteOnly, description, logoId);

                if (result instanceof ChitterError) {
                    return res.status(400).json({ success: false, error: result.reason });
                }

                res.json({ success: true, message: "Room updated successfully" });
            } catch (err) {
                console.error(err);
                res.status(500).json({ success: false, error: "Server error occurred." });
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
            if (!errors.isEmpty()) {
                return res.status(400).json({ success: false, errors: errors.array() });
            }

            try {
                const userToken = req.headers.authorization!;
                const { displayName, description, avatar } = req.body;
                const result = await db.updateUser(userToken, displayName, description, avatar);

                if (result instanceof ChitterError) {
                    return res.status(400).json({ success: false, error: result.reason });
                }

                res.json({ success: true, message: "User updated successfully" });
            } catch (err) {
                console.error(err);
                res.status(500).json({ success: false, error: "Server error occurred." });
            }
        }
    );

    app.post(
        "/api/setUserRole",
        [header("authorization").notEmpty(), body("userId").isString().trim().notEmpty(), body("role").isIn(["admin", "participant"])],
        async (req: Request, res: Response) => {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({ success: false, errors: errors.array() });
            }

            try {
                const adminToken = req.headers.authorization!;
                const { userId, role } = req.body;
                const result = await db.setUserRole(adminToken, userId, role);

                if (result instanceof ChitterError) {
                    return res.status(400).json({ success: false, error: result.reason });
                }

                res.json({ success: true, message: "User role set successfully" });
            } catch (err) {
                console.error(err);
                res.status(500).json({ success: false, error: "Server error occurred." });
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
            if (!errors.isEmpty()) {
                return res.status(400).json({ success: false, errors: errors.array() });
            }

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

                if (result instanceof ChitterError) {
                    return res.status(400).json({ success: false, error: result.reason });
                }

                res.json({ success: true, data: result });
            } catch (err) {
                console.error(err);
                res.status(500).json({ success: false, error: "Server error occurred." });
            }
        }
    );

    app.get("/api/getUsers", [header("authorization").notEmpty(), query("channelId").optional().isString()], async (req: Request, res: Response) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ success: false, errors: errors.array() });
        }

        try {
            const token = req.headers.authorization!;
            const { channelId } = req.query;
            const result = await db.getUsers(token, channelId as string);

            if (result instanceof ChitterError) {
                return res.status(400).json({ success: false, error: result.reason });
            }

            res.json({ success: true, data: result });
        } catch (err) {
            console.error(err);
            res.status(500).json({ success: false, error: "Server error occurred." });
        }
    });

    app.get(
        "/api/getUser",
        [header("authorization").notEmpty(), query("userId").isString().trim().notEmpty()],
        async (req: Request, res: Response) => {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({ success: false, errors: errors.array() });
            }

            try {
                const token = req.headers.authorization!;
                const { userId } = req.query;
                const result = await db.getUser(token, userId as string);

                if (result instanceof ChitterError) {
                    return res.status(400).json({ success: false, error: result.reason });
                }

                res.json({ success: true, data: result });
            } catch (err) {
                console.error(err);
                res.status(500).json({ success: false, error: "Server error occurred." });
            }
        }
    );

    app.get("/api/getChannels", [header("authorization").notEmpty()], async (req: Request, res: Response) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ success: false, errors: errors.array() });
        }

        try {
            const token = req.headers.authorization!;
            const result = await db.getChannels(token);

            if (result instanceof ChitterError) {
                return res.status(400).json({ success: false, error: result.reason });
            }

            res.json({ success: true, data: result });
        } catch (err) {
            console.error(err);
            res.status(500).json({ success: false, error: "Server error occurred." });
        }
    });

    app.post(
        "/api/createChannel",
        [header("authorization").notEmpty(), body("displayName").isString().trim().notEmpty(), body("isPrivate").isBoolean()],
        async (req: Request, res: Response) => {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({ success: false, errors: errors.array() });
            }

            try {
                const adminToken = req.headers.authorization!;
                const { displayName, isPrivate } = req.body;
                const channelId = await db.createChannel(adminToken, displayName, isPrivate);

                if (channelId instanceof ChitterError) {
                    return res.status(400).json({ success: false, error: channelId.reason });
                }

                res.json({ success: true, channelId });
            } catch (err) {
                console.error(err);
                res.status(500).json({ success: false, error: "Server error occurred." });
            }
        }
    );

    app.post(
        "/api/removeChannel",
        [header("authorization").notEmpty(), body("channelId").isString().trim().notEmpty()],
        async (req: Request, res: Response) => {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({ success: false, errors: errors.array() });
            }

            try {
                const adminToken = req.headers.authorization!;
                const { channelId } = req.body;
                const result = await db.removeChannel(adminToken, channelId);

                if (result instanceof ChitterError) {
                    return res.status(400).json({ success: false, error: result.reason });
                }

                res.json({ success: true, message: "Channel removed successfully" });
            } catch (err) {
                console.error(err);
                res.status(500).json({ success: false, error: "Server error occurred." });
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
            if (!errors.isEmpty()) {
                return res.status(400).json({ success: false, errors: errors.array() });
            }

            try {
                const adminToken = req.headers.authorization!;
                const { channelId, displayName, description } = req.body;
                const result = await db.updateChannel(adminToken, channelId, displayName, description);

                if (result instanceof ChitterError) {
                    return res.status(400).json({ success: false, error: result.reason });
                }

                res.json({ success: true, message: "Channel updated successfully" });
            } catch (err) {
                console.error(err);
                res.status(500).json({ success: false, error: "Server error occurred." });
            }
        }
    );

    app.post(
        "/api/addUserToChannel",
        [header("authorization").notEmpty(), body("userId").isString().trim().notEmpty(), body("channelId").isString().trim().notEmpty()],
        async (req: Request, res: Response) => {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({ success: false, errors: errors.array() });
            }

            try {
                const adminToken = req.headers.authorization!;
                const { userId, channelId } = req.body;
                const result = await db.addUserToChannel(adminToken, userId, channelId);

                if (result instanceof ChitterError) {
                    return res.status(400).json({ success: false, error: result.reason });
                }

                res.json({ success: true, message: "User added to channel successfully" });
            } catch (err) {
                console.error(err);
                res.status(500).json({ success: false, error: "Server error occurred." });
            }
        }
    );

    app.post(
        "/api/removeUserFromChannel",
        [header("authorization").notEmpty(), body("userId").isString().trim().notEmpty(), body("channelId").isString().trim().notEmpty()],
        async (req: Request, res: Response) => {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({ success: false, errors: errors.array() });
            }

            try {
                const adminToken = req.headers.authorization!;
                const { userId, channelId } = req.body;
                const result = await db.removeUserFromChannel(adminToken, userId, channelId);

                if (result instanceof ChitterError) {
                    return res.status(400).json({ success: false, error: result.reason });
                }

                res.json({ success: true, message: "User removed from channel successfully" });
            } catch (err) {
                console.error(err);
                res.status(500).json({ success: false, error: "Server error occurred." });
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
                return res.status(400).json({ success: false, error: "Invalid file type" });
            }

            let width, height;
            if (type === "image") {
                const dimensions = await sharp(filePath).metadata();
                width = dimensions.width;
                height = dimensions.height;
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
                return res.status(400).json({ success: false, error: attachment.reason });
            }

            res.json({ success: true, attachment });
        } catch (err) {
            console.error(err);
            if (req.file?.path) {
                fs.unlinkSync(req.file.path); // Ensure temporary file is deleted in case of error
            }
            res.status(500).json({ success: false, error: "Server error occurred." });
        }
    });

    app.delete("/api/removeAttachment", async (req: Request, res: Response) => {
        const token = req.headers.authorization;
        const attachmentId = req.body.attachmentId; // Assuming the attachment ID is sent in the request body

        if (!token || !attachmentId) {
            return res.status(400).json({ success: false, error: "Token and attachment ID are required" });
        }

        try {
            await db.removeAttachment(token, attachmentId);

            res.json({ success: true, message: "Attachment removed successfully" });
        } catch (error) {
            if (error instanceof ChitterError) {
                return res.status(400).json({ success: false, error: error.reason });
            }

            console.error(error);
            res.status(500).json({ success: false, error: "Server error occurred." });
        }
    });

    const server = http.createServer(app);
    server.listen(port, async () => {
        console.log(`App listening on port ${port}`);
    });

    setupLiveReload(server);
})();

async function connectWithRetry(maxRetries = 5, interval = 2000) {
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
