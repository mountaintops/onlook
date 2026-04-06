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
    transport: McpTransportType.HTTP,
    url: '',
    sandboxId: '',
    headers: {},
    command: '',
    args: [],
    env: {},
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
    const [argsText, setArgsText] = useState('');
    const [envText, setEnvText] = useState('');

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
        setArgsText('');
        setEnvText('');
        setIsAdding(true);
    };

    const startEditing = (server: McpServerConfig) => {
        setEditingServer({ ...server });
        setHeadersText(
            server.headers ? Object.entries(server.headers).map(([k, v]) => `${k}: ${v}`).join('\n') : '',
        );
        setArgsText(server.args?.join('\n') ?? '');
        setEnvText(
            server.env ? Object.entries(server.env).map(([k, v]) => `${k}=${v}`).join('\n') : '',
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

        // Parse args from newline-separated
        const args = argsText.split('\n').filter(Boolean);

        // Parse env from multi-line "KEY=VALUE" format
        const env: Record<string, string> = {};
        envText.split('\n').filter(Boolean).forEach((line) => {
            const idx = line.indexOf('=');
            if (idx > 0) {
                env[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
            }
        });

        const serverToSave: McpServerConfig = {
            ...editingServer,
            headers: Object.keys(headers).length > 0 ? headers : undefined,
            args: args.length > 0 ? args : undefined,
            env: Object.keys(env).length > 0 ? env : undefined,
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
                                    {t.toUpperCase()}
                                </Button>
                            ))}
                        </div>
                    </div>

                    {(editingServer.transport === McpTransportType.HTTP ||
                        editingServer.transport === McpTransportType.SSE) && (
                            <>
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
                            </>
                        )}

                    {editingServer.transport === McpTransportType.STDIO && (
                        <>
                            <div className="flex flex-col gap-1.5">
                                <Label>Command</Label>
                                <Input
                                    value={editingServer.command || ''}
                                    onChange={(e) =>
                                        setEditingServer({ ...editingServer, command: e.target.value })
                                    }
                                    placeholder="node"
                                />
                            </div>
                            <div className="flex flex-col gap-1.5">
                                <Label>Arguments (one per line)</Label>
                                <textarea
                                    className="flex min-h-[60px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                    value={argsText}
                                    onChange={(e) => setArgsText(e.target.value)}
                                    placeholder="server.js"
                                />
                            </div>
                            <div className="flex flex-col gap-1.5">
                                <Label>Environment Variables (one per line, KEY=VALUE)</Label>
                                <textarea
                                    className="flex min-h-[60px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                    value={envText}
                                    onChange={(e) => setEnvText(e.target.value)}
                                    placeholder="API_KEY=your-key"
                                />
                            </div>
                            <p className="text-xs text-amber-500">
                                ⚠ Stdio servers spawn local processes. They only work when the server is running locally.
                            </p>
                        </>
                    )}

                    {editingServer.transport === McpTransportType.CODESANDBOX && (
                        <>
                            <div className="flex flex-col gap-1.5">
                                <Label>Sandbox ID</Label>
                                <Input
                                    value={editingServer.sandboxId || ''}
                                    onChange={(e) =>
                                        setEditingServer({ ...editingServer, sandboxId: e.target.value })
                                    }
                                    placeholder="e1fg2h..."
                                />
                            </div>
                            <div className="flex flex-col gap-1.5">
                                <Label>Command</Label>
                                <Input
                                    value={editingServer.command || ''}
                                    onChange={(e) =>
                                        setEditingServer({ ...editingServer, command: e.target.value })
                                    }
                                    placeholder="node"
                                />
                            </div>
                            <div className="flex flex-col gap-1.5">
                                <Label>Arguments (one per line)</Label>
                                <textarea
                                    className="flex min-h-[60px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                    value={argsText}
                                    onChange={(e) => setArgsText(e.target.value)}
                                    placeholder="server.js"
                                />
                            </div>
                            <div className="flex flex-col gap-1.5">
                                <Label>Environment Variables (one per line, KEY=VALUE)</Label>
                                <textarea
                                    className="flex min-h-[60px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                    value={envText}
                                    onChange={(e) => setEnvText(e.target.value)}
                                    placeholder="API_KEY=your-key"
                                />
                            </div>
                            <p className="text-xs text-blue-500">
                                ℹ CodeSandbox servers run inside a remote VM. They work in both local and cloud environments.
                            </p>
                        </>
                    )}
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
                        Add an MCP server to give your AI access to external tools via HTTP, SSE, or stdio transports.
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
                                        {server.transport}
                                    </span>
                                </div>
                                <span className="text-xs text-muted-foreground truncate">
                                    {server.transport === McpTransportType.HTTP || server.transport === McpTransportType.SSE
                                        ? server.url
                                        : `${server.command} ${server.args?.join(' ') ?? ''}${server.sandboxId ? ` (Sandbox: ${server.sandboxId})` : ''}`}
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
