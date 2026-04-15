import { Daytona } from '@daytonaio/sdk';
const apiKey = 'dtn_d96a1319893b214a4fbcbf217315663f64c547016312da5c9f6732e6a4441c1b';

const client = new Daytona({ apiKey });

async function run() {
    try {
        console.log('Creating sandbox for writing test...');
        const sandbox = await client.create({
            language: 'typescript' as any,
            ephemeral: true,
        });
        console.log('Created ID:', sandbox.id);
        
        console.log('Testing immediate write...');
        try {
            await sandbox.fs.uploadFiles([
                { source: Buffer.from('test'), destination: '/home/daytona/test-immediate.txt' }
            ]);
            console.log('Immediate write successful!');
        } catch (e: any) {
            console.log('Immediate write failed as expected:', e.message);
            
            console.log('Waiting for started state...');
            let attempts = 0;
            while (attempts < 30) {
                const s = await client.get(sandbox.id);
                console.log(`Current state: ${s.state}`);
                if (s.state === 'started') break;
                await new Promise(r => setTimeout(r, 2000));
                attempts++;
            }
            
            console.log('Testing write after wait...');
            await sandbox.fs.uploadFiles([
                { source: Buffer.from('test'), destination: '/home/daytona/test-after-wait.txt' }
            ]);
            console.log('Write after wait successful!');
        }
        
        await client.delete(sandbox);
    } catch (e: any) {
        console.error('Test failed:', e.message);
    }
}
run();
