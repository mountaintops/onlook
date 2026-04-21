import { Icons } from '@onlook/ui/icons';
import type { EditorEngine } from '@onlook/web-client/src/components/store/editor/engine';
import { z } from 'zod';
import { ClientTool } from '../models/client';

export class CreateTweaksTool extends ClientTool {
    static readonly toolName = 'create_tweaks';
    static readonly description =
        'Propose dynamic UI sliders (Tweaks) for CSS variables. Use this whenever the user asks for "vibe" shifts or stylistic fine-tuning (e.g. "make it more modern", "I want it to be more bouncy"). DO NOT create tweaks for standard layout/typography properties (padding, margin, fonts, colors, roundness, etc.) as these are handled by the main style panel. MANDATORY: You must first edit the component code to use these CSS variables with fallbacks before calling this tool.';
    
    static readonly parameters = z.object({
        tweaks: z.array(z.object({
            name: z.string().describe('Professional, Title Case name for the slider (e.g., "Layout Density", "Glow Intensity")'),
            cssVariable: z.string().describe('The CSS variable to match the code change (e.g., "--spacing-unit", "--vibe-scale")'),
            min: z.number().describe('Minimum logical limit for the style'),
            max: z.number().describe('Maximum logical limit for the style'),
            value: z.number().describe('Current baseline value in the app'),
            unit: z.string().optional().describe('CSS unit (px, rem, %, s, ms). Leave empty for unitless variables like opacity.'),
        })).describe('Array of related style tweaks for the UI.'),
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
