import { createTRPCRouter } from '../../trpc';
import { previewRouter } from './preview';
import { sandboxRouter } from './sandbox';
import { snapshotRouter } from './snapshot';
import { setupRouter } from './setup';
import { fsRouter } from './fs';

/**
 * Daytona primary router grouping all sandbox sub-systems.
 */
export const daytonaRouter = createTRPCRouter({
    sandbox: sandboxRouter,
    snapshot: snapshotRouter,
    preview: previewRouter,
    setup: setupRouter,
    fs: fsRouter,
});
