import { useEditorEngine } from '@/components/store/editor';
import { useHostingContext, useHostingType } from '@/components/store/hosting';
import { DeploymentStatus, DeploymentType } from '@onlook/models';
import { Button } from '@onlook/ui/button';
import { Icons } from '@onlook/ui/icons/index';
import { Input } from '@onlook/ui/input';
import { Checkbox } from '@onlook/ui/checkbox';
import { Label } from '@onlook/ui/label';
import { toast } from '@onlook/ui/sonner';
import { observer } from 'mobx-react-lite';
import { useState, useMemo, useEffect } from 'react';
import { UrlSection } from './url';
import { api } from '@/trpc/react';

const BASE_DOMAIN = 'weliketech.eu.org';

function sanitiseSubdomain(value: string): string {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 63);
}

export const PreviewDomainSection = observer(() => {
    const editorEngine = useEditorEngine();
    const { deployScreenshit, isScreenshitDeploying, deployments, refetch } = useHostingContext();
    const { data: user } = api.user.get.useQuery();

    // Get the current screenshit deployment
    const sstDeployment = deployments?.screenshit;
    const computedSstUrl = sstDeployment?.status === DeploymentStatus.COMPLETED ? sstDeployment.message : null;

    // Persisted assigned domain URL
    const assignedDomain = useMemo(() => {
        if (sstDeployment?.urls && sstDeployment.urls.length > 0) {
            return sstDeployment.urls[0];
        }
        return null;
    }, [sstDeployment]);

    const [subdomainInput, setSubdomainInput] = useState('');
    const [isAssigning, setIsAssigning] = useState(false);
    const [forceRedeploy, setForceRedeploy] = useState(false);

    // tRPC mutations
    const { mutateAsync: assignDomain } = api.publish.screenshit.assignDomain.useMutation();
    const { mutateAsync: removeDomain } = api.publish.screenshit.removeDomain.useMutation();

    // Generate a default subdomain when user data is available
    useEffect(() => {
        if (user && !subdomainInput && !assignedDomain) {
            const name = user.firstName || user.displayName || 'user';
            const random = Math.floor(Math.random() * 9000) + 1000;
            setSubdomainInput(sanitiseSubdomain(`${name}-${random}`));
        }
    }, [user, assignedDomain]);

    // If we have an assigned domain, pre-fill it (just the label part)
    useEffect(() => {
        if (assignedDomain) {
            try {
                const url = new URL(assignedDomain);
                const label = url.hostname.split('.')[0];
                setSubdomainInput(label);
            } catch (e) {
                console.error('Failed to parse assigned domain', e);
            }
        }
    }, [assignedDomain]);

    const effectiveSubdomain = subdomainInput.trim() ? sanitiseSubdomain(subdomainInput.trim()) : '';
    const fullDomain = `${effectiveSubdomain}.${BASE_DOMAIN}`;
    const fullUrl = `https://${fullDomain}`;

    const publishSst = async (): Promise<void> => {
        const sandboxId = editorEngine.branches?.activeBranch?.sandbox?.id;
        if (!sandboxId) {
            toast.error('No active sandbox found for publish');
            return;
        }

        try {
            // 1. Deploy/Update the project
            const deployResult = await deployScreenshit(editorEngine.projectId, sandboxId, forceRedeploy);
            if (!deployResult?.url) {
                throw new Error('Deployment failed - no URL returned');
            }

            // 2. Automatically assign the subdomain
            if (effectiveSubdomain) {
                setIsAssigning(true);
                await assignDomain({
                    projectId: editorEngine.projectId,
                    lambdaUrl: deployResult.url,
                    subdomain: effectiveSubdomain,
                });
                toast.success('Project published and subdomain assigned!');
            } else {
                toast.success('Project published!');
            }
            // Reset force redeploy after success
            setForceRedeploy(false);
        } catch (err) {
            toast.error('Publishing failed', {
                description: err instanceof Error ? err.message : 'Unknown error',
            });
        } finally {
            setIsAssigning(false);
            refetch(DeploymentType.SCREENSHIT);
        }
    };

    const handleRemove = async () => {
        if (!assignedDomain) return;
        setIsAssigning(true);
        try {
            const url = new URL(assignedDomain);
            const subdomainToRemove = url.hostname.split('.')[0];
            await removeDomain({
                projectId: editorEngine.projectId,
                subdomain: subdomainToRemove,
            });
            toast.success('Subdomain removed');
            refetch(DeploymentType.SCREENSHIT);
        } catch (err) {
            toast.error('Failed to remove subdomain');
        } finally {
            setIsAssigning(false);
        }
    };

    const isWorking = isScreenshitDeploying || isAssigning;

    return (
        <div className="p-4 flex flex-col items-center gap-4">
            <div className="w-full flex flex-col gap-2">
                <div className="flex flex-row justify-between items-center px-1">
                    <h3 className="text-sm font-medium">Publish</h3>
                    {sstDeployment?.status === DeploymentStatus.IN_PROGRESS && (
                        <div className="text-xs text-muted-foreground flex items-center gap-1.5 animate-pulse">
                            {sstDeployment.message || 'Publishing...'}
                        </div>
                    )}
                </div>

                {assignedDomain && (
                    <div className="space-y-2">
                        <UrlSection url={assignedDomain} isCopyable={true} />
                        <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-[10px] text-destructive hover:text-destructive p-0 h-auto"
                            onClick={handleRemove}
                            disabled={isWorking}
                        >
                            Remove subdomain
                        </Button>
                    </div>
                )}

                <div className="space-y-1.5 mt-2">
                    <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold px-1">
                        Subdomain
                    </label>
                    <div className="flex items-center gap-1">
                        <Input
                            type="text"
                            className="flex-1 h-8 text-xs font-mono"
                            placeholder="my-subdomain"
                            value={subdomainInput}
                            onChange={(e) => setSubdomainInput(e.target.value)}
                            disabled={isWorking}
                        />
                        <span className="text-xs text-muted-foreground whitespace-nowrap">
                            .{BASE_DOMAIN}
                        </span>
                    </div>
                    {effectiveSubdomain && !assignedDomain && (
                        <p className="text-[10px] text-muted-foreground px-1 truncate">
                            → {fullUrl}
                        </p>
                    )}
                </div>

                <div className="flex items-center space-x-2 px-1 mt-1">
                    <Checkbox
                        id="force-redeploy"
                        checked={forceRedeploy}
                        onCheckedChange={(checked) => setForceRedeploy(!!checked)}
                        disabled={isWorking || !computedSstUrl}
                    />
                    <Label
                        htmlFor="force-redeploy"
                        className="text-[10px] text-muted-foreground cursor-pointer"
                    >
                        Redeploy full project
                    </Label>
                </div>

                <Button
                    onClick={publishSst}
                    variant="outline"
                    className="w-full rounded-md p-3 mt-1"
                    disabled={isWorking}
                    id="publish-btn"
                >
                    {isWorking && (
                        <Icons.LoadingSpinner className="w-4 h-4 mr-2 animate-spin" />
                    )}
                    {isWorking ? 'Publishing...' : 'Publish'}
                </Button>
            </div>
        </div>
    );
});
