import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import {
    CodeProvider,
    createCodeProviderClient,
    getStaticCodeProvider,
    Provider,
    type ListFilesOutputFile,
} from '@onlook/code-provider';
import { getSandboxPreviewUrl, SandboxTemplates, Templates } from '@onlook/constants';
import { shortenUuid } from '@onlook/utility/src/id';

import { createTRPCRouter, protectedProcedure } from '../../trpc';

const CONTEXT_EXCLUDED = new Set([
    'node_modules', '.git', '.next', 'dist', '.sst', 'build', 'coverage', '.turbo', '.vscode',
]);
const CONTEXT_EXCLUDED_FILES = new Set([
    '.prettierignore', '.DS_Store', 'bun.lock', 'package-lock.json',
]);

const ENTRY_POINT_CANDIDATES = ['./src/app/page.tsx', './app/page.tsx', './src/pages/index.tsx', './pages/index.tsx'];

async function buildFileTree(
    provider: Provider,
    dirPath: string,
    basePath: string = dirPath,
): Promise<string[]> {
    const results: string[] = [];
    try {
        const { files } = await provider.listFiles({ args: { path: dirPath } });
        for (const entry of files as ListFilesOutputFile[]) {
            if (entry.name.startsWith('.') && CONTEXT_EXCLUDED.has(entry.name)) continue;
            if (entry.type === 'directory') {
                if (CONTEXT_EXCLUDED.has(entry.name)) continue;
                const subPath = `${dirPath}/${entry.name}`;
                const subFiles = await buildFileTree(provider, subPath, basePath);
                results.push(...subFiles);
            } else {
                if (CONTEXT_EXCLUDED_FILES.has(entry.name)) continue;
                const relativePath = `${dirPath}/${entry.name}`.replace(basePath + '/', '').replace(basePath, '.');
                results.push(relativePath);
            }
        }
    } catch (_e) {
        // Gracefully skip unreadable dirs
    }
    return results.sort();
}

function getProvider({
    sandboxId,
    userId,
    provider = CodeProvider.CodeSandbox,
    tier,
}: {
    sandboxId: string;
    provider?: CodeProvider;
    userId?: undefined | string;
    tier?: string;
}) {
    if (provider === CodeProvider.CodeSandbox) {
        return createCodeProviderClient(CodeProvider.CodeSandbox, {
            providerOptions: {
                codesandbox: {
                    sandboxId,
                    userId,
                    tier,
                },
            },
        });
    } else {
        return createCodeProviderClient(CodeProvider.NodeFs, {
            providerOptions: {
                nodefs: {},
            },
        });
    }
}

