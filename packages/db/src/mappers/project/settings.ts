import type { McpServerConfig, ProjectSettings } from '@onlook/models';
import type { McpServerConfigDb, ProjectSettings as DbProjectSettings } from '../../schema';

export const fromDbProjectSettings = (dbProjectSettings: DbProjectSettings): ProjectSettings => {
    const dbMcpServers = (dbProjectSettings.mcpServers as McpServerConfigDb[] | null) ?? [];
    const mcpServers: McpServerConfig[] = dbMcpServers.map((s) => ({
        id: s.id,
        name: s.name,
        enabled: s.enabled,
        transport: s.transport as McpServerConfig['transport'],
        url: s.url,
        headers: s.headers,
        command: s.command,
        args: s.args,
        env: s.env,
    }));

    return {
        commands: {
            build: dbProjectSettings.buildCommand,
            run: dbProjectSettings.runCommand,
            install: dbProjectSettings.installCommand,
        },
        mcpServers,
    };
};

export const toDbProjectSettings = (projectId: string, projectSettings: ProjectSettings): DbProjectSettings => {
    const mcpServers: McpServerConfigDb[] = (projectSettings.mcpServers ?? []).map((s) => ({
        id: s.id,
        name: s.name,
        enabled: s.enabled,
        transport: s.transport as any,
        url: s.url,
        headers: s.headers,
        command: s.command,
        args: s.args,
        env: s.env,
    }));

    return {
        projectId,
        buildCommand: projectSettings.commands.build ?? '',
        runCommand: projectSettings.commands.run ?? '',
        installCommand: projectSettings.commands.install ?? '',
        mcpServers,
    };
};