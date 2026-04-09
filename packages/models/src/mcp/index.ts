export type McpAuthType = 'none' | 'bearer';

export interface McpServerConfig {
    /** Client-generated UUID used as React list key */
    id: string;
    /** Human-readable label shown in the UI */
    name: string;
    /** Streamable-HTTP MCP endpoint (e.g. https://my-server.com/mcp) */
    url: string;
    /** Authentication strategy for this server */
    authType: McpAuthType;
    /** Present only when authType === 'bearer' */
    bearerToken?: string;
}