export const sandboxRouter = createTRPCRouter({
    create: protectedProcedure
        .input(
            z.object({
                title: z.string().optional(),
            }),
        )
        .mutation(async ({ input, ctx }) => {
            // Create a new sandbox using the static provider
            const CodesandboxProvider = await getStaticCodeProvider(CodeProvider.CodeSandbox);

            // Use the empty Next.js template
            const template = SandboxTemplates[Templates.EMPTY_NEXTJS];

            const newSandbox = await CodesandboxProvider.createProject({
                source: 'template',
                id: template.id,
                title: input.title || 'Onlook Test Sandbox',
                description: 'Test sandbox for Onlook sync engine',
                tags: ['onlook-test'],
                tier: 'Pico',
            });

            return {
                sandboxId: newSandbox.id,
                previewUrl: getSandboxPreviewUrl(newSandbox.id, template.port),
            };
        }),

    start: protectedProcedure
        .input(
            z.object({
                sandboxId: z.string(),
            }),
        )
        .mutation(async ({ input, ctx }) => {
            const userId = ctx.user.id;
            const provider = await getProvider({
                sandboxId: input.sandboxId,
                userId,
                tier: 'Pico',
            });
            const session = await provider.createSession({
                args: {
                    id: shortenUuid(userId, 20),
                },
            });
            await provider.destroy();
            return session;
        }),
    hibernate: protectedProcedure
        .input(
            z.object({
                sandboxId: z.string(),
            }),
        )
        .mutation(async ({ input }) => {
            const provider = await getProvider({ sandboxId: input.sandboxId, tier: 'Pico' });
            try {
                await provider.pauseProject({});
            } finally {
                await provider.destroy().catch(() => {});
            }
        }),
    list: protectedProcedure.input(z.object({ sandboxId: z.string() })).query(async ({ input }) => {
        const provider = await getProvider({ sandboxId: input.sandboxId, tier: 'Pico' });
        const res = await provider.listProjects({});
        // TODO future iteration of code provider abstraction will need this code to be refactored
        if ('projects' in res) {
            return res.projects;
        }
        return [];
    }),
    fork: protectedProcedure
        .input(
            z.object({
                sandbox: z.object({
                    id: z.string(),
                    port: z.number(),
                }),
                config: z
                    .object({
                        title: z.string().optional(),
                        tags: z.array(z.string()).optional(),
                    })
                    .optional(),
            }),
        )
        .mutation(async ({ input }) => {
            const MAX_RETRY_ATTEMPTS = 3;
            let lastError: Error | null = null;

            for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
                try {
                    const CodesandboxProvider = await getStaticCodeProvider(
                        CodeProvider.CodeSandbox,
                    );
                    const sandbox = await CodesandboxProvider.createProject({
                        source: 'template',
                        id: input.sandbox.id,

                        // Metadata
                        title: input.config?.title,
                        tags: input.config?.tags,
                        tier: 'Pico',
                    });

                    const previewUrl = getSandboxPreviewUrl(sandbox.id, input.sandbox.port);

                    return {
                        sandboxId: sandbox.id,
                        previewUrl,
                    };
                } catch (error) {
                    lastError = error instanceof Error ? error : new Error(String(error));

                    if (attempt < MAX_RETRY_ATTEMPTS) {
                        await new Promise((resolve) =>
                            setTimeout(resolve, Math.pow(2, attempt) * 1000),
                        );
                    }
                }
            }

            throw new TRPCError({
                code: 'INTERNAL_SERVER_ERROR',
                message: `Failed to create sandbox after ${MAX_RETRY_ATTEMPTS} attempts: ${lastError?.message}`,
                cause: lastError,
            });
        }),
    delete: protectedProcedure
        .input(
            z.object({
                sandboxId: z.string(),
            }),
        )
        .mutation(async ({ input }) => {
            const provider = await getProvider({ sandboxId: input.sandboxId, tier: 'Pico' });
            try {
                await provider.stopProject({});
            } finally {
                await provider.destroy().catch(() => {});
            }
        }),
    createFromGitHub: protectedProcedure
        .input(
            z.object({
                repoUrl: z.string(),
                branch: z.string(),
            }),
        )
        .mutation(async ({ input }) => {
            const MAX_RETRY_ATTEMPTS = 3;
            const DEFAULT_PORT = 3000;
            let lastError: Error | null = null;

            for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
                try {
                    const CodesandboxProvider = await getStaticCodeProvider(
                        CodeProvider.CodeSandbox,
                    );
                    const sandbox = await CodesandboxProvider.createProjectFromGit({
                        repoUrl: input.repoUrl,
                        branch: input.branch,
                        tier: 'Pico',
                    });

                    const previewUrl = getSandboxPreviewUrl(sandbox.id, DEFAULT_PORT);

                    return {
                        sandboxId: sandbox.id,
                        previewUrl,
                    };
                } catch (error) {
                    lastError = error instanceof Error ? error : new Error(String(error));

                    if (attempt < MAX_RETRY_ATTEMPTS) {
                        await new Promise((resolve) =>
                            setTimeout(resolve, Math.pow(2, attempt) * 1000),
                        );
                    }
                }
            }

            throw new TRPCError({
                code: 'INTERNAL_SERVER_ERROR',
                message: `Failed to create GitHub sandbox after ${MAX_RETRY_ATTEMPTS} attempts: ${lastError?.message}`,
                cause: lastError,
            });
        }),

    generateContext: protectedProcedure
        .input(z.object({ sandboxId: z.string(), userId: z.string() }))
        .mutation(async ({ input }) => {
            const provider = await getProvider({
                sandboxId: input.sandboxId,
                userId: input.userId,
                tier: 'Pico',
            });
            try {
                // 1. Build flat directory tree
                const tree = await buildFileTree(provider, '.');

                // 2. Find and read the primary entry point
                let entryPath = '';
                let entryContent = '';
                for (const candidate of ENTRY_POINT_CANDIDATES) {
                    try {
                        const { file } = await provider.readFile({ args: { path: candidate } });
                        entryContent = file.toString();
                        entryPath = candidate.replace('./', '');
                        break;
                    } catch (_e) {
                        // Try next candidate
                    }
                }

                // 3. Build context.txt in the Onlook editable file format
                const ext = entryPath.split('.').pop() ?? 'tsx';
                let context = 'Project Directory Structure:\n';
                context += tree.join('\n');
                context += '\n\n=========================================\n\n';
                if (entryPath && entryContent) {
                    context += `I have added these files to the chat so you can go ahead and edit them\n`;
                    context += `<file>\n`;
                    context += `<path>${entryPath}</path>\n`;
                    context += `\`\`\`${ext}\n`;
                    context += entryContent;
                    context += `\n\`\`\`\n`;
                    context += `</file>\n`;
                }

                // 4. Write context.txt to sandbox root
                await provider.writeFile({
                    args: {
                        path: './context.txt',
                        content: context,
                        overwrite: true,
                    },
                });

                return { success: true, entryPath };
            } catch (error) {
                console.error('Error generating sandbox context:', error);
                return { success: false, entryPath: '' };
            } finally {
                await provider.destroy().catch(() => {});
            }
        }),
});
