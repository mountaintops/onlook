import { readFileSync } from 'fs';
import { join } from 'path';
import type { McpServerConfig } from '@onlook/models';
import { combineMcpServers } from './mcp';

/**
 * Load permanent MCP servers from YAML configuration
 * These are site-wide servers configured by the site admin
 * This is a server-only function
 */
export function loadPermanentMcpServers(): McpServerConfig[] {
    try {
        const configPath = join(process.cwd(), 'apps/backend/permanent-mcp-servers.yaml');
        const configContent = readFileSync(configPath, 'utf-8');
        
        // Check if the file has an empty array
        if (configContent.includes('permanentMcpServers: []')) {
            return [];
        }
        
        // Parse YAML - simple key-value parsing for this specific format
        const lines = configContent.split('\n');
        const servers: McpServerConfig[] = [];
        let inServersList = false;
        let currentServer: Partial<McpServerConfig> | null = null;

        for (const line of lines) {
            const trimmed = line.trim();
            
            // Skip comments and empty lines
            if (trimmed.startsWith('#') || trimmed === '') {
                continue;
            }

            // Check if we're starting the servers list
            if (trimmed.startsWith('permanentMcpServers:')) {
                inServersList = true;
                // Check for empty array on same line
                if (trimmed.includes('[]')) {
                    return [];
                }
                continue;
            }

            // Parse server entries (indented lines)
            if (inServersList && trimmed.startsWith('- id:')) {
                if (currentServer && currentServer.id && currentServer.name && currentServer.url) {
                    servers.push(currentServer as McpServerConfig);
                }
                const idMatch = trimmed.match(/- id:\s*(.+)/);
                if (idMatch && idMatch[1]) {
                    currentServer = {
                        id: idMatch[1].trim().replace(/"/g, '').replace(/'/g, ''),
                        transportType: 'http',
                        authType: 'none',
                    };
                }
            } else if (currentServer) {
                const match = trimmed.match(/^(\w+):\s*(.*)$/);
                if (match && match[1] && match[2] !== undefined) {
                    const [, key, value] = match;
                    const cleanValue = value.trim().replace(/"/g, '').replace(/'/g, '');
                    if (key === 'name') currentServer.name = cleanValue;
                    else if (key === 'url') currentServer.url = cleanValue;
                    else if (key === 'transportType') currentServer.transportType = cleanValue as 'http' | 'sse';
                    else if (key === 'authType') currentServer.authType = cleanValue as 'none' | 'bearer';
                    else if (key === 'bearerToken') currentServer.bearerToken = cleanValue;
                }
            }
        }

        // Add the last server if exists
        if (currentServer && currentServer.id && currentServer.name && currentServer.url) {
            servers.push(currentServer as McpServerConfig);
        }

        return servers;
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : undefined;
        console.error('[MCP Utils] Failed to load permanent MCP servers configuration:', {
            error: errorMessage,
            stack: errorStack,
            configPath: join(process.cwd(), 'apps/backend/permanent-mcp-servers.yaml'),
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
