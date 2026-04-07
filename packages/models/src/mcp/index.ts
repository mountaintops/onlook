export enum McpTransportType {
    HTTP = 'http',
    SSE = 'sse',
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
}
