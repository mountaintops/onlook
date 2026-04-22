import { useEffect, useMemo, useState } from 'react';
import {
    AlertCircleIcon,
    CheckCircle2Icon,
    ChevronDownIcon,
    FilterIcon,
    LayersIcon,
    LayoutGridIcon,
    Settings2Icon,
    SparklesIcon,
    Undo2Icon,
} from 'lucide-react';
import { observer } from 'mobx-react-lite';

import { Color } from '@onlook/utility';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@onlook/ui/accordion';
import { Button } from '@onlook/ui/button';
import { Icons } from '@onlook/ui/icons';
import { Popover, PopoverContent, PopoverTrigger } from '@onlook/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@onlook/ui/select';
import { Slider } from '@onlook/ui/slider';
import { cn } from '@onlook/ui/utils';
import { ColorPickerContent } from '@/app/project/[id]/_components/editor-bar/inputs/color-picker';
import { useEditorEngine } from '@/components/store/editor';

const TweakItem = observer(({ 
    tweak, 
    selectedElementOid 
}: { 
    tweak: any; 
    selectedElementOid: string;
}) => {
    const editorEngine = useEditorEngine();
    const [isValid, setIsValid] = useState<boolean | null>(null);

    const colorValue = useMemo(() => {
        if (tweak.type !== 'color') return null;
        try {
            return Color.from(String(tweak.value));
        } catch (e) {
            return Color.transparent;
        }
    }, [tweak.value, tweak.type]);

    const formattedColorLabel = useMemo(() => {
        if (String(tweak.value).includes('gradient')) return 'Gradient';
        if (!colorValue) return String(tweak.value);
        const hex = colorValue.toHex6();
        const alpha = Math.round(colorValue.a * 100);
        return alpha < 100 ? `${hex} ${alpha}%` : hex;
    }, [colorValue, tweak.value]);

    useEffect(() => {
        const checkValidity = async () => {
            if (!tweak.targetOid) {
                setIsValid(true);
                return;
            }
            const metadata = await editorEngine.ast.getJsxElementMetadata(tweak.targetOid);
            setIsValid(metadata?.code?.includes(tweak.cssVariable) ?? false);
        };
        checkValidity();
    }, [tweak.targetOid, tweak.cssVariable, editorEngine.ast]);

    return (
        <div className="group/tweak flex flex-col gap-3">
            <div className="flex items-center justify-between">
                <div className="flex flex-col gap-0.5">
                    <div className="flex items-center gap-2">
                        <label className="text-foreground/80 group-hover/tweak:text-foreground text-[11px] font-medium transition-colors">
                            {tweak.name}
                        </label>
                        {isValid === false && (
                            <div className="bg-destructive/10 text-destructive flex items-center gap-1 rounded px-1 py-0.5 text-[8px] font-bold tracking-tighter uppercase">
                                <AlertCircleIcon className="h-2 w-2" />
                                Broken
                            </div>
                        )}
                    </div>
                    {selectedElementOid === 'all' && tweak.targetOid && (
                        <span className="text-muted-foreground flex items-center gap-1 text-[9px]">
                            <LayersIcon className="h-2.5 w-2.5" />
                            {editorEngine.ast.mappings.getLayerNodeByOid(tweak.targetOid)?.component ||
                                editorEngine.ast.mappings.getLayerNodeByOid(tweak.targetOid)?.tagName ||
                                'Element'}
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-1">
                    {tweak.initialValue !== undefined && tweak.value !== tweak.initialValue && (
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-muted-foreground hover:text-foreground"
                            onClick={() => editorEngine.tweaks.undoTweak(tweak.id)}
                            title="Undo changes"
                        >
                            <Undo2Icon className="h-3 w-3" />
                        </Button>
                    )}
                    <div className="bg-muted/50 text-foreground group-hover/tweak:border-primary/20 flex items-center gap-1.5 rounded border border-transparent px-2 py-0.5 font-mono text-[10px] transition-all">
                        {tweak.type === 'color' ? (
                            <div
                                className="w-3 h-3 rounded-full border border-foreground/10"
                                style={{ background: String(tweak.value) }}
                            />
                        ) : null}
                        {tweak.type === 'color' ? formattedColorLabel : tweak.value}
                        {tweak.type !== 'color' && (
                            <span className="text-muted-foreground opacity-60">
                                {tweak.unit || ''}
                            </span>
                        )}
                    </div>
                </div>
            </div>
            <div className="relative flex flex-col gap-2 px-1 pt-1">
                {tweak.type === 'color' ? (
                    <>
                        <Popover>
                            <PopoverTrigger asChild>
                                <Button
                                    variant="outline"
                                    className={cn(
                                        "w-full h-8 justify-start gap-2 text-xs font-normal border-muted-foreground/20 bg-background/50",
                                        isValid === false && "opacity-50"
                                    )}
                                >
                                    <div
                                        className="w-3 h-3 rounded-sm border border-foreground/10 shrink-0"
                                        style={{ background: String(tweak.value) }}
                                    />
                                    <span className="truncate">{formattedColorLabel}</span>
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0 border shadow-xl" align="start">
                                <ColorPickerContent
                                    color={colorValue || Color.transparent}
                                    onChange={(newColor) =>
                                        editorEngine.tweaks.updateTweakValue(
                                            tweak.id,
                                            typeof newColor === 'string' ? newColor : newColor instanceof Color ? newColor.toHex() : newColor.lightColor,
                                        )
                                    }
                                    onChangeEnd={(newColor) =>
                                        editorEngine.tweaks.updateTweakValue(
                                            tweak.id,
                                            typeof newColor === 'string' ? newColor : newColor instanceof Color ? newColor.toHex() : newColor.lightColor,
                                        )
                                    }
                                    disableAutoUpdate={true}
                                />
                            </PopoverContent>
                        </Popover>
                        <div className="flex flex-col gap-1.5 px-0.5">
                            <div className="flex items-center justify-between">
                                <span className="text-[9px] text-muted-foreground uppercase font-bold tracking-tight">Opacity</span>
                                <span className="text-[9px] font-mono">{Math.round((colorValue?.a ?? 1) * 100)}%</span>
                            </div>
                            <Slider
                                min={0}
                                max={1}
                                step={0.01}
                                value={[colorValue?.a ?? 1]}
                                onValueChange={(val) => {
                                    if (colorValue) {
                                        editorEngine.tweaks.updateTweakValue(
                                            tweak.id,
                                            colorValue.withAlpha(val[0] ?? 1).toHex()
                                        );
                                    }
                                }}
                                className={cn('w-full', isValid === false && 'opacity-50')}
                            />
                        </div>
                    </>
                ) : (
                    <Slider
                        min={tweak.min}
                        max={tweak.max}
                        step={
                            (tweak.max ?? 100) - (tweak.min ?? 0) > 10
                                ? 1
                                : ((tweak.max ?? 100) - (tweak.min ?? 0)) / 100
                        }
                        value={[Number(tweak.value)]}
                        onValueChange={(val) =>
                            editorEngine.tweaks.updateTweakValue(
                                tweak.id,
                                val[0] ?? tweak.min ?? 0,
                            )
                        }
                        className={cn('w-full', isValid === false && 'opacity-50')}
                    />
                )}
                {isValid === false && (
                    <p className="text-destructive mt-1 text-[9px] leading-tight italic opacity-80">
                        Variable "{tweak.cssVariable}" not found in element code.
                    </p>
                )}
            </div>
        </div>
    );
});

export const TweaksTab = observer(() => {
    const editorEngine = useEditorEngine();
    const tweaks = editorEngine.tweaks.activeTweaks;
    const [selectedElementOid, setSelectedElementOid] = useState<string>('all');

    // Extract unique elements that have tweaks
    const elementsWithTweaks = useMemo(() => {
        const map = new Map<string, { oid: string; name: string }>();
        tweaks.forEach((tweak) => {
            if (tweak.targetOid) {
                if (!map.has(tweak.targetOid)) {
                    const node = editorEngine.ast.mappings.getLayerNodeByOid(tweak.targetOid);
                    const name = node?.component || node?.tagName || 'Element';
                    map.set(tweak.targetOid, { oid: tweak.targetOid, name });
                }
            } else {
                if (!map.has('global')) {
                    map.set('global', { oid: 'global', name: 'Global Tweaks' });
                }
            }
        });
        return Array.from(map.values());
    }, [tweaks, editorEngine.ast.mappings]);

    // Filter tweaks based on selected element
    const filteredTweaks = useMemo(() => {
        if (selectedElementOid === 'all') return tweaks;
        if (selectedElementOid === 'global') return tweaks.filter((t) => !t.targetOid);
        return tweaks.filter((t) => t.targetOid === selectedElementOid);
    }, [tweaks, selectedElementOid]);

    // Group filtered tweaks by category
    const groupedByCategory = useMemo(() => {
        const groups: Record<string, typeof tweaks> = {};
        filteredTweaks.forEach((tweak) => {
            const category = tweak.category || 'General';
            if (!groups[category]) groups[category] = [];
            groups[category].push(tweak);
        });
        return groups;
    }, [filteredTweaks]);

    const categories = useMemo(
        () =>
            Object.keys(groupedByCategory).sort((a, b) => {
                if (a === 'General') return 1;
                if (b === 'General') return -1;
                return a.localeCompare(b);
            }),
        [groupedByCategory],
    );

    if (tweaks.length === 0) {
        return (
            <div className="text-muted-foreground flex h-full w-full flex-col items-center justify-center p-8 text-center">
                <div className="relative mb-6">
                    <SparklesIcon className="h-12 w-12 animate-pulse opacity-20" />
                    <div className="bg-primary/10 absolute inset-0 rounded-full blur-xl" />
                </div>
                <h4 className="text-foreground mb-2 font-medium">No Tweaks Active</h4>
                <p className="max-w-[200px] text-xs leading-relaxed">
                    Ask the AI to "create a slider" for any style to tune it visually here.
                </p>
            </div>
        );
    }

    return (
        <div className="bg-background flex h-full w-full flex-col overflow-hidden">
            {/* Header Area */}
            <div className="bg-muted/30 flex flex-col gap-3 border-b p-4">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <div className="bg-primary/10 text-primary rounded-md p-1.5">
                            <Settings2Icon className="h-4 w-4" />
                        </div>
                        <h3 className="text-foreground text-sm font-semibold">Active Tweaks</h3>
                    </div>
                </div>

                {/* Element Filter Dropdown */}
                {elementsWithTweaks.length > 1 && (
                    <div className="flex items-center gap-2">
                        <div className="flex-1">
                            <Select
                                value={selectedElementOid}
                                onValueChange={setSelectedElementOid}
                            >
                                <SelectTrigger className="bg-background/50 border-muted-foreground/20 h-8 text-xs">
                                    <div className="flex items-center gap-2">
                                        <FilterIcon className="text-muted-foreground h-3 w-3" />
                                        <SelectValue placeholder="Filter by element" />
                                    </div>
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">
                                        All Elements ({tweaks.length})
                                    </SelectItem>
                                    {elementsWithTweaks.map((el) => (
                                        <SelectItem key={el.oid} value={el.oid}>
                                            <div className="flex items-center gap-2">
                                                {el.oid === 'global' ? (
                                                    <SparklesIcon className="h-3 w-3" />
                                                ) : (
                                                    <LayersIcon className="h-3 w-3" />
                                                )}
                                                {el.name}
                                            </div>
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                )}
            </div>

            {/* Tweaks Content Area */}
            <div className="custom-scrollbar flex-1 overflow-y-auto px-4 py-2">
                <Accordion type="multiple" defaultValue={categories} className="w-full">
                    {categories.map((category) => (
                        <AccordionItem key={category} value={category} className="mb-2 border-none">
                            <AccordionTrigger className="group py-2 hover:no-underline">
                                <div className="flex items-center gap-2">
                                    <div className="bg-primary/40 group-data-[state=open]:bg-primary h-4 w-1 rounded-full transition-colors" />
                                    <span className="text-muted-foreground group-data-[state=open]:text-foreground text-[11px] font-bold tracking-widest uppercase transition-colors">
                                        {category}
                                    </span>
                                    <span className="bg-muted text-muted-foreground rounded-full px-1.5 py-0.5 font-mono text-[10px]">
                                        {groupedByCategory[category]?.length || 0}
                                    </span>
                                </div>
                            </AccordionTrigger>
                            <AccordionContent className="flex flex-col gap-6 pt-2 pb-4">
                                {groupedByCategory[category]?.map((tweak) => (
                                    <TweakItem 
                                        key={tweak.id} 
                                        tweak={tweak} 
                                        selectedElementOid={selectedElementOid} 
                                    />
                                ))}
                            </AccordionContent>
                        </AccordionItem>
                    ))}
                </Accordion>
            </div>

            {/* Footer / Tip area */}
            <div className="bg-muted/10 border-t p-4">
                <div className="text-muted-foreground flex items-start gap-2 text-[10px] leading-relaxed">
                    <SparklesIcon className="text-primary mt-0.5 h-3 w-3 shrink-0" />
                    <span>
                        Tweaks are non-destructive and only apply in the editor. Save your changes
                        to apply them to your code.
                    </span>
                </div>
            </div>
        </div>
    );
});

