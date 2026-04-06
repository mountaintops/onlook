export enum McpTransportType {
    HTTP = 'http',
    SSE = 'sse',
    STDIO = 'stdio',
    CODESANDBOX = 'codesandbox',
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
    /** Command for stdio/codesandbox transport */
    command?: string;
    /** Args for stdio/codesandbox transport */
    args?: string[];
    /** Environment variables for stdio/codesandbox transport */
    env?: Record<string, string>;
}
