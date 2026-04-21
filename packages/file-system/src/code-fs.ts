import debounce from 'lodash.debounce';

import { ONLOOK_CACHE_DIRECTORY, ONLOOK_PRELOAD_SCRIPT_FILE } from '@onlook/constants';
import { RouterType } from '@onlook/models';
import {
    addOidsToAst,
    createTemplateNodeMap,
    formatContent,
    getAstFromContent,
    getContentFromAst,
    getContentFromTemplateNode,
    injectPreloadScript,
} from '@onlook/parser';
import { isRootLayoutFile, pathsEqual } from '@onlook/utility';

import type { JsxElementMetadata } from './index-cache';
import { FileSystem } from './fs';
import {
    clearIndexCache,
    getIndexFromCache,
    getOrLoadIndex,
    saveIndexToCache,
} from './index-cache';

export type { JsxElementMetadata } from './index-cache';

export interface CodeEditorOptions {
    routerType?: RouterType;
}

export interface WriteCallback {
    (path: string, content: string | Uint8Array): void;
}

export class CodeFileSystem extends FileSystem {
    private projectId: string;
    private branchId: string;
    private options: Required<CodeEditorOptions>;
    private indexPath = `${ONLOOK_CACHE_DIRECTORY}/index.json`;
    private writeCallbacks: WriteCallback[] = [];

    constructor(projectId: string, branchId: string, options: CodeEditorOptions = {}) {
        super(`/${projectId}/${branchId}`);
        this.projectId = projectId;
        this.branchId = branchId;
        this.options = {
            routerType: options.routerType ?? RouterType.APP,
        };
    }

    onWrite(callback: WriteCallback): () => void {
        this.writeCallbacks.push(callback);
        return () => {
            const index = this.writeCallbacks.indexOf(callback);
            if (index > -1) {
                this.writeCallbacks.splice(index, 1);
            }
        };
    }

    async writeFile(path: string, content: string | Uint8Array): Promise<void> {
        await this.writeBatch([{ type: 'file', path, content }]);
    }

    async writeFiles(files: Array<{ path: string; content: string | Uint8Array }>): Promise<void> {
        await this.writeBatch(files.map(f => ({ type: 'file', path: f.path, content: f.content })));
    }

    async writeBatch(actions: Array<{ type: 'file' | 'folder'; path: string; content?: string | Uint8Array }>): Promise<void> {
        const index = await this.loadIndex();
        let hasIndexChanges = false;

        // Process files in batches for better performance but manageable concurrency
        const BATCH_SIZE = 5;
        for (let i = 0; i < actions.length; i += BATCH_SIZE) {
            const batch = actions.slice(i, i + BATCH_SIZE);

            await Promise.all(batch.map(async (action) => {
                try {
                    if (action.type === 'folder') {
                        await this.createDirectory(action.path);
                        return;
                    }

                    const { path, content } = action;
                    if (this.isJsxFile(path) && typeof content === 'string') {
                        // For JSX files, we process and update metadata
                        const processedContent = await this.processJsxBatch(path, content, index);
                        await super.writeFile(path, processedContent);
                        hasIndexChanges = true;
                    } else {
                        // For non-JSX files, just write normally
                        await super.writeFile(path, content || '');
                    }

                    // Notify listeners
                    for (const callback of this.writeCallbacks) {
                        try {
                            callback(path, content || '');
                        } catch (error) {
                            console.error('[CodeFileSystem] Error in write callback:', error);
                        }
                    }
                } catch (error) {
                    console.error(`[CodeFileSystem] Error processing batch action for ${action.path}:`, error);
                }
            }));
        }

        if (hasIndexChanges) {
            await this.saveIndex(index);
        }
    }

    private async processJsxBatch(path: string, content: string, index: Record<string, JsxElementMetadata>): Promise<string> {
        let processedContent = content;

        const ast = getAstFromContent(content);
        if (ast) {
            if (isRootLayoutFile(path, this.options.routerType)) {
                injectPreloadScript(ast);
            }

            // Get existing OIDs from the provided index instead of reloading it
            const existingOids = new Set<string>();
            for (const [oid, metadata] of Object.entries(index)) {
                if (pathsEqual(metadata.path, path)) {
                    existingOids.add(oid);
                    delete index[oid]; // Clear existing metadata for this file
                }
            }

            const { ast: processedAst } = addOidsToAst(ast, existingOids);
            processedContent = await getContentFromAst(processedAst, content);

            const formattedContent = await formatContent(path, processedContent);

            // Re-parse formatted content to get accurate positions for template nodes
            const finalAst = getAstFromContent(formattedContent);
            if (finalAst) {
                const templateNodeMap = createTemplateNodeMap({
                    ast: finalAst,
                    filename: path,
                    branchId: this.branchId,
                });

                for (const [oid, node] of templateNodeMap.entries()) {
                    const code = await getContentFromTemplateNode(node, formattedContent);
                    index[oid] = {
                        ...node,
                        oid,
                        code: code || '',
                    };
                }
            }

            return formattedContent;
        } else {
            console.warn(`Failed to parse ${path}, skipping OID injection but will still format`);
            return formatContent(path, content);
        }
    }

