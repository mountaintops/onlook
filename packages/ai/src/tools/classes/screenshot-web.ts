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
            const isLocalhost = finalUrl.includes('localhost') || finalUrl.includes('127.0.0.1');

            if (isLocalhost) {
                const activeSandbox = editorEngine.activeSandbox;
                const signedPreviewUrl = activeSandbox?.session.signedPreviewUrl;

                if (signedPreviewUrl) {
                    try {
                        const localUrl = new URL(finalUrl);
                        const publicUrl = new URL(signedPreviewUrl);
                        
                        // Merge the path and search params from the local URL into the public URL
                        publicUrl.pathname = localUrl.pathname;
                        publicUrl.search = localUrl.search;
                        finalUrl = publicUrl.toString();

                        console.log(`[ScreenshotWebTool] Resolved local URL to sandbox URL: ${finalUrl}`);
                    } catch (e) {
                        console.error('Failed to resolve localhost URL:', e);
                    }
                } else {
                    // Fail if it's localhost but no sandbox is available to resolve it
                    return {
                        success: false,
                        error: `The URL "${args.url}" is local and cannot be accessed by the screenshot service. Please ensure your sandbox is active or provide a public URL.`,
                    };
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
