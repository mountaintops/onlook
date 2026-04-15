import { Daytona } from '@daytonaio/sdk';
const apiKey = 'dtn_d96a1319893b214a4fbcbf217315663f64c547016312da5c9f6732e6a4441c1b'; // Using the one found in .env

const client = new Daytona({ apiKey });

async function run() {
    try {
        console.log('Listing projects...');
        const projects = await client.list(undefined, 1, 10);
        console.log('Projects count:', projects.items?.length);
        
        console.log('Listing snapshots...');
        const snapshots = await client.snapshot.list(1, 10);
        console.log('Snapshots count:', snapshots.items?.length);
    } catch (e: any) {
        console.error('Error:', e.message);
        if (e.response) {
            console.error('Response status:', e.response.status);
            console.error('Response data:', e.response.data);
        }
    }
}
run();
