import { type NextRequest, NextResponse } from 'next/server';
import { createClient as createTRPCClient } from '@/trpc/request-server';
import { getSupabaseUser } from '@/app/api/chat/helpers';

/**
 * OAuth callback endpoint for MCP server authorization.
 *
 * After the user authorizes in their browser, the OAuth provider redirects here with:
 *   ?code=AUTH_CODE&state=SERVER_ID
 *
 * We store the code in the server's OAuth config so the next chat request can call
 * transport.finishAuth(code) and complete the connection automatically.
 */
export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const code = searchParams.get('code');
    const state = searchParams.get('state'); // We use state to identify the server
    const error = searchParams.get('error');
    const errorDescription = searchParams.get('error_description');

    const htmlPage = (title: string, message: string, success: boolean) => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${title} – Onlook</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
           background: #0a0a0a; color: #fff; display: flex; align-items: center;
           justify-content: center; min-height: 100vh; }
    .card { background: #111; border: 1px solid #222; border-radius: 16px;
            padding: 40px 48px; max-width: 480px; text-align: center; }
    .icon { font-size: 48px; margin-bottom: 20px; }
    h1 { font-size: 22px; font-weight: 600; margin-bottom: 10px; }
    p { color: #888; font-size: 14px; line-height: 1.6; }
    .badge { display: inline-block; margin-top: 20px; padding: 6px 16px;
             border-radius: 8px; font-size: 13px; font-weight: 500;
             background: ${success ? '#0d2d1e' : '#2d0d0d'};
             color: ${success ? '#4ade80' : '#f87171'}; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">${success ? '✅' : '❌'}</div>
    <h1>${title}</h1>
    <p>${message}</p>
    <span class="badge">${success ? 'Connected' : 'Failed'}</span>
    <p style="margin-top:20px; font-size:12px; color:#555;">You can close this window and return to Onlook.</p>
  </div>
  <script>
    // Try to notify the opener if still available
    if (window.opener) {
      try {
        window.opener.postMessage({ type: 'mcp-oauth-callback', success: ${success}, code: ${JSON.stringify(code)} }, '*');
      } catch(e) {}
    }
    setTimeout(() => window.close(), 3000);
  </script>
</body>
</html>`;

    if (error) {
        return new NextResponse(
            htmlPage('Authorization Failed', errorDescription || error, false),
            { status: 400, headers: { 'Content-Type': 'text/html' } }
        );
    }

    if (!code) {
        return new NextResponse(
            htmlPage('Missing Authorization Code', 'No authorization code was received. Please try again.', false),
            { status: 400, headers: { 'Content-Type': 'text/html' } }
        );
    }

    // The state encodes the server ID and project ID: "serverId:projectId"
    // This allows us to save the auth code to the right server config.
    if (state) {
        try {
            const user = await getSupabaseUser(req);
            if (user) {
                const [serverId, projectId] = state.split(':');
                if (serverId && projectId) {
                    const { api } = await createTRPCClient(req);
                    const projectSettingsData = await api.settings.get({ projectId });
                    const mcpServers = projectSettingsData?.mcpServers ?? [];
                    const updatedServers = mcpServers.map((s: any) =>
                        s.id === serverId
                            ? { ...s, oauth: { ...(s.oauth ?? {}), pendingAuthCode: code } }
                            : s
                    );
                    await api.settings.upsert({
                        projectId,
                        settings: { projectId, mcpServers: updatedServers },
                    });
                }
            }
        } catch (err) {
            console.error('[MCP Callback] Failed to save auth code:', err);
            // Non-fatal — the postMessage fallback will also pass the code to the parent window
        }
    }

    return new NextResponse(
        htmlPage(
            'Authorization Successful',
            'Your account has been connected. Send another message in Onlook to continue.',
            true,
        ),
        { status: 200, headers: { 'Content-Type': 'text/html' } }
    );
}
