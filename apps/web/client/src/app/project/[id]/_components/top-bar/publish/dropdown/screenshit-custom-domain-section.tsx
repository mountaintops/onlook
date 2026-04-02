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

    if (txtName === hostname) return '@';

    if (txtName.endsWith('.' + hostname)) {
        return txtName.slice(0, -(hostname.length + 1));
    }

    const hostParts = hostname.split('.');
    if (hostParts.length >= 2) {
        const rootDomain = hostParts.slice(-2).join('.');
        if (txtName.endsWith('.' + rootDomain)) {
            return txtName.slice(0, -(rootDomain.length + 1));
        }
    }

    return txtName;
}

// A single copyable DNS row
const DnsRow = ({
    type,
    host,
    value,
    highlight,
}: {
    type: string;
    host: string;
    value: string;
    highlight?: 'yellow' | 'blue' | 'none';
}) => {
    const [copied, setCopied] = useState<'host' | 'value' | null>(null);

    const copy = (text: string, field: 'host' | 'value') => {
        navigator.clipboard.writeText(text).then(() => {
            setCopied(field);
            toast.success(`Copied ${field === 'host' ? 'Host' : 'Value'} to clipboard`);
            setTimeout(() => setCopied(null), 2000);
        });
    };

    const rowBg =
        highlight === 'yellow'
            ? 'bg-yellow-500/5'
            : highlight === 'blue'
              ? 'bg-blue-500/5'
              : '';

    return (
        <tr className={`border-b border-border/30 last:border-0 text-[10px] font-mono ${rowBg}`}>
            <td className="py-1.5 px-2 font-bold text-muted-foreground whitespace-nowrap align-middle">
                {type}
            </td>
            <td className="py-1.5 px-2 align-middle">
                <button
                    className="flex items-center gap-1 group cursor-pointer hover:text-foreground text-muted-foreground max-w-[80px] truncate"
                    title={`Click to copy: ${host}`}
                    onClick={() => copy(host, 'host')}
                >
                    <span className="truncate">{host}</span>
                    {copied === 'host' ? (
                        <Icons.Check className="w-2.5 h-2.5 text-green-400 shrink-0" />
                    ) : (
                        <Icons.Copy className="w-2.5 h-2.5 opacity-0 group-hover:opacity-100 shrink-0 transition-opacity" />
                    )}
                </button>
            </td>
            <td className="py-1.5 px-2 align-middle max-w-[120px]">
                <button
                    className="flex items-center gap-1 group cursor-pointer hover:text-foreground text-muted-foreground w-full"
                    title={`Click to copy: ${value}`}
                    onClick={() => copy(value, 'value')}
                >
                    <span className="truncate block">{value}</span>
                    {copied === 'value' ? (
                        <Icons.Check className="w-2.5 h-2.5 text-green-400 shrink-0" />
                    ) : (
                        <Icons.Copy className="w-2.5 h-2.5 opacity-0 group-hover:opacity-100 shrink-0 transition-opacity" />
                    )}
                </button>
            </td>
        </tr>
    );
};

// DNS Records Table
const DnsTable = ({
    rows,
}: {
    rows: Array<{ type: string; host: string; value: string; highlight?: 'yellow' | 'blue' | 'none' }>;
}) => {
    if (rows.length === 0) return null;
    return (
        <div className="rounded border border-border/40 overflow-hidden">
            <table className="w-full text-[10px]">
                <thead>
                    <tr className="bg-muted/30 border-b border-border/40">
                        <th className="py-1 px-2 text-left font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">
                            Type
                        </th>
                        <th className="py-1 px-2 text-left font-semibold text-muted-foreground uppercase tracking-wider">
                            Host / Name
                        </th>
                        <th className="py-1 px-2 text-left font-semibold text-muted-foreground uppercase tracking-wider">
                            Value (click to copy)
                        </th>
                    </tr>
                </thead>
                <tbody>
                    {rows.map((row, i) => (
                        <DnsRow key={i} {...row} />
                    ))}
                </tbody>
            </table>
        </div>
    );
};

