import type { Commands } from './command';
import type { LifecycleHooks } from './lifecycle-hooks';
import { DEFAULT_LIFECYCLE_HOOKS } from './lifecycle-hooks';

export interface ProjectSettings {
    commands: Commands;
    lifecycleHooks?: LifecycleHooks;
}

export const DEFAULT_PROJECT_SETTINGS: ProjectSettings = {
    commands: {
        build: '',
        run: '',
        install: '',
    },
    lifecycleHooks: DEFAULT_LIFECYCLE_HOOKS,
};
