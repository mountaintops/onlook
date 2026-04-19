import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { CodeProvider, createCodeProviderClient, getStaticCodeProvider } from '@onlook/code-provider';
import { DaytonaProvider } from '@onlook/code-provider/daytona';
import { getSandboxPreviewUrl, SandboxTemplates, Templates } from '@onlook/constants';
import { shortenUuid } from '@onlook/utility/src/id';
import { getSandboxBackend } from '@/config/sandbox-backend';
import { env } from '@/env';
import { resolveFramePreviewUrl } from '@/server/sandbox/preview-url';

import { createTRPCRouter, protectedProcedure, publicProcedure } from '../../trpc';

export function getDefaultEditorSandboxProvider(): CodeProvider {
    return getSandboxBackend() === 'daytona' ? CodeProvider.Daytona : CodeProvider.CodeSandbox;
}

export function getProvider({
    sandboxId,
    userId,
    provider,
    tier,
    initClient = true,
}: {
    sandboxId: string;
    provider?: CodeProvider;
    userId?: undefined | string;
    tier?: string;
    initClient?: boolean;
}) {
    const p = provider ?? getDefaultEditorSandboxProvider();

    if (p === CodeProvider.CodeSandbox) {
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
    }

    if (p === CodeProvider.Daytona) {
        return createCodeProviderClient(CodeProvider.Daytona, {
            providerOptions: {
                daytona: { sandboxId },
            },
        });
    }

    return createCodeProviderClient(CodeProvider.NodeFs, {
        providerOptions: {
            nodefs: {},
        },
    });
}

function escShell(s: string): string {
    return s.replace(/'/g, `'\\''`);
}

export const sandboxRouter = createTRPCRouter({
    create: publicProcedure
        .input(
            z.object({
                title: z.string().optional(),
            }),
        )
        .mutation(async ({ input }) => {
            if (getSandboxBackend() === 'daytona') {
                const snapshot = env.SANDBOX_DAYTONA_EMPTY_SNAPSHOT;
                const created = snapshot
                    ? await DaytonaProvider.createProject({
                          snapshotName: snapshot,
                          id: '',
                          title: input.title || 'Onlook Test Sandbox',
                          labels: { 'onlook:framework': 'next' },
                      })
                    : await DaytonaProvider.createProject({
                          source: 'typescript',
                          id: '',
                          title: input.title || 'Onlook Test Sandbox',
                          labels: { 'onlook:framework': 'next' },
                      });
                const template = SandboxTemplates[Templates.EMPTY_NEXTJS];
                return {
                    sandboxId: created.id,
                    previewUrl: await resolveFramePreviewUrl(created.id, template.port),
                };
            }

            const CodesandboxProvider = await getStaticCodeProvider(CodeProvider.CodeSandbox);
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
                    initClient: false,
                });

                const session = await provider.createSession({
                    args: {
                        id: shortenUuid(userId, 20),
                    },
                });

                let signedPreviewUrl: string | undefined;
                if (getSandboxBackend() === 'daytona') {
                    signedPreviewUrl = await resolveFramePreviewUrl(sandboxId, 3000);
                }

                await provider.destroy().catch(() => {});
                return { ...session, signedPreviewUrl };
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
                initClient: false,
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
            initClient: false,
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
                    if (getSandboxBackend() === 'daytona') {
                        const snapshot = env.SANDBOX_DAYTONA_EMPTY_SNAPSHOT;
                        const created = snapshot
                            ? await DaytonaProvider.createProject({
                                  snapshotName: snapshot,
                                  id: '',
                                  title: input.config?.title,
                                  tags: input.config?.tags,
                                  labels: { 'onlook:framework': 'next' },
                              })
                            : await DaytonaProvider.createProject({
                                  source: 'typescript',
                                  id: '',
                                  title: input.config?.title ?? 'Onlook project',
                                  tags: input.config?.tags,
                                  labels: { 'onlook:framework': 'next' },
                              });

                        const previewUrl = await resolveFramePreviewUrl(created.id, input.sandbox.port);
                        return {
                            sandboxId: created.id,
                            previewUrl,
                        };
                    }

                    const CodesandboxProvider = await getStaticCodeProvider(CodeProvider.CodeSandbox);
                    const sandbox = await CodesandboxProvider.createProject({
                        source: 'template',
                        id: input.sandbox.id,
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
                        await new Promise((resolve) => setTimeout(resolve, Math.pow(2, attempt) * 1000));
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
                initClient: false,
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
                    if (getSandboxBackend() === 'daytona') {
                        const created = await DaytonaProvider.createProject({
                            source: 'typescript',
                            id: '',
                            title: 'GitHub import',
                            labels: { 'onlook:framework': 'next' },
                        });

                        const prov = (await createCodeProviderClient(CodeProvider.Daytona, {
                            providerOptions: { daytona: { sandboxId: created.id } },
                        })) as DaytonaProvider;

                        const repo = escShell(input.repoUrl);
                        const branch = escShell(input.branch);

                        try {
                            await prov.runCommand({
                                args: {
                                    command: `cd /home/daytona && rm -rf onlook-starter && git clone --depth 1 --branch '${branch}' '${repo}' onlook-starter`,
                                    timeout: 300,
                                },
                            });
                            await prov.runCommand({
                                args: {
                                    command: `cd /home/daytona/onlook-starter && (bun install || npm install --no-audit --no-fund)`,
                                    timeout: 420,
                                },
                            });
                        } finally {
                            await prov.destroy().catch(() => {});
                        }

                        const previewUrl = await resolveFramePreviewUrl(created.id, DEFAULT_PORT);
                        return {
                            sandboxId: created.id,
                            previewUrl,
                        };
                    }

                    const CodesandboxProvider = await getStaticCodeProvider(CodeProvider.CodeSandbox);
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
