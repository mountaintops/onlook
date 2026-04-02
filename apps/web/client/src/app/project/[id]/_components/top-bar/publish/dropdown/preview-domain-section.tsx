import { useEditorEngine } from '@/components/store/editor';
import { useHostingContext } from '@/components/store/hosting';
import { DeploymentStatus, DeploymentType } from '@onlook/models';
import { Button } from '@onlook/ui/button';
import { Icons } from '@onlook/ui/icons/index';
import { Input } from '@onlook/ui/input';
import { Checkbox } from '@onlook/ui/checkbox';
import { Label } from '@onlook/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@onlook/ui/select';
import { toast } from '@onlook/ui/sonner';
import { observer } from 'mobx-react-lite';
import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { UrlSection } from './url';
import { api } from '@/trpc/react';

const AVAILABLE_DOMAINS = [
    { value: 'weliketech.eu.org', label: '.weliketech.eu.org' },
    { value: 'website.dpdns.org', label: '.website.dpdns.org' },
];

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

    const isPublished = !!assignedDomain;

    const [subdomainInput, setSubdomainInput] = useState('');
    const [selectedDomain, setSelectedDomain] = useState(AVAILABLE_DOMAINS[0]?.value ?? 'weliketech.eu.org');
    const [selectedBranchId, setSelectedBranchId] = useState<string>('');
    const [isAssigning, setIsAssigning] = useState(false);

    // Persist auto-update across popup open/close via MobX state
    const autoUpdate = editorEngine.state.autoUpdatePublish;
    const setAutoUpdate = (v: boolean) => { editorEngine.state.autoUpdatePublish = v; };

    // Keep a ref to the latest publishSst so useCallback always calls the fresh version
    const publishSstRef = useRef<() => Promise<void>>(async () => {});

    // tRPC mutations
    const { mutateAsync: assignDomain } = api.publish.screenshit.assignDomain.useMutation();
    const { mutateAsync: removeDomain } = api.publish.screenshit.removeDomain.useMutation();

    // Set default branch from active branch
    useEffect(() => {
        if (!selectedBranchId && editorEngine.branches?.activeBranch?.id) {
            setSelectedBranchId(editorEngine.branches.activeBranch.id);
        }
    }, [editorEngine.branches?.activeBranch?.id]);

    // Generate a default subdomain when user data is available
    useEffect(() => {
        if (user && !subdomainInput && !assignedDomain) {
            const name = user.firstName || user.displayName || 'user';
            const random = Math.floor(Math.random() * 9000) + 1000;
            setSubdomainInput(sanitiseSubdomain(`${name}-${random}`));
        }
    }, [user, assignedDomain]);

    // If we have an assigned domain, pre-fill the subdomain label and detect the domain suffix
    useEffect(() => {
        if (assignedDomain) {
            try {
                const url = new URL(assignedDomain);
                const hostname = url.hostname;

                // Detect which of the available domains this belongs to
                for (const d of AVAILABLE_DOMAINS) {
                    if (hostname.endsWith('.' + d.value)) {
                        setSelectedDomain(d.value);
                        const label = hostname.slice(0, -(d.value.length + 1));
                        setSubdomainInput(label || '');
                        return;
                    }
                }

                // Fallback: just use the first label
                const label = hostname.split('.')[0];
                setSubdomainInput(label || '');
            } catch (e) {
                console.error('Failed to parse assigned domain', e);
            }
        }
    }, [assignedDomain]);


    // Debounce subdomain input for status check
    const [debouncedSubdomain, setDebouncedSubdomain] = useState(subdomainInput);
    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedSubdomain(subdomainInput);
        }, 500);
        return () => clearTimeout(timer);
    }, [subdomainInput]);

    const { data: domainStatus } = api.publish.screenshit.domainStatus.useQuery(
        { subdomain: sanitiseSubdomain(debouncedSubdomain) },
        {
            enabled:
                debouncedSubdomain.length > 0 &&
                debouncedSubdomain !==
                    (assignedDomain
                        ? (() => {
                              try {
                                  const h = new URL(assignedDomain).hostname;
                                  for (const d of AVAILABLE_DOMAINS) {
                                      if (h.endsWith('.' + d.value))
                                          return h.slice(0, -(d.value.length + 1));
                                  }
                                  return h.split('.')[0];
                              } catch {
                                  return '';
                              }
                          })()
                        : ''),
        },
    );

    const isConflict = useMemo(() => {
        if (!domainStatus?.cloudflare) {
            return false;
        }
        if (assignedDomain) {
            try {
                const assignedHostname = new URL(assignedDomain).hostname;
                return domainStatus.hostname !== assignedHostname;
            } catch (e) {
                return true;
            }
        }
        return true;
    }, [domainStatus, assignedDomain]);

    const effectiveSubdomain = subdomainInput.trim() ? sanitiseSubdomain(subdomainInput.trim()) : '';
    const fullDomain = `${effectiveSubdomain}.${selectedDomain}`;
    const fullUrl = `https://${fullDomain}`;

    // Resolve sandbox from the selected branch
    const resolvedSandboxId = useMemo(() => {
        if (!editorEngine.branches?.allBranches) return editorEngine.branches?.activeBranch?.sandbox?.id;
        const branch = editorEngine.branches.allBranches.find((b: any) => b.id === selectedBranchId);
        return branch?.sandbox?.id ?? editorEngine.branches?.activeBranch?.sandbox?.id;
    }, [selectedBranchId, editorEngine.branches?.allBranches, editorEngine.branches?.activeBranch]);

    const publishSst = useCallback(async (): Promise<void> => {
        const sandboxId = resolvedSandboxId;
        if (!sandboxId) {
            toast.error('No active sandbox found for publish');
            return;
        }

        try {
            const deployResult = await deployScreenshit(
                editorEngine.projectId,
                sandboxId,
                isPublished,
                effectiveSubdomain,
                isPublished,
            );

            if (!deployResult?.url) {
                throw new Error('Deployment failed - no URL returned');
            }

            toast.success(isPublished ? 'Site updated!' : 'Project published!');
        } catch (err) {
            toast.error(isPublished ? 'Update failed' : 'Publishing failed', {
                description: err instanceof Error ? err.message : 'Unknown error',
            });
        } finally {
            setIsAssigning(false);
            refetch(DeploymentType.SCREENSHIT);
        }
    }, [deployScreenshit, editorEngine.projectId, resolvedSandboxId, effectiveSubdomain, isPublished, refetch]);

    // Keep the ref up-to-date so the reaction always calls the latest version
    useEffect(() => {
        publishSstRef.current = publishSst;
    }, [publishSst]);

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
    const allBranches = editorEngine.branches?.allBranches ?? [];

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

                {/* Branch selector */}
                {allBranches.length > 1 && (
                    <div className="space-y-1.5 mt-1">
                        <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold px-1">
                            Branch
                        </label>
                        <Select
                            value={selectedBranchId}
                            onValueChange={setSelectedBranchId}
                            disabled={isWorking}
                        >
                            <SelectTrigger className="h-8 text-xs">
                                <SelectValue placeholder="Select branch" />
                            </SelectTrigger>
                            <SelectContent>
                                {allBranches.map((branch: any) => (
                                    <SelectItem key={branch.id} value={branch.id} className="text-xs">
                                        <span className="flex items-center gap-2">
                                            <Icons.Branch className="w-3 h-3 text-muted-foreground" />
                                            {branch.name}
                                        </span>
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                )}

                {/* Subdomain input + domain selector */}
                <div className="space-y-1.5 mt-2">
                    <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold px-1">
                        Subdomain
                    </label>
                    <div className="flex items-center gap-1">
                        <Input
                            type="text"
                            className="flex-1 h-8 text-xs font-mono min-w-0"
                            placeholder="my-subdomain"
                            value={subdomainInput}
                            onChange={(e) => setSubdomainInput(e.target.value)}
                            disabled={isWorking}
                        />
                        <Select
                            value={selectedDomain}
                            onValueChange={setSelectedDomain}
                            disabled={isWorking}
                        >
                            <SelectTrigger className="h-8 text-xs w-auto shrink-0 font-mono px-2">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent align="end">
                                {AVAILABLE_DOMAINS.map((d) => (
                                    <SelectItem key={d.value} value={d.value} className="text-xs font-mono">
                                        {d.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    {isConflict && (
                        <div className="flex items-center gap-1.5 px-1 mt-1 text-[10px] text-yellow-500 font-medium">
                            <Icons.ExclamationTriangle className="w-3 h-3" />
                            <span>This subdomain is already in use by another project</span>
                        </div>
                    )}
                    {effectiveSubdomain && !assignedDomain && !isConflict && (
                        <p className="text-[10px] text-muted-foreground px-1 truncate">
                            → {fullUrl}
                        </p>
                    )}
                </div>

                {/* Auto-update checkbox */}
                <div className="flex items-center space-x-2 px-1 mt-1">
                    <Checkbox
                        id="auto-update"
                        checked={autoUpdate}
                        onCheckedChange={(checked) => setAutoUpdate(!!checked)}
                        disabled={isWorking || !isPublished}
                    />
                    <Label
                        htmlFor="auto-update"
                        className="text-[10px] text-muted-foreground cursor-pointer"
                    >
                        Auto-update — redeploy when code changes
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
                    {isWorking ? (isPublished ? 'Updating...' : 'Publishing...') : isPublished ? 'Update' : 'Publish'}
                </Button>
            </div>
        </div>
    );
});
