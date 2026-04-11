import { Icons } from '@onlook/ui/icons';
import type { EditorEngine } from '@onlook/web-client/src/components/store/editor/engine';
import { z } from 'zod';
import { ClientTool } from '../models/client';
import { BRANCH_ID_SCHEMA } from '../shared/type';
import { UploaderTool } from './uploader';

export class ScreenshotWebTool extends ClientTool {
    static readonly toolName = 'screenshot_web';
    static readonly description = `Take a screenshot of a specific URL or the current application page. 
    This tool allows you to perform an interaction before capturing the image and then tell the visual auditor exactly what to look for.

    KEY ARGUMENTS:
    1. 'url' (REQUIRED): The URL to screenshot. Use localhost URLs for local development; they will be automatically resolved to the sandbox preview URL.
    2. 'action' (INTERACTION): Use Stagehand/Playwright instructions to interact with the page before the screenshot. Use this when you need to change page state (e.g., "Click the signup button", "Hover over the nav menu", "Fill in the email field").
    3. 'focus' (ANALYSIS): Tell the Gemini Visual Auditor exactly what to verify in the resulting image. This prevents general audits and focuses on your specific change. ALWAYS provide specific verification criteria (e.g., "Is the button now showing a darker shade of blue?", "Does the error message appear under the email input?").
    4. 'delayMs' (TIMING): Optional delay before capture in milliseconds. Default is 1600ms. Increase for slow-loading pages or animations.
    5. 'scrollToId' (NAVIGATION): The ID of the element to scroll to before taking the screenshot. Use this to capture specific sections of long pages.
    6. 'visualAudit' (VERIFICATION): Whether to perform a Gemini-powered visual audit. Default is true. Set to false if you only need the image without analysis.

    WHEN TO USE THIS TOOL:
    - After making UI changes to verify the result
    - To check responsive design on different screen sizes
    - To verify hover states, click states, or other interactive elements
    - To debug layout issues or visual regressions
    - To capture the current state before making further changes

    EXAMPLES OF SYNERGY:
    - Verifying a Hover State: 
      action: "Hover over the primary button"
      focus: "Is the button now showing a darker shade of blue? Does a tooltip appear?"
    - Verifying a Color Change:
      focus: "Please focus on the 'Submit' button. Is it correctly colored red (#ef4444)?"
    - Verifying Error States:
      action: "Click the Submit button without filling the form"
      focus: "Check if a red validation error message appears under the email input."
    - Verifying Navigation:
      action: "Click the About link in the navigation"
      focus: "Did the page navigate to /about? Is the About page header visible?"
    - Checking Responsive Layout:
      focus: "Verify the layout is responsive. Are elements properly stacked on mobile? Is there no horizontal overflow?"

    BEST PRACTICES:
    - ALWAYS provide a specific 'focus' argument to guide the visual auditor
    - Use 'action' when you need to interact with the page before capturing
    - Increase 'delayMs' if the page has slow animations or loading states
    - Take screenshots at key milestones during complex multi-step changes
    - Re-screenshot after fixing issues identified in the visual audit
    - Use 'scrollToId' to capture specific sections of long pages

    The visual audit will return a STATUS (STABLE or BROKEN). If BROKEN, you MUST fix the identified issues and re-verify with another screenshot. DO NOT end the turn without fixing broken UI.`;

    static readonly parameters = z.object({
        url: z.string().url().describe('The URL to screenshot (e.g., http://localhost:3000/about)'),
        branchId: BRANCH_ID_SCHEMA,
        scrollToId: z.string().optional().describe('The ID of the element to scroll to before taking the screenshot'),
        delayMs: z.number().optional().describe('Wait before capture. (default: 1600)'),
        visualAudit: z.boolean().optional().default(true).describe('Whether to perform a Gemini-powered visual audit of the screenshot (default: true)'),
        action: z.string().optional().describe('Stagehand interaction (e.g. "Click the menu", "Hover over the button")'),
        focus: z.string().optional().describe('Visual analysis focus for Gemini (e.g. "Is the button red?", "Are there layout shifts?")'),
    });
    static readonly icon = Icons.Image;

    async handle(
        args: z.infer<typeof ScreenshotWebTool.parameters>,
        editorEngine: EditorEngine,
    ): Promise<{
        success: boolean;
        error: string | null;
        message?: string;
        auditPassed?: boolean;
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

            const { base64, visualAuditReport } = await editorEngine.api.screenshot(finalUrl, args.scrollToId, args.delayMs, args.visualAudit, args.action, args.focus);
            
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

            const auditFindings = visualAuditReport || "No visual audit was performed.";
            
            // Parse the STATUS line from the audit report for accurate pass/fail determination
            // The prompt instructs the AI to include: "- STATUS: STABLE" or "- STATUS: BROKEN [reason]"
            let auditPassed = true;
            const statusMatch = auditFindings.match(/- STATUS:\s*(STABLE|BROKEN)/i);
            if (statusMatch) {
                auditPassed = statusMatch[1].toUpperCase() === 'STABLE';
            } else {
                // Fallback to heuristic detection if STATUS line is not found
                const errorKeywords = ['broken', 'overlapping', 'not centered', 'missing', 'error', '404', 'failed', 'misaligned'];
                auditPassed = !errorKeywords.some(keyword => auditFindings.toLowerCase().includes(keyword));
            }
            
            let finalMessage = `${uploaderResult.message}\n\n### Visual Audit Report\n${auditFindings}`;
            if (!auditPassed) {
                finalMessage = `⚠️ [ACTION REQUIRED: UI IS BROKEN]\n${finalMessage}\n\nCRITICAL: The audit report indicates issues. You MUST provide a fix and re-verify. DO NOT end the turn.`;
            }

            return {
                success: true,
                error: uploaderResult.success ? null : uploaderResult.message,
                message: finalMessage,
                auditPassed,
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
