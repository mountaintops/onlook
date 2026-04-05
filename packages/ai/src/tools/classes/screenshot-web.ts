import { Icons } from '@onlook/ui/icons';
import type { EditorEngine } from '@onlook/web-client/src/components/store/editor/engine';
import { z } from 'zod';
import { ClientTool } from '../models/client';
import { BRANCH_ID_SCHEMA } from '../shared/type';
import { UploaderTool } from './uploader';

export class ScreenshotWebTool extends ClientTool {
    static readonly toolName = 'screenshot_web';
    static readonly description = 'Take a screenshot of a specific URL or the current application page. If the user mentions a bug or UI issue on a specific page, use this to see it.';
    static readonly parameters = z.object({
        url: z.string().url().describe('The URL to screenshot (e.g., http://localhost:3000/about)'),
        branchId: BRANCH_ID_SCHEMA,
        scrollToId: z.string().optional().describe('The ID of the element to scroll to before taking the screenshot'),
    });
    static readonly icon = Icons.Image;

    async handle(
        args: z.infer<typeof ScreenshotWebTool.parameters>,
        editorEngine: EditorEngine,
    ): Promise<{
        success: boolean;
        error: string | null;
        message?: string;
    }> {
        try {
            let finalUrl = args.url;

            // Resolve localhost to public sandbox URL if available
            if (
                finalUrl.startsWith('http://localhost') ||
                finalUrl.startsWith('http://127.0.0.1')
            ) {
                const signedPreviewUrl = editorEngine.activeSandbox?.session.signedPreviewUrl;
                if (signedPreviewUrl) {
                    try {
                        const localUrl = new URL(finalUrl);
                        const publicUrl = new URL(signedPreviewUrl);
                        // Transfer path and search params
                        publicUrl.pathname = localUrl.pathname;
                        publicUrl.search = localUrl.search;
                        finalUrl = publicUrl.toString();
                        console.log(
                            `📡 Resolved local URL ${args.url} to public sandbox URL: ${finalUrl}`,
                        );
                    } catch (e) {
                        console.warn('Failed to parse or resolve URL:', e);
                    }
                }
            }

            const { base64 } = await editorEngine.api.screenshot(finalUrl, args.scrollToId);
            
            let displayName = 'Screenshot';
            try {
                const parsedUrl = new URL(finalUrl);
                displayName = `Screenshot of ${parsedUrl.pathname}`;
            } catch (e) {
                // Ignore parsing errors
            }

            const uploader = new UploaderTool();
            const message = await uploader.handle({
                base64,
                displayName,
                branchId: args.branchId,
            }, editorEngine);

            return {
                success: true,
                error: null,
                message,
            };
        } catch (error: any) {
            console.error('Screenshot failed:', error);
            return {
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
