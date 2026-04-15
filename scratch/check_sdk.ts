import { Daytona } from '@daytonaio/sdk';
const apiKey = 'dtn_d96a1319893b214a4fbcbf217315663f64c547016312da5c9f6732e6a4441c1b';

const client = new Daytona({ apiKey });

async function run() {
    try {
        const projects = await client.list(undefined, 1, 1);
        if (projects.items.length > 0) {
            const sandbox = await client.get(projects.items[0].id);
            console.log('--- Sandbox Methods ---');
            let current = sandbox;
            while (current) {
                Object.getOwnPropertyNames(current).forEach(prop => {
                    if (typeof (sandbox as any)[prop] === 'function') console.log(prop);
                });
                current = Object.getPrototypeOf(current);
            }
            if (sandbox.process) {
                console.log('--- Sandbox.process Methods ---');
                let curProc = sandbox.process;
                while (curProc) {
                    Object.getOwnPropertyNames(curProc).forEach(prop => {
                        if (typeof (sandbox.process as any)[prop] === 'function') console.log(prop);
                    });
                    curProc = Object.getPrototypeOf(curProc);
                }
                console.log('executeCommand length:', sandbox.process.executeCommand.length);
            }
        }
    } catch (e: any) {
        console.error('Error:', e.message);
    }
}
run();
