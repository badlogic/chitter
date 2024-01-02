import { exec } from "child_process";
import { Api } from "../common/api";
import { sleep } from "../utils/utils";

function hasArg(arg: string): boolean {
    return process.argv.indexOf(arg) > -1;
}

function runStandalone() {
    return exec(`npx ts-node src/server/standalone.ts ${hasArg("--pg-mem") ? "--pg-mem" : ""}`, (error, stdout, stderr) => {
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

runStandalone();

(async () => {
    await sleep(5000);
    const result = await Api.createRoomAndAdmin("room", "admin", true);
    if (result.success) {
        const { admin, generalChannel } = result.data;
        const promises: Promise<any>[] = [];
        const numMessages = 100000;
        let start = performance.now();
        for (let i = 0; i < numMessages; i++) {
            promises.push(Api.createMessage(admin.token, { text: "Hello", facets: [] }, generalChannel.id));
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
        while (true) {
            const messages = await Api.getMessages(admin.token, generalChannel.id, undefined, cursor, 25);
            if (!messages.success) {
                console.log(messages.error);
                break;
            }
            if (messages.data.length == 0) break;
            cursor = messages.data[messages.data.length - 1].id.toString();
        }
        secs = (performance.now() - start) / 1000;
        console.log(`Read took ${secs} secs`);
    }

    console.log("Press CTRL+C");
})();
