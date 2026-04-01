import { useEditorEngine } from '@/components/store/editor';
import { useHostingContext } from '@/components/store/hosting';
import { DeploymentStatus, DeploymentType } from '@onlook/models';
import { Button } from '@onlook/ui/button';
import { Icons } from '@onlook/ui/icons/index';
import { Input } from '@onlook/ui/input';
import { toast } from '@onlook/ui/sonner';
import { observer } from 'mobx-react-lite';
import { useState, useMemo } from 'react';
import { UrlSection } from './url';
import { api } from '@/trpc/react';
import React from 'react';

// Extract the hostname from a full URL
function getHostname(urlStr: string) {
    try {
        const url = new URL(urlStr);
        return url.hostname;
    } catch {
        return urlStr;
    }
}

// Extract the "Host" part for DNS providers like GoDaddy/Namecheap
function getDnsHost(txtName: string, hostname: string) {
    if (!txtName || !hostname) return txtName;
    // GoDaddy usually manages the root domain (last two parts)
    const parts = hostname.split('.');
    if (parts.length < 2) return txtName;
    const rootDomain = parts.slice(-2).join('.');
    if (txtName.endsWith('.' + rootDomain)) {
        return txtName.slice(0, -(rootDomain.length + 1));
    }
    return txtName;
}

export const ScreenshitCustomDomainItem = ({ 
    domainUrl, 
    onRemove 
}: { 
    domainUrl: string; 
    onRemove: (domain: string) => void; 
}) => {
    const hostname = getHostname(domainUrl);
    const { data: statusData, isLoading, refetch } = api.publish.screenshit.customDomainStatus.useQuery(
        { customDomain: hostname },
        { enabled: !!hostname, refetchInterval: (query) => query.state.data?.status === 'active' ? false : 10000 }
    );

    const isIssuing = statusData?.status === 'issuing_certificate';
    const isPending = statusData?.status !== 'active' && !isIssuing;

    const dnsHost = useMemo(() => {
        if (!statusData?.cloudflare?.ownership_verification?.name) return '';
        return getDnsHost(statusData.cloudflare.ownership_verification.name, hostname);
    }, [statusData, hostname]);

    const txtValue = statusData?.cloudflare?.ownership_verification?.value;
    const cnameTarget = 'proxy-fallback.weliketech.eu.org';

    return (
        <div className="flex flex-col gap-2 p-2 border border-border rounded text-xs bg-background">
            <div className="flex justify-between items-center">
                <UrlSection url={domainUrl} isCopyable={true} />
                <Button variant="ghost" size="icon" className="h-4 w-4 text-destructive hover:bg-transparent" onClick={() => onRemove(hostname)}>
                    <Icons.Trash className="h-3 w-3" />
                </Button>
            </div>
            
            {isLoading ? (
                <div className="text-muted-foreground flex items-center gap-1">
                    <Icons.LoadingSpinner className="h-3 w-3 animate-spin"/> Loading status...
                </div>
            ) : isIssuing ? (
                <div className="flex flex-col gap-2 mt-1 p-2 rounded-sm bg-blue-500/10 border border-blue-500/20">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5 font-medium text-blue-400">
                            <Icons.Check className="w-3 h-3" />
                            <span>DNS Verified!</span>
                        </div>
                        <Button variant="ghost" size="sm" className="h-5 px-1 text-[10px]" onClick={() => refetch()}>
                            Refresh
                        </Button>
                    </div>
                    <p className="text-[10px] text-blue-200/70 leading-normal italic">
                        Success! Cloudflare is now issuing your security certificate (SSL). This typically takes 2-5 minutes.
                    </p>
                </div>
            ) : isPending ? (
                <div className="flex flex-col gap-2 mt-2 bg-yellow-500/10 p-2 rounded border border-yellow-500/20">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5 font-semibold text-yellow-500">
                            <Icons.ExclamationTriangle className="w-3 h-3" />
                            <span>Verification Required</span>
                        </div>
                        <Button variant="ghost" size="sm" className="h-5 px-1 text-[10px]" onClick={() => refetch()}>
                            Refresh
                        </Button>
                    </div>
                    
                    <div className="flex flex-col gap-3 mt-1">
                        <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 font-mono text-[10px]">
                            <span className="text-muted-foreground shrink-0">TXT</span>
                            <div className="flex flex-col overflow-hidden gap-1">
                                <div className="flex flex-col gap-0.5">
                                    <span className="text-[9px] text-yellow-500/70">GoDaddy Host:</span>
                                    <span className="font-bold text-foreground bg-yellow-500/20 px-1 rounded w-fit select-all">{dnsHost}</span>
                                </div>
                                <div className="mt-1">
                                    <span className="text-[9px] text-muted-foreground">Value:</span>
                                    <span className="text-muted-foreground break-all bg-black/20 p-1 rounded block select-all mt-0.5">{txtValue}</span>
                                </div>
                            </div>

                            <span className="text-muted-foreground shrink-0 border-t border-yellow-500/10 pt-2">CNAME</span>
                            <div className="flex flex-col gap-1 overflow-hidden border-t border-yellow-500/10 pt-2">
                                <span className="text-[9px] text-muted-foreground">Target:</span>
                                <span className="text-muted-foreground truncate bg-black/20 p-1 rounded block mt-0.5 select-all" title={cnameTarget}>{cnameTarget}</span>
                            </div>
                        </div>
                    </div>
                </div>
            ) : (
                <div className="flex items-center gap-1 text-green-500 font-medium p-1">
                    <Icons.Check className="w-3 h-3" />
                    Active
                </div>
            )}
        </div>
    );
};

