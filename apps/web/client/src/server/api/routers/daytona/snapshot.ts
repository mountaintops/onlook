import { CodeProvider, createCodeProviderClient, DaytonaProvider } from '@onlook/code-provider';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { createTRPCRouter, publicProcedure } from '../../trpc';

export const snapshotRouter = createTRPCRouter({
    /**
     * List all snapshots.
     */
    list: publicProcedure.query(async () => {
        const provider = (await createCodeProviderClient(CodeProvider.Daytona, {
            providerOptions: { daytona: {} },
        })) as DaytonaProvider;
        try {
            const result = await provider.listSnapshots();
            return result || [];
        } catch (error: any) {
            console.error(`[tRPC] daytona.snapshot.list failed:`, error.message);
            throw new TRPCError({
                code: 'INTERNAL_SERVER_ERROR',
                message: `Failed to list snapshots: ${error.message}`,
            });
        }
    }),

    /**
     * Create a new snapshot.
     */
    create: publicProcedure
        .input(
            z.object({
                name: z.string().min(1),
                image: z.string().min(1),
            }),
        )
        .mutation(async ({ input }) => {
            const provider = (await createCodeProviderClient(CodeProvider.Daytona, {
                providerOptions: { daytona: {} },
            })) as DaytonaProvider;
            try {
                const snapshot = await provider.createSnapshot(input.name, input.image);
                return {
                    success: true,
                    id: (snapshot as any).id,
                    name: (snapshot as any).name,
                    state: String((snapshot as any).state ?? 'unknown'),
                };
            } catch (error: any) {
                console.error('[Daytona] Failed to create snapshot:', error);
                throw new TRPCError({
                    code: 'INTERNAL_SERVER_ERROR',
                    message: `Failed to create snapshot: ${error.message}`,
                });
            }
        }),

    /**
     * Delete a snapshot.
     */
    delete: publicProcedure
        .input(z.object({ snapshotName: z.string() }))
        .mutation(async ({ input }) => {
            const provider = (await createCodeProviderClient(CodeProvider.Daytona, {
                providerOptions: { daytona: {} },
            })) as DaytonaProvider;
            try {
                await provider.deleteSnapshot(input.snapshotName);
                return { success: true, snapshotName: input.snapshotName };
            } catch (error: any) {
                console.error(`[Daytona] Failed to delete snapshot ${input.snapshotName}:`, error);
                throw new TRPCError({
                    code: 'INTERNAL_SERVER_ERROR',
                    message: `Failed to delete snapshot: ${error.message}`,
                });
            }
        }),

    /**
     * Activate a snapshot.
     */
    activate: publicProcedure
        .input(z.object({ snapshotName: z.string() }))
        .mutation(async ({ input }) => {
            const provider = (await createCodeProviderClient(CodeProvider.Daytona, {
                providerOptions: { daytona: {} },
            })) as DaytonaProvider;
            try {
                const snapshot = await provider.activateSnapshot(input.snapshotName);
                return {
                    success: true,
                    name: (snapshot as any).name || input.snapshotName,
                    state: (snapshot as any).state || 'activated',
                };
            } catch (error: any) {
                console.error(`[Daytona] Failed to activate snapshot ${input.snapshotName}:`, error);
                throw new TRPCError({
                    code: 'INTERNAL_SERVER_ERROR',
                    message: `Failed to activate snapshot: ${error.message}`,
                });
            }
        }),
});
