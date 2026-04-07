export enum McpTransportType {
    STREAMABLE_HTTP = 'streamable_http',
}

/**
 * OAuth configuration stored per MCP server.
 * When present, the SDK will automatically attempt OAuth when connecting.
 * No manual configuration needed — uses Dynamic Client Registration (RFC 7591).
 */
export interface McpOAuthConfig {
    /** Stored tokens from a successful authorization */
    tokens?: {
        access_token: string;
        token_type: string;
        expires_in?: number;
        refresh_token?: string;
        scope?: string;
        id_token?: string;
    };
    /** PKCE code verifier (transient, cleared after auth completes) */
    codeVerifier?: string;
    /** OAuth state parameter (transient) */
    state?: string;
    /** Pending authorization URL to show to the user (transient) */
    pendingAuthUrl?: string;
    /** Pending auth code received from callback (transient) */
    pendingAuthCode?: string;
    /** Client info from Dynamic Client Registration */
    clientId?: string;
    clientSecret?: string;
}

export interface McpServerConfig {
    id: string;
    name: string;
    enabled: boolean;
    transport: McpTransportType;
    /** URL for HTTP transports */
    url?: string;
    /** HTTP headers for authenticated transports */
    headers?: Record<string, string>;
    /** OAuth — when set, enables automatic OAuth flow when the server requires it */
    oauth?: McpOAuthConfig;
}
