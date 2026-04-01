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
    
    // If the txtName is EXACTLY the hostname, it's the root/apex
    if (txtName === hostname) return '@';

    // If txtName ends with .hostname, strip it
    if (txtName.endsWith('.' + hostname)) {
        return txtName.slice(0, -(hostname.length + 1));
    }

    // Heuristic for subdomains:
    // If txtName is _cf-custom-hostname.www.domain.com and hostname is www.domain.com
    // The zone is likely domain.com.
    const hostParts = hostname.split('.');
    if (hostParts.length >= 2) {
        const rootDomain = hostParts.slice(-2).join('.');
        if (txtName.endsWith('.' + rootDomain)) {
            return txtName.slice(0, -(rootDomain.length + 1));
        }
    }

    return txtName;
}

export const ScreenshitCustomDomainItem = ({ 
    domainUrl, 
    onRemove 
}: { 
    domainUrl: string;
    onRemove: (hostname: string) => void;
}) => {
    const hostname = getHostname(domainUrl);
    const [shouldTrigger, setShouldTrigger] = useState(false);
    const { data: statusData, isLoading, refetch } = api.publish.screenshit.customDomainStatus.useQuery(
        { customDomain: hostname, trigger: shouldTrigger },
        { 
            enabled: !!hostname, 
            refetchInterval: (query) => {
                const data = query.state.data;
                const isFullyActive = data?.status === 'active' && data?.sslStatus === 'active';
                return isFullyActive ? false : 10000;
            }
        }
    );

    // Reset trigger after a successful load
    React.useEffect(() => {
        if (shouldTrigger && statusData) {
            setShouldTrigger(false);
        }
    }, [statusData, shouldTrigger]);

    const handleRefresh = () => {
        setShouldTrigger(true);
        refetch();
    };

    const isActive = statusData?.status === 'active' && statusData?.sslStatus === 'active';
    const isIssuing = statusData?.status === 'active' && statusData?.sslStatus !== 'active';
    const isPending = !isActive && !isIssuing;

    const ownershipDnsHost = useMemo(() => {
        if (!statusData?.txtOwnership?.name) return '';
        return getDnsHost(statusData.txtOwnership.name, hostname);
    }, [statusData, hostname]);

    const sslDnsHost = useMemo(() => {
        if (!statusData?.txtSsl?.name) return '';
        return getDnsHost(statusData.txtSsl.name, hostname);
    }, [statusData, hostname]);

    const cnameTarget = statusData?.cnameTarget || 'proxy-fallback.weliketech.eu.org';

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
            ) : isIssuing || isPending ? (
                <div className={`flex flex-col gap-2 mt-2 p-2 rounded border ${isIssuing ? 'bg-blue-500/10 border-blue-500/20' : 'bg-yellow-500/10 border-yellow-500/20'}`}>
                    <div className="flex items-center justify-between">
                        <div className={`flex items-center gap-1.5 font-semibold ${isIssuing ? 'text-blue-400' : 'text-yellow-500'}`}>
                            {isIssuing ? <Icons.Check className="w-3 h-3" /> : <Icons.ExclamationTriangle className="w-3 h-3" />}
                            <span>{isIssuing ? 'DNS Verified! Waiting for SSL...' : 'Verification Required'}</span>
                        </div>
                        <Button variant="ghost" size="sm" className="h-5 px-1 text-[10px]" onClick={handleRefresh} disabled={shouldTrigger}>
                            {shouldTrigger ? 'Checking...' : 'Refresh'}
                        </Button>
                    </div>

                    {isIssuing && (
                         <p className="text-[10px] text-blue-200/70 leading-normal italic mb-1">
                            DNS is verified. Cloudflare is now issuing your security certificate. This typically takes 2-5 minutes.
                        </p>
                    )}
                    
                    <div className="flex flex-col gap-3 mt-1">
                        <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-3 font-mono text-[10px]">
                            {/* CNAME RECORD - Only show if not fully active */}
                            {(!statusData?.status || statusData.status !== 'active') && (
                                <>
                                    <span className="text-muted-foreground shrink-0 font-bold">CNAME</span>
                                    <div className="flex flex-col gap-1 overflow-hidden">
                                        <div className="flex flex-col gap-0.5">
                                            <span className="text-[9px] text-muted-foreground uppercase font-semibold">Host / Name:</span>
                                            <span className="font-bold text-foreground bg-black/40 px-1 rounded w-fit select-all">{hostname.split('.').length > 2 ? hostname.split('.').slice(0, -2).join('.') : '@'}</span>
                                        </div>
                                        <div className="mt-1">
                                            <span className="text-[9px] text-muted-foreground uppercase font-semibold">Target / Value:</span>
                                            <span className="text-muted-foreground truncate bg-black/20 p-1 rounded block select-all mt-0.5" title={cnameTarget}>{cnameTarget}</span>
                                        </div>
                                    </div>
                                </>
                            )}

                            {/* OWNERSHIP TXT RECORD - Only show if not active */}
                            {statusData?.txtOwnership?.value && statusData.status !== 'active' && (
                                <>
                                    <span className="text-muted-foreground shrink-0 border-t border-border/10 pt-2 font-bold">TXT</span>
                                    <div className="flex flex-col overflow-hidden gap-2 border-t border-border/10 pt-2">
                                        <div className="flex flex-col gap-0.5">
                                            <span className="text-[9px] text-yellow-500/70 uppercase font-semibold">Host / Name:</span>
                                            <span className="font-bold text-foreground bg-yellow-500/20 px-1 rounded w-fit select-all truncate max-w-full" title={statusData.txtOwnership.name}>{ownershipDnsHost}</span>
                                            <span className="text-[8px] text-muted-foreground italic truncate">Full: {statusData.txtOwnership.name}</span>
                                        </div>
                                        <div className="">
                                            <span className="text-[9px] text-muted-foreground uppercase font-semibold">Value:</span>
                                            <span className="text-muted-foreground break-all bg-black/20 p-1 rounded block select-all mt-0.5">{statusData.txtOwnership.value}</span>
                                        </div>
                                    </div>
                                </>
                            )}

                            {/* SSL TXT RECORD - Always show if available and SSL not active */}
                            {statusData?.txtSsl?.value && statusData.sslStatus !== 'active' && (
                                <>
                                    <span className="text-muted-foreground shrink-0 border-t border-border/10 pt-2 font-bold">TXT</span>
                                    <div className="flex flex-col overflow-hidden gap-2 border-t border-border/10 pt-2">
                                        <div className="flex flex-col gap-0.5">
                                            <span className={`text-[9px] uppercase font-semibold ${isIssuing ? 'text-blue-400/70' : 'text-yellow-500/70'}`}>Host / Name (SSL):</span>
                                            <span className={`font-bold text-foreground px-1 rounded w-fit select-all truncate max-w-full ${isIssuing ? 'bg-blue-500/20' : 'bg-yellow-500/20'}`} title={statusData.txtSsl.name}>{sslDnsHost}</span>
                                            <span className="text-[8px] text-muted-foreground italic truncate">Full: {statusData.txtSsl.name}</span>
                                        </div>
                                        <div className="">
                                            <span className="text-[9px] text-muted-foreground uppercase font-semibold">Value:</span>
                                            <span className="text-muted-foreground break-all bg-black/20 p-1 rounded block select-all mt-0.5">{statusData.txtSsl.value}</span>
                                        </div>
                                        <p className="text-[9px] text-muted-foreground/60 leading-tight">
                                            Note: If you already added this record, it may take a few minutes for Cloudflare to detect it.
                                        </p>
                                    </div>
                                </>
                            )}
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

export const ScreenshitCustomDomainSection = observer(() => {
    const editorEngine = useEditorEngine();
    const { deployments, refetch } = useHostingContext();
    const sstDeployment = deployments?.screenshit;
    
    const [domainInput, setDomainInput] = useState('');
    const [isAssigning, setIsAssigning] = useState(false);

    const { mutateAsync: assignDomain } = api.publish.screenshit.assignCustomDomain.useMutation();
    const { mutateAsync: removeDomain } = api.publish.screenshit.removeCustomDomain.useMutation();

    const customDomains = useMemo(() => {
        if (!sstDeployment?.urls) return [];
        return sstDeployment.urls.filter(url => !url.endsWith('.weliketech.eu.org'));
    }, [sstDeployment?.urls]);

    const handleAddDomain = async () => {
        if (!domainInput.trim()) return;
        
        const lambdaUrl = sstDeployment?.status === DeploymentStatus.COMPLETED ? sstDeployment.message : null;
        if (!lambdaUrl) {
            toast.error("You must publish the project first before adding a custom domain.");
            return;
        }

        setIsAssigning(true);
        try {
            await assignDomain({
                projectId: editorEngine.projectId,
                lambdaUrl,
                customDomain: domainInput.trim().toLowerCase(),
            });
            toast.success("Custom domain added! Please configure your DNS.");
            setDomainInput('');
            refetch(DeploymentType.SCREENSHIT);
        } catch (err: any) {
            toast.error(err.message || 'Failed to add custom domain');
        } finally {
            setIsAssigning(false);
        }
    };

    const handleRemoveDomain = async (domain: string) => {
        const projectId = editorEngine.projectId;
        if (!projectId) {
            toast.error("Project ID not found");
            return;
        }

        setIsAssigning(true);
        console.log(`[domain] Removing ${domain} for project ${projectId}`);
        try {
            await removeDomain({
                projectId,
                customDomain: domain,
            });
            toast.success("Custom domain removed");
            refetch(DeploymentType.SCREENSHIT);
        } catch (err: any) {
            console.error('[domain] Failed to remove domain:', err);
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
                        {isAssigning ? <Icons.LoadingSpinner className="h-3 w-3 animate-spin"/> : 'Add'}
                    </Button>
                </div>
            </div>
        </div>
    );
});
