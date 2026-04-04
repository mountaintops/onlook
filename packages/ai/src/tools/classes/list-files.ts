import { Icons } from '@onlook/ui/icons';
import type { EditorEngine } from '@onlook/web-client/src/components/store/editor/engine';
import { z } from 'zod';
import { ClientTool } from '../models/client';
import { isCommandAvailable, resolveDirectoryPath, safeRunCommand, withTimeout } from '../shared/helpers/files';
import { BRANCH_ID_SCHEMA } from '../shared/type';


export class ListFilesTool extends ClientTool {
    static readonly toolName = 'list_files';
    static readonly description = 'List files and directories in a specified path. Supports both absolute and relative paths with fuzzy matching. Can filter by type and exclude patterns. Returns file paths with type information (file/directory). Only lists immediate children (non-recursive).';
    static readonly parameters = z.object({
        path: z
            .string()
            .optional()
            .describe(
                'The directory path to list files from. Can be absolute or relative. If not specified, uses current working directory. Supports fuzzy path matching if exact path is not found.',
            ),
        show_hidden: z
            .boolean()
            .optional()
            .default(false)
            .describe('Whether to include hidden files and directories (starting with .)'),
        file_types_only: z
            .boolean()
            .optional()
            .default(false)
            .describe('Whether to only return files (exclude directories)'),
        ignore: z
            .array(z.string())
            .optional()
            .describe('Array of glob patterns to ignore (e.g., ["node_modules", "*.log", ".git"])'),
        limit: z
            .number()
            .optional()
            .default(1000)
            .describe('Maximum number of results to return. Default is 1000.'),
        branchId: BRANCH_ID_SCHEMA,
    });
    static readonly icon = Icons.ListBullet;

    async handle(
        args: z.infer<typeof ListFilesTool.parameters>,
        editorEngine: EditorEngine,
    ): Promise<{
        entries: { path: string; type: 'file' | 'directory'; size?: number; modified?: string }[];
        total: number;
        truncated?: boolean;
        message?: string;
    }> {
        const sandbox = editorEngine.branches.getSandboxById(args.branchId);
        if (!sandbox) {
            throw new Error(`Sandbox not found for branch ID: ${args.branchId}`);
        }

        try {
            // Resolve the directory path with fuzzy matching support
            const resolvedPath = await resolveDirectoryPath(args.path, sandbox);

            // SDK-First approach: Use native readDir which is much more reliable than shell commands
            const timeoutMs = 15000;
            const rawEntries = await withTimeout(
                sandbox.readDir(resolvedPath),
                timeoutMs,
                `List directory operation timed out after ${timeoutMs}ms: ${resolvedPath}`
            );

            if (!rawEntries) {
                throw new Error(`Cannot list directory: ${resolvedPath}`);
            }

            // Map and filter entries in TypeScript
            let filteredEntries = rawEntries
                .map((entry: any) => ({
                    path: entry.name,
                    type: (entry.type === 'directory' ? 'directory' : 'file') as 'file' | 'directory',
                    // Note: SDK may not provide size/modified directly in readDir, 
                    // we skip them for performance and reliability to avoid "stuck" commands.
                }))
                .filter(entry => {
                    // Filter hidden files
                    if (!args.show_hidden && entry.path.startsWith('.')) {
                        return false;
                    }

                    // Filter by type
                    if (args.file_types_only && entry.type !== 'file') {
                        return false;
                    }

                    // Filter by ignore patterns (simple string containment/exact match)
                    if (args.ignore && args.ignore.length > 0) {
                        const isIgnored = args.ignore.some(pattern => {
                            if (pattern.includes('*')) {
                                // Simple glob-to-regex for basic patterns like *.log or node_modules/*
                                const regex = new RegExp('^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$');
                                return regex.test(entry.path);
                            }
                            return entry.path === pattern || entry.path.includes(pattern);
                        });
                        if (isIgnored) return false;
                    }

                    return true;
                })
                .sort((a, b) => {
                    // Sort directories first, matching the previous behavior
                    if (a.type !== b.type) {
                        return a.type === 'directory' ? -1 : 1;
                    }
                    return a.path.localeCompare(b.path);
                });

            const total = filteredEntries.length;
            const truncated = total > args.limit;
            const entries = filteredEntries.slice(0, args.limit);

            // Final check: character limit (100k) to stay within tool response limits
            const MAX_CHARS = 100000;
            let finalOutput = {
                entries,
                total,
                truncated,
                message: truncated ? `[RESULTS TRUNCATED: Showing first ${args.limit} of ${total} items. Use ignore patterns to narrow down.]` : undefined
            };

            const serialized = JSON.stringify(finalOutput);
            if (serialized.length > MAX_CHARS) {
                // If still too large, reduce number of entries further
                const safeCount = Math.floor((MAX_CHARS / serialized.length) * entries.length * 0.8);
                finalOutput.entries = entries.slice(0, safeCount);
                finalOutput.truncated = true;
                finalOutput.message = `[RESULTS TRUNCATED: Output size exceeds character limit. Showing ${safeCount} of ${total} items.]`;
            }

            return finalOutput;
        } catch (error) {
            throw new Error(`Cannot list directory: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    static getLabel(input?: z.infer<typeof ListFilesTool.parameters>): string {
        if (input?.path) {
            return 'Reading directory ' + (input.path.split('/').pop() || '');
        }
        return 'Reading directory';
    }
}
