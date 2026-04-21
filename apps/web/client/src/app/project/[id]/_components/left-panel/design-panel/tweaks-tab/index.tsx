import { useEditorEngine } from '@/components/store/editor';
import { Slider } from '@onlook/ui/slider';
import { Icons } from '@onlook/ui/icons';
import { Button } from '@onlook/ui/button';
import { 
    SparklesIcon, 
    LayoutGridIcon, 
    FilterIcon, 
    LayersIcon,
    ChevronDownIcon,
    Settings2Icon
} from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useState, useMemo } from 'react';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@onlook/ui/select";
import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
} from "@onlook/ui/accordion";
import { cn } from '@onlook/ui/utils';

export const TweaksTab = observer(() => {
    const editorEngine = useEditorEngine();
    const tweaks = editorEngine.tweaks.activeTweaks;
    const [selectedElementOid, setSelectedElementOid] = useState<string>("all");

    // Extract unique elements that have tweaks
    const elementsWithTweaks = useMemo(() => {
        const map = new Map<string, { oid: string; name: string }>();
        tweaks.forEach(tweak => {
            if (tweak.targetOid) {
                if (!map.has(tweak.targetOid)) {
                    const node = editorEngine.ast.mappings.getLayerNodeByOid(tweak.targetOid);
                    const name = node?.name || node?.tagName || "Element";
                    map.set(tweak.targetOid, { oid: tweak.targetOid, name });
                }
            } else {
                if (!map.has("global")) {
                    map.set("global", { oid: "global", name: "Global Tweaks" });
                }
            }
        });
        return Array.from(map.values());
    }, [tweaks, editorEngine.ast.mappings]);

    // Filter tweaks based on selected element
    const filteredTweaks = useMemo(() => {
        if (selectedElementOid === "all") return tweaks;
        if (selectedElementOid === "global") return tweaks.filter(t => !t.targetOid);
        return tweaks.filter(t => t.targetOid === selectedElementOid);
    }, [tweaks, selectedElementOid]);

    // Group filtered tweaks by category
    const groupedByCategory = useMemo(() => {
        const groups: Record<string, typeof tweaks> = {};
        filteredTweaks.forEach(tweak => {
            const category = tweak.category || "General";
            if (!groups[category]) groups[category] = [];
            groups[category].push(tweak);
        });
        return groups;
    }, [filteredTweaks]);

    const categories = useMemo(() => Object.keys(groupedByCategory).sort((a, b) => {
        if (a === "General") return 1;
        if (b === "General") return -1;
        return a.localeCompare(b);
    }), [groupedByCategory]);

    if (tweaks.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-full w-full p-8 text-center text-muted-foreground">
                <div className="relative mb-6">
                    <SparklesIcon className="w-12 h-12 opacity-20 animate-pulse" />
                    <div className="absolute inset-0 bg-primary/10 blur-xl rounded-full" />
                </div>
                <h4 className="text-foreground font-medium mb-2">No Tweaks Active</h4>
                <p className="text-xs leading-relaxed max-w-[200px]">
                    Ask the AI to "create a slider" for any style to tune it visually here.
                </p>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full w-full overflow-hidden bg-background">
            {/* Header Area */}
            <div className="flex flex-col gap-3 p-4 border-b bg-muted/30">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <div className="p-1.5 rounded-md bg-primary/10 text-primary">
                            <Settings2Icon className="w-4 h-4" />
                        </div>
                        <h3 className="font-semibold text-sm text-foreground">Active Tweaks</h3>
                    </div>
                </div>

                {/* Element Filter Dropdown */}
                {elementsWithTweaks.length > 1 && (
                    <div className="flex items-center gap-2">
                        <div className="flex-1">
                            <Select value={selectedElementOid} onValueChange={setSelectedElementOid}>
                                <SelectTrigger className="h-8 text-xs bg-background/50 border-muted-foreground/20">
                                    <div className="flex items-center gap-2">
                                        <FilterIcon className="w-3 h-3 text-muted-foreground" />
                                        <SelectValue placeholder="Filter by element" />
                                    </div>
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All Elements ({tweaks.length})</SelectItem>
                                    {elementsWithTweaks.map(el => (
                                        <SelectItem key={el.oid} value={el.oid}>
                                            <div className="flex items-center gap-2">
                                                {el.oid === 'global' ? <SparklesIcon className="w-3 h-3" /> : <LayersIcon className="w-3 h-3" />}
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
            <div className="flex-1 overflow-y-auto px-4 py-2 custom-scrollbar">
                <Accordion type="multiple" defaultValue={categories} className="w-full">
                    {categories.map((category) => (
                        <AccordionItem key={category} value={category} className="border-none mb-2">
                            <AccordionTrigger className="hover:no-underline py-2 group">
                                <div className="flex items-center gap-2">
                                    <div className="w-1 h-4 rounded-full bg-primary/40 group-data-[state=open]:bg-primary transition-colors" />
                                    <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground group-data-[state=open]:text-foreground transition-colors">
                                        {category}
                                    </span>
                                    <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded-full text-muted-foreground font-mono">
                                        {groupedByCategory[category].length}
                                    </span>
                                </div>
                            </AccordionTrigger>
                            <AccordionContent className="pt-2 pb-4 flex flex-col gap-6">
                                {groupedByCategory[category].map((tweak) => (
                                    <div key={tweak.id} className="flex flex-col gap-3 group/tweak">
                                        <div className="flex items-center justify-between">
                                            <div className="flex flex-col gap-0.5">
                                                <label className="text-[11px] font-medium text-foreground/80 group-hover/tweak:text-foreground transition-colors">
                                                    {tweak.name}
                                                </label>
                                                {selectedElementOid === 'all' && tweak.targetOid && (
                                                    <span className="text-[9px] text-muted-foreground flex items-center gap-1">
                                                        <LayersIcon className="w-2.5 h-2.5" />
                                                        {editorEngine.ast.mappings.getLayerNodeByOid(tweak.targetOid)?.name || "Element"}
                                                    </span>
                                                )}
                                            </div>
                                            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-muted/50 font-mono text-[10px] text-foreground border border-transparent group-hover/tweak:border-primary/20 transition-all">
                                                {tweak.value}
                                                <span className="text-muted-foreground opacity-60">{tweak.unit || ''}</span>
                                            </div>
                                        </div>
                                        <div className="relative pt-1 px-1">
                                            <Slider
                                                min={tweak.min}
                                                max={tweak.max}
                                                step={(tweak.max - tweak.min) > 10 ? 1 : ((tweak.max - tweak.min) / 100)}
                                                value={[tweak.value]}
                                                onValueChange={(val) => editorEngine.tweaks.updateTweakValue(tweak.id, val[0] ?? tweak.min)}
                                                className="w-full"
                                            />
                                        </div>
                                    </div>
                                ))}
                            </AccordionContent>
                        </AccordionItem>
                    ))}
                </Accordion>
            </div>
            
            {/* Footer / Tip area */}
            <div className="p-4 border-t bg-muted/10">
                <div className="flex items-start gap-2 text-[10px] text-muted-foreground leading-relaxed">
                    <SparklesIcon className="w-3 h-3 mt-0.5 text-primary shrink-0" />
                    <span>Tweaks are non-destructive and only apply in the editor. Save your changes to apply them to your code.</span>
                </div>
            </div>
        </div>
    );
});
