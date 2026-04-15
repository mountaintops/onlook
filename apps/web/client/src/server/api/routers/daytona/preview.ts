import { CodeProvider, createCodeProviderClient, DaytonaProvider } from '@onlook/code-provider';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { createTRPCRouter, publicProcedure } from '../../trpc';

export const previewRouter = createTRPCRouter({
    /**
     * Get the public preview URL for a given port.
     */
    getPreviewUrl: publicProcedure
        .input(
            z.object({
                sandboxId: z.string(),
                port: z.number().default(3000),
            }),
        )
        .query(async ({ input }) => {
            const provider = (await createCodeProviderClient(CodeProvider.Daytona, {
                providerOptions: { daytona: { sandboxId: input.sandboxId } },
            })) as DaytonaProvider;
            try {
                const previewInfo = await provider.getPreviewLink(input.port);
                return {
                    url: previewInfo?.url ?? null,
                    token: previewInfo?.token ?? null,
                };
            } catch (error: any) {
                console.error(`[Daytona] Failed to get preview URL for ${input.sandboxId}:`, error);
                throw new TRPCError({
                    code: 'INTERNAL_SERVER_ERROR',
                    message: `Failed to get preview URL: ${error.message}`,
                });
            }
        }),
});
