import { useEditorEngine } from '@/components/store/editor';
import { useHostingContext, useHostingType } from '@/components/store/hosting';
import { DeploymentStatus, DeploymentType } from '@onlook/models';
import { Button } from '@onlook/ui/button';
import { Icons } from '@onlook/ui/icons/index';
import { toast } from '@onlook/ui/sonner';
import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import { UrlSection } from './url';

export const PreviewDomainSection = observer(() => {
    const editorEngine = useEditorEngine();
    const [sstDeployedUrl, setSstDeployedUrl] = useState<string | null>(null);
    const { deployment: _, publish: __, isDeploying: ___ } = useHostingType(DeploymentType.PREVIEW);
    const { deployScreenshit, isScreenshitDeploying, deployments } = useHostingContext();
    
    // Use the backend DB URL if available and local session state hasn't overridden it
    const sstDeployment = deployments?.screenshit;
    const computedSstUrl = sstDeployedUrl || (sstDeployment?.status === DeploymentStatus.COMPLETED ? sstDeployment.message : null);

    const publishSst = async (): Promise<void> => {
        const sandboxId = editorEngine.branches?.activeBranch?.sandbox?.id;
        if (!sandboxId) {
            toast.error('No active sandbox found for publish');
            return;
        }
        const result = await deployScreenshit(editorEngine.projectId, sandboxId);
        if (result?.url) {
            setSstDeployedUrl(result.url);
        }
    };

    return (
        <div className="p-4 flex flex-col items-center gap-2">
            <div className="w-full flex flex-col gap-2">
                <div className="flex flex-row justify-between items-center px-1">
                    <h3 className="text-sm font-medium">Publish</h3>
                    {sstDeployment?.status === DeploymentStatus.IN_PROGRESS && (
                        <div className="text-xs text-muted-foreground flex items-center gap-1.5 animate-pulse">
                            {sstDeployment.message || 'Publishing...'}
                        </div>
                    )}
                </div>
                {computedSstUrl && (
                    <UrlSection url={computedSstUrl} isCopyable={true} />
                )}
                <Button
                    onClick={publishSst}
                    variant="outline"
                    className="w-full rounded-md p-3"
                    disabled={isScreenshitDeploying}
                    id="publish-btn"
                >
                    {isScreenshitDeploying && (
                        <Icons.LoadingSpinner className="w-4 h-4 mr-2 animate-spin" />
                    )}
                    {isScreenshitDeploying ? 'Publishing...' : 'Publish'}
                </Button>
            </div>
        </div>
    );
});
