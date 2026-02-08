import { api } from '@/trpc/react';
import type { MCPServerConfig } from '@onlook/models';
import { Button } from '@onlook/ui/button';
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from '@onlook/ui/card';
import { Icons } from '@onlook/ui/icons';
import { Input } from '@onlook/ui/input';
import { Label } from '@onlook/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@onlook/ui/select';
import { Switch } from '@onlook/ui/switch';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@onlook/ui/table';
import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import { v4 as uuidv4 } from 'uuid';

export const MCPTab = observer(() => {
    const { data: settings } = api.user.settings.get.useQuery();
    const apiUtils = api.useUtils();
    const { mutate: updateSettings } = api.user.settings.upsert.useMutation({
        onSuccess: () => {
            void apiUtils.user.settings.get.invalidate();
        },
    });

    const [transportType, setTransportType] = useState<'stdio' | 'sse'>('stdio');
    const [newServerName, setNewServerName] = useState('');
    // For stdio
    const [newServerCommand, setNewServerCommand] = useState('');
    const [newServerArgs, setNewServerArgs] = useState('');
    // For SSE
    const [newServerUrl, setNewServerUrl] = useState('');

    if (!settings) return null;

    const handleEnableMCP = (checked: boolean) => {
        updateSettings({
            enableMcp: checked,
        });
    };

    const handleAddServer = () => {
        if (!newServerName) return;

        let newServer: MCPServerConfig;

        if (transportType === 'stdio') {
            if (!newServerCommand) return;
            const argsList = newServerArgs.match(/(?:[^\s"]+|"[^"]*")+/g)?.map(arg => arg.replace(/^"|"$/g, '')) || [];
            newServer = {
                id: uuidv4(),
                name: newServerName,
                transport: 'stdio',
                command: newServerCommand,
                args: argsList,
                enabled: true,
            };
        } else {
            if (!newServerUrl) return;
            newServer = {
                id: uuidv4(),
                name: newServerName,
                transport: 'sse',
                url: newServerUrl,
                enabled: true,
            };
        }

        const currentServers = settings.mcp?.servers || [];
        updateSettings({
            mcpServers: [...currentServers, newServer],
        });

        setNewServerName('');
        setNewServerCommand('');
        setNewServerArgs('');
        setNewServerUrl('');
    };

    const handleRemoveServer = (id: string) => {
        const currentServers = settings.mcp?.servers || [];
        updateSettings({
            mcpServers: currentServers.filter(s => s.id !== id),
        });
    };

    const handleToggleServer = (id: string, checked: boolean) => {
        const currentServers = settings.mcp?.servers || [];
        updateSettings({
            mcpServers: currentServers.map(s => s.id === id ? { ...s, enabled: checked } : s),
        });
    };

    const getServerDisplayInfo = (server: MCPServerConfig) => {
        if (server.transport === 'sse') {
            return server.url || 'No URL';
        }
        return `${server.command || ''} ${(server.args || []).join(' ')}`.trim() || 'No command';
    };

    return (
        <div className="space-y-6 p-6">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-lg font-medium">Model Context Protocol (MCP)</h2>
                    <p className="text-sm text-muted-foreground">
                        Connect external tools and data sources to your AI agent.
                    </p>
                </div>
                <div className="flex items-center space-x-2">
                    <Label htmlFor="mcp-mode">Enable MCP</Label>
                    <Switch
                        id="mcp-mode"
                        checked={settings.mcp?.enabled || false}
                        onCheckedChange={handleEnableMCP}
                    />
                </div>
            </div>

            {settings.mcp?.enabled && (
                <>
                    <Card>
                        <CardHeader>
                            <CardTitle>Add New Server</CardTitle>
                            <CardDescription>
                                Configure a new MCP server. Choose Local for command-line servers or Remote for HTTP endpoints.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label htmlFor="server-name">Name</Label>
                                    <Input
                                        id="server-name"
                                        placeholder="My Server"
                                        value={newServerName}
                                        onChange={(e) => setNewServerName(e.target.value)}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="transport-type">Transport</Label>
                                    <Select value={transportType} onValueChange={(v) => setTransportType(v as 'stdio' | 'sse')}>
                                        <SelectTrigger>
                                            <SelectValue placeholder="Select transport" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="stdio">Local (Command)</SelectItem>
                                            <SelectItem value="sse">Remote (HTTP/SSE)</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>

                            {transportType === 'stdio' ? (
                                <>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="space-y-2">
                                            <Label htmlFor="server-command">Command</Label>
                                            <Input
                                                id="server-command"
                                                placeholder="npx or python"
                                                value={newServerCommand}
                                                onChange={(e) => setNewServerCommand(e.target.value)}
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <Label htmlFor="server-args">Arguments</Label>
                                            <Input
                                                id="server-args"
                                                placeholder='-y @modelcontextprotocol/server-memory'
                                                value={newServerArgs}
                                                onChange={(e) => setNewServerArgs(e.target.value)}
                                            />
                                        </div>
                                    </div>
                                    <p className="text-xs text-muted-foreground">
                                        Space-separated arguments. Use quotes for arguments with spaces.
                                    </p>
                                </>
                            ) : (
                                <div className="space-y-2">
                                    <Label htmlFor="server-url">Server URL</Label>
                                    <Input
                                        id="server-url"
                                        placeholder="https://mcp.example.com/sse"
                                        value={newServerUrl}
                                        onChange={(e) => setNewServerUrl(e.target.value)}
                                    />
                                    <p className="text-xs text-muted-foreground">
                                        The HTTP/SSE endpoint URL of the remote MCP server.
                                    </p>
                                </div>
                            )}

                            <Button
                                onClick={handleAddServer}
                                disabled={!newServerName || (transportType === 'stdio' ? !newServerCommand : !newServerUrl)}
                            >
                                Add Server
                            </Button>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle>Configured Servers</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead className="w-12">On</TableHead>
                                        <TableHead>Name</TableHead>
                                        <TableHead>Type</TableHead>
                                        <TableHead>Configuration</TableHead>
                                        <TableHead className="text-right w-12">Actions</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {(settings.mcp?.servers || []).length === 0 && (
                                        <TableRow>
                                            <TableCell colSpan={5} className="text-center text-muted-foreground">
                                                No servers configured
                                            </TableCell>
                                        </TableRow>
                                    )}
                                    {(settings.mcp?.servers || []).map((server: MCPServerConfig) => (
                                        <TableRow key={server.id}>
                                            <TableCell>
                                                <Switch
                                                    checked={server.enabled}
                                                    onCheckedChange={(checked) => handleToggleServer(server.id, checked)}
                                                />
                                            </TableCell>
                                            <TableCell className="font-medium">{server.name}</TableCell>
                                            <TableCell>
                                                <span className={`text-xs px-2 py-1 rounded ${server.transport === 'sse' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200' : 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200'}`}>
                                                    {server.transport === 'sse' ? 'Remote' : 'Local'}
                                                </span>
                                            </TableCell>
                                            <TableCell className="font-mono text-xs max-w-[200px] truncate">
                                                {getServerDisplayInfo(server)}
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={() => handleRemoveServer(server.id)}
                                                >
                                                    <Icons.Trash className="h-4 w-4" />
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </CardContent>
                    </Card>
                </>
            )}
        </div>
    );
});
