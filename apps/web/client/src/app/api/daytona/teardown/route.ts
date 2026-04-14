import { NextResponse } from 'next/server';
import { Daytona } from '@daytonaio/sdk';

export async function POST(req: Request) {
    try {
        const body = await req.json();
        const { sandboxId } = body;

        const apiKey = process.env.SANDBOX_DAYTONA_API_KEY;
        if (!apiKey) {
            return NextResponse.json({ error: 'SANDBOX_DAYTONA_API_KEY is not configured' }, { status: 500 });
        }

        if (!sandboxId) {
            return NextResponse.json({ error: 'Missing sandboxId' }, { status: 400 });
        }

        const client = new Daytona({ apiKey });

        // Run the teardown asynchronously so we can respond to the beacon immediately
        (async () => {
            try {
                const sandbox = await client.get(sandboxId);
                const state = (sandbox as any).state;
                if (state === 'started' || state === 'starting' || state === 'running') {
                    console.log(`[Daytona Teardown] Stopping sandbox ${sandboxId} due to page close...`);
                    await sandbox.stop();
                }
                
                // Wait for it to be completely stopped
                let attempts = 0;
                while (attempts < 30) { // Up to 60s
                    const s = await client.get(sandboxId);
                    if ((s as any).state === 'stopped') break;
                    if ((s as any).state === 'error' || (s as any).state === 'archived') break;
                    await new Promise(r => setTimeout(r, 2000));
                    attempts++;
                }

                console.log(`[Daytona Teardown] Archiving sandbox ${sandboxId}...`);
                await sandbox.archive();
                console.log(`[Daytona Teardown] Successfully archived sandbox ${sandboxId}.`);
            } catch (err: any) {
                console.error(`[Daytona Teardown] Failed to gracefully teardown sandbox ${sandboxId}:`, err);
            }
        })();

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('[Daytona Teardown] Error processing beacon:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
