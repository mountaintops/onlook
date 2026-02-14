import { CodeProviderSync } from '@/services/sync-engine/sync-engine';
import type { ISandboxAdapter } from '@onlook/code-provider';
import { parseDependencies } from '@onlook/code-provider';
import { EXCLUDED_SYNC_PATHS } from '@onlook/constants';
import type { CodeFileSystem } from '@onlook/file-system';
import { type FileEntry } from '@onlook/file-system';
import type { Branch, RouterConfig } from '@onlook/models';
import { makeAutoObservable, reaction, runInAction } from 'mobx';
import type { EditorEngine } from '../engine';
import type { ErrorManager } from '../error';
import { detectRouterConfig } from '../pages/helper';
import { copyPreloadScriptToPublic, getLayoutPath as detectLayoutPath } from './preload-script';
import { SessionManager } from './session';
import { DEFAULT_FILES } from './fallback';
import { type AutomergeSchema, initPersistence } from './persistence';
import type { DocHandle } from '@automerge/automerge-repo';
import { next as Automerge } from '@automerge/automerge';

export enum PreloadScriptState {
    NOT_INJECTED = 'not-injected',
    LOADING = 'loading',
    INJECTED = 'injected'
}
export class SandboxManager {
    readonly session: SessionManager;
    // readonly gitManager: GitManager; // Removed GitManager
    private providerReactionDisposer?: () => void;
    private sync: CodeProviderSync | null = null;
    preloadScriptState: PreloadScriptState = PreloadScriptState.NOT_INJECTED
    routerConfig: RouterConfig | null = null;
    files: Record<string, string> = { ...DEFAULT_FILES };
    dependencies: Record<string, string> = {};
    isSandpackMode = false;
    private watchDisposer: (() => void) | null = null;
    private handle: DocHandle<AutomergeSchema> | null = null;

    constructor(
        private branch: Branch,
        private readonly editorEngine: EditorEngine,
        private readonly errorManager: ErrorManager,
        private readonly fs: CodeFileSystem,
    ) {
        this.session = new SessionManager(this.branch, this.errorManager);
        // this.gitManager = new GitManager(this); // Removed GitManager
        makeAutoObservable(this);
    }

    async init() {
        // Use Sandpack (browser) mode by default
        // This seeds files into ZenFS so the file manager can discover them
        await this.initSandpackMode();
    }

