import { Icons } from '@onlook/ui/icons';
import type { EditorEngine } from '@onlook/web-client/src/components/store/editor/engine';
import type { Action } from '@onlook/models/actions';
import { z } from 'zod';
import { ClientTool } from '../models/client';
import { BRANCH_ID_SCHEMA } from '../shared/type';
import { UploaderTool } from './uploader';

export class ScreenshotRelevantTool extends ClientTool {
    static readonly toolName = 'screenshot_relevant';
    static readonly description = 'Take screenshots of all pages that were edited or created in this conversation. If a component was edited, this will screenshot the page(s) that include it.';
    static readonly parameters = z.object({
        branchId: BRANCH_ID_SCHEMA,
        delayMs: z.number().optional().describe('Optional delay in milliseconds to wait before each screenshot (default: 3000)'),
    });
    static readonly icon = Icons.Image;

    async handle(
        args: z.infer<typeof ScreenshotRelevantTool.parameters>,
        editorEngine: EditorEngine,
    ): Promise<{
        success: boolean;
        error: string | null;
        message?: string;
        images?: {
            base64: string;
            mimeType: string;
            displayName: string;
        }[];
    }> {
        try {
            const modifiedPaths = await this.getModifiedPaths(editorEngine);
            if (modifiedPaths.size === 0) {
                return { success: true, error: 'No modified files found in recent history.' };
            }

            const activeSandbox = editorEngine.activeSandbox;
            const signedPreviewUrl = activeSandbox?.session.signedPreviewUrl;

            if (!signedPreviewUrl) {
                return { success: false, error: 'No active sandbox with a public preview URL found. Please ensure your sandbox is running.' };
            }

            const relevantUrls = await this.getRelevantUrls(modifiedPaths, editorEngine);
            if (relevantUrls.size === 0) {
                return { success: true, error: `Could not determine relevant URLs for modified files: ${Array.from(modifiedPaths).join(', ')}` };
            }

            const uploadedMessages: string[] = [];
            const images: { base64: string, mimeType: string, displayName: string }[] = [];
            const uploader = new UploaderTool();

            for (const url of relevantUrls) {
                try {
                    const { base64 } = await editorEngine.api.screenshot(url, undefined, args.delayMs);
                    
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
                        const parsedUrl = new URL(url);
                        displayName = `Screenshot of ${parsedUrl.pathname}`;
                    } catch (e) {
                    }
                    images.push({ base64: cleanBase64, mimeType, displayName });

                    const msg = await uploader.handle({
                        base64,
                        displayName,
                        branchId: args.branchId,
                    }, editorEngine);
                    uploadedMessages.push(msg.message);
                } catch (e) {
                    console.error(`Failed to screenshot ${url}:`, e);
                }
            }

            return {
                success: true,
                error: uploadedMessages.length === 0 ? 'Failed to capture any screenshots' : null,
                message: uploadedMessages.join('\n'),
                images,
            };
        } catch (error: any) {
            console.error('Screenshot relevant failed:', error);
            return {
                success: false,
                error: error.message || 'Failed to capture relevant screenshots',
            };
        }
    }

    private async getModifiedPaths(editorEngine: EditorEngine): Promise<Set<string>> {
        const paths = new Set<string>();
        // @ts-ignore - access private field for tool logic
        const undoStack = (editorEngine.history as any).undoStack as Action[];

        for (const action of undoStack) {
            if (action.type === 'write-code') {
                (action as any).diffs.forEach((diff: any) => paths.add(diff.path));
            } else if ('targets' in action) {
                const targets = (action as any).targets as any[];
                for (const target of targets) {
                    if ((target as any).oid) {
                        try {
                            const branchData = editorEngine.branches.getBranchDataById((target as any).branchId);
                            const codeEditor = branchData?.codeEditor || editorEngine.fileSystem;
                            const metadata = await codeEditor.getJsxElementMetadata((target as any).oid);
                            if (metadata?.path) {
                                paths.add(metadata.path);
                            }
                        } catch (e) {
                            // Ignore metadata failures
                        }
                    }
                }
            }
        }
        return paths;
    }

    private async getRelevantUrls(paths: Set<string>, editorEngine: EditorEngine): Promise<Set<string>> {
        const urls = new Set<string>();
        const signedPreviewUrl = editorEngine.activeSandbox?.session.signedPreviewUrl;
        if (!signedPreviewUrl) return urls;

        for (const path of paths) {
            console.log(`[ScreenshotRelevantTool] Mapping path to route: ${path}`);
            const pageRoute = this.getPageRoute(path);
            if (pageRoute !== null) {
                urls.add(new URL(pageRoute, signedPreviewUrl).toString());
                continue;
            }

            // If it's a component, try to find pages that use it
            if (path.includes('/components/') || path.endsWith('.tsx') || path.endsWith('.ts')) {
                const pagesUsingComponent = await this.findPagesUsingFile(path, editorEngine);
                for (const route of pagesUsingComponent) {
                    urls.add(new URL(route, signedPreviewUrl).toString());
                }
            }
        }
        return urls;
    }

    private getPageRoute(path: string): string | null {
        // Handle common monorepo prefixes in this project
        const appPrefixes = ['apps/web/client/', 'apps/web/server/', 'packages/ai/'];
        let normalizedPath = path;
        for (const prefix of appPrefixes) {
            if (normalizedPath.startsWith(prefix)) {
                normalizedPath = normalizedPath.substring(prefix.length);
                break;
            }
        }

        // Match Next.js app router pages: src/app/**/page.tsx
        const match = normalizedPath.match(/^src\/app\/(.*)\/page\.tsx$/);
        if (match) {
            const route = match[1];
            if (!route || route === '.') return '/';
            // Remove route groups like (auth)
            const cleanRoute = '/' + route.split('/').filter(s => !s.startsWith('(') && !s.endsWith(')')).join('/');
            return cleanRoute.replace(/\/+/g, '/'); // Ensure no double slashes
        }

        // Handle Next.js pages router (fallback)
        const pagesMatch = normalizedPath.match(/^src\/pages\/(.*)\.(tsx|ts|js|jsx)$/);
        if (pagesMatch) {
            const route = pagesMatch[1];
            if (route === 'index' || route === '_app' || route === '_document') return '/';
            return '/' + route;
        }

        // Root page
        if (normalizedPath === 'src/app/page.tsx') return '/';
        return null;
    }

    private async findPagesUsingFile(filePath: string, editorEngine: EditorEngine): Promise<string[]> {
        const routes: string[] = [];
        try {
            // Heuristic: search for the filename (without extension) in the app directory
            const fileName = filePath.split('/').pop()?.split('.')[0];
            if (!fileName) return routes;

            const sandbox = editorEngine.activeSandbox;
            if (!sandbox) return routes;

            // Grep for the component name in src/app
            const command = `grep -lR "${fileName}" src/app`;
            const result = await sandbox.session.runCommand(command);

            if (result.success && result.output) {
                const files = result.output.split('\n').filter(Boolean);
                for (const file of files) {
                    const route = this.getPageRoute(file);
                    if (route) routes.push(route);
                }
            }
        } catch (e) {
            console.error('Failed to find pages using file:', e);
        }
        return routes;
    }

    static getLabel(): string {
        return 'Screenshotting relevant pages';
    }
}
