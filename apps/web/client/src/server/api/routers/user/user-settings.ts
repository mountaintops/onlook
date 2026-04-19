import { createDefaultUserSettings, fromDbUserSettings, userSettings, userSettingsUpdateSchema } from '@onlook/db';
import { eq } from 'drizzle-orm';
import { createTRPCRouter, protectedProcedure } from '../../trpc';

export const userSettingsRouter = createTRPCRouter({
    get: protectedProcedure.query(async ({ ctx }) => {
        const user = ctx.user;
        try {
            const settings = await ctx.db.query.userSettings.findFirst({
                where: eq(userSettings.userId, user.id),
            });
            return fromDbUserSettings(settings ?? createDefaultUserSettings(user.id));
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            const errorStack = error instanceof Error ? error.stack : undefined;
            console.error('[UserSettings Router] Failed to get user settings:', {
                error: errorMessage,
                stack: errorStack,
                userId: user.id,
                timestamp: new Date().toISOString(),
            });
            throw new Error(`Failed to get user settings: ${errorMessage}`);
        }
    }),
    upsert: protectedProcedure.input(userSettingsUpdateSchema).mutation(async ({ ctx, input }) => {
        const user = ctx.user
        try {
            const existingSettings = await ctx.db.query.userSettings.findFirst({
                where: eq(userSettings.userId, user.id),
            });

            if (!existingSettings) {
                const newSettings = {
                    ...createDefaultUserSettings(user.id),
                    ...input,
                    userId: user.id,
                };
                const [insertedSettings] = await ctx.db.insert(userSettings).values(newSettings).returning();
                return fromDbUserSettings(insertedSettings ?? newSettings);
            }
            const [updatedSettings] = await ctx.db.update(userSettings).set(input).where(eq(userSettings.userId, user.id)).returning();

            if (!updatedSettings) {
                console.error('[UserSettings Router] Failed to update user settings - no result returned', {
                    userId: user.id,
                    input,
                    timestamp: new Date().toISOString(),
                });
                throw new Error('Failed to update user settings');
            }

            return fromDbUserSettings(updatedSettings);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            const errorStack = error instanceof Error ? error.stack : undefined;
            console.error('[UserSettings Router] Failed to upsert user settings:', {
                error: errorMessage,
                stack: errorStack,
                userId: user.id,
                input,
                timestamp: new Date().toISOString(),
            });
            throw new Error(`Failed to update user settings: ${errorMessage}`);
        }
    }),
});
