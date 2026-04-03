import { Icons } from '@onlook/ui/icons';
import type { EditorEngine } from '@onlook/web-client/src/components/store/editor/engine';
import { z } from 'zod';
import { ClientTool } from '../models/client';

export class ScreenshotWebTool extends ClientTool {
    static readonly toolName = 'screenshot_web';
    static readonly description = 'Take a screenshot of a specific URL or the current application page. If the user mentions a bug or UI issue on a specific page, use this to see it.';
    static readonly parameters = z.object({
        url: z.string().url().describe('The URL to screenshot (e.g., http://localhost:3000/about)'),
    });
    static readonly icon = Icons.Image;

    async handle(
        args: z.infer<typeof ScreenshotWebTool.parameters>,
        editorEngine: EditorEngine,
    ): Promise<{
        base64: string;
        success: boolean;
        error: string | null;
    }> {
        try {
            const { base64 } = await editorEngine.api.screenshot(args.url);
            return {
                base64,
                success: true,
                error: null,
            };
        } catch (error: any) {
            console.error('Screenshot failed:', error);
            return {
                base64: '',
                success: false,
                error: error.message || 'Failed to capture screenshot',
            };
        }
    }

    static getLabel(input?: z.infer<typeof ScreenshotWebTool.parameters>): string {
        if (input?.url) {
            try {
                return 'Screenshotting ' + (new URL(input.url).hostname || 'URL');
            } catch {
                return 'Screenshotting URL';
            }
        }
        return 'Taking screenshot';
    }
}
