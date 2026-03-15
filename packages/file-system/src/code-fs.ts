import debounce from 'lodash.debounce';
import type { DocHandle } from '@automerge/automerge-repo';
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
    automergeHandle?: DocHandle<any>;
}

export class CodeFileSystem extends FileSystem {
    private projectId: string;
    private branchId: string;
    private options: Required<CodeEditorOptions>;
    private indexPath = `${ONLOOK_CACHE_DIRECTORY}/index.json`;
    private automergeHandle?: DocHandle<any>;

    constructor(projectId: string, branchId: string, options: CodeEditorOptions = {}) {
        super(`/${projectId}/${branchId}`);
        this.projectId = projectId;
        this.branchId = branchId;
        this.automergeHandle = options.automergeHandle;
        this.options = {
            routerType: options.routerType ?? RouterType.APP,
            automergeHandle: options.automergeHandle ?? (null as any),
        };
    }

    async initialize(): Promise<void> {
        await super.initialize();

        if (this.automergeHandle) {
            // Use AbortController for a 3-second timeout on whenReady()
            // If it's not ready by then, we proceed with ZenFS as source
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 3000);

            try {
                await this.automergeHandle.whenReady(undefined, { signal: controller.signal });
                clearTimeout(timeoutId);

                const doc = this.automergeHandle.docSync();
                if (doc && doc.files && Object.keys(doc.files).length > 0) {
                    console.log(
                        `[Automerge] Restoring ${Object.keys(doc.files).length} files from Automerge to ZenFS`,
                    );
                    for (const [path, content] of Object.entries(doc.files)) {
                        try {
                            const existing = await super.readFile(path);
                            if (existing !== content) {
                                await super.writeFile(path, content as string | Uint8Array);
                            }
                        } catch (e) {
                            await super.writeFile(path, content as string | Uint8Array);
                        }
                    }
                } else {
                    console.log(`[Automerge] Automerge document is empty, populating from ZenFS`);
                    const entries = await this.listAll();
                    const filesToPopulate: Record<string, string | Uint8Array> = {};
                    
                    for (const entry of entries) {
                        if (entry.type === 'file') {
                            const content = await super.readFile(entry.path);
                            filesToPopulate[entry.path] = content;
                        }
                    }

                    if (Object.keys(filesToPopulate).length > 0) {
                        this.automergeHandle.change((d: any) => {
                            if (!d.files) d.files = {};
                            for (const [path, content] of Object.entries(filesToPopulate)) {
                                d.files[path] = content;
                            }
                        });
                    }
                }
            } catch (e: any) {
                clearTimeout(timeoutId);
                console.warn(`[Automerge] DocHandle not ready after timeout, skipping Automerge sync`, e.name === 'AbortError' ? '(Timeout)' : e);
            }
        }
    }

    async writeFile(path: string, content: string | Uint8Array): Promise<void> {
        // Update Automerge if handle is available
        if (this.automergeHandle) {
            this.automergeHandle.change((d: any) => {
                if (!d.files) d.files = {};
                d.files[path] = content;
            });
        }

        if (this.isJsxFile(path) && typeof content === 'string') {
            const processedContent = await this.processJsxFile(path, content);
            await super.writeFile(path, processedContent);
        } else {
            await super.writeFile(path, content);
        }
    }

    async writeFiles(files: Array<{ path: string; content: string | Uint8Array }>): Promise<void> {
        // Update Automerge in a single batch
        if (this.automergeHandle) {
            this.automergeHandle.change((d: any) => {
                if (!d.files) d.files = {};
                for (const { path, content } of files) {
                    d.files[path] = content;
                }
            });
        }

        // Write files sequentially to ZenFS to avoid race conditions to metadata file
        for (const { path, content } of files) {
            if (this.isJsxFile(path) && typeof content === 'string') {
                const processedContent = await this.processJsxFile(path, content);
                await super.writeFile(path, processedContent);
            } else {
                await super.writeFile(path, content);
            }
        }
    }

    private async processJsxFile(path: string, content: string): Promise<string> {
        let processedContent = content;

        const ast = getAstFromContent(content);
        if (ast) {
            if (isRootLayoutFile(path, this.options.routerType)) {
                injectPreloadScript(ast);
            }

            const existingOids = await this.getFileOids(path);
            const { ast: processedAst } = addOidsToAst(ast, existingOids);

            processedContent = await getContentFromAst(processedAst, content);
        } else {
            console.warn(`Failed to parse ${path}, skipping OID injection but will still format`);
        }

        const formattedContent = await formatContent(path, processedContent);
        await this.updateMetadataForFile(path, formattedContent);

        return formattedContent;
    }

    private async getFileOids(path: string): Promise<Set<string>> {
        const index = await this.loadIndex();

        const oids = new Set<string>();
        for (const [oid, metadata] of Object.entries(index)) {
            if (pathsEqual(metadata.path, path)) {
                oids.add(oid);
            }
        }
        return oids;
    }

    private async updateMetadataForFile(path: string, content: string): Promise<void> {
        const index = await this.loadIndex();

        for (const [oid, metadata] of Object.entries(index)) {
            if (pathsEqual(metadata.path, path)) {
                delete index[oid];
            }
        }

        const ast = getAstFromContent(content);
        if (!ast) return;

        const templateNodeMap = createTemplateNodeMap({
            ast,
            filename: path,
            branchId: this.branchId,
        });

        for (const [oid, node] of templateNodeMap.entries()) {
            const code = await getContentFromTemplateNode(node, content);
            const metadata: JsxElementMetadata = {
                ...node,
                oid,
                code: code || '',
            };
            index[oid] = metadata;
        }

        await this.saveIndex(index);
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
        // Update Automerge if handle is available
        if (this.automergeHandle) {
            this.automergeHandle.change((d: any) => {
                if (d.files && d.files[path]) {
                    delete d.files[path];
                }
            });
        }

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
        // Update Automerge if handle is available
        if (this.automergeHandle) {
            this.automergeHandle.change((d: any) => {
                if (d.files && d.files[oldPath]) {
                    d.files[newPath] = d.files[oldPath];
                    delete d.files[oldPath];
                }
            });
        }

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
