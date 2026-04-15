import { Daytona } from '@daytonaio/sdk';
const apiKey = 'dtn_d96a1319893b214a4fbcbf217315663f64c547016312da5c9f6732e6a4441c1b';

const client = new Daytona({ apiKey });

async function run() {
    try {
        console.log('Testing sandbox creation with FULL options...');
        const sandbox = await client.create({
            language: 'typescript' as any,
            autoStopInterval: 120,
            autoArchiveInterval: 30,
            ephemeral: false,
        });
        console.log('Sandbox created successfully:', sandbox.id);
        await client.delete(sandbox);
    } catch (e: any) {
        console.error('Creation failed:', e.message);
        if (e.response) {
            console.error('Response:', e.response.data);
        }
    }
}
run();
