import { Icons } from '@onlook/ui/icons';
import type { EditorEngine } from '@onlook/web-client/src/components/store/editor/engine';
import { z } from 'zod';
import { ClientTool } from '../models/client';

export class ScreenshotRelevantTool extends ClientTool {
    static readonly toolName = 'screenshot_relevant';
    static readonly description = 'Take screenshots of all pages that were edited or created in this conversation. If a component was edited, this will screenshot the page(s) that include it.';
    static readonly parameters = z.object({});
    static readonly icon = Icons.Image;

    async handle(
        args: z.infer<typeof ScreenshotRelevantTool.parameters>,
        editorEngine: EditorEngine,
    ): Promise<{
        screenshots: { url: string; base64: string }[];
        success: boolean;
        error: string | null;
    }> {
        try {
            const modifiedPaths = await this.getModifiedPaths(editorEngine);
            if (modifiedPaths.size === 0) {
                return { screenshots: [], success: true, error: 'No modified files found in recent history.' };
            }

            const relevantUrls = await this.getRelevantUrls(modifiedPaths, editorEngine);
            if (relevantUrls.size === 0) {
                return { screenshots: [], success: true, error: 'Could not determine relevant URLs for modified files.' };
            }

            const screenshots: { url: string; base64: string }[] = [];
            for (const url of relevantUrls) {
                try {
                    const { base64 } = await editorEngine.api.screenshot(url);
                    screenshots.push({ url, base64 });
                } catch (e) {
                    console.error(`Failed to screenshot ${url}:`, e);
                }
            }

            return {
                screenshots,
                success: true,
                error: screenshots.length === 0 ? 'Failed to capture any screenshots' : null,
            };
        } catch (error: any) {
            console.error('Screenshot relevant failed:', error);
            return {
                screenshots: [],
                success: false,
                error: error.message || 'Failed to capture relevant screenshots',
            };
        }
    }

    private async getModifiedPaths(editorEngine: EditorEngine): Promise<Set<string>> {
        const paths = new Set<string>();
        // @ts-ignore - access private field for tool logic
        const undoStack = editorEngine.history.undoStack;

        for (const action of undoStack) {
            if (action.type === 'write-code') {
                action.diffs.forEach(diff => paths.add(diff.path));
            } else if ('targets' in action) {
                for (const target of action.targets) {
                    if (target.oid) {
                        try {
                            const branchData = editorEngine.branches.getBranchDataById(target.branchId);
                            const codeEditor = branchData?.codeEditor || editorEngine.fileSystem;
                            const metadata = await codeEditor.getJsxElementMetadata(target.oid);
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
        const previewBaseUrl = editorEngine.activeSandbox.session.signedPreviewUrl;
        if (!previewBaseUrl) return urls;

        for (const path of paths) {
            // Check if it's a page
            const pageRoute = this.getPageRoute(path);
            if (pageRoute !== null) {
                urls.add(new URL(pageRoute, previewBaseUrl).toString());
                continue;
            }

            // If it's a component, try to find pages that use it
            if (path.includes('/components/') || path.endsWith('.tsx') || path.endsWith('.ts')) {
                const pagesUsingComponent = await this.findPagesUsingFile(path, editorEngine);
                for (const route of pagesUsingComponent) {
                    urls.add(new URL(route, previewBaseUrl).toString());
                }
            }
        }
        return urls;
    }

    private getPageRoute(path: string): string | null {
        // Match Next.js app router pages: src/app/**/page.tsx
        const match = path.match(/src\/app\/(.*)\/page\.tsx$/);
        if (match) {
            const route = match[1];
            if (route === '.') return '/';
            // Remove route groups like (auth)
            return '/' + route.split('/').filter(s => !s.startsWith('(') || !s.endsWith(')')).join('/');
        }
        // Root page
        if (path.endsWith('src/app/page.tsx')) return '/';
        return null;
    }

    private async findPagesUsingFile(filePath: string, editorEngine: EditorEngine): Promise<string[]> {
        const routes: string[] = [];
        try {
            // Heuristic: search for the filename (without extension) in the app directory
            const fileName = filePath.split('/').pop()?.split('.')[0];
            if (!fileName) return routes;

            const sandbox = editorEngine.activeSandbox;
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
