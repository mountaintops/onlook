import { useEditorEngine } from '@/components/store/editor';
import { Slider } from '@onlook/ui/slider';
import { Icons } from '@onlook/ui/icons';
import { SparklesIcon } from 'lucide-react';
import { observer } from 'mobx-react-lite';

export const TweaksTab = observer(() => {
    const editorEngine = useEditorEngine();
    const tweaks = editorEngine.tweaks.activeTweaks;

    return (
        <div className="flex flex-col h-full w-full p-3 overflow-y-auto gap-6 text-xs">
            <div className="flex items-center gap-2 mb-2">
                <Icons.MixerHorizontal className="w-4 h-4" />
                <h3 className="font-semibold text-foreground uppercase tracking-wider">Active Tweaks</h3>
            </div>
            
            {tweaks.length === 0 ? (
                <div className="flex flex-col items-center justify-center text-center text-muted-foreground pt-10">
                    <SparklesIcon className="w-8 h-8 mb-4 opacity-50" />
                    <p>No tweaks active.</p>
                    <p className="text-xs mt-2">Ask the AI to change the vibe, adjust density, or tweak styles to create new sliders here.</p>
                </div>
            ) : (
                <div className="flex flex-col gap-8">
                    {tweaks.map((tweak) => (
                        <div key={tweak.id} className="flex flex-col gap-3">
                            <div className="flex items-center justify-between">
                                <label className="font-medium text-foreground-secondary">{tweak.name}</label>
                                <span className="text-xs font-mono text-muted-foreground">
                                    {tweak.value}{tweak.unit || ''}
                                </span>
                            </div>
                            <Slider
                                min={tweak.min}
                                max={tweak.max}
                                step={(tweak.max - tweak.min) > 10 ? 1 : ((tweak.max - tweak.min) / 100)}
                                value={[tweak.value]}
                                onValueChange={(val) => editorEngine.tweaks.updateTweakValue(tweak.id, val[0] ?? tweak.min)}
                                className="w-full"
                            />
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
});
