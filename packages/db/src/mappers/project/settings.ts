import type { LifecycleHooks, McpServerConfig, ProjectSettings } from '@onlook/models';
import type { LifecycleHooksDb, McpServerConfigDb, ProjectSettings as DbProjectSettings } from '../../schema';

export const fromDbProjectSettings = (dbProjectSettings: DbProjectSettings): ProjectSettings => {
    const dbHooks = dbProjectSettings.lifecycleHooks as LifecycleHooksDb | null;
    const lifecycleHooks: LifecycleHooks | undefined = dbHooks
        ? {
              setupScript: dbHooks.setupScript ?? 'setup.sh',
              startup: dbHooks.startup,
              shutdown: dbHooks.shutdown,
              vmCreation: dbHooks.vmCreation,
              fileDelete: dbHooks.fileDelete,
              fileCreate: dbHooks.fileCreate,
              fileEdit: dbHooks.fileEdit,
          }
        : undefined;

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
        lifecycleHooks,
        mcpServers,
    };
};

export const toDbProjectSettings = (projectId: string, projectSettings: ProjectSettings): DbProjectSettings => {
    const hooks = projectSettings.lifecycleHooks;
    const lifecycleHooks: LifecycleHooksDb = hooks
        ? {
              setupScript: hooks.setupScript,
              startup: hooks.startup,
              shutdown: hooks.shutdown,
              vmCreation: hooks.vmCreation,
              fileDelete: hooks.fileDelete,
              fileCreate: hooks.fileCreate,
              fileEdit: hooks.fileEdit,
          }
        : {};

    const mcpServers: McpServerConfigDb[] = (projectSettings.mcpServers ?? []).map((s) => ({
        id: s.id,
        name: s.name,
        enabled: s.enabled,
        transport: s.transport,
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
        lifecycleHooks,
        mcpServers,
    };
};