/** State for a pending same-user domain conflict awaiting confirmation. */
interface DomainConflict {
    domain: string;
    lambdaUrl: string;
    conflictingProjectId: string;
}

export const ScreenshitCustomDomainSection = observer(() => {
    const editorEngine = useEditorEngine();
    const { deployments, refetch } = useHostingContext();
    const sstDeployment = deployments?.screenshit;

    const [domainInput, setDomainInput] = useState('');
    const [isAssigning, setIsAssigning] = useState(false);
    /** Set when the API returns conflict: true (same user owns the domain elsewhere). */
    const [pendingConflict, setPendingConflict] = useState<DomainConflict | null>(null);

    const { mutateAsync: setupDomain } = api.publish.screenshit.setupCustomDomain.useMutation();
    const { mutateAsync: removeDomain } = api.publish.screenshit.removeCustomDomain.useMutation();

    const customDomains = useMemo(() => {
        if (!sstDeployment?.urls) return [];
        return sstDeployment.urls.filter(url => !url.endsWith('.weliketech.eu.org'));
    }, [sstDeployment?.urls]);

    const getLambdaUrl = () => {
        const url = sstDeployment?.status === DeploymentStatus.COMPLETED ? sstDeployment.message : null;
        if (!url) {
            toast.error("You must publish the project first before adding a custom domain.");
        }
        return url;
    };

    const handleAddDomain = async () => {
        if (!domainInput.trim()) return;
        const lambdaUrl = getLambdaUrl();
        if (!lambdaUrl) return;

        setIsAssigning(true);
        try {
            const result = await setupDomain({
                projectId: editorEngine.projectId,
                customDomain: domainInput.trim().toLowerCase(),
            });

            if ('conflict' in result && result.conflict && result.ownedByCurrentUser) {
                // Same user already uses this domain on another project — show opt-in prompt
                setPendingConflict({
                    domain: domainInput.trim().toLowerCase(),
                    lambdaUrl,
                    conflictingProjectId: result.conflictingProjectId,
                });
                return;
            }

            if ('conflict' in result && !result.conflict) {
                const { status, sslStatus } = result;
                if (status === 'active' && sslStatus === 'active') {
                    toast.success("Domain already verified! Re-deploy your project to activate it.");
                } else {
                    toast.success("Domain setup started! Configure your DNS records below, then re-deploy to activate.");
                }
            }
            setDomainInput('');
            refetch(DeploymentType.SCREENSHIT);
        } catch (err: any) {
            toast.error(err.message || 'Failed to set up custom domain');
        } finally {
            setIsAssigning(false);
        }
    };

    /** User confirmed they want to migrate the domain away from the old project. */
    const handleConfirmMigrate = async () => {
        if (!pendingConflict) return;
        setIsAssigning(true);
        try {
            // Init the CF hostname (idempotent) then ask user to re-deploy with removeOld
            await setupDomain({
                projectId: editorEngine.projectId,
                customDomain: pendingConflict.domain,
            });
            toast.success(`Domain setup complete! Re-deploy your project with "Remove old" to migrate it.`);
            setDomainInput('');
            setPendingConflict(null);
            refetch(DeploymentType.SCREENSHIT);
        } catch (err: any) {
            toast.error(err.message || 'Failed to migrate domain');
        } finally {
            setIsAssigning(false);
        }
    };

    const handleCancelConflict = () => {
        setPendingConflict(null);
        setIsAssigning(false);
    };

    const handleRemoveDomain = async (domain: string) => {
        setIsAssigning(true);
        try {
            await removeDomain({
                projectId: editorEngine.projectId,
                customDomain: domain,
            });
            toast.success("Custom domain removed");
            refetch(DeploymentType.SCREENSHIT);
        } catch (err: any) {
            toast.error(err.message || "Failed to remove domain");
        } finally {
            setIsAssigning(false);
        }
    };

    return (
        <div className="p-4 flex flex-col items-center gap-4">
            <div className="w-full flex flex-col gap-2">
                <div className="flex flex-row justify-between items-center px-1">
                    <h3 className="text-sm font-medium flex items-center gap-2">
                        Custom Domain
                    </h3>
                </div>

                <div className="space-y-2 mt-2">
                    {customDomains.length > 0 && customDomains.map(url => (
                        <ScreenshitCustomDomainItem
                            key={url}
                            domainUrl={url}
                            onRemove={handleRemoveDomain}
                        />
                    ))}
                </div>

                {/* Same-user conflict confirmation panel */}
                {pendingConflict ? (
                    <div className="mt-2 p-3 rounded border border-yellow-500/30 bg-yellow-500/10 flex flex-col gap-3">
                        <div className="flex items-start gap-2">
                            <Icons.ExclamationTriangle className="w-3.5 h-3.5 text-yellow-500 shrink-0 mt-0.5" />
                            <p className="text-xs text-foreground leading-normal">
                                <span className="font-semibold text-yellow-400">{pendingConflict.domain}</span>
                                {' '}is already connected to one of your other projects.
                                Do you want to move it to this project instead?
                            </p>
                        </div>
                        <p className="text-[10px] text-muted-foreground leading-normal pl-5">
                            The domain will be removed from project{' '}
                            <span className="font-mono text-foreground/70">{pendingConflict.conflictingProjectId}</span>
                            {' '}and reassigned here.
                        </p>
                        <div className="flex gap-2 justify-end">
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 text-xs"
                                onClick={handleCancelConflict}
                                disabled={isAssigning}
                            >
                                Cancel
                            </Button>
                            <Button
                                variant="default"
                                size="sm"
                                className="h-7 text-xs bg-yellow-600 hover:bg-yellow-700 text-white"
                                onClick={handleConfirmMigrate}
                                disabled={isAssigning}
                            >
                                {isAssigning
                                    ? <Icons.LoadingSpinner className="h-3 w-3 animate-spin" />
                                    : 'Move Domain'}
                            </Button>
                        </div>
                    </div>
                ) : (
                    <div className="flex gap-2 items-center w-full mt-2">
                        <Input
                            type="text"
                            className="flex-1 h-8 text-xs bg-background"
                            placeholder="yourdomain.com"
                            value={domainInput}
                            onChange={(e) => setDomainInput(e.target.value)}
                            disabled={isAssigning}
                            onKeyDown={(e) => e.key === 'Enter' && handleAddDomain()}
                        />
                        <Button
                            variant="secondary"
                            size="sm"
                            className="h-8"
                            onClick={handleAddDomain}
                            disabled={isAssigning || !domainInput.trim()}
                        >
                            {isAssigning ? <Icons.LoadingSpinner className="h-3 w-3 animate-spin" /> : 'Add'}
                        </Button>
                    </div>
                )}
            </div>
        </div>
    );
});
