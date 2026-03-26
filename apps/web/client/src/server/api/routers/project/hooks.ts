import type { LifecycleHookEvent, LifecycleHooks } from '@onlook/models';
import type { Provider } from '@onlook/code-provider';

/**
 * Runs a shell script inside the sandbox VM with the lifecycle event as the first argument
 * and the affected file path as the second argument.
 *
 * Execution is fire-and-forget: errors are logged but not thrown so they do not block
 * the primary operation that triggered the event.
 */
async function runScript(provider: Provider, scriptPath: string, event: LifecycleHookEvent, filePath: string): Promise<void> {
    // Escape single quotes in paths to avoid shell injection
    const escapedScript = scriptPath.replace(/'/g, "'\\''");
    const escapedEvent = event.replace(/'/g, "'\\''");
    const escapedFile = filePath.replace(/'/g, "'\\''");
    const command = `bash '${escapedScript}' '${escapedEvent}' '${escapedFile}'`;
    await provider.runCommand({ args: { command } });
}

/**
 * Execute lifecycle hooks for a given event. Always runs `setup.sh` first,
 * then the event-specific script if configured.
 *
 * @param provider  Active CodeSandbox provider instance.
 * @param hooks     The project's lifecycle hook configuration.
 * @param event     The event that occurred.
 * @param filePath  Path of the file involved (empty string for VM-level events).
 */
export async function executeLifecycleHook(
    provider: Provider,
    hooks: LifecycleHooks,
    event: LifecycleHookEvent,
    filePath: string,
): Promise<void> {
    const setupScript = hooks.setupScript || 'setup.sh';
    const escapedSetupScript = setupScript.replace(/'/g, "'\\''");
    const escapedEvent = event.replace(/'/g, "'\\''");
    const escapedFile = filePath.replace(/'/g, "'\\''");

    const setupCommand = `
if [ ! -f '${escapedSetupScript}' ]; then
  mkdir -p $(dirname '${escapedSetupScript}') || true
  cat << 'EOF' > '${escapedSetupScript}'
#!/bin/bash
# Obligatory setup script - runs on all lifecycle events
# Args: $1 = event, $2 = file path
EOF
  chmod +x '${escapedSetupScript}'
fi
bash '${escapedSetupScript}' '${escapedEvent}' '${escapedFile}'`;

    // 1. Always check and run setup.sh
    try {
        await provider.runCommand({ args: { command: setupCommand } });
    } catch (err) {
        console.warn(`[lifecycle-hooks] setup.sh failed for event "${event}":`, err);
    }

    // 2. Run event-specific script
    const eventScript = getEventScript(hooks, event);
    if (eventScript) {
        try {
            await runScript(provider, eventScript, event, filePath);
        } catch (err) {
            console.warn(`[lifecycle-hooks] hook script "${eventScript}" failed for event "${event}":`, err);
        }
    }
}

function getEventScript(hooks: LifecycleHooks, event: LifecycleHookEvent): string | undefined {
    switch (event) {
        case 'startup':      return hooks.startup;
        case 'shutdown':     return hooks.shutdown;
        case 'vm-creation':  return hooks.vmCreation;
        case 'file-delete':  return hooks.fileDelete;
        case 'file-create':  return hooks.fileCreate;
        case 'file-edit':    return hooks.fileEdit;
        default:             return undefined;
    }
}