    async getJsxElementMetadata(oid: string): Promise<JsxElementMetadata | undefined> {
        const index = await this.loadIndex();
        const metadata = index[oid];
        if (!metadata) {
            console.warn(
                `[CodeEditorApi] No metadata found for OID: ${oid}. Total index size: ${Object.keys(index).length}`,
            );
        }
        return metadata;
    }

    async rebuildIndex(): Promise<void> {
        const startTime = Date.now();
        const index: Record<string, JsxElementMetadata> = {};

        const entries = await this.listAll();
        const jsxFiles = entries.filter(
            (entry) => entry.type === 'file' && this.isJsxFile(entry.path),
        );

        const BATCH_SIZE = 10;
        let processedCount = 0;

        for (let i = 0; i < jsxFiles.length; i += BATCH_SIZE) {
            const batch = jsxFiles.slice(i, i + BATCH_SIZE);
            await Promise.all(
                batch.map(async (entry) => {
                    try {
                        const content = await this.readFile(entry.path);
                        if (typeof content === 'string') {
                            const ast = getAstFromContent(content);
                            if (!ast) return;

                            const templateNodeMap = createTemplateNodeMap({
                                ast,
                                filename: entry.path,
                                branchId: this.branchId,
                            });

                            for (const [oid, node] of templateNodeMap.entries()) {
                                const code = await getContentFromTemplateNode(node, content);
                                index[oid] = {
                                    ...node,
                                    oid,
                                    code: code || '',
                                };
                            }

                            processedCount++;
                        }
                    } catch (error) {
                        console.error(`Error indexing ${entry.path}:`, error);
                    }
                }),
            );
        }

        await this.saveIndex(index);

        const duration = Date.now() - startTime;
        console.log(
            `[CodeEditorApi] Index built: ${Object.keys(index).length} elements from ${processedCount} files in ${duration}ms`,
        );
    }

    async deleteFile(path: string): Promise<void> {
        await super.deleteFile(path);

        if (this.isJsxFile(path)) {
            const index = await this.loadIndex();
            let hasChanges = false;

            for (const [oid, metadata] of Object.entries(index)) {
                if (pathsEqual(metadata.path, path)) {
                    delete index[oid];
                    hasChanges = true;
                }
            }

            if (hasChanges) {
                await this.saveIndex(index);
            }
        }
    }

    async moveFile(oldPath: string, newPath: string): Promise<void> {
        await super.moveFile(oldPath, newPath);

        if (this.isJsxFile(oldPath) && this.isJsxFile(newPath)) {
            const index = await this.loadIndex();
            let hasChanges = false;

            for (const metadata of Object.values(index)) {
                if (pathsEqual(metadata.path, oldPath)) {
                    metadata.path = newPath;
                    hasChanges = true;
                }
            }

            if (hasChanges) {
                await this.saveIndex(index);
            }
        }
    }

    private async loadIndex(): Promise<Record<string, JsxElementMetadata>> {
        return getOrLoadIndex(this.getCacheKey(), this.indexPath, (path) => this.readFile(path));
    }

    private async saveIndex(index: Record<string, JsxElementMetadata>): Promise<void> {
        saveIndexToCache(this.getCacheKey(), index);
        void this.debouncedSaveIndexToFile();
    }

    private async undobounceSaveIndexToFile(): Promise<void> {
        try {
            await this.createDirectory(ONLOOK_CACHE_DIRECTORY);
            const index = getIndexFromCache(this.getCacheKey());
            if (index) {
                await super.writeFile(this.indexPath, JSON.stringify(index));
            }
        } catch (error) {
            console.warn(`[CodeEditorApi] Failed to save index to file:`, error);
        }
    }

    private debouncedSaveIndexToFile = debounce(this.undobounceSaveIndexToFile, 1000);

    private isJsxFile(path: string): boolean {
        // Exclude the onlook preload script from JSX processing
        if (path.endsWith(ONLOOK_PRELOAD_SCRIPT_FILE)) {
            return false;
        }
        return /\.(jsx?|tsx?)$/i.test(path);
    }

    async cleanup(): Promise<void> {
        const cacheKey = this.getCacheKey();
        if (getIndexFromCache(cacheKey)) {
            await this.undobounceSaveIndexToFile();
        }

        clearIndexCache(cacheKey);
        super.cleanup();
    }

    private getCacheKey(): string {
        return `${this.projectId}/${this.branchId}`;
    }
}
