import { z } from 'zod';

import type { EditorEngine } from '@onlook/web-client/src/components/store/editor/engine';
import { LeftPanelTabValue } from '@onlook/models';
import { Icons } from '@onlook/ui/icons';

import { ClientTool } from '../models/client';

export class CreateTweaksTool extends ClientTool {
    static readonly toolName = 'create_tweaks';
    static readonly description =
        'Propose dynamic UI controls (Tweaks) for CSS variables. Supports sliders (number) and color pickers (color). Use this whenever the user asks for "vibe" shifts or stylistic fine-tuning (e.g. "make it more modern", "change the accent colors"). DO NOT create tweaks for standard layout/typography properties unless they are exposed as theme-level CSS variables. MANDATORY: You must first edit the component code to use these CSS variables with fallbacks before calling this tool.';

    static readonly parameters = z.object({
        tweaks: z
            .array(
                z.object({
                    name: z
                        .string()
                        .describe(
                            'Professional, Title Case name for the control (e.g., "Layout Density", "Accent Color")',
                        ),
                    type: z
                        .enum(['number', 'color'])
                        .default('number')
                        .describe('The type of UI control to show.'),
                    property: z
                        .string()
                        .describe(
                            'The CSS property this tweak controls (e.g. "opacity", "background-color", "transform")',
                        ),
                    cssVariable: z
                        .string()
                        .describe(
                            'The CSS variable to match the code change (e.g., "--spacing-unit", "--accent-color")',
                        ),
                    min: z.number().optional().describe('Minimum logical limit (required for number type)'),
                    max: z.number().optional().describe('Maximum logical limit (required for number type)'),
                    value: z.union([z.number(), z.string()]).describe('Current baseline value (number for slider, hex/rgba string for color)'),
                    unit: z
                        .string()
                        .optional()
                        .describe(
                            'CSS unit (px, rem, %, s, ms). Leave empty for colors or unitless variables.',
                        ),
                    category: z
                        .string()
                        .optional()
                        .describe(
                            'Group related tweaks together (e.g. "Layout", "Colors", "Typography")',
                        ),
                    targetOid: z
                        .string()
                        .optional()
                        .describe('The Onlook OID of the element these tweaks primarily affect.'),
                }),
            )
            .describe('Array of related style tweaks for the UI.'),
    });

    static readonly icon = Icons.MixerHorizontal;

    async handle(
        args: z.infer<typeof CreateTweaksTool.parameters>,
        editorEngine: EditorEngine,
    ): Promise<{
        success: boolean;
        message: string;
    }> {
        try {
            // Validate that the variables exist in the code if OID is provided
            for (const tweak of args.tweaks) {
                if (tweak.targetOid) {
                    const metadata = await editorEngine.ast.mappings.getLayerNodeByOid(
                        tweak.targetOid,
                    );
                    if (metadata?.oid) {
                        const elementMetadata = await editorEngine.ast.getJsxElementMetadata(
                            metadata.oid,
                        );
                        if (elementMetadata?.code) {
                            if (!elementMetadata.code.includes(tweak.cssVariable)) {
                                return {
                                    success: false,
                                    message: `Validation Error: The CSS variable "${tweak.cssVariable}" was not found in the source code of the target element. You MUST first edit the code to use this variable (e.g. style={{ ${tweak.property}: 'var(${tweak.cssVariable})' }}) before calling this tool.`,
                                };
                            }
                        }
                    }
                }
            }

            editorEngine.tweaks.addTweaks(args.tweaks);
            editorEngine.state.leftPanelTab = LeftPanelTabValue.TWEAKS;
            editorEngine.state.leftPanelLocked = true;
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
