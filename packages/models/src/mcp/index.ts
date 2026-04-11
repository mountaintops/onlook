export type McpAuthType = 'none' | 'bearer';
export type McpTransportType = 'http' | 'sse';

export interface McpServerConfig {
    /** Client-generated UUID used as React list key */
    id: string;
    /** Human-readable label shown in the UI */
    name: string;
    /** MCP endpoint URL (e.g. https://my-server.com/mcp or https://my-server.com/sse) */
    url: string;
    /** Transport type: 'http' for Streamable HTTP, 'sse' for Server-Sent Events */
    transportType: McpTransportType;
    /** Authentication strategy for this server */
    authType: McpAuthType;
    /** Present only when authType === 'bearer' */
    bearerToken?: string;
}
