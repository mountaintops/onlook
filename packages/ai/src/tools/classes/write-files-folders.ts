import { Icons } from '@onlook/ui/icons';
import type { EditorEngine } from '@onlook/web-client/src/components/store/editor/engine';
import { z } from 'zod';
import { ClientTool } from '../models/client';
import { getFileSystem, withTimeout } from '../shared/helpers/files';
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
            
            // Limit concurrency to avoid overloading the bridge (e.g. max 5 at a time)
            const CONCURRENCY_LIMIT = 5;
            const chunks: any[][] = [];
            for (let i = 0; i < args.actions.length; i += CONCURRENCY_LIMIT) {
                chunks.push(args.actions.slice(i, i + CONCURRENCY_LIMIT));
            }

            const allResults: string[] = [];

            for (const chunk of chunks) {
                const chunkResults = await Promise.all(
                    chunk.map(async (action) => {
                        const timeoutMs = 15000; // Increased to 15s
                        const operationPromise = (async () => {
                            if (action.type === 'file') {
                                await fileSystem.writeFile(action.path, action.content || '');
                                return `file: ${action.path}`;
                            } else if (action.type === 'folder') {
                                await fileSystem.createDirectory(action.path);
                                return `folder: ${action.path}`;
                            }
                            return `unknown: ${action.path}`;
                        })();

                        return await withTimeout(
                            operationPromise,
                            timeoutMs,
                            `Operation timed out after ${timeoutMs}ms: ${action.path}`
                        );

                    })
                );
                allResults.push(...chunkResults);
            }

            return `Successfully created ${args.actions.length} items: ${allResults.join(', ')}`;
        } catch (error) {
            throw new Error(`Failed to complete multi-write operation: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    static getLabel(input?: z.infer<typeof WriteFilesFoldersTool.parameters>): string {
        const count = input?.actions?.length || 0;
        return `Creating ${count} files/folders`;
    }
}
