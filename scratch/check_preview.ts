import { Daytona } from '@daytonaio/sdk';
const apiKey = 'dtn_d96a1319893b214a4fbcbf217315663f64c547016312da5c9f6732e6a4441c1b';

const client = new Daytona({ apiKey });

async function run() {
    try {
        const projects = await client.list(undefined, 1, 1);
        if (projects.items.length > 0) {
            const sandbox = await client.get(projects.items[0].id);
            console.log('Preview link for port 3000:', await sandbox.getPreviewLink(3000));
            if (sandbox.getSignedPreviewUrl) {
                 console.log('Signed preview URL for port 3000:', await sandbox.getSignedPreviewUrl(3000));
            }
        }
    } catch (e: any) {
        console.error('Error:', e.message);
    }
}
run();
