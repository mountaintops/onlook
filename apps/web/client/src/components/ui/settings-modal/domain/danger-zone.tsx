import { useEditorEngine } from '@/components/store/editor';
import { useHostingContext, useHostingType } from '@/components/store/hosting';
import { api } from '@/trpc/react';
import { DeploymentStatus, DeploymentType } from '@onlook/models/hosting';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from '@onlook/ui/alert-dialog';
import { Button } from '@onlook/ui/button';
import { Icons } from '@onlook/ui/icons/index';
import { Separator } from '@onlook/ui/separator';
import { toast } from '@onlook/ui/sonner';
import { observer } from 'mobx-react-lite';

export const DangerZone = observer(() => {
    const editorEngine = useEditorEngine();

    const { data: domains } = api.domain.getAll.useQuery({ projectId: editorEngine.projectId });
    const { deployment: unpublishPreviewDeployment, unpublish: runUnpublishPreview } = useHostingType(DeploymentType.UNPUBLISH_PREVIEW);
    const { deployment: unpublishCustomDeployment, unpublish: runUnpublishCustom } = useHostingType(DeploymentType.UNPUBLISH_CUSTOM);
    const { deleteScreenshit, isScreenshitDeleting, deployments, refetch } = useHostingContext();

    const previewDomain = domains?.preview;
    const customDomain = domains?.published;

    const unpublish = async (type: DeploymentType) => {
        let unpublishResponse: {
            deploymentId: string;
        } | null = null;
        if (type === DeploymentType.UNPUBLISH_PREVIEW) {
            unpublishResponse = await runUnpublishPreview(editorEngine.projectId);
        } else {
            unpublishResponse = await runUnpublishCustom(editorEngine.projectId);
        }

        if (unpublishResponse) {
            toast.success('Project is being unpublished', {
                description: 'Deployment ID: ' + unpublishResponse.deploymentId,
            });
        } else {
            toast.error('Failed to unpublish project', {
                description: 'Please try again.',
            });
        }
    };

    const handleSstDelete = async () => {
        await deleteScreenshit(editorEngine.projectId);
        // Refetch the screenshit deployment so the UI reflects it's been deleted
        refetch(DeploymentType.SCREENSHIT);
    };

    return (
        <div className="flex flex-col gap-4">
            <h2 className="text-lg">Danger Zone</h2>
            <div className="flex flex-col gap-4">
                {/* Freestyle unpublish — preview */}
                <div className="flex flex-row gap-2 items-center">
                    <p className="text-sm text-muted-foreground">
                        {!previewDomain
                            ? 'Your domain is not published'
                            : `Unpublish from ${previewDomain.url}`}
                    </p>
                    <Button
                        onClick={() => {
                            if (previewDomain) {
                                unpublish(DeploymentType.UNPUBLISH_PREVIEW);
                            }
                        }}
                        className="ml-auto"
                        size="sm"
                        variant="destructive"
                        disabled={!previewDomain || unpublishPreviewDeployment?.status === DeploymentStatus.IN_PROGRESS}
                    >
                        {unpublishPreviewDeployment?.status === DeploymentStatus.IN_PROGRESS ? 'Unpublishing...' : 'Unpublish'}
                    </Button>
                </div>

                {/* Freestyle unpublish — custom domain */}
                {customDomain && (
                    <div className="flex flex-row gap-2 items-center">
                        <p className="text-sm text-muted-foreground">
                            Unpublish from {customDomain.url}
                        </p>
                        <Button
                            onClick={() => unpublish(DeploymentType.UNPUBLISH_CUSTOM)}
                            className="ml-auto"
                            size="sm"
                            variant="destructive"
                            disabled={!customDomain || unpublishCustomDeployment?.status === DeploymentStatus.IN_PROGRESS}
                        >
                            {unpublishCustomDeployment?.status === DeploymentStatus.IN_PROGRESS ? 'Unpublishing...' : 'Unpublish'}
                        </Button>
                    </div>
                )}

                {/* ── SST / Screenshit delete section ── */}
                <Separator />
                <div className="flex flex-row gap-2 items-center">
                    <div className="flex flex-col gap-0.5">
                        <p className="text-sm font-medium">SST Deployment</p>
                        <p className="text-xs text-muted-foreground">
                            Permanently remove the SST infrastructure for this project.
                        </p>
                    </div>
                    <AlertDialog>
                        <AlertDialogTrigger asChild>
                            <Button
                                className="ml-auto shrink-0"
                                size="sm"
                                variant="destructive"
                                disabled={isScreenshitDeleting || deployments?.screenshit?.status !== DeploymentStatus.COMPLETED}
                                id="sst-delete-btn"
                            >
                                {isScreenshitDeleting && <Icons.LoadingSpinner className="w-4 h-4 mr-2 animate-spin" />}
                                {isScreenshitDeleting ? 'Deleting...' : 'Delete SST Deploy'}
                            </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                            <AlertDialogHeader>
                                <AlertDialogTitle>Delete SST Deployment?</AlertDialogTitle>
                                <AlertDialogDescription>
                                    This will permanently remove the SST infrastructure for project{' '}
                                    <strong>{editorEngine.projectId}</strong>. This action cannot be
                                    undone.
                                </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                    onClick={handleSstDelete}
                                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                >
                                    Yes, delete it
                                </AlertDialogAction>
                            </AlertDialogFooter>
                        </AlertDialogContent>
                    </AlertDialog>
                </div>
            </div>
        </div>
    );
});
