import { createMCPClient } from '@ai-sdk/mcp';
import type { McpServerConfig } from '@onlook/models';
import type { ToolSet } from 'ai';

type McpClient = Awaited<ReturnType<typeof createMCPClient>>;

export class McpClientManager {
    private clients: McpClient[] = [];

    async loadTools(
        projectId: string,
        servers: McpServerConfig[],
        onSaveConfig: (serverId: string, patch: Partial<McpServerConfig>) => Promise<void>
    ): Promise<ToolSet> {
        if (!servers.length) return {};

        const results = await Promise.allSettled(
            servers.map(async (srv) => {
                const headers: Record<string, string> = {};
                if (srv.authType === 'bearer' && srv.bearerToken) {
                    headers['Authorization'] = `Bearer ${srv.bearerToken}`;
                }

                const client = await createMCPClient({
                    transport: {
                        type: 'http',
                        url: srv.url,
                        headers,
                    },
                });
                this.clients.push(client);

                try {
                    const tools = await client.tools();
                    console.log(
                        `[MCP] Connected to "${srv.name}" (${srv.url}) — ${Object.keys(tools).length} tools loaded`,
                    );
                    return tools;
                } catch (err) {
                    throw err; // Rethrow to fail this specific server's Promise in allSettled
                }
            }),
        );

        const merged: ToolSet = {};
        for (let i = 0; i < results.length; i++) {
            const result = results[i];
            if (result && result.status === 'fulfilled') {
                Object.assign(merged, result.value);
            } else if (result) {
                console.warn(
                    `[MCP] Server "${servers[i]?.name}" (${servers[i]?.url}) failed to connect:`,
                    result.reason,
                );
            }
        }
        return merged;
    }

    /** Close all open MCP client connections. Safe to call multiple times. */
    async closeAll() {
        if (!this.clients.length) return;
        await Promise.allSettled(this.clients.map((c) => c.close()));
        console.log(`[MCP] Closed ${this.clients.length} client connection(s)`);
        this.clients = [];
    }
}
