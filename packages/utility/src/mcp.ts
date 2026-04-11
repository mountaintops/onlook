import type { McpServerConfig } from '@onlook/models';

/**
 * Combine MCP servers from multiple sources with deduplication
 * Precedence: project > global > permanent (later sources override earlier ones by ID)
 */
export function combineMcpServers(
    permanent: McpServerConfig[],
    global: McpServerConfig[],
    project: McpServerConfig[],
): McpServerConfig[] {
    const allServers = [...permanent, ...global, ...project];
    const seen = new Set<string>();
    
    // Filter to keep only the last occurrence of each ID (highest precedence)
    return allServers.filter((server) => {
        if (seen.has(server.id)) {
            return false;
        }
        seen.add(server.id);
        return true;
    });
}
