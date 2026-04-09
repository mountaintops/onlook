'use client';

import { useEditorEngine } from '@/components/store/editor';
import { api } from '@/trpc/react';
import { DefaultSettings } from '@onlook/constants';
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
import { Separator } from '@onlook/ui/separator';
import { toast } from '@onlook/ui/sonner';
import { observer } from 'mobx-react-lite';
import { useEffect, useMemo, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';

export const ProjectTab = observer(() => {
    const editorEngine = useEditorEngine();
    const utils = api.useUtils();
    const { data: project } = api.project.get.useQuery({ projectId: editorEngine.projectId });
    const { mutateAsync: updateProject } = api.project.update.useMutation();
    const { data: projectSettings } = api.settings.get.useQuery({ projectId: editorEngine.projectId });
    const { mutateAsync: updateProjectSettings } = api.settings.upsert.useMutation();

    const installCommand = projectSettings?.commands?.install ?? DefaultSettings.COMMANDS.install;
    const runCommand = projectSettings?.commands?.run ?? DefaultSettings.COMMANDS.run;
    const buildCommand = projectSettings?.commands?.build ?? DefaultSettings.COMMANDS.build;
    const name = project?.name ?? '';

    // Form state
    const [formData, setFormData] = useState({
        name: '',
        install: '',
        run: '',
        build: '',
        mcpServers: [] as McpServerConfig[],
    });
    const [isSaving, setIsSaving] = useState(false);

    // Initialize and sync form data
    useEffect(() => {
        setFormData({
            name,
            install: installCommand,
            run: runCommand,
            build: buildCommand,
            mcpServers: projectSettings?.mcpServers ?? [],
        });
    }, [name, installCommand, runCommand, buildCommand, projectSettings?.mcpServers]);

    // Check if form has changes
    const isDirty = useMemo(() => {
        const serversChanged =
            JSON.stringify(formData.mcpServers) !==
            JSON.stringify(projectSettings?.mcpServers ?? []);
        return (
            formData.name !== name ||
            formData.install !== installCommand ||
            formData.run !== runCommand ||
            formData.build !== buildCommand ||
            serversChanged
        );
    }, [formData, name, installCommand, runCommand, buildCommand, projectSettings?.mcpServers]);

    const handleSave = async () => {
        setIsSaving(true);
        try {
            // Update project name if changed
            if (formData.name !== name) {
                await updateProject({
                    id: editorEngine.projectId,
                    name: formData.name,
                });
                // Invalidate queries to refresh UI
                await Promise.all([
                    utils.project.list.invalidate(),
                    utils.project.get.invalidate({ projectId: editorEngine.projectId }),
                ]);
            }

            // Update commands / MCP servers if any changed
            const commandsChanged =
                formData.install !== installCommand ||
                formData.run !== runCommand ||
                formData.build !== buildCommand;
            const mcpChanged =
                JSON.stringify(formData.mcpServers) !==
                JSON.stringify(projectSettings?.mcpServers ?? []);

            if (commandsChanged || mcpChanged) {
                await updateProjectSettings({
                    projectId: editorEngine.projectId,
                    settings: {
                        installCommand: formData.install,
                        runCommand: formData.run,
                        buildCommand: formData.build,
                        mcpServers: formData.mcpServers.length ? formData.mcpServers : null,
                    },
                });
            }

            toast.success('Project settings updated successfully.');
        } catch (error) {
            console.error('Failed to update project settings:', error);
            toast.error('Failed to update project settings. Please try again.');
        } finally {
            setIsSaving(false);
        }
    };

    const handleDiscard = () => {
        setFormData({
            name,
            install: installCommand,
            run: runCommand,
            build: buildCommand,
            mcpServers: projectSettings?.mcpServers ?? [],
        });
    };

    const updateField = (field: keyof Omit<typeof formData, 'mcpServers'>, value: string) => {
        setFormData((prev) => ({ ...prev, [field]: value }));
    };

    // ── MCP server list helpers ──────────────────────────────────────────────

    const addMcpServer = () => {
        const newServer: McpServerConfig = {
            id: uuidv4(),
            name: '',
            url: '',
            authType: 'none',
        };
        setFormData((prev) => ({ ...prev, mcpServers: [...prev.mcpServers, newServer] }));
    };

    const updateMcpServer = (id: string, patch: Partial<McpServerConfig>) => {
        setFormData((prev) => ({
            ...prev,
            mcpServers: prev.mcpServers.map((s) => (s.id === id ? { ...s, ...patch } : s)),
        }));
    };

    const removeMcpServer = (id: string) => {
        setFormData((prev) => ({
            ...prev,
            mcpServers: prev.mcpServers.filter((s) => s.id !== id),
        }));
    };

    return (
        <div className="text-sm flex flex-col h-full">
            <div className="flex flex-col gap-4 p-6 pb-24 overflow-y-auto flex-1">
                <div className="flex flex-col gap-4">
                    <h2 className="text-lg">Metadata</h2>
                    <div className="space-y-4">
                        <div className="flex justify-between items-center">
                            <p className="text-muted-foreground">Name</p>
                            <Input
                                id="name"
                                value={formData.name}
                                onChange={(e) => updateField('name', e.target.value)}
                                className="w-2/3"
                                disabled={isSaving}
                            />
                        </div>
                    </div>
                </div>
                <Separator />

                <div className="flex flex-col gap-4">
                    <div className="flex flex-col gap-2">
                        <h2 className="text-lg">Commands</h2>
                        <p className="text-small text-foreground-secondary">
                            {"Only update these if you know what you're doing!"}
                        </p>
                    </div>
                    <div className="space-y-4">
                        <div className="flex justify-between items-center">
                            <p className="text-muted-foreground">Install</p>
                            <Input
                                id="install"
                                value={formData.install}
                                onChange={(e) => updateField('install', e.target.value)}
                                className="w-2/3"
                                disabled={isSaving}
                            />
                        </div>
                        <div className="flex justify-between items-center">
                            <p className="text-muted-foreground">Run</p>
                            <Input
                                id="run"
                                value={formData.run}
                                onChange={(e) => updateField('run', e.target.value)}
                                className="w-2/3"
                                disabled={isSaving}
                            />
                        </div>
                        <div className="flex justify-between items-center">
                            <p className="text-muted-foreground">Build</p>
                            <Input
                                id="build"
                                value={formData.build}
                                onChange={(e) => updateField('build', e.target.value)}
                                className="w-2/3"
                                disabled={isSaving}
                            />
                        </div>
                    </div>
                </div>
                <Separator />

                {/* ── MCP Servers ──────────────────────────────────────────── */}
                <div className="flex flex-col gap-4">
                    <div className="flex flex-col gap-2">
                        <h2 className="text-lg">MCP Servers</h2>
                        <p className="text-small text-foreground-secondary">
                            Connect external Model Context Protocol servers to give the AI additional tools.
                        </p>
                    </div>

                    {formData.mcpServers.length > 0 && (
                        <div className="flex flex-col gap-3">
                            {formData.mcpServers.map((server) => (
                                <div
                                    key={server.id}
                                    className="flex flex-col gap-2 p-3 rounded-md border border-border/60 bg-background-secondary/30"
                                >
                                    {/* Row 1: Name + URL */}
                                    <div className="flex gap-2 items-center">
                                        <Input
                                            id={`mcp-name-${server.id}`}
                                            placeholder="Name"
                                            value={server.name}
                                            onChange={(e) =>
                                                updateMcpServer(server.id, { name: e.target.value })
                                            }
                                            className="flex-1"
                                            disabled={isSaving}
                                        />
                                        <Input
                                            id={`mcp-url-${server.id}`}
                                            placeholder="https://your-server.com/mcp"
                                            value={server.url}
                                            onChange={(e) =>
                                                updateMcpServer(server.id, { url: e.target.value })
                                            }
                                            className="flex-[2]"
                                            disabled={isSaving}
                                        />
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="shrink-0 text-muted-foreground hover:text-destructive"
                                            onClick={() => removeMcpServer(server.id)}
                                            disabled={isSaving}
                                            title="Remove server"
                                        >
                                            <Icons.CrossS className="h-4 w-4" />
                                        </Button>
                                    </div>

                                    {/* Row 2: Auth type + optional token */}
                                    <div className="flex gap-2 items-center">
                                        <Select
                                            value={server.authType}
                                            onValueChange={(v) =>
                                                updateMcpServer(server.id, {
                                                    authType: v as McpServerConfig['authType'],
                                                    bearerToken: v === 'none' ? undefined : server.bearerToken,
                                                })
                                            }
                                            disabled={isSaving}
                                        >
                                            <SelectTrigger
                                                id={`mcp-auth-${server.id}`}
                                                className="w-36 shrink-0"
                                            >
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="none">No auth</SelectItem>
                                                <SelectItem value="bearer">Bearer token</SelectItem>
                                            </SelectContent>
                                        </Select>

                                        {server.authType === 'bearer' && (
                                            <Input
                                                id={`mcp-token-${server.id}`}
                                                placeholder="Bearer token"
                                                type="password"
                                                value={server.bearerToken ?? ''}
                                                onChange={(e) =>
                                                    updateMcpServer(server.id, {
                                                        bearerToken: e.target.value,
                                                    })
                                                }
                                                className="flex-1"
                                                disabled={isSaving}
                                            />
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    <Button
                        variant="outline"
                        size="sm"
                        className="self-start flex items-center gap-2"
                        onClick={addMcpServer}
                        disabled={isSaving}
                    >
                        <Icons.Plus className="h-3.5 w-3.5" />
                        Add MCP Server
                    </Button>
                </div>
            </div>

            {/* Save/Discard buttons matching site tab pattern */}
            <div className="sticky bottom-0 bg-background border-t border-border/50 p-6" style={{ borderTopWidth: '0.5px' }}>
                <div className="flex justify-end gap-4">
                    <Button
                        variant="outline"
                        className="flex items-center gap-2 px-4 py-2 bg-background border border-border/50"
                        type="button"
                        onClick={handleDiscard}
                        disabled={!isDirty || isSaving}
                    >
                        <span>Discard changes</span>
                    </Button>
                    <Button
                        variant="secondary"
                        className="flex items-center gap-2 px-4 py-2"
                        type="button"
                        onClick={handleSave}
                        disabled={!isDirty || isSaving}
                    >
                        {isSaving && <Icons.LoadingSpinner className="h-4 w-4 animate-spin" />}
                        <span>{isSaving ? 'Saving...' : 'Save changes'}</span>
                    </Button>
                </div>
            </div>
        </div>
    );
});