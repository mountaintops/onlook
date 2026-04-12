import { createMCPClient } from '@ai-sdk/mcp';
import type { McpServerConfig } from '@onlook/models';
import type { ToolSet } from 'ai';

type McpClient = Awaited<ReturnType<typeof createMCPClient>>;

export class McpClientManager {
    private clients: McpClient[] = [];

    async loadTools(
        projectId: string,
        servers: McpServerConfig[],
        onSaveConfig: (serverId: string, patch: Partial<McpServerConfig>) => Promise<void>,
        previewUrl?: string,
    ): Promise<ToolSet> {
        if (!servers.length) return {};

        const results = await Promise.allSettled(
            servers.map(async (srv) => {
                // Validate URL - data URIs are not supported for MCP connections
                if (srv.url.startsWith('data:')) {
                    console.warn(
                        `[MCP] Server "${srv.name}" has a data: URL which is not supported. Skipping.`,
                    );
                    return null;
                }

                const headers: Record<string, string> = {};
                if (srv.authType === 'bearer' && srv.bearerToken) {
                    headers['Authorization'] = `Bearer ${srv.bearerToken}`;
                }

                const client = await createMCPClient({
                    transport: {
                        type: srv.transportType ?? 'http',
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

                    // Wrap tools to resolve localhost URLs if previewUrl is provided
                    if (previewUrl) {
                        const wrappedTools = Object.fromEntries(
                            Object.entries(tools).map(([name, tool]) => [
                                name,
                                {
                                    ...tool,
                                    execute: async (args: any, context: any) => {
                                        const resolvedArgs = resolveLocalhostArgs(args, previewUrl);
                                        return tool.execute(resolvedArgs, context);
                                    }
                                }
                            ])
                        );
                        return wrappedTools;
                    }

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

/**
 * Recursively find and replace localhost/127.0.0.1 URLs in tool arguments with the preview URL.
 */
function resolveLocalhostArgs(args: any, previewUrl: string): any {
    if (typeof args === 'string') {
        if (args.includes('localhost') || args.includes('127.0.0.1')) {
            try {
                const localUrl = new URL(args);
                const publicUrl = new URL(previewUrl);
                // Merge path and search params
                publicUrl.pathname = localUrl.pathname;
                publicUrl.search = localUrl.search;
                return publicUrl.toString();
            } catch (e) {
                return args;
            }
        }
        return args;
    } else if (Array.isArray(args)) {
        return args.map((item) => resolveLocalhostArgs(item, previewUrl));
    } else if (args !== null && typeof args === 'object') {
        return Object.fromEntries(
            Object.entries(args).map(([key, value]) => [
                key,
                resolveLocalhostArgs(value, previewUrl),
            ]),
        );
    }
    return args;
}
