import { NextResponse } from 'next/server';
import { CodeProvider, createCodeProviderClient, DaytonaProvider } from '@onlook/code-provider';

export async function POST(req: Request) {
    try {
        const body = await req.json();
        const { sandboxId } = body;

        if (!sandboxId) {
            return NextResponse.json({ error: 'Missing sandboxId' }, { status: 400 });
        }

        // Run the teardown asynchronously so we can respond to the beacon immediately
        (async () => {
            try {
                const provider = (await createCodeProviderClient(CodeProvider.Daytona, {
                    providerOptions: { daytona: { sandboxId } },
                })) as DaytonaProvider;

                const sandbox = await provider.get({ sandboxId });
                const state = (sandbox as any).state;
                if (state === 'started' || state === 'starting' || state === 'running') {
                    console.log(`[Daytona Teardown] Stopping sandbox ${sandboxId} due to page close...`);
                    await provider.stopProject({});
                }
                
                // Wait for it to be completely stopped
                let attempts = 0;
                while (attempts < 30) { // Up to 60s
                    const s = await provider.get({ sandboxId });
                    if ((s as any).state === 'stopped') break;
                    if ((s as any).state === 'error' || (s as any).state === 'archived') break;
                    await new Promise(r => setTimeout(r, 2000));
                    attempts++;
                }

                console.log(`[Daytona Teardown] Archiving sandbox ${sandboxId}...`);
                await provider.archive();
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
