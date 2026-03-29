import { Icons } from '@onlook/ui/icons';
import type { EditorEngine } from '@onlook/web-client/src/components/store/editor/engine';
import { z } from 'zod';
import { ClientTool } from '../models/client';
import { BRANCH_ID_SCHEMA } from '../shared/type';

export class CheckWebsiteTool extends ClientTool {
    static readonly toolName = 'check_website';
    static readonly description = 'Check the availability and HTTP status of a website/URL using curl in the VM. If the website returns an error (4xx or 5xx), you MUST edit files to fix the issue.';
    static readonly parameters = z.object({
        url: z.string().url().describe('The URL to check (e.g., http://localhost:3000)'),
        branchId: BRANCH_ID_SCHEMA,
    });
    static readonly icon = Icons.Globe;

    async handle(
        args: z.infer<typeof CheckWebsiteTool.parameters>,
        editorEngine: EditorEngine,
    ): Promise<{
        status: number;
        success: boolean;
        error: string | null;
        message: string;
    }> {
        const sandbox = editorEngine.branches.getSandboxById(args.branchId);
        if (!sandbox) {
            return {
                status: 0,
                success: false,
                error: `Sandbox not found for branch ID: ${args.branchId}`,
                message: 'Failed to access sandbox',
            };
        }

        // Use curl to get the HTTP status code
        // -L: follow redirects
        // -s: silent mode
        // -o /dev/null: discard output body
        // -w "%{http_code}": print only the status code
        const command = `curl -L -s -o /dev/null -w "%{http_code}" ${args.url}`;
        const result = await sandbox.session.runCommand(command);

        if (!result.success) {
            return {
                status: 0,
                success: false,
                error: result.error,
                message: `Failed to execute curl command: ${result.error}`,
            };
        }

        const statusCode = parseInt(result.output.trim(), 10);
        const isSuccess = statusCode >= 200 && statusCode < 400;

        return {
            status: statusCode,
            success: isSuccess,
            error: isSuccess ? null : `Website returned status code: ${statusCode}`,
            message: isSuccess 
                ? `Website is accessible (Status: ${statusCode})` 
                : `Website is inaccessible or returned an error (Status: ${statusCode}). You should investigate and fix the cause.`,
        };
    }

    static getLabel(input?: z.infer<typeof CheckWebsiteTool.parameters>): string {
        if (input?.url) {
            try {
                return 'Checking ' + (new URL(input.url).hostname || 'URL');
            } catch {
                return 'Checking URL';
            }
        }
        return 'Checking website';
    }
}
