import { DeploymentStatus, DeploymentType } from '@onlook/models';
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { createTRPCRouter, protectedProcedure } from '../../trpc';
import { createDeployment } from './helpers/deploy';
import { updateDeployment } from './helpers/helpers';
import { forkBuildSandbox } from './helpers/fork';
import {
    screenshitDeploy,
    screenshitDelete,
    pollScreenshitStatus,
} from './helpers/screenshit';
import {
    screenshitAssignDomain,
    screenshitAssignCustomDomain,
    screenshitRemoveDomain,
    screenshitRemoveCustomDomain,
    screenshitDomainStatus,
    screenshitCustomDomainStatus,
    screenshitListDomains,
} from './helpers/subdomain';
import { deployments } from '@onlook/db';
import { and, eq } from 'drizzle-orm';

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
                force: z.boolean().optional().default(false),
                customDomain: z.string().optional(),
            }),
        )
        .mutation(async ({ ctx, input }): Promise<{ deploymentId: string; url: string; subdomainUrl?: string }> => {
            const { projectId, sandboxId, force, customDomain } = input;
            const userId = ctx.user.id;

            // 0. Check for existing completed deployment if not forcing
            if (!force) {
                const existing = await ctx.db.query.deployments.findFirst({
                    where: (deployments, { and, eq }) =>
                        and(
                            eq(deployments.projectId, projectId),
                            eq(deployments.type, DeploymentType.SCREENSHIT),
                            eq(deployments.status, DeploymentStatus.COMPLETED),
                        ),
                    orderBy: (deployments, { desc }) => [desc(deployments.createdAt)],
                });

                if (existing && existing.message) {
                    const url = existing.message;
                    console.log(`[screenshit] Reusing existing deployment: ${url}`);
                    return {
                        deploymentId: existing.id,
                        url,
                        subdomainUrl: `https://${url.replace(/^https?:\/\//, '').split('.')[0]}.weliketech.eu.org`
                    };
                }
            }

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
                    const { jobId } = await screenshitDeploy(provider, projectId, customDomain);

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

                    const subdomainUrl = customDomain ? `https://${customDomain}` : `https://${url.replace(/^https?:\/\//, '').split('.')[0]}.weliketech.eu.org`;
                    return { deploymentId, url, subdomainUrl };
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

    /**
     * Assign a custom subdomain to a deployed project.
     *
     * Creates a Cloudflare custom hostname + CloudFront KVS route
     * via the screenshit Express API.
     */
    assignDomain: protectedProcedure
        .input(
            z.object({
                projectId: z.string(),
                lambdaUrl: z.string().url(),
                subdomain: z.string().optional(),
            }),
        )
        .mutation(async ({ ctx, input }) => {
            const { projectId, lambdaUrl, subdomain } = input;

            // 1. Check for subdomain uniqueness if provided
            if (subdomain) {
                const targetDomain = `${subdomain}.weliketech.eu.org`;
                const fullUrl = `https://${targetDomain}`;

                // Check if any OTHER project already has this domain assigned
                const existing = await ctx.db.query.deployments.findFirst({
                    where: (deployments, { and, ne, sql }) =>
                        and(
                            ne(deployments.projectId, projectId),
                            sql`${deployments.urls} @> ARRAY[${fullUrl}]::text[]`
                        ),
                });

                if (existing) {
                    throw new TRPCError({
                        code: 'CONFLICT',
                        message: `The subdomain "${subdomain}" is already in use by another project.`,
                    });
                }
            }

            const result = await screenshitAssignDomain(projectId, lambdaUrl, subdomain);

            // Persist the assigned subdomain URL in the latest SCREENSHIT deployment record
            const latestDeployment = await ctx.db.query.deployments.findFirst({
                where: (deployments, { eq, and }) =>
                    and(
                        eq(deployments.projectId, projectId),
                        eq(deployments.type, DeploymentType.SCREENSHIT)
                    ),
                orderBy: (deployments, { desc }) => [desc(deployments.createdAt)],
            });

            if (latestDeployment) {
                const fullUrl = `https://${result.fullDomain}`;
                await ctx.db.update(deployments)
                    .set({ urls: [fullUrl] })
                    .where(eq(deployments.id, latestDeployment.id));
            }

            return {
                hostname: result.hostname,
                hostnameId: result.hostnameId,
                subdomain: result.subdomain,
                fullDomain: result.fullDomain,
                baseDomain: result.baseDomain,
            };
        }),

    /**
     * Remove a custom subdomain from a project.
     *
     * Deletes the Cloudflare custom hostname + CloudFront KVS route.
     */
    removeDomain: protectedProcedure
        .input(
            z.object({
                projectId: z.string(),
                subdomain: z.string().optional(),
            }),
        )
        .mutation(async ({ ctx, input }) => {
            const { projectId, subdomain } = input;
            const result = await screenshitRemoveDomain(projectId, subdomain);

            // Clear the assigned subdomain URL from the deployment records
            const deploymentsToUpdate = await ctx.db.query.deployments.findMany({
                where: (deployments, { eq, and }) =>
                    and(
                        eq(deployments.projectId, projectId),
                        eq(deployments.type, DeploymentType.SCREENSHIT)
                    ),
            });

            for (const d of deploymentsToUpdate) {
                await ctx.db.update(deployments)
                    .set({ urls: [] })
                    .where(eq(deployments.id, d.id));
            }

            return { hostname: result.hostname, removed: result.removed };
        }),

    /**
     * Check the status of a subdomain.
     */
    domainStatus: protectedProcedure
        .input(z.object({ subdomain: z.string() }))
        .query(async ({ input }) => {
            return await screenshitDomainStatus(input.subdomain);
        }),

    /**
     * Assign a custom domain to a deployed project.
     */
    assignCustomDomain: protectedProcedure
        .input(
            z.object({
                projectId: z.string(),
                lambdaUrl: z.string().url(),
                customDomain: z.string(),
            }),
        )
        .mutation(async ({ ctx, input }) => {
            const { projectId, lambdaUrl, customDomain } = input;

            const fullUrl = `https://${customDomain}`;
            
            // Check if any OTHER project already has this domain assigned
            const existing = await ctx.db.query.deployments.findFirst({
                where: (deployments, { and, ne, sql }) =>
                    and(
                        ne(deployments.projectId, projectId),
                        sql`${deployments.urls} @> ARRAY[${fullUrl}]::text[]`
                    ),
            });

            if (existing) {
                throw new TRPCError({
                    code: 'CONFLICT',
                    message: `The domain "${customDomain}" is already in use by another project.`,
                });
            }

            const result = await screenshitAssignCustomDomain(projectId, lambdaUrl, customDomain);

            // Persist the assigned custom domain URL in the latest SCREENSHIT deployment record
            const latestDeployment = await ctx.db.query.deployments.findFirst({
                where: (deployments, { eq, and }) =>
                    and(
                        eq(deployments.projectId, projectId),
                        eq(deployments.type, DeploymentType.SCREENSHIT)
                    ),
                orderBy: (deployments, { desc }) => [desc(deployments.createdAt)],
            });

            if (latestDeployment) {
                // Determine existing URLs and append the new one
                const currentUrls = latestDeployment.urls || [];
                if (!currentUrls.includes(fullUrl)) {
                    await ctx.db.update(deployments)
                        .set({ urls: [...currentUrls, fullUrl] })
                        .where(eq(deployments.id, latestDeployment.id));
                }
            }

            return result;
        }),

    /**
     * Remove a custom domain from a project.
     */
    removeCustomDomain: protectedProcedure
        .input(
            z.object({
                projectId: z.string(),
                customDomain: z.string(),
            }),
        )
        .mutation(async ({ ctx, input }) => {
            const { projectId, customDomain } = input;
            const result = await screenshitRemoveCustomDomain(customDomain);
            const fullUrl = `https://${customDomain}`;

            // Remove the assigned custom domain URL from the deployment records
            const deploymentsToUpdate = await ctx.db.query.deployments.findMany({
                where: (deployments, { eq, and }) =>
                    and(
                        eq(deployments.projectId, projectId),
                        eq(deployments.type, DeploymentType.SCREENSHIT)
                    ),
            });

            for (const d of deploymentsToUpdate) {
                const currentUrls = d.urls || [];
                if (currentUrls.includes(fullUrl)) {
                    await ctx.db.update(deployments)
                        .set({ urls: currentUrls.filter(u => u !== fullUrl) })
                        .where(eq(deployments.id, d.id));
                }
            }

            return result;
        }),

    /**
     * Check the status of a custom domain.
     */
    customDomainStatus: protectedProcedure
        .input(z.object({ customDomain: z.string() }))
        .query(async ({ input }) => {
            return await screenshitCustomDomainStatus(input.customDomain);
        }),

    /**
     * List all active subdomains.
     */
    listDomains: protectedProcedure
        .query(async () => {
            return await screenshitListDomains();
        }),
});
