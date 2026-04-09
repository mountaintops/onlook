import { createMCPClient } from '@ai-sdk/mcp';
import type { McpServerConfig } from '@onlook/models';
import type { ToolSet } from 'ai';

type McpClient = Awaited<ReturnType<typeof createMCPClient>>;

/**
 * Manages per-request MCP client instances.
 *
 * Usage:
 *   const manager = new McpClientManager();
 *   const mcpTools = await manager.loadTools(mcpServers);
 *   // ... pass mcpTools into streamText ...
 *   // in onFinish / onError:
 *   await manager.closeAll();
 */
export class McpClientManager {
    private clients: McpClient[] = [];

    /**
     * Connects to each configured MCP server, fetches its tool set, and
     * returns the union of all tools. Failed servers are logged and skipped.
     */
    async loadTools(servers: McpServerConfig[]): Promise<ToolSet> {
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

                const tools = await client.tools();
                console.log(
                    `[MCP] Connected to "${srv.name}" (${srv.url}) — ${Object.keys(tools).length} tools loaded`,
                );
                return tools;
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
