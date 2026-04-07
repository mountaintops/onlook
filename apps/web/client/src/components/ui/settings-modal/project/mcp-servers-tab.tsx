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
import { auth, type OAuthClientProvider, type OAuthTokens } from '@modelcontextprotocol/sdk/client/auth.js';

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
        setIsAdding(true);
    };

    const startEditing = (server: McpServerConfig) => {
        setEditingServer({ ...server });
        setHeadersText(
            server.headers ? Object.entries(server.headers).map(([k, v]) => `${k}: ${v}`).join('\n') : '',
        );
        setIsAdding(true);
    };

    const handleSave = () => {
        if (!editingServer || !editingServer.name.trim()) {
            toast.error('Server name is required');
            return;
        }

        // Parse headers from multi-line "Key: Value" format
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
                        <Label>Transport</Label>
                        <div className="flex gap-2">
                            {Object.values(McpTransportType).map((t) => (
                                <Button
                                    key={t}
                                    variant={editingServer.transport === t ? 'default' : 'outline'}
                                    size="sm"
                                    onClick={() => setEditingServer({ ...editingServer, transport: t })}
                                >
                                    {t === McpTransportType.STREAMABLE_HTTP ? 'STREAMABLE HTTP' : String(t).toUpperCase()}
                                </Button>
                            ))}
                        </div>
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

                    <div className="flex flex-col gap-4 p-4 border rounded-lg bg-muted/30">
                        <div className="flex items-center justify-between">
                            <Label className="text-base">OAuth Configuration</Label>
                            <Switch
                                checked={!!editingServer.oauth}
                                onCheckedChange={(checked) =>
                                    setEditingServer({
                                        ...editingServer,
                                        oauth: checked ? { clientId: '', redirectUri: window.location.origin + '/mcp-callback' } : undefined
                                    })
                                }
                            />
                        </div>

                        {editingServer.oauth && (
                            <div className="flex flex-col gap-4 pt-2">
                                <div className="flex flex-col gap-1.5">
                                    <Label>Client ID</Label>
                                    <Input
                                        value={editingServer.oauth.clientId}
                                        onChange={(e) => setEditingServer({
                                            ...editingServer,
                                            oauth: { ...editingServer.oauth!, clientId: e.target.value }
                                        })}
                                        placeholder="your-client-id"
                                    />
                                </div>
                                <div className="flex flex-col gap-1.5">
                                    <Label>Redirect URI</Label>
                                    <Input
                                        value={editingServer.oauth.redirectUri || ''}
                                        onChange={(e) => setEditingServer({
                                            ...editingServer,
                                            oauth: { ...editingServer.oauth!, redirectUri: e.target.value }
                                        })}
                                        placeholder="http://localhost:3000/callback"
                                    />
                                </div>
                                <div className="flex flex-col gap-1.5">
                                    <Label>Scopes (comma separated)</Label>
                                    <Input
                                        value={editingServer.oauth.scopes?.join(', ') || ''}
                                        onChange={(e) => setEditingServer({
                                            ...editingServer,
                                            oauth: { ...editingServer.oauth!, scopes: e.target.value.split(',').map(s => s.trim()).filter(Boolean) }
                                        })}
                                        placeholder="read, write"
                                    />
                                </div>

                                <div className="flex flex-col gap-2">
                                    <Button
                                        variant="outline"
                                        className="w-full"
                                        onClick={async () => {
                                            if (!editingServer.url || !editingServer.oauth?.clientId) {
                                                toast.error('Server URL and Client ID are required for OAuth');
                                                return;
                                            }
                                            try {
                                                const provider: OAuthClientProvider = {
                                                    get redirectUrl() { return editingServer.oauth?.redirectUri; },
                                                    get clientMetadata() {
                                                        return {
                                                            client_id: editingServer.oauth?.clientId || '',
                                                            client_name: 'Onlook',
                                                            redirect_uris: editingServer.oauth?.redirectUri ? [editingServer.oauth.redirectUri] : [],
                                                        };
                                                    },
                                                    clientInformation: () => ({ client_id: editingServer.oauth?.clientId || '' }),
                                                    tokens: () => editingServer.oauth?.tokens,
                                                    saveTokens: (tokens: OAuthTokens) => {
                                                        setEditingServer({
                                                            ...editingServer,
                                                            oauth: { ...editingServer.oauth!, tokens }
                                                        });
                                                        toast.success('Tokens saved successfully');
                                                    },
                                                    redirectToAuthorization: (url: URL) => {
                                                        window.open(url.toString(), '_blank');
                                                    },
                                                    saveCodeVerifier: (v: string) => {
                                                        setEditingServer({
                                                            ...editingServer,
                                                            oauth: { ...editingServer.oauth!, codeVerifier: v }
                                                        });
                                                    },
                                                    codeVerifier: () => editingServer.oauth?.codeVerifier || '',
                                                };

                                                toast.info(`Starting OAuth flow for ${editingServer.name}...`);
                                                const result = await auth(provider, {
                                                    serverUrl: editingServer.url,
                                                    clientId: editingServer.oauth.clientId,
                                                } as any);

                                                if (result === 'AUTHORIZED') {
                                                    toast.success('Authorized successfully!');
                                                } else if (result === 'REDIRECT') {
                                                    toast.info('Please complete authorization in the browser.');
                                                }
                                            } catch (err) {
                                                toast.error(`OAuth error: ${err instanceof Error ? err.message : String(err)}`);
                                            }
                                        }}
                                    >
                                        <Icons.Lock className="h-4 w-4 mr-2" />
                                        {editingServer.oauth.tokens ? 'Reconnect Account' : 'Connect Account'}
                                    </Button>
                                    {editingServer.oauth.tokens && (
                                        <span className="text-xs text-green-500 text-center">
                                            Account Connected
                                        </span>
                                    )}
                                </div>
                            </div>
                        )}
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
                        Connect external MCP servers to extend AI capabilities with additional tools.
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
                        Add an MCP server to give your AI access to external tools via Streamable HTTP.
                    </p>
                </div>
            ) : (
                <div className="flex flex-col gap-3">
                    {servers.map((server) => (
                        <div
                            key={server.id}
                            className={cn(
                                'flex items-center justify-between p-4 border rounded-lg',
                                !server.enabled && 'opacity-50',
                            )}
                        >
                            <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                    <span className="font-medium text-sm truncate">
                                        {server.name}
                                    </span>
                                    <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground uppercase">
                                        {server.transport === McpTransportType.STREAMABLE_HTTP ? 'STREAMABLE HTTP' : server.transport}
                                    </span>
                                </div>
                                <span className="text-xs text-muted-foreground truncate">
                                    {server.url}
                                </span>
                            </div>
                            <div className="flex items-center gap-2 ml-4 shrink-0">
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
                    ))}
                </div>
            )}
        </div>
    );
});
