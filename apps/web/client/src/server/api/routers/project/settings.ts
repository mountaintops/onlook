import {
    projectSettings,
    projectSettingsInsertSchema,
    fromDbProjectSettings,
    toDbProjectSettings,
} from '@onlook/db';
import { LifecycleHookEvent } from '@onlook/models';
import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { createTRPCRouter, protectedProcedure } from '../../trpc';
import { executeLifecycleHook } from './hooks';
import { getProvider } from './sandbox';

export const settingsRouter = createTRPCRouter({
    get: protectedProcedure
        .input(
            z.object({
                projectId: z.string(),
            }),
        )
        .query(async ({ ctx, input }) => {
            const setting = await ctx.db.query.projectSettings.findFirst({
                where: eq(projectSettings.projectId, input.projectId),
            });
            if (!setting) {
                return null;
            }
            return fromDbProjectSettings(setting);
        }),
    upsert: protectedProcedure
        .input(
            z.object({
                projectId: z.string(),
                settings: projectSettingsInsertSchema,
            }),
        )
        .mutation(async ({ ctx, input }) => {
            const [updatedSettings] = await ctx.db
                .insert(projectSettings)
                .values(input)
                .onConflictDoUpdate({
                    target: [projectSettings.projectId],
                    set: input.settings,
                })
                .returning();
            if (!updatedSettings) {
                throw new TRPCError({
                    code: 'INTERNAL_SERVER_ERROR',
                    message: 'Failed to update project settings',
                });
            }
            return fromDbProjectSettings(updatedSettings);
        }),
    delete: protectedProcedure
        .input(
            z.object({
                projectId: z.string(),
            }),
        )
        .mutation(async ({ ctx, input }) => {
            await ctx.db
                .delete(projectSettings)
                .where(eq(projectSettings.projectId, input.projectId));
            return true;
        }),

    /**
     * Execute a lifecycle hook inside the sandbox VM.
     * Called by the client (SandboxManager) after file operations.
     */
    executeHook: protectedProcedure
        .input(
            z.object({
                sandboxId: z.string(),
                projectId: z.string(),
                event: z.enum([
                    LifecycleHookEvent.STARTUP,
                    LifecycleHookEvent.SHUTDOWN,
                    LifecycleHookEvent.VM_CREATION,
                    LifecycleHookEvent.FILE_DELETE,
                    LifecycleHookEvent.FILE_CREATE,
                    LifecycleHookEvent.FILE_EDIT,
                ]),
                filePath: z.string(),
            }),
        )
        .mutation(async ({ ctx, input }) => {
            const setting = await ctx.db.query.projectSettings.findFirst({
                where: eq(projectSettings.projectId, input.projectId),
            });
            const hooks = setting ? fromDbProjectSettings(setting).lifecycleHooks : undefined;
            if (!hooks) {
                return { ran: false, reason: 'No hooks configured' };
            }

            const provider = await getProvider({
                sandboxId: input.sandboxId,
                userId: ctx.user.id,
                tier: 'Pico',
            });

            try {
                await executeLifecycleHook(provider, hooks, input.event, input.filePath);
                return { ran: true };
            } finally {
                await provider.destroy().catch(() => {});
            }
        }),
});
