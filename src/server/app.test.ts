import { GenericContainer, StartedTestContainer } from "testcontainers";
import { createApp } from "./app";
import * as fs from "fs";
import * as util from "util";
import * as path from "path";
import { Environment } from "testcontainers/build/types";
import { Api } from "../api";

describe("Integration Tests", () => {
    let container: StartedTestContainer;
    let app: ReturnType<typeof createApp>;
    const tmpUploadDir = path.join(__dirname, "./tmp");
    let stopApp: () => Promise<void>;

    before(async () => {
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
    });

    after(async () => {
        await stopApp();
        await container.stop();
        if (fs.existsSync(tmpUploadDir)) {
            fs.rmSync(tmpUploadDir, { recursive: true });
        }
        // FIXME test hangs otherwise
        process.exit(0);
    });

    it("Should create a room and admin account", async () => {
        const result = await Api.createRoomAndAdmin("room", "admin", true);
    });
});
