import { GenericContainer, StartedTestContainer } from "testcontainers";
import { createApp } from "./app.js"; // Adjust the path
import { Environment } from "testcontainers/build/types.js";
import * as fs from "fs";
import * as util from "util";
import * as path from "path";

describe("Integration Tests", () => {
    let container: StartedTestContainer;
    let app: ReturnType<typeof createApp>;
    const tmpUploadDir = path.join(__dirname, "./tmp");

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

        await createApp(dbConfig, tmpUploadDir);
    });

    after(async () => {
        await container.stop();
        if (fs.existsSync(tmpUploadDir)) {
        }
    });

    // Add your test cases here
});
