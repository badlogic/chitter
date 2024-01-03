import { createApp, createAppFromChitter } from "./app";
import { ChitterMem, SerializedMemRoom } from "./chitter-mem";
import * as fs from "fs";

const uploadDirectory = "docker/data/uploads";
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
const shutdownToken = process.env.SHUTDOWN_TOKEN;
if (!shutdownToken) {
    console.error("Environment variable SHUTDOWN_TOKEN missing");
    process.exit(-1);
}

(async () => {
    let stopApp = async () => {};
    if (dbName == "mem") {
        console.log("Starting app with in-memory database");

        const chitterMem = new ChitterMem({
            save: async (chitter) => {
                console.log("Saving Chitter memory database to docker/data/mem.json");
                fs.writeFileSync("docker/data/mem.json", JSON.stringify(chitter.serialize()), "utf-8");
                console.log("Saved, size: " + (fs.statSync("docker/data/mem.json").size / (1024 * 1024)).toFixed(2) + "MB");
            },
            load: async () => {
                if (fs.existsSync("docker/data/mem.json")) {
                    console.log("Restoring Chitter memory database");
                    return JSON.parse(fs.readFileSync("docker/data/mem.json", "utf-8")) as SerializedMemRoom[];
                } else {
                    return [];
                }
            },
        });
        await chitterMem.initialize();
        stopApp = await createAppFromChitter(chitterMem, uploadDirectory, shutdownToken);
    } else {
        console.log("Starting app with postgres database");
        stopApp = await createApp({ name: dbName, user: dbUser, password: dbPassword, host: "db", port: 5432 }, uploadDirectory, shutdownToken, port);
    }
    async function gracefulShutdown(signal: string) {
        console.log(`Received ${signal}. Shutting down gracefully.`);
        await stopApp();
        process.exit(0);
    }

    process.on("SIGINT", gracefulShutdown);
    process.on("SIGTERM", gracefulShutdown);
})();
