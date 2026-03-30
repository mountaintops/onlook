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
        { enabled: !!hostname, refetchInterval: (query) => query.state.data?.cloudflare?.status === 'active' ? false : 10000 }
    );

    const isPending = statusData?.cloudflare?.status !== 'active';
    const txtName = statusData?.cloudflare?.ownership_verification?.name;
    const txtValue = statusData?.cloudflare?.ownership_verification?.value;
    // CNAME will always be proxy-fallback.weliketech.eu.org based on our screenshit config
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
            ) : isPending ? (
                <div className="flex flex-col gap-2 mt-2 bg-yellow-500/10 p-2 rounded border border-yellow-500/20">
                    <div className="flex items-center gap-2">
                        <Icons.ExclamationTriangle className="w-3 h-3 text-yellow-500" />
                        <span className="font-semibold text-yellow-500">Pending Verification</span>
                        <Button variant="ghost" size="sm" className="h-5 text-[10px] ml-auto" onClick={() => refetch()}>
                            Refresh
                        </Button>
                    </div>
                    <p className="text-muted-foreground text-[10px]">Add these DNS records to your domain provider to verify ownership and route traffic:</p>
                    <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 font-mono text-[10px]">
                        <span className="text-foreground shrink-0 font-bold">Type</span>
                        <span className="text-foreground font-bold">Name / Target</span>

                        <span className="text-muted-foreground shrink-0 mt-1">TXT</span>
                        <div className="flex flex-col overflow-hidden mt-1 gap-1">
                            <span className="truncate" title={txtName}>{txtName}</span>
                            <span className="text-muted-foreground break-all bg-black/20 p-1 rounded selection:bg-blue-500/30">{txtValue}</span>
                        </div>

                        <span className="text-muted-foreground shrink-0 mt-2">CNAME<br/><span className="text-[8px]">(or ALIAS/ANAME for root domains)</span></span>
                        <div className="flex flex-col mt-2 gap-1 overflow-hidden">
                            <span>@ or www</span>
                            <span className="text-muted-foreground truncate bg-black/20 p-1 rounded selection:bg-blue-500/30" title={cnameTarget}>{cnameTarget}</span>
                        </div>
                    </div>
                </div>
            ) : (
                <div className="flex items-center gap-1 text-green-500 font-medium">
                    <Icons.CheckCircled className="w-3 h-3" />
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
