export enum McpTransportType {
    STREAMABLE_HTTP = 'streamable_http',
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
