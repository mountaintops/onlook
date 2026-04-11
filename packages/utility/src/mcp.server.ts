import { readFileSync } from 'fs';
import { join } from 'path';
import type { McpServerConfig } from '@onlook/models';
import { combineMcpServers } from './mcp';

/**
 * Load permanent MCP servers from JSON configuration
 * These are site-wide servers configured by the site admin
 * This is a server-only function
 */
export function loadPermanentMcpServers(): McpServerConfig[] {
    try {
        const configPath = join(process.cwd(), 'apps/backend/permanent-mcp-servers.json');
        const configContent = readFileSync(configPath, 'utf-8');
        const config = JSON.parse(configContent);
        return config.permanentMcpServers || [];
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : undefined;
        console.error('[MCP Utils] Failed to load permanent MCP servers configuration:', {
            error: errorMessage,
            stack: errorStack,
            configPath: join(process.cwd(), 'apps/backend/permanent-mcp-servers.json'),
            timestamp: new Date().toISOString(),
        });
        return [];
    }
}

/**
 * Get all MCP servers for a project
 * Combines permanent, global (user), and project-specific servers
 * This is a server-only function
 */
export function getProjectMcpServers(
    projectServers: McpServerConfig[] = [],
    globalServers: McpServerConfig[] = [],
): McpServerConfig[] {
    const permanentServers = loadPermanentMcpServers();
    return combineMcpServers(permanentServers, globalServers, projectServers);
}
