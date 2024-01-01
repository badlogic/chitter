import * as fs from "fs";
import { GenericContainer, StartedTestContainer } from "testcontainers";
import { Environment } from "testcontainers/build/types";
import { Api } from "../common/api";
import { createApp } from "./app";
import { assert, expect } from "chai";
import { UserBasic } from "../common/common";

describe("Integration Tests", function () {
    if (process.execArgv.some((arg) => arg.includes("--inspect"))) {
        this.timeout(0); // Disable timeout if debugger is attached
    }

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
        setTimeout(() => process.exit(0), 1000);
    });

    it("Should create a room and admin account", async () => {
        const result = await Api.createRoomAndAdmin("room", "admin", true);
        assert(result.success);
        const { admin, generalChannel, room } = result.data;
        expect(admin).to.include({ displayName: "admin", role: "admin", roomId: room.id });
        expect(generalChannel).to.include({ displayName: "General", roomId: room.id, createdBy: admin.id, isPrivate: false });
        expect(room).to.include({ displayName: "room", adminInviteOnly: true });
    });

    it("Should update a room", async () => {
        const result = await Api.createRoomAndAdmin("room", "admin", true);
        assert(result.success);
        const { admin, room } = result.data;
        const result2 = await Api.updateRoom(admin.token, "new room name", false, "This is a description");
        assert(result2.success);
        const result3 = await Api.getRoom(admin.token, room.id);
        assert(result3.success);
        expect(result3.data).to.include({
            id: room.id,
            createdAt: room.createdAt,
            displayName: "new room name",
            description: "This is a description",
            adminInviteOnly: false,
        });
    });

    it("Should create and consume invite code", async () => {
        const result = await Api.createRoomAndAdmin("room", "admin", true);
        assert(result.success);
        const { admin } = result.data;
        const result2 = await Api.createInviteCode(result.data.admin.token);
        assert(result2.success);
        assert(result2.data.inviteCode);
        const result3 = await Api.createUserFromInviteCode(result2.data.inviteCode, "user");
        assert(result3.success);
        const result4 = await Api.getUsers(admin.token);
        assert(result4.success);
        assert(result4.data.length == 2);
    });

    it("Should update a user", async () => {
        const result = await Api.createRoomAndAdmin("room", "admin", true);
        assert(result.success);
        const { admin, room } = result.data;
        const result2 = await Api.updateUser(admin.token, "Mario", "It'se me");
        assert(result2.success);
        const result3 = await Api.getUser(admin.token, admin.id);
        assert(result3.success);
        const user: UserBasic = {
            id: admin.id,
            roomId: admin.roomId,
            createdAt: admin.createdAt,
            role: "admin",
            displayName: "Mario",
            description: "It'se me",
        };
        expect(result3.data).to.include(user);
    });

    it("Should create a channel", async () => {
        const result = await Api.createRoomAndAdmin("room", "admin", true);
        assert(result.success);
        const { admin, room } = result.data;
        const result2 = await Api.createChannel(admin.token, "channel", false);
        assert(result2.success);
        const result3 = await Api.getChannel(admin.token, result2.data.channelId);
        assert(result3.success);
        expect(result3.data).to.include({
            id: result2.data.channelId,
            roomId: room.id,
            displayName: "channel",
            isPrivate: false,
            createdBy: admin.id,
        });
    });

    it("Should create a private channel and add admin and a user and remove user", async () => {
        const result = await Api.createRoomAndAdmin("room", "admin", true);
        assert(result.success);
        const { admin, room } = result.data;
        const result2 = await Api.createChannel(admin.token, "channel", true);
        assert(result2.success);
        const result3 = await Api.getChannel(admin.token, result2.data.channelId);
        assert(result3.success);
        expect(result3.data).to.include({
            id: result2.data.channelId,
            roomId: room.id,
            displayName: "channel",
            isPrivate: true,
            createdBy: admin.id,
        });
        const result4 = await Api.getUsers(admin.token, result2.data.channelId);
        assert(result4.success);
        assert(result4.data.length == 1);

        const result5 = await Api.createInviteCode(admin.token);
        assert(result5.success);
        const result6 = await Api.createUserFromInviteCode(result5.data.inviteCode, "user");
        assert(result6.success);
        const result7 = await Api.addUserToChannel(admin.token, result6.data.id, result2.data.channelId);
        assert(result7.success);
        const result8 = await Api.getUsers(admin.token, result2.data.channelId);
        assert(result8.success);
        assert(result8.data.length == 2);

        const result9 = await Api.removeUserFromChannel(admin.token, result6.data.id, result2.data.channelId);
        assert(result9.success);

        const result10 = await Api.getUsers(admin.token, result2.data.channelId);
        assert(result10.success);
        assert(result10.data.length == 1);
    });

    it("Should create a message", async () => {
        const result = await Api.createRoomAndAdmin("room", "admin", true);
        assert(result.success);
        const { admin, room, generalChannel } = result.data;
        const result2 = await Api.createMessage(
            admin.token,
            {
                text: "Hello world",
                facets: [],
            },
            generalChannel.id
        );
        assert(result2.success, JSON.stringify(result2));
        const result3 = await Api.getMessages(admin.token, generalChannel.id);
        assert(result3.success, JSON.stringify(result3));
        assert(result3.data.length == 1);
        delete (admin as any).token;
        expect(result3.data[0]).to.deep.include({
            id: result2.data.messageId,
            user: admin,
            content: { text: "Hello world", facets: [] },
            channelId: generalChannel.id,
        });
    });

    it("Should page through messages", async () => {
        const result = await Api.createRoomAndAdmin("room", "admin", true);
        assert(result.success);
        const { admin, room, generalChannel } = result.data;
        for (let i = 0; i < 10; i++) {
            const result2 = await Api.createMessage(
                admin.token,
                {
                    text: `message ${i + 1}`,
                    facets: [],
                },
                generalChannel.id
            );
            assert(result2.success, JSON.stringify(result2));
        }
        let cursor: string | undefined;
        for (let i = 0, j = 10; i < 10; i += 2, j -= 2) {
            const result3 = await Api.getMessages(admin.token, generalChannel.id, undefined, cursor, 2);
            assert(result3.success, JSON.stringify(result3));
            assert(result3.data.length == 2);
            expect(result3.data[0].content.text).to.equal(`message ${j}`);
            expect(result3.data[1].content.text).to.equal(`message ${j - 1}`);
            cursor = `${result3.data[result3.data.length - 1].id}`;
        }
    });
});
