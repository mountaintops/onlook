import { CodeProviderSync } from '@/services/sync-engine/sync-engine';
import type { ISandboxAdapter } from '@onlook/code-provider';
import { EXCLUDED_SYNC_PATHS } from '@onlook/constants';
import type { CodeFileSystem } from '@onlook/file-system';
import { type FileEntry } from '@onlook/file-system';
import type { Branch, RouterConfig } from '@onlook/models';
import { makeAutoObservable, reaction, runInAction } from 'mobx';
import type { EditorEngine } from '../engine';
import type { ErrorManager } from '../error';
import { GitManager } from '../git';
import { detectRouterConfig } from '../pages/helper';
import { copyPreloadScriptToPublic, getLayoutPath as detectLayoutPath } from './preload-script';
import { SessionManager } from './session';
import { DEFAULT_FILES } from './fallback';

export enum PreloadScriptState {
    NOT_INJECTED = 'not-injected',
    LOADING = 'loading',
    INJECTED = 'injected'
}
export class SandboxManager {
    readonly session: SessionManager;
    readonly gitManager: GitManager;
    private providerReactionDisposer?: () => void;
    private sync: CodeProviderSync | null = null;
    preloadScriptState: PreloadScriptState = PreloadScriptState.NOT_INJECTED
    routerConfig: RouterConfig | null = null;
    files: Record<string, string> = { ...DEFAULT_FILES };
    private watchDisposer: (() => void) | null = null;

    constructor(
        private branch: Branch,
        private readonly editorEngine: EditorEngine,
        private readonly errorManager: ErrorManager,
        private readonly fs: CodeFileSystem,
    ) {
        this.session = new SessionManager(this.branch, this.errorManager);
        this.gitManager = new GitManager(this);
        makeAutoObservable(this);
    }

    async init() {
        // Start connection asynchronously (don't wait)
        if (!this.session.provider) {
            this.session.start(this.branch.sandbox.id).catch(err => {
                console.error('[SandboxManager] Initial connection failed:', err);
                // Don't throw - let reaction handle retries/reconnects
            });
        }

        // React to provider becoming available (now or later)
        this.providerReactionDisposer = reaction(
            () => this.session.provider,
            async (provider) => {
                if (provider && this.session.adapter) {
                    await this.initializeSyncEngine(this.session.adapter);
                    await this.gitManager.init();
                } else if (this.sync) {
                    // If the provider is null, release the sync engine reference
                    this.sync.release();
                    this.sync = null;
                }
            },
            { fireImmediately: true },
        );

        // Initialize file watching
        this.loadFiles();
        this.watchFiles();
    }

    async getRouterConfig(): Promise<RouterConfig | null> {
        if (!!this.routerConfig) {
            return this.routerConfig;
        }
        if (!this.session.provider) {
            throw new Error('Provider not initialized');
        }
        this.routerConfig = await detectRouterConfig(this.session.provider);
        return this.routerConfig;
    }

    async initializeSyncEngine(adapter: ISandboxAdapter) {
        if (this.sync) {
            this.sync.release();
            this.sync = null;
        }

        this.sync = CodeProviderSync.getInstance(adapter, this.fs, this.branch.sandbox.id, {
            exclude: EXCLUDED_SYNC_PATHS,
        });

        await this.sync.start();
        await this.ensurePreloadScriptExists();
        await this.fs.rebuildIndex();
    }

    private async ensurePreloadScriptExists(): Promise<void> {
        try {
            if (this.preloadScriptState !== PreloadScriptState.NOT_INJECTED
            ) {
                return;
            }

            this.preloadScriptState = PreloadScriptState.LOADING

            if (!this.session.provider) {
                throw new Error('No provider available for preload script injection');
            }

            const routerConfig = await this.getRouterConfig();
            if (!routerConfig) {
                throw new Error('No router config found for preload script injection');
            }

            await copyPreloadScriptToPublic(this.session.provider, routerConfig);
            this.preloadScriptState = PreloadScriptState.INJECTED
        } catch (error) {
            console.error('[SandboxManager] Failed to ensure preload script exists:', error);
            // Mark as injected to prevent blocking frames indefinitely
            // Frames will handle the missing preload script gracefully
            this.preloadScriptState = PreloadScriptState.NOT_INJECTED
        }
    }

    async getLayoutPath(): Promise<string | null> {
        const routerConfig = await this.getRouterConfig();
        if (!routerConfig) {
            return null;
        }
        return detectLayoutPath(routerConfig, (path) => this.fileExists(path));
    }

