export const LifecycleHookEvent = {
    STARTUP: 'startup',
    SHUTDOWN: 'shutdown',
    VM_CREATION: 'vm-creation',
    FILE_DELETE: 'file-delete',
    FILE_CREATE: 'file-create',
    FILE_EDIT: 'file-edit',
} as const;

export type LifecycleHookEvent = (typeof LifecycleHookEvent)[keyof typeof LifecycleHookEvent];

/**
 * Maps each lifecycle event to an optional shell script path inside the sandbox.
 * `setupScript` is mandatory and always runs before any other hook.
 */
export interface LifecycleHooks {
    /** Mandatory script that runs for EVERY event. Defaults to "setup.sh". */
    setupScript: string;
    /** Runs when the sandbox VM starts. */
    startup?: string;
    /** Runs when the sandbox VM shuts down or hibernates. */
    shutdown?: string;
    /** Runs when a new sandbox VM is created. */
    vmCreation?: string;
    /** Runs when a file is deleted. Second arg is the deleted file path. */
    fileDelete?: string;
    /** Runs when a new file is created. Second arg is the created file path. */
    fileCreate?: string;
    /** Runs when an existing file is edited. Second arg is the edited file path. */
    fileEdit?: string;
}

export const DEFAULT_LIFECYCLE_HOOKS: LifecycleHooks = {
    setupScript: 'setup.sh',
};
