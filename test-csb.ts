import { CodeSandbox } from '@codesandbox/sdk';

async function main() {
    const sandboxId = 'vzqq7c';
    console.log("Testing CodeSandbox connection to", sandboxId);
    try {
        const sdk = new CodeSandbox();
        console.log("SDK instantiated. Resuming...");
        const sandbox = await sdk.sandboxes.resume(sandboxId);
        console.log("Resume passed. Connecting...");
        const client = await sandbox.connect();
        console.log("Connected seamlessly!");
        await client.disconnect();
    } catch(e) {
        console.error("FAILED!", e);
    }
}
main();
