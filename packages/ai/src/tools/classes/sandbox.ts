import { Icons } from '@onlook/ui/icons';
import type { EditorEngine } from '@onlook/web-client/src/components/store/editor/engine';
import { z } from 'zod';
import { ClientTool } from '../models/client';
import { withTimeout } from '../shared/helpers/files';
import { BRANCH_ID_SCHEMA } from '../shared/type';


export class SandboxTool extends ClientTool {
    static readonly ALLOWED_SANDBOX_COMMANDS = z.enum(['restart_dev_server', 'read_dev_server_logs', 'screenshot']);
    static readonly toolName = 'sandbox';
    static readonly description = 'Execute commands in a sandboxed environment';
    static readonly parameters = z.object({
        command: SandboxTool.ALLOWED_SANDBOX_COMMANDS.describe('The allowed command to run'),
        branchId: BRANCH_ID_SCHEMA,
    });
    static readonly icon = Icons.Cube;

    async handle(args: z.infer<typeof SandboxTool.parameters>, editorEngine: EditorEngine): Promise<string> {
        try {
            const sandbox = editorEngine.branches.getSandboxById(args.branchId);
            if (!sandbox) {
                throw new Error(`Sandbox not found for branch ID: ${args.branchId}`);
            }

            const timeoutMs = 30000;
            if (args.command === 'restart_dev_server') {
                const success = await withTimeout(
                    sandbox.session.restartDevServer(),
                    timeoutMs,
                    `Restart dev server timed out after ${timeoutMs}ms`
                );
                if (success) {
                    return 'Dev server restarted';
                } else {
                    return 'Failed to restart dev server';
                }
            } else if (args.command === 'read_dev_server_logs') {
                const logs = await withTimeout(
                    sandbox.session.readDevServerLogs(),
                    timeoutMs,
                    `Read dev server logs timed out after ${timeoutMs}ms`
                );
                return logs;

            } else if (args.command === 'screenshot') {
                const result = await editorEngine.screenshot.capture(true);
                if (result?.success) {
                    return 'Screenshot captured successfully';
                } else {
                    return 'Failed to capture screenshot: ' + (result?.error || 'Unknown error');
                }
            } else {
                throw new Error('Invalid command');
            }
        } catch (error) {
            console.error('Error handling sandbox tool:', error);
            throw new Error('Error handling sandbox tool');
        }
    }

    static getLabel(input?: z.infer<typeof SandboxTool.parameters>): string {
        if (input?.command) {
            return 'Sandbox: ' + input.command;
        }
        return 'Sandbox';
    }
}