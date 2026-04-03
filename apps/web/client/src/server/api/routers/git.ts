import { generateGitCommitTitle } from '@onlook/ai/src/agents/titles';
import { z } from 'zod';
import { createTRPCRouter, protectedProcedure } from '../trpc';

export const gitRouter = createTRPCRouter({
    generateCommitTitle: protectedProcedure
        .input(z.object({
            instruction: z.string(),
        }))
        .mutation(async ({ input }) => {
            const title = await generateGitCommitTitle(input.instruction);
            return title;
        }),
});