    /**
     * Legacy VM-based init — connects to CodeSandbox Devbox via provider.
     * Kept for rollback purposes; call this explicitly if needed.
     */
    async initLegacy() {
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
                    // await this.gitManager.init(); // Removed GitManager
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

    /**
     * Initialize in Sandpack (browser) mode — no VM provider needed.
     * The adapter operates entirely against the in-memory files map.
     * Files are also written into ZenFS so the file manager (useDirectory) can discover them.
     */
    async initSandpackMode() {
        this.isSandpackMode = true;

        // Initialize Automerge Persistence
        try {
            this.handle = await initPersistence(this.branch.projectId);
            const doc = await this.handle.doc();

            runInAction(() => {
                // If Automerge has files, load them. Otherwise, seed Automerge with current defaults.
                if (doc && Object.keys(doc.files).length > 0) {
                    this.files = { ...doc.files };
                    // Parse dependencies from loaded package.json
                    const pkgJson = this.files['/package.json'] ?? this.files['package.json'];
                    if (pkgJson) {
                        this.dependencies = parseDependencies(pkgJson);
                    }
                } else {
                    // Seed Automerge with default files
                    this.handle?.change((d) => {
                        d.files = { ...this.files };
                    });
                }
            });

            // Listen for changes from other tabs/clients
            this.handle.on('change', ({ doc }) => {
                runInAction(() => {
                    this.files = { ...doc.files };
                    const pkgJson = this.files['/package.json'] ?? this.files['package.json'];
                    if (pkgJson) {
                        this.dependencies = parseDependencies(pkgJson);
                    }
                });
                // Sync external changes to ZenFS so the file tree updates
                this.seedFilesToZenFS();
            });

        } catch (error) {
            console.error('[SandboxManager] Failed to initialize persistence:', error);
        }

        await this.session.startSandpackSession({
            getFiles: () => this.files,
            onFileUpdate: (path: string, content: string) => {
                // Sync to Automerge
                this.handle?.change(d => {
                    d.files[path] = content;
                });

                runInAction(() => {
                    this.files[path] = content;
                    // Auto-sync dependencies when package.json changes
                    if (path === '/package.json' || path === 'package.json') {
                        this.dependencies = parseDependencies(content);
                    }
                });
                // Write-through to ZenFS so file manager stays in sync (raw to bypass JSX processing)
                this.fs?.writeFileRaw(path, content).catch((err: Error) =>
                    console.error('[SandboxManager] Failed to sync file to ZenFS:', path, err),
                );
            },
            onFileDelete: (path: string) => {
                // Sync to Automerge
                this.handle?.change(d => {
                    delete d.files[path];
                });

                runInAction(() => {
                    delete this.files[path];
                });
                // Remove from ZenFS so file manager stays in sync
                this.fs?.deleteFile(path).catch((err: Error) =>
                    console.error('[SandboxManager] Failed to delete file from ZenFS:', path, err),
                );
            },
            onDependenciesChanged: (deps: Record<string, string>) => {
                runInAction(() => {
                    this.dependencies = deps;
                });
            },
        });

        // Extract initial dependencies from package.json if present
        const pkgJson = this.files['/package.json'] ?? this.files['package.json'];
        if (pkgJson) {
            this.dependencies = parseDependencies(pkgJson);
        }

        // Seed ZenFS with all current files so useDirectory / FileTree can discover them
        await this.seedFilesToZenFS();

        // Register write/delete hooks on CodeFileSystem to intercept ALL file writes
        // (code panel, AI chat, theme editor, etc.) and sync them to this.files → SandpackProvider
        this.fs.onWriteHook = (path: string, content: string | Uint8Array) => {
            // Only sync string content (not binary) and skip internal cache paths
            if (typeof content !== 'string') return;
            if (path.startsWith('.onlook') || path.includes('/node_modules/')) return;

            // Sync to Automerge
            this.handle?.change(d => {
                d.files[path] = content;
            });

            runInAction(() => {
                this.files[path] = content;
                if (path === '/package.json' || path === 'package.json') {
                    this.dependencies = parseDependencies(content);
                }
            });
        };

        this.fs.onDeleteHook = (path: string) => {
            // Sync to Automerge
            this.handle?.change(d => {
                delete d.files[path];
            });

            runInAction(() => {
                delete this.files[path];
            });
        };
    }

    /**
     * Write all entries from this.files into ZenFS (CodeFileSystem).
     * Uses writeFileRaw to bypass JSX processing (OID injection / index saves).
     * This makes them visible to useDirectory / FileTree.
     */
    private async seedFilesToZenFS() {
        if (!this.fs) return;

        const paths = Object.keys(this.files);
        for (const filePath of paths) {
            const content = this.files[filePath];
            if (content === undefined) continue;
            try {
                await this.fs.writeFileRaw(filePath, content);
            } catch (err) {
                console.error('[SandboxManager] Failed to seed file to ZenFS:', filePath, err);
            }
        }
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
        await this.fs.writeFile(path, content);

        // In Sandpack mode, also update the in-memory files map so SandpackProvider picks up changes
        if (this.isSandpackMode && typeof content === 'string') {
            this.handle?.change(d => {
                d.files[path] = content;
            });

            runInAction(() => {
                this.files[path] = content;
                if (path === '/package.json' || path === 'package.json') {
                    this.dependencies = parseDependencies(content);
                }
            });
        }
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

    async save(): Promise<void> {
        // No-op for now as Automerge saves automatically,
        // but can be used for explicit flush if needed
    }

    async createSnapshot(message: string): Promise<void> {
        if (!this.handle) {
            console.error('Persistence handle not initialized');
            return;
        }
        console.log('Creating snapshot with message:', message);
        this.handle.change((d) => {
            if (!d.metadata) d.metadata = {};
            d.metadata.lastSnapshot = Date.now();
        }, { message });
    }

    async restoreSnapshot(hash: string): Promise<void> {
        if (!this.handle) {
            console.error('Persistence handle not initialized');
            return;
        }

        const doc = await this.handle.doc();
        if (!doc) return;

        // Get history to find the snapshot state
        const history = Automerge.getHistory(doc);
        const snapshot = history.find(h => h.change.hash === hash);

        if (!snapshot) {
            console.error('Snapshot not found:', hash);
            return;
        }

        // Apply the snapshot state to the current document
        // We do this by updating the `files` map to match the snapshot
        const snapshotFiles = snapshot.snapshot.files;

        this.handle.change(d => {
            // 1. Remove files not in snapshot
            for (const path of Object.keys(d.files)) {
                if (!snapshotFiles[path]) {
                    delete d.files[path];
                }
            }

            // 2. Update/Add files from snapshot
            for (const [path, content] of Object.entries(snapshotFiles)) {
                if (d.files[path] !== content) {
                    d.files[path] = content;
                }
            }
        }, { message: `Revert to ${hash}` });

        // Update in-memory files and ZenFS
        runInAction(() => {
            this.files = { ...snapshotFiles };
            const pkgJson = this.files['/package.json'] ?? this.files['package.json'];
            if (pkgJson) {
                this.dependencies = parseDependencies(pkgJson);
            }
        });

        // Sync to ZenFS
        await this.seedFilesToZenFS();
    }

    async checkoutAndSave(hash: string, saveMessage: string = 'Backup before checkout'): Promise<void> {
        await this.createSnapshot(saveMessage);
        await this.restoreSnapshot(hash);
    }

    async getHistory() {
        if (!this.handle) {
            console.warn('getHistory: Handle not initialized');
            return [];
        }
        const doc = await this.handle.doc();
        if (!doc) {
            console.warn('getHistory: Document not found');
            return [];
        }
        const history = Automerge.getHistory(doc);
        console.log('getHistory: Changes found:', history.length);
        if (history.length > 0) {
            console.log('First change:', history[0]);
            console.log('Last change:', history[history.length - 1]);
        }
        return history.map(state => ({
            oid: state.change.hash,
            message: state.change.message || 'No message',
            timestamp: state.change.time,
            author: { name: 'Onlook User' }, // Placeholder as we don't have actor names yet
            files: state.snapshot.files
        }));
    }
}
