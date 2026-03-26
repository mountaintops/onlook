import { useStateManager } from '@/components/store/state';
import { useEditorEngine } from '@/components/store/editor';
import { api } from '@/trpc/react';
import type { LifecycleHooks } from '@onlook/models';
import { DEFAULT_LIFECYCLE_HOOKS } from '@onlook/models';
import { Button } from '@onlook/ui/button';
import { Input } from '@onlook/ui/input';
import { Label } from '@onlook/ui/label';
import { Switch } from '@onlook/ui/switch';
import { toast } from '@onlook/ui/sonner';
import { observer } from 'mobx-react-lite';
import { useEffect, useState } from 'react';

export const LifecycleHooksTab = observer(() => {
    const editorEngine = useEditorEngine();
    const projectId = editorEngine.projectId;

    const [hooks, setHooks] = useState<LifecycleHooks>(DEFAULT_LIFECYCLE_HOOKS);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);

    // Fetch existing settings
    const { data: settings, refetch } = api.settings.get.useQuery(
        { projectId: projectId ?? '' },
        { enabled: !!projectId, refetchOnWindowFocus: false }
    );

    const upsertMutation = api.settings.upsert.useMutation({
        onSuccess: () => {
            toast.success('Lifecycle hooks saved');
            refetch();
        },
        onError: (error: any) => {
            toast.error(error.message);
        },
        onSettled: () => setIsSaving(false),
    });

    useEffect(() => {
        if (settings) {
            setHooks(settings.lifecycleHooks || DEFAULT_LIFECYCLE_HOOKS);
            setIsLoading(false);
        } else if (settings === null) {
            // Project has no settings yet, use default
            setIsLoading(false);
        }
    }, [settings]);

    const handleChange = (key: keyof LifecycleHooks, value: string) => {
        setHooks((prev) => ({ ...prev, [key]: value }));
    };

    const handleSave = () => {
        if (!projectId) return;
        setIsSaving(true);
        upsertMutation.mutate({
            projectId,
            settings: {
                projectId,
                lifecycleHooks: hooks,
            },
        });
    };

    if (!projectId || isLoading) {
        return <div className="p-8 text-center text-muted-foreground">Loading...</div>;
    }

    return (
        <div className="flex flex-col gap-8 p-8 max-w-2xl">
            <div className="flex flex-col gap-2">
                <h2 className="text-xl font-semibold">Lifecycle Hooks</h2>
                <p className="text-sm text-muted-foreground">
                    Configure shell scripts to run inside the VM during specific sandbox events.
                    All scripts run in the sandbox root directory and receive the event name and affected path as arguments.
                </p>
            </div>

            <div className="flex flex-col gap-6">
                {/* Mandatory Setup Script */}
                <div className="flex flex-col gap-3">
                    <Label className="flex items-center justify-between">
                        <span>Setup Script (Always runs)</span>
                        <Switch checked={true} disabled />
                    </Label>
                    <Input
                        value={hooks.setupScript}
                        disabled
                        placeholder="./hooks/setup.sh"
                    />
                    <p className="text-xs text-muted-foreground">
                        This required script runs before any other hook. It is automatically created if missing and its path cannot be modified.
                    </p>
                </div>

                {/* Optional Events */}
                <div className="space-y-4">
                    <h3 className="text-sm font-medium border-b pb-2">Event Hooks</h3>
                    <HookRow
                        label="Startup"
                        value={hooks.startup}
                        onChange={(val) => handleChange('startup', val)}
                        placeholder="./hooks/on-startup.sh"
                    />
                    <HookRow
                        label="Shutdown"
                        value={hooks.shutdown}
                        onChange={(val) => handleChange('shutdown', val)}
                        placeholder="./hooks/on-shutdown.sh"
                    />
                    <HookRow
                        label="VM Creation"
                        value={hooks.vmCreation}
                        onChange={(val) => handleChange('vmCreation', val)}
                        placeholder="./hooks/on-vm-creation.sh"
                        description="Runs right after the sandbox is forked or created."
                    />
                    <HookRow
                        label="File Create"
                        value={hooks.fileCreate}
                        onChange={(val) => handleChange('fileCreate', val)}
                        placeholder="./hooks/on-file-create.sh"
                    />
                    <HookRow
                        label="File Edit"
                        value={hooks.fileEdit}
                        onChange={(val) => handleChange('fileEdit', val)}
                        placeholder="./hooks/on-file-edit.sh"
                    />
                    <HookRow
                        label="File Delete"
                        value={hooks.fileDelete}
                        onChange={(val) => handleChange('fileDelete', val)}
                        placeholder="./hooks/on-file-delete.sh"
                    />
                </div>

                <div className="flex justify-end pt-4 border-t">
                    <Button onClick={handleSave} disabled={isSaving}>
                        {isSaving ? 'Saving...' : 'Save Settings'}
                    </Button>
                </div>
            </div>
        </div>
    );
});

function HookRow({
    label,
    value,
    onChange,
    placeholder,
    description,
}: {
    label: string;
    value?: string;
    onChange: (val: string) => void;
    placeholder: string;
    description?: string;
}) {
    return (
        <div className="flex flex-col gap-1.5">
            <Label>{label}</Label>
            <Input
                value={value || ''}
                onChange={(e) => onChange(e.target.value)}
                placeholder={placeholder}
            />
            {description && <p className="text-xs text-muted-foreground">{description}</p>}
        </div>
    );
}
