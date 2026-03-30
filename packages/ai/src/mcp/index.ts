import { createMCPClient, type MCPClient } from '@ai-sdk/mcp';
import { McpTransportType, type McpServerConfig } from '@onlook/models';
import type { ToolSet } from 'ai';

/**
 * Manages MCP client connections and aggregates their tools.
 * Creates clients on demand, fetches tools, and provides cleanup.
 */
export class McpClientManager {
    private clients: MCPClient[] = [];

    constructor(private configs: McpServerConfig[]) { }

    /**
     * Connect to all enabled MCP servers and return a merged ToolSet.
     * Servers that fail to connect are logged and skipped gracefully.
     */
    async getTools(): Promise<ToolSet> {
        const enabledConfigs = this.configs.filter((c) => c.enabled);
        if (enabledConfigs.length === 0) {
            return {};
        }

        const TIMEOUT_MS = 15000; // 15 seconds timeout per server
        const results = await Promise.allSettled(
            enabledConfigs.map(async (config) => {
                const fetchToolsPromise = (async () => {
                    const client = await this.createClient(config);
                    this.clients.push(client);
                    return await client.tools();
                })();

                return await Promise.race([
                    fetchToolsPromise,
                    new Promise<ToolSet>((_, reject) =>
                        setTimeout(() => reject(new Error(`Connection timeout after ${TIMEOUT_MS}ms`)), TIMEOUT_MS)
                    ),
                ]);
            })
        );

        const allTools: ToolSet = {};
        results.forEach((result, index) => {
            const config = enabledConfigs[index];
            if (!config) {
                return;
            }
            if (result.status === 'fulfilled') {
                const prefix = config.name.toLowerCase().replace(/[^a-z0-9]/g, '_');
                const tools = result.value;
                for (const [name, tool] of Object.entries(tools)) {
                    const toolName = `${prefix}_${name}`;
                    allTools[toolName] = {
                        ...tool,
                        execute: tool.execute ? async (...args: any[]) => {
                            const [input] = args;
                            console.log(`[MCP] Calling tool: ${toolName} with args:`, JSON.stringify(input, null, 2));
                            try {
                                const result = await (tool.execute as any)(...args);
                                console.log(`[MCP] Tool ${toolName} returned result:`, JSON.stringify(result, null, 2));
                                return result;
                            } catch (error) {
                                console.error(`[MCP] Error calling tool ${toolName}:`, error);
                                throw error;
                            }
                        } : undefined,
                    };
                }
            } else {
                console.error(`[MCP] Failed to fetch tools from "${config.name}" (${config.transport}):`, result.reason);
            }
        });

        return allTools;
    }

    /**
     * Close all active MCP client connections.
     */
    async closeAll(): Promise<void> {
        await Promise.allSettled(
            this.clients.map((client) => client.close().catch((err) => {
                console.error('[MCP] Error closing client:', err);
            }))
        );
        this.clients = [];
    }

    private async createClient(config: McpServerConfig): Promise<MCPClient> {
        switch (config.transport) {
            case McpTransportType.HTTP:
                console.log(`[MCP] Connecting to HTTP server: "${config.name}" at ${config.url}`);
                return createMCPClient({
                    transport: {
                        type: 'http',
                        url: config.url!,
                        headers: config.headers,
                    },
                });

            case McpTransportType.SSE:
                console.log(`[MCP] Connecting to SSE server: "${config.name}" at ${config.url}`);
                return createMCPClient({
                    transport: {
                        type: 'sse',
                        url: config.url!,
                        headers: config.headers,
                    },
                });

            case McpTransportType.STDIO: {
                console.log(`[MCP] Connecting to STDIO server: "${config.name}" with command: ${config.command} ${config.args?.join(' ')}`);
                // Dynamic import to avoid bundling stdio in production builds
                const { Experimental_StdioMCPTransport } = await import('@ai-sdk/mcp/mcp-stdio');
                return createMCPClient({
                    transport: new Experimental_StdioMCPTransport({
                        command: config.command!,
                        args: config.args,
                        env: config.env,
                    }),
                });
            }

            default:
                throw new Error(`Unsupported MCP transport: ${config.transport}`);
        }
    }
}
