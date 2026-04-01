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
    screenshitInitCustomDomain,
    screenshitCustomDomainStatus,
} from './helpers/subdomain';
import { deployments, userProjects } from '@onlook/db';
import { eq } from 'drizzle-orm';

export const screenshitRouter = createTRPCRouter({
    /**
     * Deploy a project to the screenshit Express API.
     *
     * Flow (mirrors deploy.ts):
     *   1. Create a PENDING deployment record in the DB.
     *   2. Fork the sandbox to get a read-only Provider.
     *   3. Zip & POST to /deploy[?customDomain=Y] → receive jobId.
     *      The server automatically assigns {projectId}.weliketech.eu.org as subdomain.
     *      If customDomain is provided (and already CF-verified), it is also routed.
     *   4. Poll /deploy/status/:jobId until completed or failed.
     *   5. Update the deployment record: lambdaUrl in message, public URLs in urls.
     */
    deploy: protectedProcedure
        .input(
            z.object({
                projectId: z.string(),
                sandboxId: z.string(),
                force: z.boolean().optional().default(false),
                /**
                 * Optional: custom domain to activate routing for.
                 * Must already be CF-verified via setupCustomDomain + customDomainStatus.
                 */
                customDomain: z.string().optional(),
                /** Remove the custom domain from the project that currently owns it. */
                removeOld: z.boolean().optional().default(false),
            }),
        )
        .mutation(async ({ ctx, input }): Promise<{ deploymentId: string; url: string; subdomainUrl: string }> => {
            const { projectId, sandboxId, force, customDomain, removeOld } = input;
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
                    const lambdaUrl = existing.message;
                    const subdomainUrl = (existing.urls ?? []).find(u => u.includes('weliketech.eu.org')) ?? '';
                    console.log(`[screenshit] Reusing existing deployment: ${lambdaUrl}`);
                    return { deploymentId: existing.id, url: lambdaUrl, subdomainUrl };
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

                    // 3. Zip & upload (with optional custom domain)
                    const { jobId } = await screenshitDeploy(provider, projectId, {
                        customDomain,
                        removeOld,
                    });

                    await updateDeployment(ctx.db, {
                        id: deploymentId,
                        status: DeploymentStatus.IN_PROGRESS,
                        message: `Waiting for deploy server (job: ${jobId})...`,
                        progress: 50,
                        envVars: {},
                    });

                    // 4. Poll until done — result contains lambdaUrl + subdomain
                    const { url: lambdaUrl, subdomain } = await pollScreenshitStatus(jobId);

                    // Build the list of public URLs (subdomain + custom domain if provided)
                    const publicUrls: string[] = [];
                    if (subdomain) publicUrls.push(`https://${subdomain}`);
                    if (customDomain) publicUrls.push(`https://${customDomain}`);

                    // 5. Mark completed; store lambdaUrl in message, public URLs in urls
                    await updateDeployment(ctx.db, {
                        id: deploymentId,
                        status: DeploymentStatus.COMPLETED,
                        message: lambdaUrl,
                        progress: 100,
                        envVars: {},
                    });

                    // Persist public URL list
                    if (publicUrls.length > 0) {
                        await ctx.db.update(deployments)
                            .set({ urls: publicUrls })
                            .where(eq(deployments.id, deploymentId));
                    }

                    const subdomainUrl = subdomain ? `https://${subdomain}` : '';
                    return { deploymentId, url: lambdaUrl, subdomainUrl };
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
     */
    delete: protectedProcedure
        .input(z.object({ projectId: z.string() }))
        .mutation(async ({ ctx, input }): Promise<{ success: boolean }> => {
            const { projectId } = input;

            const { jobId } = await screenshitDelete(projectId);
            // Poll so the mutation only resolves once deletion is truly finished
            await pollScreenshitStatus(jobId, false);

            // Mark the deployment as cancelled in the database
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
     * Step 1 of custom domain setup: initialise a Cloudflare for SaaS hostname.
     *
     * Mirrors deploy.ts: POST /domain/custom.
     * Returns DNS records the user must configure in their registrar.
     * After verification, call deploy() again with customDomain set to activate routing.
     *
     * Conflict resolution (same user owns domain on another project):
     *   - forceRemoveOld: false → returns { conflict: true, conflictingProjectId, ownedByCurrentUser: true }
     *   - forceRemoveOld: true  → re-deploys with removeOld=true to migrate the domain
     */
    setupCustomDomain: protectedProcedure
        .input(
            z.object({
                projectId: z.string(),
                customDomain: z.string(),
            }),
        )
        .mutation(async ({ ctx, input }) => {
            const { projectId, customDomain } = input;
            const fullUrl = `https://${customDomain}`;

            // Check if any OTHER project has this domain already
            const existingDeployment = await ctx.db.query.deployments.findFirst({
                where: (deployments, { and, ne, sql }) =>
                    and(
                        ne(deployments.projectId, projectId),
                        sql`${deployments.urls} @> ARRAY[${fullUrl}]::text[]`
                    ),
            });

            if (existingDeployment) {
                const ownerRecord = await ctx.db.query.userProjects.findFirst({
                    where: (up, { and, eq }) =>
                        and(
                            eq(up.projectId, existingDeployment.projectId),
                            eq(up.userId, ctx.user.id),
                        ),
                });

                if (!ownerRecord) {
                    throw new TRPCError({
                        code: 'CONFLICT',
                        message: `The domain "${customDomain}" is already in use by another project.`,
                    });
                }

                // Same user — return conflict info so UI can offer opt-in
                return {
                    conflict: true as const,
                    conflictingProjectId: existingDeployment.projectId,
                    ownedByCurrentUser: true as const,
                };
            }

            // No conflict: initialise the CF hostname and return verification records
            const result = await screenshitInitCustomDomain(customDomain);
            return { conflict: false as const, ...result };
        }),

    /**
     * Step 2 of custom domain setup: poll until the custom domain is verified.
     * Wraps GET /domain/custom/status/:domain.
     */
    customDomainStatus: protectedProcedure
        .input(z.object({ customDomain: z.string() }))
        .query(async ({ input }) => {
            return await screenshitCustomDomainStatus(input.customDomain);
        }),

    /**
     * Remove a custom domain from a project.
     * Clears the domain URL from Onlook's deployment records.
     *
     * Note: the Cloudflare worker routing entry for this domain will remain
     * until the project is next deployed (no dedicated remove endpoint exists).
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
            const fullUrl = `https://${customDomain}`;

            const deploymentsToUpdate = await ctx.db.query.deployments.findMany({
                where: (d, { eq, and }) =>
                    and(
                        eq(d.projectId, projectId),
                        eq(d.type, DeploymentType.SCREENSHIT)
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

            return { success: true, customDomain };
        }),
});
