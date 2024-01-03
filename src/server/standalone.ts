import { Environment } from "testcontainers/build/types";
import { createApp, createAppFromChitter, createAppFromPool } from "./app";
import { GenericContainer } from "testcontainers";
import * as pgmem from "pg-mem";
import { ChitterMem, SerializedMemRoom } from "./chitter-mem";
import * as fs from "fs";

function hasArg(arg: string): boolean {
    return process.argv.indexOf(arg) > -1;
}

(async () => {
    const tmpUploadDir = "./tmp";
    const shutdownToken = "shutdown-token";
    let stopApp: any;
    let container: any;

    if (hasArg("--mem")) {
        console.log("Starting in memory app");

        const chitterMem = new ChitterMem({
            save: async (chitter) => {
                fs.writeFileSync("mem.json", JSON.stringify(chitter.serialize()), "utf-8");
            },
            load: async () => {
                if (fs.existsSync("mem.json")) {
                    return JSON.parse(fs.readFileSync("mem.json", "utf-8")) as SerializedMemRoom[];
                } else {
                    return [];
                }
            },
        });
        stopApp = await createAppFromChitter(chitterMem, tmpUploadDir, shutdownToken);
    } else if (hasArg("--pgmem")) {
        console.log("Starting in PG memory app");
        const db = pgmem.newDb();
        const client = db.adapters.createPg();

        stopApp = await createAppFromPool(new client.Pool(), tmpUploadDir, shutdownToken);
    } else {
        console.log("Starting PG app");
        const environment: Environment = {
            POSTGRES_DB: "testdb",
            POSTGRES_USER: "user",
            POSTGRES_PASSWORD: "password",
        };

        container = await new GenericContainer("postgres").withEnvironment(environment).withExposedPorts(5432).start();

        const dbConfig = {
            host: container.getHost(),
            user: "user",
            password: "password",
            name: "testdb",
            port: container.getMappedPort(5432),
        };
        stopApp = await createApp(dbConfig, tmpUploadDir, shutdownToken);
    }

    async function gracefulShutdown(signal: string) {
        console.log(`Received ${signal}. Shutting down gracefully.`);
        stopApp();
        if (container) await container.stop();
        process.exit(0);
    }

    process.on("SIGINT", gracefulShutdown);
    process.on("SIGTERM", gracefulShutdown);
})();
