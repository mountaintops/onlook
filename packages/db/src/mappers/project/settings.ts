import type { LifecycleHooks, ProjectSettings } from '@onlook/models';
import type { LifecycleHooksDb, ProjectSettings as DbProjectSettings } from '../../schema';

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

    return {
        commands: {
            build: dbProjectSettings.buildCommand,
            run: dbProjectSettings.runCommand,
            install: dbProjectSettings.installCommand,
        },
        lifecycleHooks,
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

    return {
        projectId,
        buildCommand: projectSettings.commands.build ?? '',
        runCommand: projectSettings.commands.run ?? '',
        installCommand: projectSettings.commands.install ?? '',
        lifecycleHooks,
    };
};