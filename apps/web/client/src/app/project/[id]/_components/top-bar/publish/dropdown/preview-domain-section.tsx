import { useEditorEngine } from '@/components/store/editor';
import { useHostingContext } from '@/components/store/hosting';
import { DeploymentStatus, DeploymentType } from '@onlook/models';
import { Button } from '@onlook/ui/button';
import { Icons } from '@onlook/ui/icons/index';
import { Checkbox } from '@onlook/ui/checkbox';
import { Label } from '@onlook/ui/label';
import { toast } from '@onlook/ui/sonner';
import { observer } from 'mobx-react-lite';
import { useState, useMemo } from 'react';
import { UrlSection } from './url';

const BASE_DOMAIN = 'weliketech.eu.org';

export const PreviewDomainSection = observer(() => {
    const editorEngine = useEditorEngine();
    const { deployScreenshit, isScreenshitDeploying, deployments, refetch } = useHostingContext();

    // Get the current screenshit deployment
    const sstDeployment = deployments?.screenshit;
    const computedSstUrl = sstDeployment?.status === DeploymentStatus.COMPLETED ? sstDeployment.message : null;

    // Persisted assigned domain URL
    const assignedDomain = useMemo(() => {
        if (sstDeployment?.urls && sstDeployment.urls.length > 0) {
            // Prefer the auto-assigned staging domain for this section
            return sstDeployment.urls.find(u => u.includes(BASE_DOMAIN)) || sstDeployment.urls[0];
        }
        return null;
    }, [sstDeployment]);

    const [forceRedeploy, setForceRedeploy] = useState(false);

    const publishSst = async (): Promise<void> => {
        const sandboxId = editorEngine.branches?.activeBranch?.sandbox?.id;
        if (!sandboxId) {
            toast.error('No active sandbox found for publish');
            return;
        }

        try {
            // Deploy the project
            // The screenshit API backend automatically wires up `{projectId}.weliketech.eu.org`
            const deployResult = await deployScreenshit(editorEngine.projectId, sandboxId, forceRedeploy);
            if (!deployResult?.url) {
                throw new Error('Deployment failed - no URL returned');
            }

            toast.success('Project published successfully!');
            // Reset force redeploy after success
            setForceRedeploy(false);
        } catch (err) {
            toast.error('Publishing failed', {
                description: err instanceof Error ? err.message : 'Unknown error',
            });
        } finally {
            refetch(DeploymentType.SCREENSHIT);
        }
    };

    const isWorking = isScreenshitDeploying;

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

                {assignedDomain ? (
                    <div className="space-y-2 mt-2">
                        <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold px-1">
                            Preview Domain
                        </label>
                        <UrlSection url={assignedDomain} isCopyable={true} />
                    </div>
                ) : (
                    <div className="text-xs text-muted-foreground bg-secondary/30 p-2 rounded px-2 mt-2 border border-border/50">
                        Publish your project to automatically get a staging domain.
                    </div>
                )}

                <div className="flex items-center space-x-2 px-1 mt-3">
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
                        Force full clean redeploy
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
