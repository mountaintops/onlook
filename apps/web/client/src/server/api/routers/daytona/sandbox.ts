import { CodeProvider, createCodeProviderClient } from '@onlook/code-provider';
import { DaytonaProvider } from '@onlook/code-provider/daytona';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { createTRPCRouter, publicProcedure } from '../../trpc';
import { ptyManager } from './pty-manager';

export const sandboxRouter = createTRPCRouter({
    /**
     * Create a new Daytona sandbox.
     */
    create: publicProcedure
        .input(
            z.object({
                language: z.enum(['typescript', 'javascript', 'python']).default('typescript'),
                autoStopInterval: z.number().min(0).max(10080).default(120),
                autoArchiveInterval: z.number().min(0).max(10080).default(30),
                envVars: z.record(z.string(), z.string()).optional(),
                subdomain: z.string().optional(),
            }),
        )
        .mutation(async ({ input }) => {
            try {
                const result = await DaytonaProvider.createProject({
                    source: input.language,
                    id: '', // Auto-generated
                    title: `Daytona ${input.language} Sandbox`,
                    labels: input.subdomain ? { 'onlook:subdomain': input.subdomain } : undefined,
                });
                return {
                    id: result.id,
                    state: 'started',
                    createdAt: new Date().toISOString(),
                };
            } catch (error: any) {
                console.error('[Daytona] Failed to create sandbox:', error);
                throw new TRPCError({
                    code: 'INTERNAL_SERVER_ERROR',
                    message: `Failed to create Daytona sandbox: ${error.message}`,
                    cause: error,
                });
            }
        }),

    /**
     * Stop a Daytona sandbox.
     */
    stop: publicProcedure
        .input(z.object({ sandboxId: z.string() }))
        .mutation(async ({ input }) => {
            const provider = (await createCodeProviderClient(CodeProvider.Daytona, {
                providerOptions: { daytona: { sandboxId: input.sandboxId } },
            })) as DaytonaProvider;
            try {
                await provider.stopProject({});
                return { success: true, sandboxId: input.sandboxId };
            } catch (error: any) {
                console.error(`[Daytona] Failed to stop sandbox ${input.sandboxId}:`, error);
                throw new TRPCError({
                    code: 'INTERNAL_SERVER_ERROR',
                    message: `Failed to stop sandbox: ${error.message}`,
                });
            }
        }),

    /**
     * List all Daytona sandboxes.
     */
    list: publicProcedure.query(async () => {
        const provider = (await createCodeProviderClient(CodeProvider.Daytona, {
            providerOptions: { daytona: {} },
        })) as DaytonaProvider;
        try {
            const result = await provider.listProjects({});
            return result.projects || [];
        } catch (error: any) {
            console.error('[Daytona] Failed to list sandboxes:', error);
            throw new TRPCError({
                code: 'INTERNAL_SERVER_ERROR',
                message: `Failed to list Daytona sandboxes: ${error.message}`,
            });
        }
    }),

    /**
     * Get info about a specific sandbox.
     */
    get: publicProcedure
        .input(z.object({ sandboxId: z.string() }))
        .query(async ({ input }) => {
            const provider = (await createCodeProviderClient(CodeProvider.Daytona, {
                providerOptions: { daytona: { sandboxId: input.sandboxId } },
            })) as DaytonaProvider;
            try {
                const projects = await provider.listProjects({});
                const sandbox = projects.projects?.find((p: any) => p.id === input.sandboxId);
                if (!sandbox) throw new Error('Sandbox not found');
                return sandbox;
            } catch (error: any) {
                throw new TRPCError({
                    code: 'NOT_FOUND',
                    message: `Sandbox ${input.sandboxId} not found: ${error.message}`,
                });
            }
        }),

    /**
     * Execute a shell command inside a specific sandbox.
     */
    executeCommand: publicProcedure
        .input(
            z.object({
                sandboxId: z.string(),
                command: z.string().min(1),
            }),
        )
        .mutation(async ({ input }) => {
            const provider = (await createCodeProviderClient(CodeProvider.Daytona, {
                providerOptions: { daytona: { sandboxId: input.sandboxId } },
            })) as DaytonaProvider;
            try {
                const { output, exitCode } = await provider.runCommand({ args: { command: input.command } });
                return { exitCode: exitCode ?? 0, output };
            } catch (error: any) {
                console.error(`[Daytona] Command execution failed for ${input.sandboxId}:`, error);
                throw new TRPCError({
                    code: 'INTERNAL_SERVER_ERROR',
                    message: `Command execution failed: ${error.message}`,
                });
            }
        }),

    /**
     * Run TypeScript/JS/Python code inside a sandbox.
     */
    runCode: publicProcedure
        .input(
            z.object({
                sandboxId: z.string(),
                code: z.string().min(1),
            }),
        )
        .mutation(async ({ input }) => {
            const provider = (await createCodeProviderClient(CodeProvider.Daytona, {
                providerOptions: { daytona: { sandboxId: input.sandboxId } },
            })) as DaytonaProvider;
            try {
                // DaytonaProvider should have a specialized way for codeRun if we want to match previous behavior
                // For now, use runCommand or a custom provider method
                const { output } = await provider.runCommand({ args: { command: `node -e '${input.code.replace(/'/g, "'\\''")}'` } });
                return { exitCode: 0, output, success: true };
            } catch (error: any) {
                console.error(`[Daytona] Code execution failed for ${input.sandboxId}:`, error);
                throw new TRPCError({
                    code: 'INTERNAL_SERVER_ERROR',
                    message: `Code execution failed: ${error.message}`,
                });
            }
        }),

    /**
     * Archive a Daytona sandbox.
     */
    archive: publicProcedure
        .input(z.object({ sandboxId: z.string() }))
        .mutation(async ({ input }) => {
            const provider = (await createCodeProviderClient(CodeProvider.Daytona, {
                providerOptions: { daytona: { sandboxId: input.sandboxId } },
            })) as DaytonaProvider;
            try {
                await provider.archive();
                return { success: true, sandboxId: input.sandboxId };
            } catch (error: any) {
                console.error(`[Daytona] Failed to archive sandbox ${input.sandboxId}:`, error);
                throw new TRPCError({
                    code: 'INTERNAL_SERVER_ERROR',
                    message: `Failed to archive sandbox: ${error.message}`,
                });
            }
        }),

    /**
     * Start a Daytona sandbox.
     */
    start: publicProcedure
        .input(z.object({ sandboxId: z.string() }))
        .mutation(async ({ input }) => {
            const provider = (await createCodeProviderClient(CodeProvider.Daytona, {
                providerOptions: { daytona: { sandboxId: input.sandboxId } },
            })) as DaytonaProvider;
            try {
                await provider.start();
                return { success: true, sandboxId: input.sandboxId, state: 'started' };
            } catch (error: any) {
                console.error(`[Daytona] Failed to start sandbox ${input.sandboxId}:`, error);
                throw new TRPCError({
                    code: 'INTERNAL_SERVER_ERROR',
                    message: `Failed to start sandbox: ${error.message}`,
                });
            }
        }),

    /**
     * Recover a Daytona sandbox.
     */
    recover: publicProcedure
        .input(z.object({ sandboxId: z.string() }))
        .mutation(async ({ input }) => {
            const provider = (await createCodeProviderClient(CodeProvider.Daytona, {
                providerOptions: { daytona: { sandboxId: input.sandboxId } },
            })) as DaytonaProvider;
            try {
                await provider.recover();
                return { success: true, sandboxId: input.sandboxId };
            } catch (error: any) {
                console.error(`[Daytona] Failed to recover sandbox ${input.sandboxId}:`, error);
                throw new TRPCError({
                    code: 'INTERNAL_SERVER_ERROR',
                    message: `Failed to recover sandbox: ${error.message}`,
                });
            }
        }),

    /**
     * Delete a Daytona sandbox.
     */
    delete: publicProcedure
        .input(z.object({ sandboxId: z.string() }))
        .mutation(async ({ input }) => {
            const provider = (await createCodeProviderClient(CodeProvider.Daytona, {
                providerOptions: { daytona: { sandboxId: input.sandboxId } },
            })) as DaytonaProvider;
            try {
                await provider.deleteProject({ sandboxId: input.sandboxId });
                return { success: true, sandboxId: input.sandboxId };
            } catch (error: any) {
                console.error(`[tRPC] daytona.sandbox.delete failed:`, error.message);
                throw new TRPCError({
                    code: 'INTERNAL_SERVER_ERROR',
                    message: `Deletion failed: ${error.message}`,
                });
            }
        }),
    
    /**
     * Fork/Clone an existing sandbox.
     */
    fork: publicProcedure
        .input(z.object({
            sandboxId: z.string(),
            name: z.string().optional(),
        }))
        .mutation(async ({ input }) => {
            const provider = (await createCodeProviderClient(CodeProvider.Daytona, {
                providerOptions: { daytona: { sandboxId: input.sandboxId } },
            })) as DaytonaProvider;
            try {
                const result = await provider.fork(input.name);
                return {
                    success: true,
                    id: result.id,
                    state: result.state,
                };
            } catch (error: any) {
                console.error(`[Daytona] Fork failed for sandbox ${input.sandboxId}:`, error.message);
                throw new TRPCError({
                    code: 'INTERNAL_SERVER_ERROR',
                    message: `Cloning failed: ${error.message}`,
                });
            }
        }),

    /**
     * Delete ALL Daytona sandboxes (Admin/Debug utility).
     */
    deleteAll: publicProcedure
        .mutation(async () => {
            const provider = (await createCodeProviderClient(CodeProvider.Daytona, {
                providerOptions: { daytona: {} },
            })) as DaytonaProvider;
            try {
                const projects = await provider.listProjects({});
                const ids = projects.projects?.map(p => p.id) || [];
                
                const sdk = await (provider as any).getSDK();
                const apiKey = process.env.SANDBOX_DAYTONA_API_KEY;
                const client = new sdk({ apiKey });

                for (const id of ids) {
                    try {
                        const sandbox = await client.get(id);
                        await client.delete(sandbox);
                    } catch (e) {
                        console.warn(`Failed to delete sandbox ${id}:`, e);
                    }
                }
                return { count: ids.length };
            } catch (error: any) {
                throw new TRPCError({
                    code: 'INTERNAL_SERVER_ERROR',
                    message: `Failed to cleanup sandboxes: ${error.message}`,
                });
            }
        }),

    /**
     * Create a sandbox from a snapshot.
     */
    createFromSnapshot: publicProcedure
        .input(z.object({ 
            snapshotName: z.string(),
            subdomain: z.string().optional(),
        }))
        .mutation(async ({ input }) => {
             try {
                const result = await DaytonaProvider.createProject({
                    snapshotName: input.snapshotName,
                    id: '',
                    title: `Sandbox from ${input.snapshotName}`,
                    labels: input.subdomain ? { 'onlook:subdomain': input.subdomain } : undefined,
                });
                return {
                    id: result.id,
                    state: 'started',
                    createdAt: new Date().toISOString(),
                };
            } catch (error: any) {
                console.error(`[Daytona] Failed to create sandbox from snapshot ${input.snapshotName}:`, error);
                throw new TRPCError({
                    code: 'INTERNAL_SERVER_ERROR',
                    message: `Failed to create sandbox from snapshot: ${error.message}`,
                    cause: error,
                });
            }
        }),
        
    /**
     * Set auto-archive interval.
     */
    setAutoArchiveInterval: publicProcedure
        .input(z.object({ sandboxId: z.string(), interval: z.number().int().min(0).max(10080) }))
        .mutation(async ({ input }) => {
            const provider = (await createCodeProviderClient(CodeProvider.Daytona, {
                providerOptions: { daytona: { sandboxId: input.sandboxId } },
            })) as DaytonaProvider;
            try {
                await provider.setAutoArchiveInterval(input.interval);
                return { success: true, sandboxId: input.sandboxId, interval: input.interval };
            } catch (error: any) {
                throw new TRPCError({
                    code: 'INTERNAL_SERVER_ERROR',
                    message: `Failed to set auto-archive interval: ${error.message}`,
                });
            }
        }),

    /**
     * Set auto-stop interval.
     */
    setAutoStopInterval: publicProcedure
        .input(z.object({ sandboxId: z.string(), interval: z.number().int().min(0).max(10080) }))
        .mutation(async ({ input }) => {
            const provider = (await createCodeProviderClient(CodeProvider.Daytona, {
                providerOptions: { daytona: { sandboxId: input.sandboxId } },
            })) as DaytonaProvider;
            try {
                await provider.setAutoStopInterval(input.interval);
                return { success: true, sandboxId: input.sandboxId, interval: input.interval };
            } catch (error: any) {
                throw new TRPCError({
                    code: 'INTERNAL_SERVER_ERROR',
                    message: `Failed to set auto-stop interval: ${error.message}`,
                });
            }
        }),
    
    /**
     * Create a new PTY session.
     */
    createPty: publicProcedure
        .input(z.object({ 
            sandboxId: z.string(),
            cols: z.number().optional(),
            rows: z.number().optional()
        }))
        .mutation(async ({ input }) => {
            const provider = (await createCodeProviderClient(CodeProvider.Daytona, {
                providerOptions: { daytona: { sandboxId: input.sandboxId } },
            })) as DaytonaProvider;
            
            const sessionId = await ptyManager.create(input.sandboxId, provider, {
                cols: input.cols || 80,
                rows: input.rows || 24
            });
            
            return { sessionId };
        }),

    /**
     * Poll for PTY output.
     */
    pollPty: publicProcedure
        .input(z.object({ sessionId: z.string() }))
        .query(async ({ input }) => {
            const data = ptyManager.poll(input.sessionId);
            return { data: data || '' };
        }),

    /**
     * Write input to PTY.
     */
    writePty: publicProcedure
        .input(z.object({ 
            sessionId: z.string(), 
            input: z.string(),
            cols: z.number().optional(),
            rows: z.number().optional()
        }))
        .mutation(async ({ input }) => {
            try {
                await ptyManager.write(input.sessionId, input.input, 
                    (input.cols && input.rows) ? { cols: input.cols, rows: input.rows } : undefined
                );
                return { success: true };
            } catch (error: any) {
                throw new TRPCError({
                    code: 'NOT_FOUND',
                    message: `PTY session ${input.sessionId} not found: ${error.message}`,
                });
            }
        }),

    /**
     * Resize PTY.
     */
    resizePty: publicProcedure
        .input(z.object({ 
            sessionId: z.string(), 
            cols: z.number(), 
            rows: z.number() 
        }))
        .mutation(async ({ input }) => {
            try {
                await ptyManager.resize(input.sessionId, input.cols, input.rows);
                return { success: true };
            } catch (error: any) {
                throw new TRPCError({
                    code: 'NOT_FOUND',
                    message: `PTY session ${input.sessionId} not found: ${error.message}`,
                });
            }
        }),

    /**
     * Close PTY session.
     */
    closePty: publicProcedure
        .input(z.object({ sessionId: z.string() }))
        .mutation(async ({ input }) => {
            await ptyManager.close(input.sessionId);
            return { success: true };
        }),
});
