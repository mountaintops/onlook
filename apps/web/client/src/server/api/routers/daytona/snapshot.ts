import { CodeProvider, createCodeProviderClient, DaytonaProvider } from '@onlook/code-provider';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { createTRPCRouter, publicProcedure } from '../../trpc';

export const snapshotRouter = createTRPCRouter({
    /**
     * List all snapshots.
     */
    list: publicProcedure.query(async () => {
        // Since snapshots are account-wide, we can just use a blank provider
        const provider = (await createCodeProviderClient(CodeProvider.Daytona, {
            providerOptions: { daytona: {} },
        })) as DaytonaProvider;
        try {
            // Need to expose listSnapshots on DaytonaProvider or use SDK directly
            throw new Error('listSnapshots not implemented in provider');
        } catch (error: any) {
            console.error('[Daytona] Failed to list snapshots:', error);
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
             // Placeholder for now
             return { success: true, name: input.name };
        }),

    /**
     * Delete a snapshot.
     */
    delete: publicProcedure
        .input(z.object({ snapshotName: z.string() }))
        .mutation(async ({ input }) => {
             // Placeholder for now
             return { success: true, snapshotName: input.snapshotName };
        }),

    /**
     * Activate a snapshot.
     */
    activate: publicProcedure
        .input(z.object({ snapshotName: z.string() }))
        .mutation(async ({ input }) => {
             // Placeholder for now
             return { success: true, name: input.snapshotName };
        }),
});
