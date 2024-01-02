import { Environment } from "testcontainers/build/types";
import { createApp, createAppFromPool } from "./app";
import { GenericContainer } from "testcontainers";
import * as pgmem from "pg-mem";

function hasArg(arg: string): boolean {
    return process.argv.indexOf(arg) > -1;
}

(async () => {
    const tmpUploadDir = "./tmp";
    let stopApp: any;
    let container: any;

    if (hasArg("--pg-mem")) {
        const db = pgmem.newDb();
        const client = db.adapters.createPg();

        stopApp = await createAppFromPool(new client.Pool(), tmpUploadDir);
    } else {
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
        stopApp = await createApp(dbConfig, tmpUploadDir);
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
