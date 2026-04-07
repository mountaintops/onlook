import { createMCPClient, type MCPClient } from '@ai-sdk/mcp';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { type OAuthClientProvider, type OAuthTokens } from '@modelcontextprotocol/sdk/client/auth.js';
import { McpTransportType, type McpServerConfig } from '@onlook/models';
import type { ToolSet } from 'ai';

/**
 * Manages MCP client connections and aggregates their tools.
 * Creates clients on demand, fetches tools, and provides cleanup.
 */
export class McpClientManager {
    private clients: MCPClient[] = [];

    constructor(
        private configs: McpServerConfig[],
        private onLog?: (type: 'info' | 'error' | 'sent' | 'received', message: string) => void,
        private onUpdateConfig?: (config: McpServerConfig) => void,
    ) { }

    /**
     * Connect to all enabled MCP servers and return a merged ToolSet.
     * Servers that fail to connect are logged and skipped gracefully.
     */
    async getTools(): Promise<ToolSet> {
        const enabledConfigs = this.configs.filter((c) => c.enabled);
        if (enabledConfigs.length === 0) {
            this.onLog?.('info', `[MCP] No enabled MCP servers found.`);
            return {};
        }

        this.onLog?.('info', `[MCP] Fetching tools from ${enabledConfigs.length} enabled servers: ${enabledConfigs.map(c => c.name).join(', ')}`);

        const TIMEOUT_MS = 15000; // 15 seconds timeout per server
        const results = await Promise.allSettled(
            enabledConfigs.map(async (config) => {
                try {
                    this.onLog?.('info', `[MCP] Requesting client for "${config.name}"...`);
                    const client = await this.createClient(config);
                    this.clients.push(client);
                    this.onLog?.('info', `[MCP] Successfully created client for "${config.name}". Fetching tools...`);

                    const fetchToolsPromise = client.tools();
                    return await Promise.race([
                        fetchToolsPromise,
                        new Promise<ToolSet>((_, reject) =>
                            setTimeout(() => reject(new Error(`Connection timeout after ${TIMEOUT_MS}ms`)), TIMEOUT_MS)
                        ),
                    ]);
                } catch (error) {
                    this.onLog?.('error', `[MCP] Error initializing or fetching tools from "${config.name}": ${error instanceof Error ? error.message : String(error)}`);
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
                const prefix = config.name.toLowerCase().replace(/[^a-z0-9]/g, '_');
                const tools = result.value;
                const toolNames = Object.keys(tools);
                this.onLog?.('info', `[MCP] Successfully registered ${toolNames.length} tools from "${config.name}" with prefix "${prefix}_": ${toolNames.join(', ')}`);

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
                this.onLog?.('error', `[MCP] Final failure for "${config.name}" (${config.transport}): ${result.reason}`);
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
    }

    private async createClient(config: McpServerConfig): Promise<MCPClient> {
        switch (config.transport) {
            case McpTransportType.STREAMABLE_HTTP:
                this.onLog?.('info', `[MCP] Connecting to Streamable HTTP server: "${config.name}" at ${config.url}`);
                try {
                    const authProvider = config.oauth ? new McpOAuthProvider(
                        config,
                        this.onUpdateConfig,
                        (type, msg) => this.onLog?.(type, msg),
                    ) : undefined;

                    return createMCPClient({
                        transport: new StreamableHTTPClientTransport(new URL(config.url!), {
                            requestInit: {
                                headers: config.headers,
                            },
                            authProvider,
                        }),
                    });
                } catch (err) {
                    this.onLog?.('error', `[MCP] Streamable HTTP transport initialization failed for "${config.name}": ${err}`);
                    throw err;
                }

            default:
                throw new Error(`Unsupported MCP transport: ${config.transport}`);
        }
    }
}

/**
 * Implementation of OAuthClientProvider for MCP servers.
 * Handles token persistence and authorization redirects.
 */
class McpOAuthProvider implements OAuthClientProvider {
    constructor(
        private config: McpServerConfig,
        private onUpdateConfig?: (config: McpServerConfig) => void,
        private onLog?: (type: 'info' | 'error', message: string) => void,
    ) { }

    get redirectUrl() {
        return this.config.oauth?.redirectUri;
    }

    get clientMetadata() {
        return {
            client_id: this.config.oauth?.clientId || '',
            client_name: 'Onlook',
            redirect_uris: this.redirectUrl ? [String(this.redirectUrl)] : [],
        };
    }

    async clientInformation() {
        return {
            client_id: this.config.oauth?.clientId || '',
        };
    }

    async tokens() {
        if (!this.config.oauth?.tokens) return undefined;
        return {
            ...this.config.oauth.tokens,
            token_type: this.config.oauth.tokens.token_type || 'Bearer',
            expires_in: this.config.oauth.tokens.expires_at ? Math.floor((this.config.oauth.tokens.expires_at - Date.now()) / 1000) : undefined,
        } as any;
    }

    async saveTokens(tokens: OAuthTokens) {
        if (!this.config.oauth) return;
        this.config.oauth.tokens = tokens;
        this.onUpdateConfig?.(this.config);
        this.onLog?.('info', `[MCP] Tokens updated successfully for server: "${this.config.name}"`);
    }

    async redirectToAuthorization(authUrl: URL) {
        this.onLog?.('info', `[MCP] Opening authorization URL for "${this.config.name}": ${authUrl}`);
        if (typeof window !== 'undefined') {
            window.open(authUrl.toString(), '_blank');
        }
    }

    async saveCodeVerifier(codeVerifier: string) {
        if (!this.config.oauth) return;
        this.config.oauth.codeVerifier = codeVerifier;
        this.onUpdateConfig?.(this.config);
    }

    async codeVerifier() {
        return this.config.oauth?.codeVerifier || '';
    }

    async state() {
        return this.config.oauth?.state || '';
    }

    async saveState(state: string) {
        if (!this.config.oauth) return;
        this.config.oauth.state = state;
        this.onUpdateConfig?.(this.config);
    }
}
