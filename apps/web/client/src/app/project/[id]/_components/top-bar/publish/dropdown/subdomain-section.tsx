import { useEditorEngine } from '@/components/store/editor';
import { useHostingContext } from '@/components/store/hosting';
import { DeploymentStatus, DeploymentType } from '@onlook/models';
import { Button } from '@onlook/ui/button';
import { Icons } from '@onlook/ui/icons/index';
import { Input } from '@onlook/ui/input';
import { toast } from '@onlook/ui/sonner';
import { observer } from 'mobx-react-lite';
import { useState, useMemo, useCallback } from 'react';
import { api } from '@/trpc/react';
import { UrlSection } from './url';

const BASE_DOMAIN = 'weliketech.eu.org';

/**
 * Sanitise a string into a valid subdomain label.
 */
function sanitiseSubdomain(value: string): string {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 63);
}

export const SubdomainSection = observer(() => {
    const editorEngine = useEditorEngine();
    const { deployments } = useHostingContext();
    const [subdomainInput, setSubdomainInput] = useState('');
    const [isAssigning, setIsAssigning] = useState(false);
    const [isRemoving, setIsRemoving] = useState(false);
    const [assignedDomain, setAssignedDomain] = useState<string | null>(null);

    // Get the current screenshit deployment
    const sstDeployment = deployments?.screenshit;
    const sstUrl =
        sstDeployment?.status === DeploymentStatus.COMPLETED
            ? sstDeployment.message
            : null;

    // tRPC mutations
    const { mutateAsync: assignDomain } =
        api.publish.screenshit.assignDomain.useMutation();
    const { mutateAsync: removeDomain } =
        api.publish.screenshit.removeDomain.useMutation();

    // Derive a default subdomain from the project ID
    const defaultSubdomain = useMemo(
        () => sanitiseSubdomain(editorEngine.projectId || ''),
        [editorEngine.projectId],
    );

    const effectiveSubdomain = subdomainInput.trim()
        ? sanitiseSubdomain(subdomainInput.trim())
        : defaultSubdomain;

    const fullDomain = `${effectiveSubdomain}.${BASE_DOMAIN}`;
    const fullUrl = `https://${fullDomain}`;

    const handleAssign = useCallback(async () => {
        if (!sstUrl) {
            toast.error('No published Lambda URL found. Publish your project first.');
            return;
        }
        if (!effectiveSubdomain) {
            toast.error('Please enter a valid subdomain');
            return;
        }

        setIsAssigning(true);
        try {
            const result = await assignDomain({
                projectId: editorEngine.projectId,
                lambdaUrl: sstUrl,
                subdomain: effectiveSubdomain,
            });
            setAssignedDomain(`https://${result.fullDomain}`);
            toast.success('Subdomain assigned!', {
                description: `https://${result.fullDomain}`,
            });
        } catch (err) {
            toast.error('Failed to assign subdomain', {
                description: err instanceof Error ? err.message : 'Unknown error',
            });
        } finally {
            setIsAssigning(false);
        }
    }, [sstUrl, effectiveSubdomain, editorEngine.projectId, assignDomain]);

    const handleRemove = useCallback(async () => {
        setIsRemoving(true);
        try {
            await removeDomain({
                projectId: editorEngine.projectId,
                subdomain: effectiveSubdomain,
            });
            setAssignedDomain(null);
            toast.success('Subdomain removed');
        } catch (err) {
            toast.error('Failed to remove subdomain', {
                description: err instanceof Error ? err.message : 'Unknown error',
            });
        } finally {
            setIsRemoving(false);
        }
    }, [effectiveSubdomain, editorEngine.projectId, removeDomain]);

    const isWorking = isAssigning || isRemoving;

    return (
        <div className="p-4 flex flex-col gap-2">
            <div className="flex flex-row justify-between items-center px-1">
                <h3 className="text-sm font-medium">Custom Subdomain</h3>
            </div>

            {/* Show assigned domain URL */}
            {assignedDomain && (
                <UrlSection url={assignedDomain} isCopyable={true} />
            )}

            {/* Subdomain input */}
            <div className="flex items-center gap-1">
                <Input
                    type="text"
                    className="flex-1 h-8 text-xs font-mono"
                    placeholder={defaultSubdomain || 'my-project'}
                    value={subdomainInput}
                    onChange={(e) => setSubdomainInput(e.target.value)}
                    disabled={isWorking}
                    id="subdomain-input"
                />
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                    .{BASE_DOMAIN}
                </span>
            </div>

            {/* Preview */}
            {effectiveSubdomain && (
                <p className="text-xs text-muted-foreground px-1 truncate">
                    → {fullUrl}
                </p>
            )}

            {/* Actions */}
            <div className="flex gap-2">
                <Button
                    onClick={handleAssign}
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    disabled={isWorking || !sstUrl}
                    id="assign-subdomain-btn"
                >
                    {isAssigning && (
                        <Icons.LoadingSpinner className="w-3 h-3 mr-1.5 animate-spin" />
                    )}
                    {isAssigning ? 'Assigning…' : 'Assign'}
                </Button>
                {assignedDomain && (
                    <Button
                        onClick={handleRemove}
                        variant="ghost"
                        size="sm"
                        disabled={isWorking}
                        id="remove-subdomain-btn"
                    >
                        {isRemoving && (
                            <Icons.LoadingSpinner className="w-3 h-3 mr-1.5 animate-spin" />
                        )}
                        Remove
                    </Button>
                )}
            </div>

            {/* Hint when no deployment exists */}
            {!sstUrl && (
                <p className="text-xs text-muted-foreground px-1">
                    Publish your project first to assign a subdomain.
                </p>
            )}
        </div>
    );
});
