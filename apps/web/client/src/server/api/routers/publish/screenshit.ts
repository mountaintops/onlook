import { DeploymentStatus, DeploymentType } from '@onlook/models';
import { z } from 'zod';
import { createTRPCRouter, protectedProcedure } from '../../trpc';
import { createDeployment } from './helpers/deploy';
import { updateDeployment } from './helpers/helpers';
import { forkBuildSandbox } from './helpers/fork';
import {
    screenshitDeploy,
    screenshitDelete,
    pollScreenshitStatus,
} from './helpers/screenshit';

export const screenshitRouter = createTRPCRouter({
    /**
     * Deploy a project to the screenshit Express API.
     *
     * Flow:
     *   1. Create a PENDING deployment record in the DB.
     *   2. Fork the sandbox to get a read-only Provider.
     *   3. Zip & POST to /deploy → receive jobId.
     *   4. Poll /deploy/status/:jobId until completed or failed.
     *   5. Update the deployment record and return { deploymentId, url }.
     */
    deploy: protectedProcedure
        .input(
            z.object({
                projectId: z.string(),
                sandboxId: z.string(),
            }),
        )
        .mutation(async ({ ctx, input }): Promise<{ deploymentId: string; url: string }> => {
            const { projectId, sandboxId } = input;
            const userId = ctx.user.id;

            // 1. Create a deployment record so the UI can poll for status
            const deployment = await createDeployment({
                db: ctx.db,
                projectId,
                type: DeploymentType.SCREENSHIT,
                userId,
                sandboxId,
            });

            const deploymentId = deployment.id;

            try {
                await updateDeployment(ctx.db, {
                    id: deploymentId,
                    status: DeploymentStatus.IN_PROGRESS,
                    message: 'Creating build environment...',
                    progress: 10,
                    envVars: {},
                });

                // 2. Fork the sandbox so we have a Provider to walk the file tree
                const { provider } = await forkBuildSandbox(sandboxId, userId, deploymentId);

                try {
                    await updateDeployment(ctx.db, {
                        id: deploymentId,
                        status: DeploymentStatus.IN_PROGRESS,
                        message: 'Zipping project and uploading to deploy server...',
                        progress: 25,
                        envVars: {},
                    });

                    // 3. Zip & upload
                    const { jobId } = await screenshitDeploy(provider, projectId);

                    await updateDeployment(ctx.db, {
                        id: deploymentId,
                        status: DeploymentStatus.IN_PROGRESS,
                        message: `Waiting for deploy server (job: ${jobId})...`,
                        progress: 50,
                        envVars: {},
                    });

                    // 4. Poll until done
                    const url = await pollScreenshitStatus(jobId);

                    // 5. Mark completed
                    await updateDeployment(ctx.db, {
                        id: deploymentId,
                        status: DeploymentStatus.COMPLETED,
                        message: url,
                        progress: 100,
                        envVars: {},
                    });

                    return { deploymentId, url };
                } finally {
                    // Always clean up the forked sandbox
                    await provider.destroy().catch(console.error);
                }
            } catch (error) {
                await updateDeployment(ctx.db, {
                    id: deploymentId,
                    status: DeploymentStatus.FAILED,
                    error: error instanceof Error ? error.message : String(error),
                    progress: 100,
                    envVars: {},
                });
                throw error;
            }
        }),

    /**
     * Delete a project's SST deployment.
     *
     * Flow:
     *   1. DELETE /delete?projectId=<id> → receive jobId.
     *   2. Poll until completed or failed.
     *   3. Return { success: true }.
     */
    delete: protectedProcedure
        .input(z.object({ projectId: z.string() }))
        .mutation(async ({ ctx, input }): Promise<{ success: boolean }> => {
            const { projectId } = input;

            const { jobId } = await screenshitDelete(projectId);
            // Poll so that the mutation only resolves once the deletion is truly finished
            await pollScreenshitStatus(jobId, false);

            // Mark the deployment as cancelled in the database so the UI hides the URL
            const existingDeployment = await ctx.db.query.deployments.findFirst({
                where: (deployments, { eq, and }) =>
                    and(
                        eq(deployments.projectId, projectId),
                        eq(deployments.type, DeploymentType.SCREENSHIT)
                    ),
                orderBy: (deployments, { desc }) => [desc(deployments.createdAt)],
            });
            
            if (existingDeployment) {
                await updateDeployment(ctx.db, {
                    id: existingDeployment.id,
                    status: DeploymentStatus.CANCELLED,
                    message: 'SST infrastructure deleted',
                });
            }

            return { success: true };
        }),
});
