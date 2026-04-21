import { Icons } from '@onlook/ui/icons';
import type { EditorEngine } from '@onlook/web-client/src/components/store/editor/engine';
import { z } from 'zod';
import { ClientTool } from '../models/client';
import { getFileSystem } from '../shared/helpers/files';
import { BRANCH_ID_SCHEMA } from '../shared/type';

export class WriteFilesFoldersTool extends ClientTool {
    static readonly toolName = 'write_files_folders';
    static readonly description = 'Create multiple files and folders in a single operation. For each file, path and content are required. For folders, only path is required.';
    static readonly parameters = z.object({
        actions: z.array(
            z.object({
                type: z.enum(['file', 'folder']).describe('Type of operation: "file" or "folder"'),
                path: z.string().describe('Absolute path to the file or folder'),
                content: z.string().optional().describe('Content to write to the file (not used for folders)'),
            })
        ).describe('List of files and folders to create'),
        branchId: BRANCH_ID_SCHEMA,
    });
    static readonly icon = Icons.FilePlus;

    async handle(args: z.infer<typeof WriteFilesFoldersTool.parameters>, editorEngine: EditorEngine): Promise<string> {
        try {
            const fileSystem = await getFileSystem(args.branchId, editorEngine);
            
            // Use the optimized writeBatch method
            await fileSystem.writeBatch(args.actions);

            return `Successfully created ${args.actions.length} items.`;
        } catch (error) {
            console.error(`[WriteFilesFoldersTool] Failed to complete multi-write operation:`, error);
            throw new Error(`Failed to complete multi-write operation: ${error}`);
        }
    }

    static getLabel(input?: z.infer<typeof WriteFilesFoldersTool.parameters>): string {
        const count = input?.actions?.length || 0;
        return `Creating ${count} files/folders`;
    }
}
