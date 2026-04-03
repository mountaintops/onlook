'use client';

import { useEditorEngine } from '@/components/store/editor';
import { SystemTheme } from '@onlook/models/assets';
import { Theme } from '@onlook/constants';
import { Button } from '@onlook/ui/button';
import { Icons } from '@onlook/ui/icons';
import { observer } from 'mobx-react-lite';

export const DeviceSettings = observer(function DeviceSettings({ frameId }: { frameId: string }) {
    const editorEngine = useEditorEngine();
    const frameData = editorEngine.frames.get(frameId);
    if (!frameData) {
        return (
            <p className="text-sm text-foreground-primary">Frame not found</p>
        );
    }

    const theme = (frameData.frame.theme as unknown as SystemTheme) || SystemTheme.SYSTEM;

    async function changeTheme(newTheme: SystemTheme) {
        if (!frameData) return;
        editorEngine.frames.updateAndSaveToStorage(frameData.frame.id, { theme: newTheme as unknown as Theme });
        await frameData?.view?.setTheme(newTheme);
    }

    return (
        <div className="flex flex-col gap-2">
            <p className="text-sm text-foreground-primary">Device Settings</p>
            <div className="flex flex-row justify-between items-center">
                <span className="text-xs text-foreground-secondary">Theme</span>
                <div className="flex flex-row p-0.5 w-3/5 bg-background-secondary rounded">
                    <Button
                        size={'icon'}
                        className={`flex-1 h-full px-0.5 py-1.5 bg-background-secondary rounded-sm ${theme === SystemTheme.SYSTEM
                            ? 'bg-background-tertiary hover:bg-background-tertiary'
                            : 'hover:bg-background-tertiary/50 text-foreground-onlook'
                            }`}
                        variant={'ghost'}
                        onClick={() => changeTheme(SystemTheme.SYSTEM)}
                    >
                        <Icons.Laptop />
                    </Button>
                    <Button
                        size={'icon'}
                        className={`flex-1 h-full px-0.5 py-1.5 bg-background-secondary rounded-sm ${theme === SystemTheme.DARK
                            ? 'bg-background-tertiary hover:bg-background-tertiary'
                            : 'hover:bg-background-tertiary/50 text-foreground-onlook'
                            }`}
                        variant={'ghost'}
                        onClick={() => changeTheme(SystemTheme.DARK)}
                    >
                        <Icons.Moon />
                    </Button>
                    <Button
                        size={'icon'}
                        className={`flex-1 h-full px-0.5 py-1.5 bg-background-secondary rounded-sm ${theme === SystemTheme.LIGHT
                            ? 'bg-background-tertiary hover:bg-background-tertiary'
                            : 'hover:bg-background-tertiary/50 text-foreground-onlook'
                            }`}
                        variant={'ghost'}
                        onClick={() => changeTheme(SystemTheme.LIGHT)}
                    >
                        <Icons.Sun />
                    </Button>
                </div>
            </div>
        </div>
    );
});
