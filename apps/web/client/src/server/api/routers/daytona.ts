import { Daytona, type CreateSandboxFromSnapshotParams } from '@daytonaio/sdk';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { createTRPCRouter, publicProcedure } from '../trpc';

/**
 * Get a configured Daytona client using the API key from env.
 */
function getDaytonaClient(): Daytona {
    const apiKey = process.env.SANDBOX_DAYTONA_API_KEY;
    if (!apiKey) {
        throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'SANDBOX_DAYTONA_API_KEY is not configured',
        });
    }
    return new Daytona({ apiKey });
}

export const daytonaRouter = createTRPCRouter({
    /**
     * Create a new Daytona sandbox.
     */
    createSandbox: publicProcedure
        .input(
            z.object({
                language: z.enum(['typescript', 'javascript', 'python']).default('typescript'),
                autoStopInterval: z.number().min(0).max(240).default(10),
                envVars: z.record(z.string(), z.string()).optional(),
            }),
        )
        .mutation(async ({ input }) => {
            const client = getDaytonaClient();
            try {
                // CreateSandboxFromSnapshotParams is intersection with base; cast to satisfy overload
                const params = {
                    language: input.language,
                    autoStopInterval: input.autoStopInterval,
                    autoArchiveInterval: input.autoStopInterval + 10,
                    autoDeleteInterval: 0,
                    public: true,
                    ...(input.envVars && { envVars: input.envVars as Record<string, string> }),
                } satisfies CreateSandboxFromSnapshotParams;
                const sandbox = await client.create(params, { timeout: 120 });

                return {
                    id: sandbox.id,
                    state: (sandbox as any).state ?? 'started',
                    createdAt: (sandbox as any).createdAt ?? new Date().toISOString(),
                };
            } catch (error) {
                throw new TRPCError({
                    code: 'INTERNAL_SERVER_ERROR',
                    message: `Failed to create Daytona sandbox: ${error instanceof Error ? error.message : String(error)}`,
                    cause: error,
                });
            }
        }),

    /**
     * List all Daytona sandboxes (first page, up to 50).
     */
    listSandboxes: publicProcedure.query(async () => {
        const client = getDaytonaClient();
        try {
            // list() returns PaginatedSandboxes { items: Sandbox[], total, page, limit }
            const result = await client.list(undefined, 1, 50);
            return result.items.map((s) => ({
                id: s.id,
                state: String((s as any).state ?? 'unknown'),
                createdAt: (s as any).createdAt ?? null,
                updatedAt: (s as any).updatedAt ?? null,
                snapshot: (s as any).snapshot ?? null,
                cpu: (s as any).cpu ?? null,
                memory: (s as any).memory ?? null,
                disk: (s as any).disk ?? null,
                labels: (s as any).labels ?? {},
            }));
        } catch (error) {
            throw new TRPCError({
                code: 'INTERNAL_SERVER_ERROR',
                message: `Failed to list Daytona sandboxes: ${error instanceof Error ? error.message : String(error)}`,
                cause: error,
            });
        }
    }),

    /**
     * Get info about a specific sandbox by ID or name.
     */
    getSandbox: publicProcedure
        .input(z.object({ sandboxId: z.string() }))
        .query(async ({ input }) => {
            const client = getDaytonaClient();
            try {
                const sandbox = await client.get(input.sandboxId);
                return {
                    id: sandbox.id,
                    state: String((sandbox as any).state ?? 'unknown'),
                    createdAt: (sandbox as any).createdAt ?? null,
                    updatedAt: (sandbox as any).updatedAt ?? null,
                    snapshot: (sandbox as any).snapshot ?? null,
                    cpu: (sandbox as any).cpu ?? null,
                    memory: (sandbox as any).memory ?? null,
                    disk: (sandbox as any).disk ?? null,
                };
            } catch (error) {
                throw new TRPCError({
                    code: 'NOT_FOUND',
                    message: `Sandbox ${input.sandboxId} not found: ${error instanceof Error ? error.message : String(error)}`,
                    cause: error,
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
            const client = getDaytonaClient();
            try {
                const sandbox = await client.get(input.sandboxId);
                const result = await sandbox.process.executeCommand(input.command);
                return {
                    exitCode: result.exitCode ?? 0,
                    output: result.result ?? (result as any).artifacts?.stdout ?? '',
                };
            } catch (error) {
                throw new TRPCError({
                    code: 'INTERNAL_SERVER_ERROR',
                    message: `Command execution failed: ${error instanceof Error ? error.message : String(error)}`,
                    cause: error,
                });
            }
        }),

    /**
     * Run TypeScript/JS/Python code inside a sandbox using the code interpreter.
     */
    runCode: publicProcedure
        .input(
            z.object({
                sandboxId: z.string(),
                code: z.string().min(1),
            }),
        )
        .mutation(async ({ input }) => {
            const client = getDaytonaClient();
            try {
                const sandbox = await client.get(input.sandboxId);
                const result = await sandbox.process.codeRun(input.code);
                return {
                    exitCode: result.exitCode ?? 0,
                    output: result.result ?? '',
                    success: (result.exitCode ?? 0) === 0,
                };
            } catch (error) {
                throw new TRPCError({
                    code: 'INTERNAL_SERVER_ERROR',
                    message: `Code execution failed: ${error instanceof Error ? error.message : String(error)}`,
                    cause: error,
                });
            }
        }),

    /**
     * Delete a Daytona sandbox by ID.
     */
    deleteSandbox: publicProcedure
        .input(z.object({ sandboxId: z.string() }))
        .mutation(async ({ input }) => {
            const client = getDaytonaClient();
            try {
                // client.get() fetches the Sandbox instance, then client.delete() removes it
                const sandbox = await client.get(input.sandboxId);
                await client.delete(sandbox);
                return { success: true, sandboxId: input.sandboxId };
            } catch (error) {
                throw new TRPCError({
                    code: 'INTERNAL_SERVER_ERROR',
                    message: `Failed to delete sandbox: ${error instanceof Error ? error.message : String(error)}`,
                    cause: error,
                });
            }
        }),

    /**
     * Get the public preview URL for a given port of a sandbox.
     */
    getPreviewUrl: publicProcedure
        .input(
            z.object({
                sandboxId: z.string(),
                port: z.number().default(3000),
            }),
        )
        .query(async ({ input }) => {
            const client = getDaytonaClient();
            try {
                const sandbox = await client.get(input.sandboxId);
                const previewInfo = await sandbox.getPreviewLink(input.port);
                return {
                    url: previewInfo?.url ?? null,
                    token: previewInfo?.token ?? null,
                };
            } catch (error) {
                throw new TRPCError({
                    code: 'INTERNAL_SERVER_ERROR',
                    message: `Failed to get preview URL: ${error instanceof Error ? error.message : String(error)}`,
                    cause: error,
                });
            }
        }),
});
