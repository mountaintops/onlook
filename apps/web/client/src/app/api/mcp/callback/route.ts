import { auth } from '@ai-sdk/mcp';
import { McpOAuthProvider } from '@onlook/ai/src/mcp/oauth-provider';
import { createClient as createTRPCClient } from '@/trpc/request-server';
import { type NextRequest } from 'next/server';

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const code = searchParams.get('code');
    const state = searchParams.get('state');

    if (!code || !state) {
        return new Response('Missing code or state', { status: 400 });
    }

    try {
        const [projectId, serverId] = state.split(':');
        if (!projectId || !serverId) {
            throw new Error('Invalid state format');
        }

        const { api } = await createTRPCClient(req);
        const settings = await api.settings.get({ projectId });
        
        if (!settings) {
            throw new Error('Project settings not found');
        }

        const mcpServer = settings.mcpServers?.find(s => s.id === serverId);
        if (!mcpServer) {
            throw new Error('MCP server configuration not found');
        }

        const provider = new McpOAuthProvider(
            projectId,
            mcpServer,
            async (patch) => {
                const currentSettings = await api.settings.get({ projectId });
                const servers = currentSettings?.mcpServers ?? [];
                const updated = servers.map(s => s.id === serverId ? { ...s, ...patch } : s);
                await api.settings.upsert({ 
                    projectId, 
                    settings: { mcpServers: updated } 
                });
            }
        );

        // Perform the OAuth exchange
        await auth(provider, {
            serverUrl: mcpServer.url,
            authorizationCode: code,
        });

        // Return a page that signals the parent and closes itself
        return new Response(
            `
            <!DOCTYPE html>
            <html>
                <body>
                    <script>
                        if (window.opener) {
                            window.opener.postMessage({ type: 'MCP_OAUTH_SUCCESS' }, '*');
                        }
                        window.close();
                    </script>
                    <p>Authorization successful. You can close this window now.</p>
                </body>
            </html>
            `,
            { headers: { 'Content-Type': 'text/html' } }
        );
    } catch (err: any) {
        console.error('MCP OAuth Callback Error:', err);
        return new Response(`Authorization failed: ${err.message}`, { status: 500 });
    }
}
