export enum McpTransportType {
    STREAMABLE_HTTP = 'streamable_http',
}

export interface McpOAuthConfig {
    clientId: string;
    redirectUri?: string;
    scopes?: string[];
    tokens?: {
        access_token: string;
        token_type: string;
        expires_at?: number;
        refresh_token?: string;
        scope?: string;
    };
    // PKCE and State
    codeVerifier?: string;
    state?: string;
}

export interface McpServerConfig {
    id: string;
    name: string;
    enabled: boolean;
    transport: McpTransportType;
    /** URL for HTTP/SSE transports */
    url?: string;
    /** HTTP headers for HTTP/SSE transports */
    headers?: Record<string, string>;
    /** OAuth configuration */
    oauth?: McpOAuthConfig;
}