export const ScreenshitCustomDomainItem = ({
    domainUrl,
    onRemove,
}: {
    domainUrl: string;
    onRemove: (hostname: string) => void;
}) => {
    const hostname = getHostname(domainUrl);
    const [shouldTrigger, setShouldTrigger] = useState(false);
    const {
        data: statusData,
        isLoading,
        refetch,
    } = api.publish.screenshit.customDomainStatus.useQuery(
        { customDomain: hostname, trigger: shouldTrigger },
        {
            enabled: !!hostname,
            refetchInterval: (query) => {
                const data = query.state.data;
                const isFullyActive = data?.status === 'active' && data?.sslStatus === 'active';
                return isFullyActive ? false : 10000;
            },
        },
    );

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
    const cnameHost =
        hostname.split('.').length > 2 ? hostname.split('.').slice(0, -2).join('.') : '@';

    // Build DNS rows
    const dnsRows = useMemo(() => {
        const rows: Array<{
            type: string;
            host: string;
            value: string;
            highlight?: 'yellow' | 'blue' | 'none';
        }> = [];

        if (!statusData?.status || statusData.status !== 'active') {
            rows.push({ type: 'CNAME', host: cnameHost, value: cnameTarget, highlight: 'none' });
        }

        if (statusData?.txtOwnership?.value && statusData.status !== 'active') {
            rows.push({
                type: 'TXT',
                host: ownershipDnsHost,
                value: statusData.txtOwnership.value,
                highlight: 'yellow',
            });
        }

        if (statusData?.txtSsl?.value && statusData.sslStatus !== 'active') {
            rows.push({
                type: 'TXT',
                host: sslDnsHost,
                value: statusData.txtSsl.value,
                highlight: isIssuing ? 'blue' : 'yellow',
            });
        }

        return rows;
    }, [statusData, cnameHost, cnameTarget, ownershipDnsHost, sslDnsHost, isIssuing]);

    return (
        <div className="flex flex-col gap-2 p-2 border border-border rounded text-xs bg-background">
            <div className="flex justify-between items-center">
                <UrlSection url={domainUrl} isCopyable={true} />
                <Button
                    variant="ghost"
                    size="icon"
                    className="h-4 w-4 text-destructive hover:bg-transparent"
                    onClick={() => onRemove(hostname)}
                >
                    <Icons.Trash className="h-3 w-3" />
                </Button>
            </div>

            {isLoading ? (
                <div className="text-muted-foreground flex items-center gap-1">
                    <Icons.LoadingSpinner className="h-3 w-3 animate-spin" /> Loading status...
                </div>
            ) : isActive ? (
                <div className="flex items-center gap-1 text-green-500 font-medium p-1">
                    <Icons.Check className="w-3 h-3" />
                    Active — SSL secured
                </div>
            ) : (
                <div
                    className={`flex flex-col gap-2 mt-1 p-2 rounded border ${isIssuing ? 'bg-blue-500/10 border-blue-500/20' : 'bg-yellow-500/10 border-yellow-500/20'}`}
                >
                    <div className="flex items-center justify-between">
                        <div
                            className={`flex items-center gap-1.5 font-semibold ${isIssuing ? 'text-blue-400' : 'text-yellow-500'}`}
                        >
                            {isIssuing ? (
                                <Icons.Check className="w-3 h-3" />
                            ) : (
                                <Icons.ExclamationTriangle className="w-3 h-3" />
                            )}
                            <span>
                                {isIssuing
                                    ? 'DNS Verified! Waiting for SSL...'
                                    : 'Verification Required'}
                            </span>
                        </div>
                        <Button
                            variant="ghost"
                            size="sm"
                            className="h-5 px-1 text-[10px]"
                            onClick={handleRefresh}
                            disabled={shouldTrigger}
                        >
                            {shouldTrigger ? 'Checking...' : 'Refresh'}
                        </Button>
                    </div>

                    {isIssuing && (
                        <p className="text-[10px] text-blue-200/70 leading-normal italic">
                            DNS is verified. Cloudflare is now issuing your security certificate.
                            This typically takes 2–5 minutes.
                        </p>
                    )}

                    {!isIssuing && (
                        <p className="text-[10px] text-muted-foreground leading-normal">
                            Add the following DNS records to your domain provider. Click any row to
                            copy the value.
                        </p>
                    )}

                    <DnsTable rows={dnsRows} />
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
        return sstDeployment.urls.filter(
            (url) =>
                !url.endsWith('.weliketech.eu.org') && !url.endsWith('.website.dpdns.org'),
        );
    }, [sstDeployment?.urls]);

    const handleAddDomain = async () => {
        if (!domainInput.trim()) return;

        const lambdaUrl =
            sstDeployment?.status === DeploymentStatus.COMPLETED ? sstDeployment.message : null;
        if (!lambdaUrl) {
            toast.error('You must publish the project first before adding a custom domain.');
            return;
        }

        setIsAssigning(true);
        try {
            await assignDomain({
                projectId: editorEngine.projectId,
                lambdaUrl,
                customDomain: domainInput.trim().toLowerCase(),
            });
            toast.success('Custom domain added! Please configure your DNS.');
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
            toast.error('Project ID not found');
            return;
        }

        setIsAssigning(true);
        console.log(`[domain] Removing ${domain} for project ${projectId}`);
        try {
            await removeDomain({
                projectId,
                customDomain: domain,
            });
            toast.success('Custom domain removed');
            refetch(DeploymentType.SCREENSHIT);
        } catch (err: any) {
            console.error('[domain] Failed to remove domain:', err);
            toast.error(err.message || 'Failed to remove domain');
        } finally {
            setIsAssigning(false);
        }
    };

    return (
        <div className="p-4 flex flex-col items-center gap-4">
            <div className="w-full flex flex-col gap-2">
                <div className="flex flex-row justify-between items-center px-1">
                    <h3 className="text-sm font-medium flex items-center gap-2">Custom Domain</h3>
                </div>

                <div className="space-y-2 mt-2">
                    {customDomains.length > 0 &&
                        customDomains.map((url) => (
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
                        {isAssigning ? (
                            <Icons.LoadingSpinner className="h-3 w-3 animate-spin" />
                        ) : (
                            'Add'
                        )}
                    </Button>
                </div>
            </div>
        </div>
    );
});