    get errors() {
        return this.errorManager.errors;
    }

    get syncEngine() {
        return this.sync;
    }

    async readFile(path: string): Promise<string | Uint8Array> {
        if (!this.fs) throw new Error('File system not initialized');
        return this.fs.readFile(path);
    }

    async writeFile(path: string, content: string | Uint8Array): Promise<void> {
        if (!this.fs) throw new Error('File system not initialized');
        return this.fs.writeFile(path, content);
    }

    listAllFiles() {
        if (!this.fs) throw new Error('File system not initialized');
        return this.fs.listAll();
    }

    async readDir(dir: string): Promise<FileEntry[]> {
        if (!this.fs) throw new Error('File system not initialized');
        return this.fs.readDirectory(dir);
    }

    async listFilesRecursively(dir: string): Promise<string[]> {
        if (!this.fs) throw new Error('File system not initialized');
        return this.fs.listFiles(dir);
    }

    async fileExists(path: string): Promise<boolean> {
        if (!this.fs) throw new Error('File system not initialized');
        return this.fs?.exists(path);
    }

    async copyFile(path: string, targetPath: string): Promise<void> {
        if (!this.fs) throw new Error('File system not initialized');
        return this.fs.copyFile(path, targetPath);
    }

    async copyDirectory(path: string, targetPath: string): Promise<void> {
        if (!this.fs) throw new Error('File system not initialized');
        return this.fs.copyDirectory(path, targetPath);
    }

    async deleteFile(path: string): Promise<void> {
        if (!this.fs) throw new Error('File system not initialized');
        return this.fs.deleteFile(path);
    }

    async deleteDirectory(path: string): Promise<void> {
        if (!this.fs) throw new Error('File system not initialized');
        return this.fs.deleteDirectory(path);
    }

    async rename(oldPath: string, newPath: string): Promise<void> {
        if (!this.fs) throw new Error('File system not initialized');
        return this.fs.moveFile(oldPath, newPath);
    }

    // Download the code as a zip
    async downloadFiles(
        projectName?: string,
    ): Promise<{ downloadUrl: string; fileName: string } | null> {
        if (!this.session.provider) {
            console.error('No sandbox provider found for download');
            return null;
        }
        try {
            const { url } = await this.session.adapter!.downloadFiles('./');
            return {
                // in case there is no URL provided then the code must be updated
                // to handle this case
                downloadUrl: url ?? '',
                fileName: `${projectName ?? 'onlook-project'}-${Date.now()}.zip`,
            };
        } catch (error) {
            console.error('Error generating download URL:', error);
            return null;
        }
    }

    clear() {
        this.providerReactionDisposer?.();
        this.providerReactionDisposer = undefined;
        this.sync?.release();
        this.sync = null;
        this.watchDisposer?.();
        this.watchDisposer = null;
        this.files = {};
        this.preloadScriptState = PreloadScriptState.NOT_INJECTED
        this.session.clear();
    }

    private async loadFiles() {
        if (!this.fs) return;
        try {
            const files = await this.fs.listAll();
            for (const file of files) {
                if (file.type === 'file' && !this.shouldExclude(file.path)) {
                    const content = await this.fs.readFile(file.path);
                    if (typeof content === 'string') {
                        runInAction(() => {
                            this.files[file.path] = content;
                        });
                    }
                }
            }
        } catch (error) {
            console.error('Failed to load files:', error);
        }
    }

    private watchFiles() {
        if (!this.fs) return;
        this.watchDisposer = this.fs.watchDirectory('/', async (event) => {
            const { type, path } = event;
            if (this.shouldExclude(path)) return;

            try {
                if (type === 'delete') {
                    runInAction(() => {
                        delete this.files[path];
                    });
                } else {
                    // create, update, rename (new path)
                    const content = await this.fs.readFile(path);
                    if (typeof content === 'string') {
                        runInAction(() => {
                            this.files[path] = content;
                        });
                    }
                }

                if (type === 'rename' && event.oldPath) {
                    runInAction(() => {
                        delete this.files[event.oldPath!];
                    });
                }
            } catch (error) {
                console.error(`Error handling file event ${type} for ${path}:`, error);
            }
        });
    }

    private shouldExclude(path: string): boolean {
        return EXCLUDED_SYNC_PATHS.some(exclude => path.includes(exclude));
    }
}
