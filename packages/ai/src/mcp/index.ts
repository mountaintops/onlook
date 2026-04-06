import { createMCPClient, type MCPClient, type MCPTransport, type JSONRPCMessage } from '@ai-sdk/mcp';
import { McpTransportType, type McpServerConfig } from '@onlook/models';
import type { Provider, ProviderBackgroundCommand } from '@onlook/code-provider';
import type { ToolSet } from 'ai';

/**
 * MCP transport that runs a command in a remote VM using the CodeProvider.
 */
class VmStdioMCPTransport implements MCPTransport {
    private command: ProviderBackgroundCommand | null = null;

    constructor(
        private readonly codeProvider: Provider,
        private readonly config: { command: string; args?: string[]; env?: Record<string, string> },
        private readonly onLog?: (type: 'info' | 'error' | 'sent' | 'received', message: string) => void,
    ) { }

    onclose?: () => void;
    onerror?: (error: Error) => void;
    onmessage?: (message: JSONRPCMessage) => void;

    async start(): Promise<void> {
        const fullCommand = [this.config.command, ...(this.config.args || [])].join(' ');
        this.onLog?.('info', `[MCP] Starting transport for command: ${fullCommand}`);

        const { command } = await this.codeProvider.runBackgroundCommand({
            args: { command: fullCommand },
        });
        this.command = command;
        await this.command.open();
        this.onLog?.('info', '[MCP] Transport command opened');

        this.command.onOutput((data) => {
            // Split by lines as MCP often sends multiple JSON-RPC messages separated by newlines
            const lines = data.split('\n').filter((l) => l.trim().length > 0);
            for (const line of lines) {
                this.onLog?.('received', line);
                try {
                    const message = JSON.parse(line) as JSONRPCMessage;
                    this.onmessage?.(message);
                } catch (e) {
                    // Log non-JSON output if it might be an error or useful info
                    this.onLog?.('info', `[MCP] Server output: ${line}`);
                }
            }
        });
    }

    async send(message: JSONRPCMessage): Promise<void> {
        if (!this.command) {
            throw new Error('Transport not started');
        }
        const data = JSON.stringify(message);
        this.onLog?.('sent', data);
        await this.command.write(data + '\n');
    }

    async close(): Promise<void> {
        if (this.command) {
            const fullCommand = [this.config.command, ...(this.config.args || [])].join(' ');
            this.onLog?.('info', `[MCP] Closing transport for command: ${fullCommand}`);
            await this.command.kill();
            this.command = null;
        }
        this.onclose?.();
    }
}

/**
 * Manages MCP client connections and aggregates their tools.
 * Creates clients on demand, fetches tools, and provides cleanup.
 */
export class McpClientManager {
    private clients: MCPClient[] = [];
    private providers: Provider[] = [];

    constructor(
        private configs: McpServerConfig[],
        private codeProvider?: Provider,
        private onLog?: (type: 'info' | 'error' | 'sent' | 'received', message: string) => void,
    ) {
        if (this.codeProvider) {
            this.codeProvider.onLog = (message: string) => {
                this.onLog?.('info', message);
            };
        }
    }

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
                            this.onLog?.('info', `[MCP] Calling tool: ${toolName} with args: ${JSON.stringify(input, null, 2)}`);
                            try {
                                const result = await (tool.execute as any)(...args);
                                this.onLog?.('info', `[MCP] Tool ${toolName} returned result: ${JSON.stringify(result, null, 2)}`);
                                return result;
                            } catch (error) {
                                this.onLog?.('error', `[MCP] Error calling tool ${toolName}: ${error instanceof Error ? error.message : String(error)}`);
                                throw error;
                            }
                        } : undefined,
                    };
                }
            } else {
                this.onLog?.('error', `[MCP] Failed to fetch tools from "${config.name}" (${config.transport}): ${result.reason}`);
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
                this.onLog?.('error', `[MCP] Error closing client: ${err instanceof Error ? err.message : String(err)}`);
            }))
        );
        this.clients = [];

        await Promise.allSettled(
            this.providers.map((provider) => provider.destroy().catch((err) => {
                this.onLog?.('error', `[MCP] Error destroying provider: ${err instanceof Error ? err.message : String(err)}`);
            }))
        );
        this.providers = [];
    }

    private async createClient(config: McpServerConfig): Promise<MCPClient> {
        switch (config.transport) {
            case McpTransportType.HTTP:
                this.onLog?.('info', `[MCP] Connecting to HTTP server: "${config.name}" at ${config.url}`);
                return createMCPClient({
                    transport: {
                        type: 'http',
                        url: config.url!,
                        headers: config.headers,
                    },
                });

            case McpTransportType.SSE:
                this.onLog?.('info', `[MCP] Connecting to SSE server: "${config.name}" at ${config.url}`);
                return createMCPClient({
                    transport: {
                        type: 'sse',
                        url: config.url!,
                        headers: config.headers,
                    },
                });

            case McpTransportType.STDIO: {
                if (!this.codeProvider) {
                    throw new Error(`CodeProvider not available for transport STDIO: "${config.name}". Cannot connect to remote VM.`);
                }

                this.onLog?.('info',
                    `[MCP] Connecting to VM STDIO server: "${config.name}" with command: ${config.command} ${config.args?.join(' ')}`,
                );
                return createMCPClient({
                    transport: new VmStdioMCPTransport(this.codeProvider, {
                        command: config.command!,
                        args: config.args,
                        env: config.env,
                    }, this.onLog),
                });
            }

            case McpTransportType.CODESANDBOX: {
                if (!this.codeProvider) {
                    throw new Error(`CodeProvider not available for transport CODESANDBOX: "${config.name}". Cannot connect to Sandbox.`);
                }

                this.onLog?.('info',
                    `[MCP] Connecting to CodeSandbox server: "${config.name}" using ${this.codeProvider.constructor.name} with command: ${config.command} ${config.args?.join(' ')}`,
                );
                return createMCPClient({
                    transport: new VmStdioMCPTransport(this.codeProvider, {
                        command: config.command!,
                        args: config.args,
                        env: config.env,
                    }, this.onLog),
                });
            }

            default:
                throw new Error(`Unsupported MCP transport: ${config.transport}`);
        }
    }
}
