import { Icons } from '@onlook/ui/icons';
import type { EditorEngine } from '@onlook/web-client/src/components/store/editor/engine';
import { z } from 'zod';
import { generateVisualAudit } from '../../audit/visual-audit';
import { ClientTool } from '../models/client';
import { BRANCH_ID_SCHEMA } from '../shared/type';
import { UploaderTool } from './uploader';

export class ScreenshotWebTool extends ClientTool {
    static readonly toolName = 'screenshot_web';
    static readonly description = 'Take a screenshot of a specific URL or the current application page. If the user mentions a bug or UI issue on a specific page, use this to see it. By default, it waits 3 seconds for the page to load, but you can specify a custom delay.';
    static readonly parameters = z.object({
        url: z.string().url().describe('The URL to screenshot (e.g., http://localhost:3000/about)'),
        branchId: BRANCH_ID_SCHEMA,
        scrollToId: z.string().optional().describe('The ID of the element to scroll to before taking the screenshot'),
        delayMs: z.number().optional().describe('Optional delay in milliseconds to wait before taking the screenshot (default: 3000)'),
    });
    static readonly icon = Icons.Image;

    async handle(
        args: z.infer<typeof ScreenshotWebTool.parameters>,
        editorEngine: EditorEngine,
    ): Promise<{
        success: boolean;
        error: string | null;
        message?: string;
        image?: {
            base64: string;
            mimeType: string;
        };
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

            const { base64 } = await editorEngine.api.screenshot(finalUrl, args.scrollToId, args.delayMs);
            
            // Clean the base64 data and determine mime type
            let mimeType = 'image/png';
            let cleanBase64 = base64;
            const match = base64.match(/^data:([^;]+);base64,(.*)$/);
            if (match) {
                mimeType = match[1] ?? mimeType;
                cleanBase64 = match[2] ?? cleanBase64;
            }

            let displayName = 'Screenshot';
            try {
                const parsedUrl = new URL(finalUrl);
                displayName = `Screenshot of ${parsedUrl.pathname}`;
            } catch (e) {
                // Ignore parsing errors
            }

            const uploader = new UploaderTool();
            const uploaderResult = await uploader.handle({
                base64,
                displayName,
                branchId: args.branchId,
            }, editorEngine);

            // Perform dedicated visual audit (separate request)
            const auditFindings = await generateVisualAudit({
                base64: cleanBase64,
                mimeType,
            });

            return {
                success: true,
                error: uploaderResult.success ? null : uploaderResult.message,
                message: `${uploaderResult.message}\n\n### Visual Audit Report\n${auditFindings}`,
                image: {
                    base64: cleanBase64,
                    mimeType,
                },
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
