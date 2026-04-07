import { createMCPClient, type MCPClient, type MCPTransport, type JSONRPCMessage } from '@ai-sdk/mcp';
import { McpTransportType, type McpServerConfig } from '@onlook/models';
import type { Provider, ProviderBackgroundCommand, ProviderTerminal } from '@onlook/code-provider';
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

        let buffer = '';
        this.command.onOutput((data) => {
            buffer += data;
            // Split raw data buffers by newline (handling both LF and CRLF).
            const lines = buffer.split(/\r?\n/);
            buffer = lines.pop() || '';
            for (const line of lines) {
                const trimmed = line.trim();
                if (trimmed.length === 0) continue;
                
                // Try to extract JSON even if there's noise around it
                const jsonMatch = trimmed.match(/(\{.*\}|\[.*\])/);
                if (jsonMatch) {
                    const jsonStr = jsonMatch[0];
                    try {
                        const message = JSON.parse(jsonStr) as JSONRPCMessage;
                        if (message.jsonrpc) {
                            this.onLog?.('received', jsonStr);
                            this.onmessage?.(message);
                        }
                    } catch (e) {
                        this.onLog?.('info', `[MCP] Server non-JSON output: ${trimmed}`);
                    }
                } else {
                    this.onLog?.('info', `[MCP] Server output: ${trimmed}`);
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
 * MCP transport that runs an interactive terminal in CodeSandbox.
 * Required because CodeSandbox SDK background tasks do not easily support stdin (`write`).
 */
class CodeSandboxTerminalMCPTransport implements MCPTransport {
    private terminal: ProviderTerminal | null = null;
    private onOutputDisposable: (() => void) | null = null;

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
        this.onLog?.('info', `[MCP] Starting CodeSandbox terminal transport for command: ${fullCommand}`);

        const { terminal } = await this.codeProvider.createTerminal({
            args: {}
        });
        this.terminal = terminal;
        await this.terminal.open();
        this.onLog?.('info', '[MCP] CodeSandbox terminal opened');

        let buffer = '';
        this.onOutputDisposable = this.terminal.onOutput((data) => {
            buffer += data;
            // Support both CRLF (standard PTY) and LF
            const lines = buffer.split(/\r?\n/);
            buffer = lines.pop() || '';
            for (const line of lines) {
                const trimmed = line.trim();
                if (trimmed.length === 0) continue;
                
                // Extraction strategy: Find the first { and last } to avoid terminal prompts like "bash-5.1#"
                const jsonMatch = trimmed.match(/(\{.*\}|\[.*\])/);
                if (jsonMatch) {
                    const jsonStr = jsonMatch[0];
                    try {
                        const message = JSON.parse(jsonStr) as JSONRPCMessage;
                        // Avoid logging echos if stty -echo failed
                        if (message.jsonrpc) { 
                            this.onLog?.('received', jsonStr);
                            this.onmessage?.(message);
                        }
                    } catch (e) {
                        // Ignore partially corrupted or mismatched terminal artifacts
                    }
                }
            }
        });

        // Handshake: Give the terminal shell a moment to settle before typing
        await new Promise(resolve => setTimeout(resolve, 1500));

        // Use 'exec' to replace the shell process with the MCP server
        // Use 'stty -echo' if possible (in true PTYs), but don't abort if it fails (in local NodeFS streams)
        await this.terminal.write(`stty -echo 2>/dev/null ; exec ${fullCommand}\n`);
    }

    async send(message: JSONRPCMessage): Promise<void> {
        if (!this.terminal) {
            throw new Error('CodeSandbox transport not started');
        }
        const data = JSON.stringify(message);
        this.onLog?.('sent', data);
        // Standard PTY input expects a newline/return to submit
        await this.terminal.write(data + '\n');
    }

    async close(): Promise<void> {
        if (this.onOutputDisposable) {
            this.onOutputDisposable();
            this.onOutputDisposable = null;
        }
        if (this.terminal) {
            const fullCommand = [this.config.command, ...(this.config.args || [])].join(' ');
            this.onLog?.('info', `[MCP] Closing CodeSandbox terminal transport for command: ${fullCommand}`);
            await this.terminal.kill();
            this.terminal = null;
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
            const isLocal = this.codeProvider?.constructor.name === 'NodeFsProvider';
            const prefix = isLocal ? '[LMCP]' : '[VMCP]';
            this.onLog?.('info', `${prefix} No enabled MCP servers found.`);
            return {};
        }

        const isLocal = this.codeProvider?.constructor.name === 'NodeFsProvider';
        const prefix = isLocal ? '[LMCP]' : '[VMCP]';

        this.onLog?.('info', `${prefix} Fetching tools from ${enabledConfigs.length} enabled servers: ${enabledConfigs.map(c => c.name).join(', ')}`);

        const TIMEOUT_MS = 15000; // 15 seconds timeout per server
        const results = await Promise.allSettled(
            enabledConfigs.map(async (config) => {
                const logPrefix = isLocal ? '[LMCP]' : '[VMCP]';
                try {
                    this.onLog?.('info', `${logPrefix} Requesting client for "${config.name}"...`);
                    const client = await this.createClient(config);
                    this.clients.push(client);
                    this.onLog?.('info', `${logPrefix} Successfully created client for "${config.name}". Fetching tools...`);

                    const fetchToolsPromise = client.tools();
                    return await Promise.race([
                        fetchToolsPromise,
                        new Promise<ToolSet>((_, reject) =>
                            setTimeout(() => reject(new Error(`Connection timeout after ${TIMEOUT_MS}ms`)), TIMEOUT_MS)
                        ),
                    ]);
                } catch (error) {
                    this.onLog?.('error', `${logPrefix} Error initializing or fetching tools from "${config.name}": ${error instanceof Error ? error.message : String(error)}`);
                    throw error;
                }
            })
        );

        const allTools: ToolSet = {};
        results.forEach((result, index) => {
            const config = enabledConfigs[index];
            if (!config) {
                return;
            }
            if (result.status === 'fulfilled') {
                const isLocal = this.codeProvider?.constructor.name === 'NodeFsProvider';
                const logPrefix = isLocal ? '[LMCP]' : '[VMCP]';
                const prefix = config.name.toLowerCase().replace(/[^a-z0-9]/g, '_');
                const tools = result.value;
                const toolNames = Object.keys(tools);
                this.onLog?.('info', `${logPrefix} Successfully registered ${toolNames.length} tools from "${config.name}" with prefix "${prefix}_": ${toolNames.join(', ')}`);

                for (const [name, tool] of Object.entries(tools)) {
                    const toolName = `${prefix}_${name}`;
                    allTools[toolName] = {
                        ...tool,
                        execute: tool.execute ? async (...args: any[]) => {
                            const [input] = args;
                            this.onLog?.('info', `${logPrefix} Calling tool: ${toolName} with args: ${JSON.stringify(input, null, 2)}`);
                            try {
                                const result = await (tool.execute as any)(...args);
                                this.onLog?.('info', `${logPrefix} Tool ${toolName} returned result: ${JSON.stringify(result, null, 2)}`);
                                return result;
                            } catch (error) {
                                this.onLog?.('error', `${logPrefix} Error calling tool ${toolName}: ${error instanceof Error ? error.message : String(error)}`);
                                throw error;
                            }
                        } : undefined,
                    };
                }
            } else {
                const isLocal = this.codeProvider?.constructor.name === 'NodeFsProvider';
                const logPrefix = isLocal ? '[LMCP]' : '[VMCP]';
                this.onLog?.('error', `${logPrefix} Final failure for "${config.name}" (${config.transport}): ${result.reason}`);
            }
        });

        return allTools;
    }

    /**
     * Close all active MCP client connections.
     */
    async closeAll(): Promise<void> {
        this.onLog?.('info', `[MCP] Closing ${this.clients.length} active client connections...`);
        await Promise.allSettled(
            this.clients.map((client) => client.close().catch((err) => {
                this.onLog?.('error', `[MCP] Error closing client: ${err instanceof Error ? err.message : String(err)}`);
            }))
        );
        this.clients = [];

        if (this.providers.length > 0) {
            this.onLog?.('info', `[MCP] Destroying ${this.providers.length} resource providers...`);
            await Promise.allSettled(
                this.providers.map((provider) => provider.destroy().catch((err) => {
                    this.onLog?.('error', `[MCP] Error destroying provider: ${err instanceof Error ? err.message : String(err)}`);
                }))
            );
            this.providers = [];
        }
    }

    private getLogPrefix(): string {
        const isLocal = this.codeProvider?.constructor.name === 'NodeFsProvider';
        return isLocal ? '[LMCP]' : '[VMCP]';
    }

    private async createClient(config: McpServerConfig): Promise<MCPClient> {
        const logPrefix = this.getLogPrefix();

        switch (config.transport) {
            case McpTransportType.HTTP:
                this.onLog?.('info', `${logPrefix} Connecting to HTTP server: "${config.name}" at ${config.url}`);
                try {
                    return createMCPClient({
                        transport: {
                            type: 'http',
                            url: config.url!,
                            headers: config.headers,
                        },
                    });
                } catch (err) {
                    this.onLog?.('error', `${logPrefix} HTTP transport initialization failed for "${config.name}": ${err}`);
                    throw err;
                }

            case McpTransportType.SSE:
                this.onLog?.('info', `${logPrefix} Connecting to SSE server: "${config.name}" at ${config.url}`);
                try {
                    return createMCPClient({
                        transport: {
                            type: 'sse',
                            url: config.url!,
                            headers: config.headers,
                        },
                    });
                } catch (err) {
                    this.onLog?.('error', `${logPrefix} SSE transport initialization failed for "${config.name}": ${err}`);
                    throw err;
                }

            case McpTransportType.STDIO: {
                if (!this.codeProvider) {
                    throw new Error(`CodeProvider not available for transport STDIO: "${config.name}". Cannot connect to remote VM.`);
                }

                this.onLog?.('info',
                    `${logPrefix} Connecting to VM STDIO server: "${config.name}" with command: ${config.command} ${config.args?.join(' ')}`,
                );
                try {
                    return createMCPClient({
                        transport: new VmStdioMCPTransport(this.codeProvider, {
                            command: config.command!,
                            args: config.args,
                            env: config.env,
                        }, this.onLog),
                    });
                } catch (err) {
                    this.onLog?.('error', `${logPrefix} VM STDIO transport initialization failed for "${config.name}": ${err}`);
                    throw err;
                }
            }

            case McpTransportType.CODESANDBOX: {
                if (!this.codeProvider) {
                    throw new Error(`CodeProvider not available for transport CODESANDBOX: "${config.name}". Cannot connect to Sandbox.`);
                }

                const isLocal = this.codeProvider.constructor.name === 'NodeFsProvider';
                this.onLog?.('info',
                    `${logPrefix} Connecting to ${isLocal ? 'Local NodeFS' : 'Remote CodeSandbox'} server: "${config.name}" using interactive Terminal with command: ${config.command} ${config.args?.join(' ')}`,
                );
                try {
                    return createMCPClient({
                        transport: new CodeSandboxTerminalMCPTransport(this.codeProvider, {
                            command: config.command!,
                            args: config.args,
                            env: config.env,
                        }, this.onLog),
                    });
                } catch (err) {
                    this.onLog?.('error', `${logPrefix} CodeSandbox transport initialization failed for "${config.name}": ${err}`);
                    throw err;
                }
            }

            default:
                throw new Error(`Unsupported MCP transport: ${config.transport}`);
        }
    }
}
