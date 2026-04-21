import { Icons } from '@onlook/ui/icons';
import type { EditorEngine } from '@onlook/web-client/src/components/store/editor/engine';
import { z } from 'zod';
import { ClientTool } from '../models/client';

export class CreateTweaksTool extends ClientTool {
    static readonly toolName = 'create_tweaks';
    static readonly description =
        'Propose a set of UI sliders (tweaks) to adjust CSS variables dynamically without modifying code directly. Use this when the user asks for vibe changes like "make it less cramped" or "more playful". Make sure the component uses these CSS variables so the tweaks apply.';
    
    static readonly parameters = z.object({
        tweaks: z.array(z.object({
            name: z.string().describe('Human readable name for the slider, e.g., "Layout Density"'),
            cssVariable: z.string().describe('The CSS variable to update, e.g., "--layout-density"'),
            min: z.number().describe('Minimum value of the slider'),
            max: z.number().describe('Maximum value of the slider'),
            value: z.number().describe('Default value of the slider, based on current CSS or default'),
            unit: z.string().optional().describe('Unit for the value, e.g., "px", "rem", "%" or empty for unitless'),
        })).describe('An array of tweaks to generate sliders for.'),
    });

    static readonly icon = Icons.Slider;

    async handle(
        args: z.infer<typeof CreateTweaksTool.parameters>,
        editorEngine: EditorEngine,
    ): Promise<{
        success: boolean;
        message: string;
    }> {
        try {
            editorEngine.tweaks.addTweaks(args.tweaks);
            editorEngine.tweaks.isOpen = true;
            return {
                success: true,
                message: `Successfully created ${args.tweaks.length} tweaks.`,
            };
        } catch (error: any) {
            return {
                success: false,
                message: error?.message || 'Failed to create tweaks',
            };
        }
    }

    static getLabel(input?: z.infer<typeof CreateTweaksTool.parameters>): string {
        return 'Configure Tweaks';
    }
}
