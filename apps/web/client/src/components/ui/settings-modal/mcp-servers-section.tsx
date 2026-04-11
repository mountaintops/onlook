'use client';

import { api } from '@/trpc/react';
import type { McpServerConfig } from '@onlook/models';
import { Button } from '@onlook/ui/button';
import { Icons } from '@onlook/ui/icons';
import { Input } from '@onlook/ui/input';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@onlook/ui/select';
import { toast } from '@onlook/ui/sonner';
import { observer } from 'mobx-react-lite';
import { useEffect, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';

export const McpServersSection = observer(() => {
    const utils = api.useUtils();
    const { data: userSettings } = api.user.settings.get.useQuery();
    const { mutateAsync: updateUserSettings } = api.user.settings.upsert.useMutation();

    const [mcpServers, setMcpServers] = useState<McpServerConfig[]>([]);
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        setMcpServers(userSettings?.mcpServers ?? []);
    }, [userSettings?.mcpServers]);

    const addMcpServer = () => {
        setMcpServers((prev) => [
            ...prev,
            {
                id: uuidv4(),
                name: '',
                url: '',
                transportType: 'http',
                authType: 'none',
            },
        ]);
    };

    const updateMcpServer = (id: string, updates: Partial<McpServerConfig>) => {
        setMcpServers((prev) =>
            prev.map((s) => (s.id === id ? { ...s, ...updates } : s)),
        );
    };

    const removeMcpServer = (id: string) => {
        setMcpServers((prev) => prev.filter((s) => s.id !== id));
    };

    const handleSave = async () => {
        setIsSaving(true);
        try {
            await updateUserSettings({
                ...userSettings,
                mcpServers,
            });
            await utils.user.settings.get.invalidate();
            toast.success('Global MCP servers updated successfully');
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            const errorStack = error instanceof Error ? error.stack : undefined;
            console.error('[McpServersSection] Failed to update MCP servers:', {
                error: errorMessage,
                stack: errorStack,
                mcpServers,
                timestamp: new Date().toISOString(),
            });
            toast.error('Failed to update MCP servers');
        } finally {
            setIsSaving(false);
        }
    };

    const isDirty = JSON.stringify(mcpServers) !== JSON.stringify(userSettings?.mcpServers ?? []);

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
                <h2 className="text-lg">Global MCP Servers</h2>
                <p className="text-small text-foreground-secondary">
                    Connect external Model Context Protocol servers that will be available across all your projects.
                    These servers are combined with project-specific servers, with project servers taking precedence.
                </p>
            </div>

            <div className="flex flex-col gap-3">
                {mcpServers.map((server) => (
                    <div
                        key={server.id}
                        className="flex flex-col gap-2 p-3 rounded-md border border-border/60 bg-background-secondary/30"
                    >
                        {/* Row 1: Name + URL */}
                        <div className="flex gap-2 items-center">
                            <Input
                                placeholder="Name"
                                value={server.name}
                                onChange={(e) => updateMcpServer(server.id, { name: e.target.value })}
                                className="flex-1"
                                disabled={isSaving}
                            />
                            <Input
                                placeholder="https://your-server.com/mcp"
                                value={server.url}
                                onChange={(e) => updateMcpServer(server.id, { url: e.target.value })}
                                className="flex-1"
                                disabled={isSaving}
                            />
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => removeMcpServer(server.id)}
                                disabled={isSaving}
                            >
                                <Icons.CrossS className="h-4 w-4" />
                            </Button>
                        </div>

                        {/* Row 2: Transport Type + Auth Type + Token (if bearer) */}
                        <div className="flex gap-2 items-center">
                            <Select
                                value={server.transportType ?? 'http'}
                                onValueChange={(value: 'http' | 'sse') =>
                                    updateMcpServer(server.id, { transportType: value })
                                }
                                disabled={isSaving}
                            >
                                <SelectTrigger className="w-28">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="http">HTTP</SelectItem>
                                    <SelectItem value="sse">SSE</SelectItem>
                                </SelectContent>
                            </Select>
                            <Select
                                value={server.authType}
                                onValueChange={(value: 'none' | 'bearer') =>
                                    updateMcpServer(server.id, { authType: value })
                                }
                                disabled={isSaving}
                            >
                                <SelectTrigger className="w-32">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="none">No Auth</SelectItem>
                                    <SelectItem value="bearer">Bearer Token</SelectItem>
                                </SelectContent>
                            </Select>
                            {server.authType === 'bearer' && (
                                <Input
                                    type="password"
                                    placeholder="Bearer token"
                                    value={server.bearerToken ?? ''}
                                    onChange={(e) =>
                                        updateMcpServer(server.id, { bearerToken: e.target.value })
                                    }
                                    className="flex-1"
                                    disabled={isSaving}
                                />
                            )}
                        </div>
                    </div>
                ))}

                <Button
                    variant="outline"
                    onClick={addMcpServer}
                    disabled={isSaving}
                    className="w-full"
                >
                    <Icons.Plus className="h-4 w-4 mr-2" />
                    Add MCP Server
                </Button>
            </div>

            {isDirty && (
                <div className="flex justify-end">
                    <Button onClick={handleSave} disabled={isSaving}>
                        {isSaving ? 'Saving...' : 'Save Changes'}
                    </Button>
                </div>
            )}
        </div>
    );
});
