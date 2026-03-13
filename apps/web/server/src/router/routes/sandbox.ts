import { z } from 'zod';
import * as sandbox from '../../sandbox';
import { publicProcedure, router } from '../trpc';

export const sandboxRouter = router({
    create: publicProcedure
        .input(z.object({ sandboxId: z.string() }))
        .mutation(({ input }) => {
            return sandbox.start(input.sandboxId);
        }),

    start: publicProcedure
        .input(z.object({ sandboxId: z.string() }))
        .mutation(({ input }) => {
            return sandbox.start(input.sandboxId);
        }),

    stop: publicProcedure
        .input(z.object({ sandboxId: z.string() }))
        .mutation(({ input }) => {
            return sandbox.stop(input.sandboxId);
        }),

    status: publicProcedure
        .input(z.object({ sandboxId: z.string() }))
        .query(({ input }) => {
            return sandbox.status(input.sandboxId);
        }),

});
