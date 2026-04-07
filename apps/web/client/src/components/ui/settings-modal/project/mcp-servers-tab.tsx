'use client';

import { useEditorEngine } from '@/components/store/editor';
import { api } from '@/trpc/react';
import { McpTransportType, type McpServerConfig } from '@onlook/models';
import { Button } from '@onlook/ui/button';
import { Input } from '@onlook/ui/input';
import { Label } from '@onlook/ui/label';
import { Switch } from '@onlook/ui/switch';
import { toast } from '@onlook/ui/sonner';
import { Icons } from '@onlook/ui/icons';
import { cn } from '@onlook/ui/utils';
import { observer } from 'mobx-react-lite';
import { useEffect, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';

const EMPTY_SERVER: Omit<McpServerConfig, 'id'> = {
    name: '',
    enabled: true,
    transport: McpTransportType.STREAMABLE_HTTP,
    url: '',
    headers: {},
    oauth: undefined,
};

export const McpServersTab = observer(() => {
    const editorEngine = useEditorEngine();
    const projectId = editorEngine.projectId;

    const [servers, setServers] = useState<McpServerConfig[]>([]);
    const [editingServer, setEditingServer] = useState<McpServerConfig | null>(null);
    const [isAdding, setIsAdding] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [headersText, setHeadersText] = useState('');
    const [enableOAuth, setEnableOAuth] = useState(false);

    const { data: settings, refetch } = api.settings.get.useQuery(
        { projectId: projectId ?? '' },
        { enabled: !!projectId, refetchOnWindowFocus: false },
    );

    const upsertMutation = api.settings.upsert.useMutation({
        onSuccess: () => {
            toast.success('MCP servers saved');
            refetch();
        },
        onError: (error: any) => {
            toast.error(error.message);
        },
        onSettled: () => setIsSaving(false),
    });

    useEffect(() => {
        if (settings) {
            setServers(settings.mcpServers ?? []);
            setIsLoading(false);
        } else if (settings === null) {
            setIsLoading(false);
        }
    }, [settings]);

    const saveServers = (updatedServers: McpServerConfig[]) => {
        if (!projectId) return;
        setIsSaving(true);
        upsertMutation.mutate({
            projectId,
            settings: {
                projectId,
                mcpServers: updatedServers as any,
            },
        });
    };

    const handleToggle = (id: string) => {
        const updated = servers.map((s) =>
            s.id === id ? { ...s, enabled: !s.enabled } : s,
        );
        setServers(updated);
        saveServers(updated);
    };

    const handleDelete = (id: string) => {
        const updated = servers.filter((s) => s.id !== id);
        setServers(updated);
        saveServers(updated);
    };

    const startAdding = () => {
        setEditingServer({ ...EMPTY_SERVER, id: uuidv4() });
        setHeadersText('');
        setEnableOAuth(false);
        setIsAdding(true);
    };

    const startEditing = (server: McpServerConfig) => {
        setEditingServer({ ...server });
        setHeadersText(
            server.headers ? Object.entries(server.headers).map(([k, v]) => `${k}: ${v}`).join('\n') : '',
        );
        setEnableOAuth(!!server.oauth);
        setIsAdding(true);
    };

    const handleSave = () => {
        if (!editingServer || !editingServer.name.trim()) {
            toast.error('Server name is required');
            return;
        }

        const headers: Record<string, string> = {};
        headersText.split('\n').filter(Boolean).forEach((line) => {
            const idx = line.indexOf(':');
            if (idx > 0) {
                headers[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
            }
        });

        const serverToSave: McpServerConfig = {
            ...editingServer,
            headers: Object.keys(headers).length > 0 ? headers : undefined,
            // If OAuth is enabled, preserve existing oauth config (tokens, etc.) or init empty
            oauth: enableOAuth ? (editingServer.oauth ?? {}) : undefined,
        };

        const existingIdx = servers.findIndex((s) => s.id === serverToSave.id);
        let updated: McpServerConfig[];
        if (existingIdx >= 0) {
            updated = servers.map((s) => (s.id === serverToSave.id ? serverToSave : s));
        } else {
            updated = [...servers, serverToSave];
        }

        setServers(updated);
        saveServers(updated);
        setEditingServer(null);
        setIsAdding(false);
    };

    const handleCancel = () => {
        setEditingServer(null);
        setIsAdding(false);
    };

    const handleDisconnect = (id: string) => {
        const updated = servers.map((s) =>
            s.id === id ? { ...s, oauth: s.oauth ? { ...s.oauth, tokens: undefined, pendingAuthCode: undefined } : undefined } : s
        );
        setServers(updated);
        saveServers(updated);
        toast.success('Disconnected OAuth tokens');
    };

    if (!projectId || isLoading) {
        return <div className="p-8 text-center text-muted-foreground">Loading...</div>;
    }

    if (isAdding && editingServer) {
        return (
            <div className="flex flex-col gap-6 p-8 max-w-2xl">
                <div className="flex flex-col gap-2">
                    <h2 className="text-xl font-semibold">
                        {servers.find((s) => s.id === editingServer.id) ? 'Edit' : 'Add'} MCP Server
                    </h2>
                    <p className="text-sm text-muted-foreground">
                        Add a Streamable HTTP MCP server URL. If it requires authentication, Onlook will prompt you to authorize automatically.
                    </p>
                </div>

                <div className="flex flex-col gap-4">
                    <div className="flex flex-col gap-1.5">
                        <Label>Name</Label>
                        <Input
                            value={editingServer.name}
                            onChange={(e) => setEditingServer({ ...editingServer, name: e.target.value })}
                            placeholder="My MCP Server"
                        />
                    </div>

                    <div className="flex flex-col gap-1.5">
                        <Label>URL</Label>
                        <Input
                            value={editingServer.url || ''}
                            onChange={(e) =>
                                setEditingServer({ ...editingServer, url: e.target.value })
                            }
                            placeholder="https://your-server.com/mcp"
                        />
                        <p className="text-xs text-muted-foreground">
                            Supports Streamable HTTP (modern) and SSE (legacy) transports.
                        </p>
                    </div>

                    <div className="flex flex-col gap-1.5">
                        <Label>Headers (one per line, Key: Value)</Label>
                        <textarea
                            className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            value={headersText}
                            onChange={(e) => setHeadersText(e.target.value)}
                            placeholder="Authorization: Bearer your-key"
                        />
                    </div>

                    {/* OAuth toggle */}
                    <div className="flex items-center justify-between p-4 border rounded-lg bg-muted/30">
                        <div className="flex flex-col gap-0.5">
                            <Label className="text-sm font-medium">OAuth Authentication</Label>
                            <p className="text-xs text-muted-foreground">
                                Enable if this server requires browser-based login (e.g. GitHub, Linear, Google).
                                Authorization happens automatically when you chat.
                            </p>
                        </div>
                        <Switch
                            checked={enableOAuth}
                            onCheckedChange={setEnableOAuth}
                        />
                    </div>
                </div>

                <div className="flex justify-end gap-2 pt-4 border-t">
                    <Button variant="outline" onClick={handleCancel}>
                        Cancel
                    </Button>
                    <Button onClick={handleSave} disabled={isSaving}>
                        {isSaving ? 'Saving...' : 'Save'}
                    </Button>
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-6 p-8 max-w-2xl">
            <div className="flex items-center justify-between">
                <div className="flex flex-col gap-1">
                    <h2 className="text-xl font-semibold">MCP Servers</h2>
                    <p className="text-sm text-muted-foreground">
                        Connect external MCP servers to extend AI capabilities. OAuth-protected servers will prompt you to authorize automatically when needed.
                    </p>
                </div>
                <Button size="sm" onClick={startAdding}>
                    <Icons.Plus className="h-4 w-4 mr-1" />
                    Add Server
                </Button>
            </div>

            {servers.length === 0 ? (
                <div className="border rounded-lg p-8 text-center text-muted-foreground">
                    <p className="text-sm">No MCP servers configured yet.</p>
                    <p className="text-xs mt-1">
                        Add a server URL — Onlook will handle authentication automatically.
                    </p>
                </div>
            ) : (
                <div className="flex flex-col gap-3">
                    {servers.map((server) => {
                        const isConnected = !!server.oauth?.tokens;
                        const isPending = !isConnected && !!server.oauth;

                        return (
                            <div
                                key={server.id}
                                className={cn(
                                    'flex items-center justify-between p-4 border rounded-lg',
                                    !server.enabled && 'opacity-50',
                                )}
                            >
                                <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <span className="font-medium text-sm truncate">
                                            {server.name}
                                        </span>
                                        {server.oauth && (
                                            <span className={cn(
                                                'text-xs px-1.5 py-0.5 rounded flex items-center gap-1',
                                                isConnected
                                                    ? 'bg-green-500/10 text-green-500'
                                                    : 'bg-yellow-500/10 text-yellow-500'
                                            )}>
                                                <Icons.LockClosed className="h-2.5 w-2.5" />
                                                {isConnected ? 'Authorized' : 'Needs authorization'}
                                            </span>
                                        )}
                                    </div>
                                    <span className="text-xs text-muted-foreground truncate">
                                        {server.url}
                                    </span>
                                </div>
                                <div className="flex items-center gap-2 ml-4 shrink-0">
                                    {isConnected && (
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            title="Disconnect OAuth"
                                            onClick={() => handleDisconnect(server.id)}
                                        >
                                            <Icons.CrossCircled className="h-4 w-4 text-muted-foreground" />
                                        </Button>
                                    )}
                                    <Switch
                                        checked={server.enabled}
                                        onCheckedChange={() => handleToggle(server.id)}
                                    />
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        onClick={() => startEditing(server)}
                                    >
                                        <Icons.Pencil className="h-4 w-4" />
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        onClick={() => handleDelete(server.id)}
                                    >
                                        <Icons.Trash className="h-4 w-4" />
                                    </Button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
});
