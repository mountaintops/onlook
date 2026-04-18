import { CodeProvider, createCodeProviderClient, DaytonaProvider } from '@onlook/code-provider';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { createTRPCRouter, publicProcedure } from '../../trpc';

export const fsRouter = createTRPCRouter({
    /**
     * List files in a specific directory.
     */
    ls: publicProcedure
        .input(
            z.object({
                sandboxId: z.string(),
                path: z.string().default('.'),
            }),
        )
        .query(async ({ input }) => {
            const provider = (await createCodeProviderClient(CodeProvider.Daytona, {
                providerOptions: { daytona: { sandboxId: input.sandboxId } },
            })) as DaytonaProvider;
            try {
                const result = await provider.listFiles({ args: { path: input.path } });
                return result.files;
            } catch (error: any) {
                console.error(`[Daytona] Failed to list files in ${input.path} for ${input.sandboxId}:`, error);
                throw new TRPCError({
                    code: 'INTERNAL_SERVER_ERROR',
                    message: `Failed to list files: ${error.message}`,
                });
            }
        }),

    /**
     * Read the content of a file.
     */
    read: publicProcedure
        .input(
            z.object({
                sandboxId: z.string(),
                path: z.string(),
            }),
        )
        .query(async ({ input }) => {
            const provider = (await createCodeProviderClient(CodeProvider.Daytona, {
                providerOptions: { daytona: { sandboxId: input.sandboxId } },
            })) as DaytonaProvider;
            try {
                const result = await provider.readFile({ args: { path: input.path } });
                return {
                    content: result.file.content,
                    path: result.file.path,
                };
            } catch (error: any) {
                console.error(`[Daytona] Failed to read file ${input.path} in ${input.sandboxId}:`, error);
                throw new TRPCError({
                    code: 'INTERNAL_SERVER_ERROR',
                    message: `Failed to read file: ${error.message}`,
                });
            }
        }),

    /**
     * Write content to a file.
     */
    write: publicProcedure
        .input(
            z.object({
                sandboxId: z.string(),
                path: z.string(),
                content: z.string(),
            }),
        )
        .mutation(async ({ input }) => {
            const provider = (await createCodeProviderClient(CodeProvider.Daytona, {
                providerOptions: { daytona: { sandboxId: input.sandboxId } },
            })) as DaytonaProvider;
            try {
                await provider.writeFile({
                    args: {
                        path: input.path,
                        content: input.content,
                        overwrite: true,
                    },
                });
                return { success: true };
            } catch (error: any) {
                console.error(`[Daytona] Failed to write file ${input.path} in ${input.sandboxId}:`, error);
                throw new TRPCError({
                    code: 'INTERNAL_SERVER_ERROR',
                    message: `Failed to write file: ${error.message}`,
                });
            }
        }),

    /**
     * Rename a file.
     */
    rename: publicProcedure
        .input(
            z.object({
                sandboxId: z.string(),
                oldPath: z.string(),
                newPath: z.string(),
            }),
        )
        .mutation(async ({ input }) => {
            const provider = (await createCodeProviderClient(CodeProvider.Daytona, {
                providerOptions: { daytona: { sandboxId: input.sandboxId } },
            })) as DaytonaProvider;
            try {
                await provider.renameFile({ args: { oldPath: input.oldPath, newPath: input.newPath } });
                return { success: true };
            } catch (error: any) {
                throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: error.message });
            }
        }),

    /**
     * Get file details.
     */
    stat: publicProcedure
        .input(z.object({ sandboxId: z.string(), path: z.string() }))
        .query(async ({ input }) => {
            const provider = (await createCodeProviderClient(CodeProvider.Daytona, {
                providerOptions: { daytona: { sandboxId: input.sandboxId } },
            })) as DaytonaProvider;
            try {
                return await provider.statFile({ args: { path: input.path } });
            } catch (error: any) {
                throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: error.message });
            }
        }),

    /**
     * Delete file or directory.
     */
    delete: publicProcedure
        .input(z.object({ sandboxId: z.string(), path: z.string(), recursive: z.boolean().optional() }))
        .mutation(async ({ input }) => {
            const provider = (await createCodeProviderClient(CodeProvider.Daytona, {
                providerOptions: { daytona: { sandboxId: input.sandboxId } },
            })) as DaytonaProvider;
            try {
                await provider.deleteFiles({ args: { path: input.path, recursive: input.recursive } });
                return { success: true };
            } catch (error: any) {
                throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: error.message });
            }
        }),

    /**
     * Copy file or directory.
     */
    copy: publicProcedure
        .input(z.object({ sandboxId: z.string(), sourcePath: z.string(), targetPath: z.string(), recursive: z.boolean().optional(), overwrite: z.boolean().optional() }))
        .mutation(async ({ input }) => {
            const provider = (await createCodeProviderClient(CodeProvider.Daytona, {
                providerOptions: { daytona: { sandboxId: input.sandboxId } },
            })) as DaytonaProvider;
            try {
                await provider.copyFiles({ args: { sourcePath: input.sourcePath, targetPath: input.targetPath, recursive: input.recursive, overwrite: input.overwrite } });
                return { success: true };
            } catch (error: any) {
                throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: error.message });
            }
        }),

    /**
     * Create directory.
     */
    mkdir: publicProcedure
        .input(z.object({ sandboxId: z.string(), path: z.string() }))
        .mutation(async ({ input }) => {
            const provider = (await createCodeProviderClient(CodeProvider.Daytona, {
                providerOptions: { daytona: { sandboxId: input.sandboxId } },
            })) as DaytonaProvider;
            try {
                await provider.createDirectory({ args: { path: input.path } });
                return { success: true };
            } catch (error: any) {
                throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: error.message });
            }
        }),

    /**
     * Download files as ZIP archive.
     */
    download: publicProcedure
        .input(z.object({ sandboxId: z.string(), path: z.string() }))
        .query(async ({ input }) => {
            const provider = (await createCodeProviderClient(CodeProvider.Daytona, {
                providerOptions: { daytona: { sandboxId: input.sandboxId } },
            })) as DaytonaProvider;
            try {
                const res = await provider.downloadFiles({ args: { path: input.path } });
                return res.url || '';
            } catch (error: any) {
                throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: error.message });
            }
        }),
});
