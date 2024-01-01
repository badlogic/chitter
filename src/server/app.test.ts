import * as fs from "fs";
import { GenericContainer, StartedTestContainer } from "testcontainers";
import { Environment } from "testcontainers/build/types";
import { Api } from "../common/api";
import { createApp } from "./app";
import { assert } from "chai";

describe("Integration Tests", () => {
    let container: StartedTestContainer;
    let app: ReturnType<typeof createApp>;
    const tmpUploadDir = "./tmp";
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
        let result = await Api.createRoomAndAdmin("room", "admin", true);
        assert(result.success);
        assert(result.data.admin.displayName == "admin");
        assert(result.data.generalChannel.displayName == "general");
        assert(result.data.room.displayName == "room");
    });
});
