import { Icons } from '@onlook/ui/icons';
import type { EditorEngine } from '@onlook/web-client/src/components/store/editor/engine';
import { z } from 'zod';
import { ClientTool } from '../models/client';
import { getFileSystem } from '../shared/helpers/files';
import { BRANCH_ID_SCHEMA } from '../shared/type';

export class SearchReplaceMultiEditFileTool extends ClientTool {
    static readonly toolName = 'search_replace_multi_edit_file';
    static readonly description = 'Perform multiple search and replace operations in a file';
    static readonly parameters = z.object({
        file_path: z.string().describe('Absolute path to file'),
        edits: z
            .array(
                z.object({
                    old_string: z.string().describe('Text to replace'),
                    new_string: z.string().describe('Replacement text'),
                    replace_all: z
                        .boolean()
                        .optional()
                        .default(false)
                        .describe('Replace all occurrences'),
                }),
            )
            .describe('Array of edit operations'),
        branchId: BRANCH_ID_SCHEMA,
    });
    static readonly icon = Icons.Pencil;

    async handle(args: z.infer<typeof SearchReplaceMultiEditFileTool.parameters>, editorEngine: EditorEngine): Promise<string> {
        try {
            const fileSystem = await getFileSystem(args.branchId, editorEngine);
            const file = await fileSystem.readFile(args.file_path);
            if (typeof file !== 'string') {
                throw new Error(`Cannot read file ${args.file_path}: file is not text`);
            }

            const originalContent = file;
            let content = originalContent;

            const normalize = (str: string) => str.replace(/\s+/g, ' ').trim();

            // Validate edits
            for (const edit of args.edits) {
                if (!edit.replace_all) {
                    // Try exact match first
                    let index = content.indexOf(edit.old_string);
                    
                    // If no exact match, try whitespace-normalized match
                    if (index === -1) {
                        const normalizedContent = normalize(content);
                        const normalizedOld = normalize(edit.old_string);
                        
                        if (normalizedContent.includes(normalizedOld)) {
                            // Find the actual substring in the original content that matches the normalized version
                            // This is a bit complex, but for now we'll throw a more descriptive error 
                            // or try a regex-based fallback.
                            const escapedSearch = edit.old_string
                                .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
                                .replace(/\s+/g, '\\s+');
                            const regex = new RegExp(escapedSearch);
                            const match = content.match(regex);
                            
                            if (match) {
                                content = content.replace(regex, edit.new_string);
                            } else {
                                throw new Error(`String not found (even with whitespace tolerance): ${edit.old_string}`);
                            }
                        } else {
                            throw new Error(`String not found in file: ${edit.old_string}`);
                        }
                    } else {
                        // Exact match found
                        content = content.replace(edit.old_string, edit.new_string);
                    }
                } else {
                    content = content.replaceAll(edit.old_string, edit.new_string);
                }
            }

            await fileSystem.writeFile(args.file_path, content);
            return `File ${args.file_path} edited with ${args.edits.length} changes`;
        } catch (error) {
            throw new Error(`Cannot multi-edit file ${args.file_path}: ${(error as Error).message}`);
        }
    }

    static getLabel(input?: z.infer<typeof SearchReplaceMultiEditFileTool.parameters>): string {
        if (input?.file_path) {
            return 'Editing ' + (input.file_path.split('/').pop() || '');
        }
        return 'Editing files';
    }
}