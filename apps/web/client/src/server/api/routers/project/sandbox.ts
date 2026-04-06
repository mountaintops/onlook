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
import { projectSettings, fromDbProjectSettings } from '@onlook/db';
import { eq } from 'drizzle-orm';

import { createTRPCRouter, protectedProcedure, publicProcedure } from '../../trpc';



export function getProvider({
    sandboxId,
    userId,
    provider = CodeProvider.CodeSandbox,
    tier,
    initClient = true,
}: {
    sandboxId: string;
    provider?: CodeProvider;
    userId?: undefined | string;
    tier?: string;
    initClient?: boolean;
}) {
    if (provider === CodeProvider.CodeSandbox) {
        return createCodeProviderClient(CodeProvider.CodeSandbox, {
            providerOptions: {
                codesandbox: {
                    sandboxId,
                    userId,
                    tier,
                    initClient,
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
    create: publicProcedure
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

            // Fire VM Creation Hook
            if (input.title) { 
                // Normally title is used as project name/indicator, try to get settings if projectId was provided. 
                // Wait, create mutation here doesn't take projectId. The sandbox fork/createBlank mutations do.
                // We will leave the trigger here just in case, but no projectId is available to fetch hooks.
            }

            return {
                sandboxId: newSandbox.id,
                previewUrl: getSandboxPreviewUrl(newSandbox.id, template.port),
            };
        }),

    start: publicProcedure
        .input(
            z.object({
                sandboxId: z.string(),
            }),
        )
        .mutation(async ({ input, ctx }) => {
            const userId = ctx.user?.id ?? 'guest-user-id';
            const sandboxId = input.sandboxId;

            try {
                const provider = await getProvider({
                    sandboxId,
                    userId,
                    tier: 'Pico',
                    initClient: false, // Don't need WebSocket connection for session creation
                });

                const session = await provider.createSession({
                    args: {
                        id: shortenUuid(userId, 20),
                    },
                });

                await provider.destroy().catch(() => {});
                return session;
            } catch (error) {
                console.error(`[Sandbox] Failed to start sandbox ${sandboxId}:`, error);
                throw new TRPCError({
                    code: 'INTERNAL_SERVER_ERROR',
                    message: `Failed to start sandbox session: ${error instanceof Error ? error.message : String(error)}`,
                    cause: error,
                });
            }
        }),
    hibernate: protectedProcedure
        .input(
            z.object({
                sandboxId: z.string(),
            }),
        )
        .mutation(async ({ input }) => {
            const provider = await getProvider({ 
                sandboxId: input.sandboxId, 
                tier: 'Pico',
                initClient: false // Only need to call hibernate API
            });
            try {
                await provider.pauseProject({});
            } finally {
                await provider.destroy().catch(() => {});
            }
        }),
    list: publicProcedure.input(z.object({ sandboxId: z.string() })).query(async ({ input }) => {
        const provider = await getProvider({ 
            sandboxId: input.sandboxId, 
            tier: 'Pico',
            initClient: false // Only need to call list API
        });
        const res = await provider.listProjects({});
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
            const provider = await getProvider({ 
                sandboxId: input.sandboxId, 
                tier: 'Pico',
                initClient: false // Only need to call stop API
            });
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


    getProjectFiles: protectedProcedure
        .input(z.object({ sandboxId: z.string() }))
        .query(async ({ input, ctx }) => {
            const provider = await getProvider({
                sandboxId: input.sandboxId,
                userId: ctx.user.id,
                tier: 'Pico',
            });
            try {
                const result = await provider.runCommand({ args: { command: 'git ls-files' } });
                const files = result.output
                    .split('\n')
                    .map((f) => f.replace(/\r/g, ''))
                    .filter(Boolean);
                return { files };
            } catch (error) {
                console.error('Error getting project files:', error);
                throw new TRPCError({
                    code: 'INTERNAL_SERVER_ERROR',
                    message: 'Failed to get project files from sandbox',
                });
            } finally {
                await provider.destroy().catch(() => {});
            }
        }),

    getFilesContent: protectedProcedure
        .input(z.object({ sandboxId: z.string(), paths: z.array(z.string()) }))
        .mutation(async ({ input, ctx }) => {
            const provider = await getProvider({
                sandboxId: input.sandboxId,
                userId: ctx.user.id,
                tier: 'Pico',
            });
            try {
                const results = await Promise.all(
                    input.paths.map(async (rawPath) => {
                        try {
                            const escapedPath = rawPath.replace(/'/g, "'\\''");
                            const { output } = await provider.runCommand({ args: { command: `cat '${escapedPath}'` } });
                            return { path: rawPath, content: output };
                        } catch (e) {
                            console.error(`Failed to read file ${rawPath}:`, e);
                            return { path: rawPath, content: `Error reading file: ${e}` };
                        }
                    })
                );
                return { files: results };
            } catch (error) {
                console.error('Error getting files content:', error);
                throw new TRPCError({
                    code: 'INTERNAL_SERVER_ERROR',
                    message: 'Failed to get files content from sandbox',
                });
            } finally {
                await provider.destroy().catch(() => {});
            }
        }),
});
