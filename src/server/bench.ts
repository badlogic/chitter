import { exec } from "child_process";
import { Api } from "../common/api";
import { sleep } from "../utils/utils";

function hasArg(arg: string): boolean {
    return process.argv.indexOf(arg) > -1;
}

function runStandalone() {
    return exec(`npx ts-node src/server/standalone.ts ${process.argv[2] ?? ""}`, (error, stdout, stderr) => {
        if (error) {
            console.error(`Execution error: ${error.message}`);
            return;
        }
        if (stderr) {
            console.error(`Error: ${stderr}`);
            return;
        }
        console.log(`Output: ${stdout}`);
    });
}

function generateLoremIpsum(): string {
    const loremIpsum =
        "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.";

    // Generate a random length between 20 and 500
    const length = Math.floor(Math.random() * (500 - 20 + 1)) + 20;

    // If the lorem ipsum source is shorter than the desired length, repeat it
    const repeatedLorem = loremIpsum.repeat(Math.ceil(length / loremIpsum.length));

    // Extract the substring of the desired length
    return repeatedLorem.substring(0, length);
}

runStandalone();

(async () => {
    await sleep(5000);
    const result = await Api.createRoomAndAdmin("room", "admin", true);
    if (result.success) {
        const { admin, generalChannel } = result.data;
        const promises: Promise<any>[] = [];
        const numMessages = 200000;
        let start = performance.now();
        for (let i = 0; i < numMessages; i++) {
            promises.push(Api.createMessage(admin.token, { text: generateLoremIpsum(), facets: [] }, generalChannel.id));
            if (i % 1000 == 0) {
                await Promise.all(promises);
                promises.length = 0;
            }
        }
        await Promise.all(promises);
        let secs = (performance.now() - start) / 1000;
        console.log(`Write took ${secs} secs, ${numMessages / secs} msgs/s`);

        start = performance.now();
        let cursor: string | undefined;
        let readMessages = 0;
        while (true) {
            const messages = await Api.getMessages(admin.token, generalChannel.id, undefined, cursor, 25);
            if (!messages.success) {
                console.log(messages.error);
                break;
            }
            if (messages.data.length == 0) break;
            readMessages += messages.data.length;
            cursor = messages.data[messages.data.length - 1].id.toString();
        }
        secs = (performance.now() - start) / 1000;
        console.log(`Read ${readMessages} messages, took ${secs} secs`);
    }

    console.log("Press CTRL+C");
})();
