export enum McpTransportType {
    HTTP = 'http',
    SSE = 'sse',
    STDIO = 'stdio',
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
    /** Command for stdio transport */
    command?: string;
    /** Args for stdio transport */
    args?: string[];
    /** Environment variables for stdio transport */
    env?: Record<string, string>;
}
