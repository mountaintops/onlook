import { useEditorEngine } from '@/components/store/editor';
import { useHostingContext } from '@/components/store/hosting';
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
import { toast } from '@onlook/ui/sonner';
import { observer } from 'mobx-react-lite';

export const DangerZone = observer(() => {
    const editorEngine = useEditorEngine();
    const { deleteScreenshit, isScreenshitDeleting, deployments, refetch } = useHostingContext();

    const handleSstDelete = async () => {
        await deleteScreenshit(editorEngine.projectId);
        refetch(DeploymentType.SCREENSHIT);
    };

    return (
        <div className="flex flex-col gap-4">
            <h2 className="text-lg">Danger Zone</h2>
            <div className="flex flex-col gap-4">
                <div className="flex flex-row gap-2 items-center">
                    <div className="flex flex-col gap-0.5">
                        <p className="text-sm font-medium">Publish</p>
                        <p className="text-xs text-muted-foreground">
                            Permanently remove the published infrastructure for this project.
                        </p>
                    </div>
                    <AlertDialog>
                        <AlertDialogTrigger asChild>
                            <Button
                                className="ml-auto shrink-0"
                                size="sm"
                                variant="destructive"
                                disabled={isScreenshitDeleting || deployments?.screenshit?.status !== DeploymentStatus.COMPLETED}
                                id="publish-delete-btn"
                            >
                                {isScreenshitDeleting && <Icons.LoadingSpinner className="w-4 h-4 mr-2 animate-spin" />}
                                {isScreenshitDeleting ? 'Deleting...' : 'Delete Published Site'}
                            </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                            <AlertDialogHeader>
                                <AlertDialogTitle>Delete Published Site?</AlertDialogTitle>
                                <AlertDialogDescription>
                                    This will permanently remove the published infrastructure for project{' '}
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
