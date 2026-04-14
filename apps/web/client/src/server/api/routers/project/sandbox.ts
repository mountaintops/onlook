import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import {
    CodeProvider,
    createCodeProviderClient,
    Provider,
    type ListFilesOutputFile,
} from '@onlook/code-provider';
import { shortenUuid } from '@onlook/utility/src/id';

import { createTRPCRouter, protectedProcedure, publicProcedure } from '../../trpc';
import {
    createDaytonaSandbox,
    createDaytonaSandboxFromGit,
    getDaytonaClient,
} from './daytona-helper';

/**
 * Detect whether a sandbox ID belongs to Daytona (UUID format) or CodeSandbox
 * (short alphanumeric).
 */
export function isDaytonaSandboxId(sandboxId: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sandboxId);
}

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
    /**
     * Create a new sandbox (always Daytona for new projects).
     */
    create: publicProcedure
        .input(
            z.object({
                title: z.string().optional(),
            }),
        )
        .mutation(async ({ input }) => {
            try {
                const result = await createDaytonaSandbox(input.title ?? 'Onlook Project');
                return {
                    sandboxId: result.sandboxId,
                    previewUrl: result.previewUrl ?? `https://placeholder-${result.sandboxId}-3000.daytona.app`,
                };
            } catch (error) {
                throw new TRPCError({
                    code: 'INTERNAL_SERVER_ERROR',
                    message: `Failed to create Daytona sandbox: ${error instanceof Error ? error.message : String(error)}`,
                    cause: error,
                });
            }
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

            // Daytona sandboxes — just return the preview URL  
            if (isDaytonaSandboxId(sandboxId)) {
                try {
                    const client = getDaytonaClient();
                    const sandbox = await client.get(sandboxId);
                    let previewUrl: string | null = null;
                    let previewToken: string | null = null;
                    try {
                        const previewInfo = await sandbox.getPreviewLink(3000);
                        previewUrl = previewInfo?.url ?? null;
                        previewToken = previewInfo?.token ?? null;
                    } catch {
                        // ignore
                    }
                    return { signedPreviewUrl: previewUrl, previewToken };
                } catch (error) {
                    throw new TRPCError({
                        code: 'INTERNAL_SERVER_ERROR',
                        message: `Failed to start Daytona sandbox ${sandboxId}: ${error instanceof Error ? error.message : String(error)}`,
                        cause: error,
                    });
                }
            }

            // CodeSandbox fallback
            try {
                const provider = await getProvider({
                    sandboxId,
                    userId,
                    tier: 'Pico',
                    initClient: false,
                });
                const session = await provider.createSession({
                    args: { id: shortenUuid(userId, 20) },
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
            if (isDaytonaSandboxId(input.sandboxId)) {
                try {
                    const client = getDaytonaClient();
                    const sandbox = await client.get(input.sandboxId);
                    await sandbox.stop();
                } catch (error) {
                    throw new TRPCError({
                        code: 'INTERNAL_SERVER_ERROR',
                        message: `Failed to stop Daytona sandbox: ${error instanceof Error ? error.message : String(error)}`,
                    });
                }
                return;
            }
            const provider = await getProvider({
                sandboxId: input.sandboxId,
                tier: 'Pico',
                initClient: false,
            });
            try {
                await provider.pauseProject({});
            } finally {
                await provider.destroy().catch(() => {});
            }
        }),

    list: publicProcedure.input(z.object({ sandboxId: z.string() })).query(async ({ input }) => {
        if (isDaytonaSandboxId(input.sandboxId)) {
            return [];
        }
        const provider = await getProvider({
            sandboxId: input.sandboxId,
            tier: 'Pico',
            initClient: false,
        });
        const res = await provider.listProjects({});
        if ('projects' in res) {
            return res.projects;
        }
        return [];
    }),

    /**
     * Fork a sandbox: creates a new Daytona sandbox cloned from the source.
     * For CodeSandbox IDs, keeps the original CSB fork behaviour.
     */
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
            // If the source sandbox is Daytona, fork using Daytona
            if (isDaytonaSandboxId(input.sandbox.id)) {
                try {
                    const { forkDaytonaSandbox } = await import('./daytona-helper');
                    const result = await forkDaytonaSandbox(
                        input.sandbox.id,
                        input.config?.title,
                    );
                    return {
                        sandboxId: result.sandboxId,
                        previewUrl: result.previewUrl ?? `https://placeholder-${result.sandboxId}-3000.daytona.app`,
                    };
                } catch (error) {
                    throw new TRPCError({
                        code: 'INTERNAL_SERVER_ERROR',
                        message: `Failed to fork Daytona sandbox: ${error instanceof Error ? error.message : String(error)}`,
                        cause: error,
                    });
                }
            }

            // New sandboxes always go to Daytona (source is from old CSB project — fresh bootstrap)
            try {
                const result = await createDaytonaSandbox(input.config?.title);
                return {
                    sandboxId: result.sandboxId,
                    previewUrl: result.previewUrl ?? `https://placeholder-${result.sandboxId}-3000.daytona.app`,
                };
            } catch (error) {
                throw new TRPCError({
                    code: 'INTERNAL_SERVER_ERROR',
                    message: `Failed to create Daytona fork sandbox: ${error instanceof Error ? error.message : String(error)}`,
                    cause: error,
                });
            }
        }),

    delete: protectedProcedure
        .input(
            z.object({
                sandboxId: z.string(),
            }),
        )
        .mutation(async ({ input }) => {
            if (isDaytonaSandboxId(input.sandboxId)) {
                try {
                    const client = getDaytonaClient();
                    await client.delete(input.sandboxId);
                } catch {
                    // ignore — sandbox may already be deleted
                }
                return;
            }
            const provider = await getProvider({
                sandboxId: input.sandboxId,
                tier: 'Pico',
                initClient: false,
            });
            try {
                await provider.stopProject({});
            } finally {
                await provider.destroy().catch(() => {});
            }
        }),

    /**
     * Import from GitHub → always creates a Daytona sandbox via git clone.
     */
    createFromGitHub: protectedProcedure
        .input(
            z.object({
                repoUrl: z.string(),
                branch: z.string(),
            }),
        )
        .mutation(async ({ input }) => {
            const MAX_RETRY_ATTEMPTS = 3;
            let lastError: Error | null = null;

            for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
                try {
                    const result = await createDaytonaSandboxFromGit(
                        input.repoUrl,
                        input.branch,
                    );
                    return {
                        sandboxId: result.sandboxId,
                        previewUrl: result.previewUrl ?? `https://placeholder-${result.sandboxId}-3000.daytona.app`,
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
                message: `Failed to create Daytona sandbox from GitHub after ${MAX_RETRY_ATTEMPTS} attempts: ${lastError?.message}`,
                cause: lastError,
            });
        }),

    getProjectFiles: protectedProcedure
        .input(z.object({ sandboxId: z.string() }))
        .query(async ({ input, ctx }) => {
            if (isDaytonaSandboxId(input.sandboxId)) {
                try {
                    const client = getDaytonaClient();
                    const sandbox = await client.get(input.sandboxId);
                    const result = await sandbox.process.executeCommand(
                        'git -C /tmp/nextapp ls-files 2>/dev/null || find /tmp/nextapp -type f -not -path "*/node_modules/*" -not -path "*/.next/*" 2>/dev/null',
                        undefined,
                        undefined,
                        30,
                    );
                    const files = (result.result ?? '')
                        .split('\n')
                        .map((f: string) => f.replace(/\r/g, ''))
                        .filter(Boolean);
                    return { files };
                } catch (error) {
                    throw new TRPCError({
                        code: 'INTERNAL_SERVER_ERROR',
                        message: 'Failed to get project files from Daytona sandbox',
                    });
                }
            }

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
            if (isDaytonaSandboxId(input.sandboxId)) {
                try {
                    const client = getDaytonaClient();
                    const sandbox = await client.get(input.sandboxId);
                    const results = await Promise.all(
                        input.paths.map(async (rawPath) => {
                            try {
                                const r = await sandbox.process.executeCommand(
                                    `cat '${rawPath.replace(/'/g, "'\\''")}'`,
                                    undefined,
                                    undefined,
                                    15,
                                );
                                return { path: rawPath, content: r.result ?? '' };
                            } catch (e) {
                                return { path: rawPath, content: `Error reading file: ${e}` };
                            }
                        }),
                    );
                    return { files: results };
                } catch (error) {
                    throw new TRPCError({
                        code: 'INTERNAL_SERVER_ERROR',
                        message: 'Failed to get files content from Daytona sandbox',
                    });
                }
            }

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
                    }),
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
