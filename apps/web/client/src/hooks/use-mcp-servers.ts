import { api } from '@/trpc/react';
import { combineMcpServers } from '@onlook/utility';
import type { McpServerConfig } from '@onlook/models';

/**
 * React hook to get combined MCP servers for a project
 * Combines global (user) and project-specific servers
 * Note: Permanent servers are not included on the client side
 */
export function useMcpServers(projectId: string) {
    const { data: projectSettings } = api.settings.get.useQuery({ projectId });
    const { data: userSettings } = api.user.settings.get.useQuery();

    const mcpServers = combineMcpServers(
        [], // No permanent servers on client
        userSettings?.mcpServers ?? [],
        projectSettings?.mcpServers ?? [],
    );

    return {
        mcpServers,
        projectServers: projectSettings?.mcpServers ?? [],
        globalServers: userSettings?.mcpServers ?? [],
        isLoading: !projectSettings || !userSettings,
    };
}

/**
 * React hook to get just the user's global MCP servers
 */
export function useGlobalMcpServers() {
    const { data: userSettings } = api.user.settings.get.useQuery();

    return {
        globalServers: userSettings?.mcpServers ?? [],
        isLoading: !userSettings,
    };
}
