import { createMCPClient, type MCPClient } from '@ai-sdk/mcp';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { type OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
import type { OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import type { OAuthClientInformationMixed } from '@modelcontextprotocol/sdk/shared/auth.js';
import { McpTransportType, type McpServerConfig, type McpOAuthConfig } from '@onlook/models';
import type { ToolSet } from 'ai';

/** Thrown when an MCP server requires OAuth and the user must visit an auth URL */
export class OAuthRedirectRequired extends Error {
    constructor(
        public readonly serverName: string,
        public readonly serverId: string,
        public readonly authUrl: URL,
    ) {
        super(`OAuth authorization required for "${serverName}". Visit: ${authUrl}`);
        this.name = 'OAuthRedirectRequired';
    }
}

/** Pending OAuth authorization for a server */
export interface PendingOAuth {
    serverId: string;
    serverName: string;
    authUrl: string;
}

/**
 * Manages MCP client connections and aggregates their tools.
 * Handles automatic OAuth — when a server requires auth, captures the redirect URL
 * and surfaces it so the UI can show the user a clickable authorization link.
 */
export class McpClientManager {
    private clients: MCPClient[] = [];
    private pendingAuths: PendingOAuth[] = [];

    constructor(
        private configs: McpServerConfig[],
        private projectId?: string,
        private onLog?: (type: 'info' | 'error' | 'sent' | 'received', message: string) => void,
        private onUpdateConfig?: (config: McpServerConfig) => void,
    ) { }

    /** Returns any servers that need OAuth authorization */
    getPendingAuths(): PendingOAuth[] {
        return this.pendingAuths;
    }

    /**
     * Connect to all enabled MCP servers and return a merged ToolSet.
     * Servers that fail to connect are logged and skipped gracefully.
     * Servers requiring OAuth are added to pendingAuths.
     */
    async getTools(): Promise<ToolSet> {
        this.pendingAuths = [];
        const enabledConfigs = this.configs.filter((c) => c.enabled);
        if (enabledConfigs.length === 0) {
            this.onLog?.('info', `[MCP] No enabled MCP servers found.`);
            return {};
        }

        this.onLog?.('info', `[MCP] Fetching tools from ${enabledConfigs.length} enabled server(s): ${enabledConfigs.map(c => c.name).join(', ')}`);

        const TIMEOUT_MS = 15000;
        const results = await Promise.allSettled(
            enabledConfigs.map(async (config) => {
                try {
                    this.onLog?.('info', `[MCP] Connecting to "${config.name}"...`);
                    const client = await this.createClient(config);
                    this.clients.push(client);
                    this.onLog?.('info', `[MCP] Connected to "${config.name}". Fetching tools...`);

                    return await Promise.race([
                        client.tools(),
                        new Promise<ToolSet>((_, reject) =>
                            setTimeout(() => reject(new Error(`Timeout after ${TIMEOUT_MS}ms`)), TIMEOUT_MS)
                        ),
                    ]);
                } catch (error) {
                    if (error instanceof OAuthRedirectRequired) {
                        this.pendingAuths.push({
                            serverId: error.serverId,
                            serverName: error.serverName,
                            authUrl: error.authUrl.toString(),
                        });
                        this.onLog?.('info', `[MCP] "${config.name}" requires OAuth authorization. Auth URL captured.`);
                        throw error;
                    }
                    this.onLog?.('error', `[MCP] Error connecting to "${config.name}": ${error instanceof Error ? error.message : String(error)}`);
                    throw error;
                }
            })
        );

        const allTools: ToolSet = {};
        results.forEach((result, index) => {
            const config = enabledConfigs[index];
            if (!config) return;
            if (result.status === 'fulfilled') {
                const prefix = config.name.toLowerCase().replace(/[^a-z0-9]/g, '_');
                const toolNames = Object.keys(result.value);
                this.onLog?.('info', `[MCP] Registered ${toolNames.length} tool(s) from "${config.name}": ${toolNames.join(', ')}`);

                for (const [name, tool] of Object.entries(result.value)) {
                    const toolName = `${prefix}_${name}`;
                    allTools[toolName] = {
                        ...tool,
                        execute: tool.execute ? async (...args: any[]) => {
                            const [input] = args;
                            this.onLog?.('info', `[MCP] Calling tool: ${toolName} with args: ${JSON.stringify(input, null, 2)}`);
                            try {
                                const res = await (tool.execute as any)(...args);
                                this.onLog?.('info', `[MCP] Tool ${toolName} result: ${JSON.stringify(res, null, 2)}`);
                                return res;
                            } catch (error) {
                                this.onLog?.('error', `[MCP] Tool ${toolName} error: ${error instanceof Error ? error.message : String(error)}`);
                                throw error;
                            }
                        } : undefined,
                    };
                }
            } else {
                if (!(result.reason instanceof OAuthRedirectRequired)) {
                    this.onLog?.('error', `[MCP] Failed to connect to "${config.name}": ${result.reason}`);
                }
            }
        });

        return allTools;
    }

    async closeAll(): Promise<void> {
        await Promise.allSettled(
            this.clients.map((client) => client.close().catch((err) => {
                this.onLog?.('error', `[MCP] Error closing client: ${err instanceof Error ? err.message : String(err)}`);
            }))
        );
        this.clients = [];
    }

    private async createClient(config: McpServerConfig): Promise<MCPClient> {
        switch (config.transport) {
            case McpTransportType.STREAMABLE_HTTP: {
                if (!config.url) throw new Error(`No URL configured for server "${config.name}"`);

                this.onLog?.('info', `[MCP] Creating Streamable HTTP client for "${config.name}" at ${config.url}`);

                const authProvider = new McpOAuthProvider(
                    config,
                    this.projectId,
                    this.onUpdateConfig,
                    this.onLog,
                );

                const transport = new StreamableHTTPClientTransport(new URL(config.url), {
                    requestInit: { headers: config.headers },
                    authProvider,
                });

                return createMCPClient({ transport });
            }
            default:
                throw new Error(`Unsupported MCP transport: ${config.transport}`);
        }
    }
}

/**
 * OAuthClientProvider implementation for automatic OAuth via Dynamic Client Registration.
 *
 * Key behavior: when redirectToAuthorization is called (i.e., the server returned 401),
 * we throw OAuthRedirectRequired so the McpClientManager can surface the URL to the UI.
 * The user clicks a link in the chat, authorizes in their browser, and the flow completes
 * on the next message via the stored pendingAuthCode.
 */
class McpOAuthProvider implements OAuthClientProvider {
    private _clientInfo?: OAuthClientInformationMixed;

    constructor(
        private config: McpServerConfig,
        private projectId?: string,
        private onUpdateConfig?: (config: McpServerConfig) => void,
        private onLog?: (type: 'info' | 'error', message: string) => void,
    ) { }

    /** Redirect URL for OAuth callback — uses the app's /api/mcp/callback route */
    get redirectUrl(): string {
        // In server-side context, we need an absolute URL
        const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
        return `${baseUrl}/api/mcp/callback`;
    }

    /** Client metadata for Dynamic Client Registration */
    get clientMetadata() {
        return {
            client_name: 'Onlook',
            redirect_uris: [this.redirectUrl],
            grant_types: ['authorization_code'],
            response_types: ['code'],
            token_endpoint_auth_method: 'none', // public client (PKCE)
        };
    }

    /** Returns stored client info from previous Dynamic Client Registration */
    clientInformation(): OAuthClientInformationMixed | undefined {
        if (this._clientInfo) return this._clientInfo;
        if (this.config.oauth?.clientId) {
            return { client_id: this.config.oauth.clientId };
        }
        return undefined;
    }

    /** Saves client info from Dynamic Client Registration */
    async saveClientInformation(info: OAuthClientInformationMixed) {
        this._clientInfo = info;
        if (!this.config.oauth) this.config.oauth = {};
        if ('client_id' in info) {
            this.config.oauth.clientId = info.client_id;
        }
        this.onUpdateConfig?.(this.config);
        this.onLog?.('info', `[MCP] Registered OAuth client for "${this.config.name}"`);
    }

    /** Returns stored OAuth tokens */
    tokens(): OAuthTokens | undefined {
        if (!this.config.oauth?.tokens) return undefined;
        return this.config.oauth.tokens as OAuthTokens;
    }

    /** Saves new OAuth tokens after successful authorization */
    async saveTokens(tokens: OAuthTokens) {
        if (!this.config.oauth) this.config.oauth = {};
        this.config.oauth.tokens = tokens;
        // Clear transient fields
        delete this.config.oauth.codeVerifier;
        delete this.config.oauth.state;
        delete this.config.oauth.pendingAuthUrl;
        delete this.config.oauth.pendingAuthCode;
        this.onUpdateConfig?.(this.config);
        this.onLog?.('info', `[MCP] Tokens saved for "${this.config.name}"`);
    }

    /**
     * Instead of opening a browser (we're server-side), throw a special error
     * so McpClientManager can surface the URL to the chat UI.
     */
    async redirectToAuthorization(authUrl: URL) {
        this.onLog?.('info', `[MCP] OAuth required for "${this.config.name}". Auth URL: ${authUrl}`);
        // Save the URL so it can be persisted if needed
        if (!this.config.oauth) this.config.oauth = {};
        this.config.oauth.pendingAuthUrl = authUrl.toString();
        this.onUpdateConfig?.(this.config);

        throw new OAuthRedirectRequired(this.config.name, this.config.id, authUrl);
    }

    async saveCodeVerifier(codeVerifier: string) {
        if (!this.config.oauth) this.config.oauth = {};
        this.config.oauth.codeVerifier = codeVerifier;
        this.onUpdateConfig?.(this.config);
    }

    codeVerifier(): string {
        return this.config.oauth?.codeVerifier || '';
    }
}
