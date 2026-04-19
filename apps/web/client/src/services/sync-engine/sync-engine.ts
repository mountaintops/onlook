/**
 * Handles syncing files between a code provider and a local file system.
 *
 * On initial start, it pulls all files from the provider and stores them in the local file system.
 * After this, it watches for changes either in the local file system or the provider and syncs the changes back and forth.
 */
import { type Provider, type ProviderFileWatcher } from '@onlook/code-provider/client';

import { normalizePath } from '@/components/store/editor/sandbox/helpers';
import type { CodeFileSystem } from '@onlook/file-system';

export interface SyncConfig {
    include?: string[];
    exclude?: string[];
}

const DEFAULT_EXCLUDES = ['node_modules', '.git', '.next', 'dist', 'build', '.turbo'];

export async function hashContent(content: string | Uint8Array): Promise<string> {
    const encoder = new TextEncoder();
    const data = typeof content === 'string' ? encoder.encode(content) : new Uint8Array(content);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

interface SyncInstance {
    sync: CodeProviderSync;
    refCount: number;
}

export class CodeProviderSync {
    private static instances = new Map<string, SyncInstance>();

    private watcher: ProviderFileWatcher | null = null;
    private localWatcher: (() => void) | null = null;
    private isRunning = false;
    private isPaused = false;
    private readonly excludes: string[];
    private readonly excludePatterns: string[];
    private fileHashes = new Map<string, string>();
    private instanceKey: string | null = null;
    private writeCallbackUnregister: (() => void) | null = null;

    private constructor(
        private provider: Provider,
        private fs: CodeFileSystem,
        private config: SyncConfig = { include: [], exclude: [] },
    ) {
        // Compute excludes once
        this.excludes = [...DEFAULT_EXCLUDES, ...(this.config.exclude ?? [])];
        this.excludePatterns = this.excludes.map((dir) => `${dir}/**`);

        // Register write callback to trigger context updates when files are written directly
        this.writeCallbackUnregister = this.fs.onWrite((path, content) => {
            // Skip if not running or paused
            if (!this.isRunning || this.isPaused) {
                return;
            }

            // Check if file should be synced
            if (!this.shouldSync(path)) {
                return;
            }

            // Track recent file and trigger context update
            this.trackRecentFile(path);
            this.triggerContextUpdate();
        });
    }

    /**
     * Get or create a sync instance for the given provider and filesystem.
     * Uses reference counting to ensure the same provider+fs combination shares a single sync instance.
     *
     * Note: Config is only applied on first creation. Subsequent calls with the same provider+fs
     * will reuse the existing instance with its original config. In practice, configs are static
     * (EXCLUDED_SYNC_PATHS) so this shouldn't cause issues, but a warning is logged if detected.
     */
    static getInstance(
        provider: Provider,
        fs: CodeFileSystem,
        sandboxId: string,
        config: SyncConfig = { include: [], exclude: [] },
    ): CodeProviderSync {
        const key = CodeProviderSync.generateKey(sandboxId, fs);

        const existing = CodeProviderSync.instances.get(key);
        if (existing) {
            // Warn if configs differ to help debug unexpected behavior
            const sameConfig =
                JSON.stringify(existing.sync.config ?? {}) === JSON.stringify(config ?? {});
            if (!sameConfig) {
            }
            existing.refCount++;
            return existing.sync;
        }

        const sync = new CodeProviderSync(provider, fs, config);
        sync.instanceKey = key;
        CodeProviderSync.instances.set(key, { sync, refCount: 1 });
        return sync;
    }

    /**
     * Generate a unique key for a provider+filesystem combination.
     */
    private static generateKey(sandboxId: string, fs: CodeFileSystem): string {
        return `${sandboxId}:${fs.rootPath}`;
    }

    /**
     * Release a reference to this sync instance.
     * When the last reference is released, the sync will be stopped and removed from the registry.
     */
    release(): void {
        if (!this.instanceKey) {
            return;
        }

        const instance = CodeProviderSync.instances.get(this.instanceKey);
        if (!instance) {
            return;
        }

        instance.refCount--;

        if (instance.refCount <= 0) {
            this.stop();
            CodeProviderSync.instances.delete(this.instanceKey);
            this.instanceKey = null;
        }
    }

    /**
     * Pause syncing temporarily. Useful before operations that cause many file changes (e.g., git restore).
     * While paused, file change events are ignored.
     */
    pause(): void {
        this.isPaused = true;
    }

    /**
     * Resume syncing after being paused. Pulls fresh state from sandbox to ensure consistency.
     * @param options Optional parameters for unpausing
     * @param options.changedFiles Optional list of changed files to pull. If provided, only these files will be pulled.
     */
    async unpause(options?: { changedFiles?: string[] }): Promise<void> {
        // Keep paused while reconciling to avoid echoing local writes back to the provider
        if (this.isRunning) {
            try {
                if (options?.changedFiles && options.changedFiles.length > 0) {
                    await this.pullSpecificFiles(options.changedFiles);
                } else {
                    await this.pullFromSandbox();
                }
            } finally {
                this.isPaused = false;
            }
        } else {
            this.isPaused = false;
        }
    }

    async start(): Promise<void> {
        if (this.isRunning) {
            return;
        }

        this.isRunning = true;

        try {
            await this.pullFromSandbox();
            await this.setupWatching();
            // Push any locally modified files (with OIDs) back to sandbox. This is required for the first time sync.
            void this.pushModifiedFilesToSandbox();

            this.triggerContextUpdate();
        } catch (error) {
            this.isRunning = false;
            throw error;
        }
    }

    stop(): void {
        this.isRunning = false;

        if (this.watcher) {
            void this.watcher.stop();
            this.watcher = null;
        }

        if (this.localWatcher) {
            this.localWatcher();
            this.localWatcher = null;
        }

        if (this.writeCallbackUnregister) {
            this.writeCallbackUnregister();
            this.writeCallbackUnregister = null;
        }

        // Clear file hashes
        this.fileHashes.clear();
    }

    private gitignorePatterns: RegExp[] = [];

    private async loadGitignore(): Promise<void> {
        try {
            const content = await this.fs.readFile('/.gitignore');
            if (typeof content === 'string') {
                this.gitignorePatterns = content
                    .split('\n')
                    .map(line => line.trim())
                    .filter(line => line && !line.startsWith('#'))
                    .map(pattern => {
                        // Improved glob to regex conversion
                        let p = pattern;
                        const isDirectoryOnly = p.endsWith('/');
                        if (isDirectoryOnly) p = p.slice(0, -1);

                        let regexStr = p
                            .replace(/\./g, '\\.')
                            .replace(/\*\*/g, '(.+)')
                            .replace(/\*/g, '[^/]+')
                            .replace(/\?/g, '.');

                        if (pattern.startsWith('/')) {
                            regexStr = '^' + regexStr;
                        } else {
                            regexStr = '(^|/)' + regexStr;
                        }

                        if (isDirectoryOnly) {
                            regexStr += '($|/)';
                        } else {
                            regexStr += '($|/|\\.)';
                        }
                        
                        return new RegExp(regexStr);
                    });
            }
        } catch (error) {
            // .gitignore may not exist
            this.gitignorePatterns = [];
        }
    }

    private isIgnored(path: string): boolean {
        const normalizedPath = path.startsWith('/') ? path : '/' + path;
        return this.gitignorePatterns.some(pattern => pattern.test(normalizedPath));
    }

    private async pullFromSandbox(): Promise<void> {
        const sandboxEntries = await this.getAllSandboxFiles('./');
        const sandboxEntriesSet = new Set(
            sandboxEntries.map((e) => (e.path.startsWith('/') ? e.path : `/${e.path}`)),
        );

        const localEntries = await this.fs.listAll();

        // Find entries to delete (exist locally but not in sandbox)
        const entriesToDelete = localEntries.filter((entry) => {
            if (!this.shouldSync(entry.path)) return false;

            const sandboxPath = entry.path.startsWith('/') ? entry.path.substring(1) : entry.path;
            return !sandboxEntriesSet.has(entry.path) && !sandboxEntriesSet.has(sandboxPath);
        });

        for (const entry of entriesToDelete) {
            try {
                if (entry.type === 'file') {
                    await this.fs.deleteFile(entry.path);
                } else {
                    await this.fs.deleteDirectory(entry.path);
                }
            } catch (error) {
            }
        }

        // Process sandbox entries
        const directoriesToCreate = sandboxEntries.filter(e => e.type === 'directory').map(e => e.path);
        const filePathsToRead = sandboxEntries.filter(e => e.type === 'file').map(e => e.path);

        // Create directories first
        for (const dirPath of directoriesToCreate) {
            try {
                await this.fs.createDirectory(dirPath);
            } catch (error) {
            }
        }

        // Pull files in parallel with concurrency limit
        await this.pullSpecificFiles(filePathsToRead);

        // Also pull context.txt explicitly to restore recent files history if it exists
        try {
            const contextResult = await this.provider.readFile({ args: { path: 'context.txt' } });
            if (contextResult.file.content && typeof contextResult.file.content === 'string') {
                const parsed = JSON.parse(contextResult.file.content);
                if (Array.isArray(parsed.files)) {
                    this.recentEditedPaths = parsed.files.filter((p: string) => typeof p === 'string');
                }
            }
        } catch (e) {
            // No context.txt or parse error, just ignore
        }
    }

    /**
     * Pull specific files from the sandbox in parallel with a concurrency limit.
     */
    private async pullSpecificFiles(filePaths: string[], concurrency: number = 5): Promise<void> {
        if (filePaths.length === 0) return;

        
        const queue = [...filePaths];
        const workers = Array(Math.min(concurrency, queue.length)).fill(null).map(async () => {
            while (queue.length > 0 && this.isRunning) {
                const path = queue.shift();
                if (!path) break;

                try {
                    const result = await this.provider.readFile({ args: { path } });
                    const { file } = result;

                    if ((file.type === 'text' || file.type === 'binary') && file.content !== undefined && file.content !== null) {
                        // Write to filesystem
                        await this.fs.writeFile(path, file.content);
                        
                        // Update hash tracking
                        const hash = await hashContent(file.content);
                        this.fileHashes.set(path, hash);
                    }
                } catch (error) {
                    // Don't throw, allow other files to continue
                }
            }
        });

        await Promise.all(workers);
        
        // Seed recent files from pulled sandbox if empty, to ensure we have context
        if (this.recentEditedPaths.length === 0) {
            const ENTRY_POINT_CANDIDATES = ['/src/app/page.tsx', '/app/page.tsx', '/src/pages/index.tsx', '/pages/index.tsx'];
            for (const candidate of ENTRY_POINT_CANDIDATES) {
                if (this.fileHashes.has(candidate)) {
                    this.recentEditedPaths.push(candidate);
                    break;
                }
            }
        }
    }

    private async getAllSandboxFiles(
        dir: string,
    ): Promise<Array<{ path: string; type: 'file' | 'directory' }>> {
        const files: Array<{ path: string; type: 'file' | 'directory' }> = [];

        try {
            const result = await this.provider.listFiles({ args: { path: dir } });
            const entries = result.files;

            for (const entry of entries) {
                if (!this.isRunning) break;
                // Build path - when dir is './', just use entry.name
                const fullPath = dir === './' ? entry.name : `${dir}/${entry.name}`;

                if (entry.type === 'directory') {
                    // Check if directory should be excluded
                    if (!this.excludes.includes(entry.name)) {
                        if (this.shouldSync(fullPath)) {
                            files.push({ path: fullPath, type: 'directory' });
                        }
                        const subFiles = await this.getAllSandboxFiles(fullPath);
                        files.push(...subFiles);
                    }
                } else {
                    // Only add files that should be synced
                    if (this.shouldSync(fullPath)) {
                        files.push({ path: fullPath, type: entry.type });
                    }
                }
            }
        } catch (error) {
        }

        return files;
    }

    private async pushModifiedFilesToSandbox(): Promise<void> {

        try {
            // Get all local JSX/TSX files that might have been modified with OIDs
            const localFiles = await this.fs.listFiles('/');
            const jsxFiles = localFiles.filter(path => /\.(jsx?|tsx?)$/i.test(path));

            // TODO: Use available batch write API
            await Promise.all(
                jsxFiles.map(async (filePath) => {
                    if (!this.isRunning) return;
                    try {
                        const content = await this.fs.readFile(filePath);
                        if (typeof content === 'string') {
                            // Push to sandbox
                            await this.provider.writeFile({
                                args: {
                                    path: filePath.startsWith('/') ? filePath.substring(1) : filePath,
                                    content,
                                    overwrite: true
                                }
                            });
                        }
                    } catch (error) {
                    }
                })
            );
        } catch (error) {
        }
    }

    private shouldSync(path: string): boolean {
        if (path === 'context.txt' || path === '/context.txt') return false; // Ignore context.txt from recursive watcher syncing loop logic since we handle it manually.

        // Check if path matches any exclude pattern
        const isExcluded = this.excludes.some((exc) => {
            // Check if path is within excluded directory or is the excluded item itself
            return path === exc || path.startsWith(`${exc}/`) || path.split('/').includes(exc);
        });

        if (isExcluded) {
            return false;
        }

        // Check includes if specified
        if (this.config.include && this.config.include.length > 0) {
            const included = this.config.include.some((inc) => {
                const normalizedInc = inc.startsWith('/') ? inc.substring(1) : inc;
                return path.startsWith(normalizedInc) || path === normalizedInc;
            });
            return included;
        }

        return true;
    }

    private async setupWatching(): Promise<void> {
        try {
            // Watch the current directory (relative to workspace)
            const watchResult = await this.provider.watchFiles({
                args: {
                    path: './',
                    recursive: true,
                    excludes: this.excludePatterns,
                },
                onFileChange: async (event) => {
                    // Skip processing if paused or not running
                    if (this.isPaused || !this.isRunning) {
                        return;
                    }

                    // Process based on event type
                    if (event.type === 'change' || event.type === 'add') {
                        // Check if this is a rename (change event with 2 paths)
                        if (
                            event.type === 'change' &&
                            event.paths.length === 2 &&
                            event.paths[0] &&
                            event.paths[1]
                        ) {
                            // This is likely a rename operation
                            const oldPath = normalizePath(event.paths[0]);
                            const newPath = normalizePath(event.paths[1]);


                            if (this.shouldSync(oldPath) && this.shouldSync(newPath)) {
                                try {
                                    // Check if the old file exists locally
                                    if (await this.fs.exists(oldPath)) {
                                        // Rename the file locally
                                        await this.fs.moveFile(oldPath, newPath);

                                        // Update hash tracking
                                        const oldHash = this.fileHashes.get(oldPath);
                                        if (oldHash) {
                                            this.fileHashes.delete(oldPath);
                                            this.fileHashes.set(newPath, oldHash);
                                        }
                                    } else {
                                        // Old file doesn't exist, just create the new one

                                        try {
                                            const result = await this.provider.readFile({
                                                args: { path: newPath },
                                            });
                                            const { file } = result;

                                            if (
                                                (file.type === 'text' || file.type === 'binary') &&
                                                file.content
                                            ) {
                                                await this.fs.writeFile(newPath, file.content);
                                                const hash = await hashContent(file.content);
                                                this.fileHashes.set(newPath, hash);
                                            }
                                        } catch (error) {
                                        }
                                    }
                                } catch (error) {
                                }
                            }
                        } else {
                            // Normal processing for non-rename events
                            for (const path of event.paths) {

                                // Normalize the path to remove any duplicate prefixes
                                const normalizedPath = normalizePath(path);

                                if (!this.shouldSync(normalizedPath)) {
                                    continue;
                                }

                                try {
                                    // First check if it's a directory or file
                                    const stat = await this.provider.statFile({
                                        args: { path: normalizedPath },
                                    });

                                    if (stat.type === 'directory') {
                                        // It's a directory, create it locally
                                        const localPath = normalizedPath;

                                        try {
                                            await this.fs.createDirectory(localPath);

                                            // After creating the directory, recursively sync all its contents
                                            // This is needed because sandbox watcher might only report parent directory creation

                                            // Recursive function to sync directory contents
                                            const syncDirectoryContents = async (sandboxPath: string, localDirPath: string) => {
                                                try {
                                                    const dirContents = await this.provider.listFiles({
                                                        args: { path: sandboxPath },
                                                    });

                                                    if (dirContents.files && dirContents.files.length > 0) {

                                                        for (const item of dirContents.files) {
                                                            const itemSandboxPath = `${sandboxPath}/${item.name}`;
                                                            const itemLocalPath = `${localDirPath}/${item.name}`;

                                                            if (item.type === 'directory') {
                                                                // Create subdirectory
                                                                await this.fs.createDirectory(itemLocalPath);

                                                                // Recursively sync its contents
                                                                await syncDirectoryContents(itemSandboxPath, itemLocalPath);
                                                            } else if (item.type === 'file') {
                                                                // Sync all files including .gitkeep
                                                                try {
                                                                    const fileResult = await this.provider.readFile({
                                                                        args: { path: itemSandboxPath },
                                                                    });
                                                                    if (fileResult.file.content !== undefined) {
                                                                        // Write file even if content is empty (like .gitkeep)
                                                                        await this.fs.writeFile(itemLocalPath, fileResult.file.content || '');
                                                                        // Update hash tracking
                                                                        const hash = await hashContent(fileResult.file.content || '');
                                                                        this.fileHashes.set(itemLocalPath, hash);
                                                                    } else {
                                                                    }
                                                                } catch (fileError) {
                                                                }
                                                            }
                                                        }
                                                    }
                                                } catch (listError) {
                                                }
                                            };

                                            // Start recursive sync
                                            await syncDirectoryContents(normalizedPath, localPath);
                                        } catch (dirError) {
                                            // Directory creation might fail if parent doesn't exist
                                            // The createDirectory method should handle this with recursive: true
                                        }
                                    } else {
                                        // It's a file, read and sync it
                                        const result = await this.provider.readFile({
                                            args: { path: normalizedPath },
                                        });
                                        const { file } = result;

                                        if (
                                            (file.type === 'text' || file.type === 'binary') &&
                                            file.content
                                        ) {
                                            const localPath = normalizedPath;

                                            // Check if content has changed
                                            const newHash = await hashContent(file.content);
                                            const existingHash = this.fileHashes.get(localPath);

                                            if (newHash !== existingHash) {
                                                await this.fs.writeFile(localPath, file.content);
                                                this.fileHashes.set(localPath, newHash);
                                                this.trackRecentFile(localPath);
                                                this.triggerContextUpdate();
                                            } else {
                                               }
                                        }
                                    }
                                } catch (error) {
                                }
                            }
                        }
                    } else if (event.type === 'remove') {
                        for (const path of event.paths) {
                            // Normalize the path to remove any duplicate prefixes
                            const normalizedPath = normalizePath(path);

                            if (!this.shouldSync(normalizedPath)) {
                                continue;
                            }

                            try {
                                const localPath = normalizedPath;

                                // Check if path exists before trying to delete
                                if (await this.fs.exists(localPath)) {
                                    // Check if it's a directory or file
                                    const fileInfo = await this.fs.getInfo(localPath);

                                    if (fileInfo.isDirectory) {
                                        await this.fs.deleteDirectory(localPath);
                                    } else {
                                        await this.fs.deleteFile(localPath);
                                    }
                                }

                                // Remove hash regardless
                                this.fileHashes.delete(localPath);
                                this.untrackRecentFile(localPath);
                                this.triggerContextUpdate();
                            } catch (error) {
                            }
                        }
                    }
                },
            });

            this.watcher = watchResult.watcher;

            // Setup local file system watching for bidirectional sync
            await this.setupLocalWatching();
        } catch (error) {
            throw error;
        }
    }

    private async setupLocalWatching(): Promise<void> {
        // Watch the root directory for local changes
        this.localWatcher = this.fs.watchDirectory('/', async (event) => {
            // Skip processing if paused or not running
            if (this.isPaused || !this.isRunning) {
                return;
            }

            const { path, type } = event;

            // Check if file should be synced
            // Need to remove leading / for sandbox path
            const sandboxPath = path.startsWith('/') ? path.substring(1) : path;
            if (!this.shouldSync(sandboxPath)) {
                return;
            }

            try {
                switch (type) {
                    case 'create':
                    case 'update': {
                        // Check if it's a directory
                        const fileInfo = await this.fs.getInfo(path);

                        if (fileInfo.isDirectory) {
                            // Create directory in provider
                            await this.provider.createDirectory({
                                args: {
                                    path: sandboxPath,
                                },
                            });
                        } else {
                            // Read from local and write to provider
                            const content = await this.fs.readFile(path);
                            const currentHash = await hashContent(content);

                            // Check if this change was from our own sync
                            if (this.fileHashes.get(path) === currentHash) {
                                return;
                            }

                            // Update hash and sync to provider
                            this.fileHashes.set(path, currentHash);
                            await this.provider.writeFile({
                                args: {
                                    path: sandboxPath,
                                    content,
                                    overwrite: true,
                                },
                            });
                            this.trackRecentFile(path);
                            this.triggerContextUpdate();
                        }
                        break;
                    }
                    case 'delete': {
                        // Always attempt to sync local deletions to sandbox
                        // The user initiated this deletion locally, so it should be reflected in the sandbox

                        try {
                            await this.provider.deleteFiles({
                                args: {
                                    path: sandboxPath,
                                    recursive: true,
                                },
                            });
                        } catch (error) {
                        }

                        // Remove hash for deleted file (if it exists)
                        if (this.fileHashes.has(path)) {
                            this.fileHashes.delete(path);
                        }
                        this.untrackRecentFile(path);
                        this.triggerContextUpdate();
                        break;
                    }
                    case 'rename': {
                        // Handle rename if oldPath is provided
                        if (event.oldPath) {
                            const oldSandboxPath = event.oldPath.startsWith('/')
                                ? event.oldPath.substring(1)
                                : event.oldPath;

                            try {
                                await this.provider.renameFile({
                                    args: {
                                        oldPath: oldSandboxPath,
                                        newPath: sandboxPath,
                                    },
                                });

                                // Update hash tracking for renamed files
                                const oldHash = this.fileHashes.get(event.oldPath);
                                if (oldHash) {
                                    this.fileHashes.delete(event.oldPath);
                                    this.fileHashes.set(path, oldHash);
                                }
                                this.untrackRecentFile(event.oldPath);
                                this.trackRecentFile(path);
                                this.triggerContextUpdate();
                            } catch (error) {
                                throw error; // Re-throw to be caught by outer try-catch
                            }
                        } else {
                        }
                        break;
                    }
                }
            } catch (error) {
            }
        });
    }

    private contextUpdateTimeout: NodeJS.Timeout | null = null;
    private recentEditedPaths: string[] = [];
    private readonly mainContextFiles = [
        '/package.json',
        '/src/app/page.tsx',
        '/src/app/layout.tsx',
        '/agents.md'
    ];

    private trackRecentFile(path: string) {
        if (path === 'context.txt' || path === '/context.txt') return;
        const normalizedPath = path.startsWith('/') ? path : '/' + path;

        // Don't track main context files in the recent list
        if (this.mainContextFiles.includes(normalizedPath)) return;
        
        const index = this.recentEditedPaths.indexOf(normalizedPath);
        if (index > -1) {
            this.recentEditedPaths.splice(index, 1);
        }
        
        this.recentEditedPaths.unshift(normalizedPath);
        
        if (this.recentEditedPaths.length > 3) {
            this.recentEditedPaths = this.recentEditedPaths.slice(0, 3);
        }
    }

    private untrackRecentFile(path: string) {
        const normalizedPath = path.startsWith('/') ? path : '/' + path;
        const index = this.recentEditedPaths.indexOf(normalizedPath);
        if (index > -1) {
            this.recentEditedPaths.splice(index, 1);
        }
    }
    
    private triggerContextUpdate(): void {
        if (!this.isRunning || this.isPaused) return;
        if (this.contextUpdateTimeout) {
            clearTimeout(this.contextUpdateTimeout);
        }
        this.contextUpdateTimeout = setTimeout(() => {
            void this.writeContextTxt();
        }, 300); // reduced debounce from 1000ms to 300ms since it's much faster now
    }
    
    private async writeContextTxt(): Promise<void> {
        try {
            await this.loadGitignore();

            // Very fast memory lookup instead of disk I/O
            const allFiles = Array.from(this.fileHashes.keys());

            const filteredPaths = allFiles.filter(p => {
                const normalizedPath = p.startsWith('/') ? p : '/' + p;
                if (normalizedPath === '/context.txt') return false;
                
                // Respect .gitignore
                if (this.isIgnored(normalizedPath)) return false;

                // Also keep some essential hardcoded filters for safety
                const parts = normalizedPath.split('/');
                if (parts.some(part => part.startsWith('.') && part !== '.gitignore')) return false;
                if (parts.some(part => ['node_modules', 'dist', 'build', 'coverage', '.turbo', '.next'].includes(part))) return false;
                
                return true;
            });

            filteredPaths.sort((a, b) => a.localeCompare(b));
            const tree = filteredPaths.map(p => '.' + (p.startsWith('/') ? p : '/' + p));

            if (this.recentEditedPaths.length === 0) {
                const ENTRY_POINT_CANDIDATES = ['/src/app/page.tsx', '/app/page.tsx', '/src/pages/index.tsx', '/pages/index.tsx'];
                for (const candidate of ENTRY_POINT_CANDIDATES) {
                    if (this.fileHashes.has(candidate) || this.fileHashes.has(candidate.substring(1))) {
                        this.recentEditedPaths.push(candidate);
                        break;
                    }
                }
            }

            // Combine main context files with recent files
            const filesToInclude = [...new Set([...this.mainContextFiles, ...this.recentEditedPaths])];
            
            // Filter out files that don't exist anymore
            const existingFiles = filesToInclude.filter(p => this.fileHashes.has(p) || this.fileHashes.has(p.substring(1)));

            const payload = JSON.stringify({ tree, files: existingFiles }, null, 2);

            const hashed = await hashContent(payload);
            const currentHash = this.fileHashes.get('/context.txt') || this.fileHashes.get('context.txt');
            
            if (currentHash !== hashed) {
                await this.fs.writeFile('/context.txt', payload);
                this.fileHashes.set('/context.txt', hashed);
                await this.provider.writeFile({
                    args: {
                        path: 'context.txt',
                        content: payload,
                        overwrite: true,
                    },
                });
            }
        } catch (error) {
        }
    }
}
