/**
 * DaytonaProvider — a browser-safe implementation of the `Provider` interface.
 *
 * Because the Daytona SDK is Node.js-only, all I/O is delegated through
 * an injected `proxy` object.  In production this proxy is wired to the
 * corresponding tRPC mutations/queries that run server-side.
 *
 * The pattern mirrors the proxy-based CodeSandbox provider and keeps the
 * package free of any Node-specific imports.
 */

import {
    Provider,
    ProviderBackgroundCommand,
    ProviderFileWatcher,
    ProviderTask,
    ProviderTerminal,
    type CopyFileOutput,
    type CopyFilesInput,
    type CreateDirectoryInput,
    type CreateDirectoryOutput,
    type CreateProjectInput,
    type CreateProjectOutput,
    type CreateSessionInput,
    type CreateSessionOutput,
    type CreateTerminalInput,
    type CreateTerminalOutput,
    type DeleteFilesInput,
    type DeleteFilesOutput,
    type DownloadFilesInput,
    type DownloadFilesOutput,
    type GetTaskInput,
    type GetTaskOutput,
    type GitStatusInput,
    type GitStatusOutput,
    type InitializeInput,
    type InitializeOutput,
    type ListFilesInput,
    type ListFilesOutput,
    type PauseProjectInput,
    type PauseProjectOutput,
    type ProviderTerminalShellSize,
    type ReadFileInput,
    type ReadFileOutput,
    type RenameFileInput,
    type RenameFileOutput,
    type SetupInput,
    type SetupOutput,
    type StatFileInput,
    type StatFileOutput,
    type StopProjectInput,
    type StopProjectOutput,
    type TerminalBackgroundCommandInput,
    type TerminalBackgroundCommandOutput,
    type TerminalCommandInput,
    type TerminalCommandOutput,
    type WatchEvent,
    type WatchFilesInput,
    type WatchFilesOutput,
    type WriteFileInput,
    type WriteFileOutput,
} from '../../types';

// ---------------------------------------------------------------------------
// Proxy interface — the caller provides async implementations
// ---------------------------------------------------------------------------

export interface DaytonaFsProxy {
    readFile(path: string): Promise<{ content: string; type: 'text' | 'binary' }>;
    writeFile(path: string, content: string, overwrite?: boolean): Promise<void>;
    statFile(path: string): Promise<{ type: 'file' | 'directory' }>;
    listFiles(path: string): Promise<Array<{ name: string; type: 'file' | 'directory'; isSymlink: boolean }>>;
    deleteFiles(path: string, recursive?: boolean): Promise<void>;
    renameFile(oldPath: string, newPath: string): Promise<void>;
    copyFiles(sourcePath: string, targetPath: string, recursive?: boolean, overwrite?: boolean): Promise<void>;
    createDirectory(path: string): Promise<void>;
}

export interface DaytonaProcessProxy {
    /** Execute a one-shot command and return stdout/stderr combined. */
    executeCommand(command: string): Promise<{ exitCode: number; output: string }>;
    /** Start a background command (fire-and-forget). Returns a session/exec ID. */
    startBackground(command: string): Promise<string>;
    /** Stop a background command by exec ID. */
    stopBackground(execId: string): Promise<void>;
    /** Poll output from a background command. */
    pollOutput(execId: string): Promise<string>;
    /** Get a signed WebSocket URL for a PTY session. */
    getPtyWsUrl(terminalId: string): Promise<{ wsUrl: string; token?: string }>;
}

export interface DaytonaSessionProxy {
    /** Bootstrap a new Daytona sandbox, returning its sandbox ID and preview info. */
    createProject(params: { title?: string }): Promise<{ sandboxId: string; previewUrl?: string }>;
    /** Restore / start an existing sandbox. Returns preview URL. */
    startSandbox(sandboxId: string): Promise<{ previewUrl?: string; token?: string }>;
    /** Stop (gracefully) an existing sandbox. */
    stopSandbox(sandboxId: string): Promise<void>;
    /** Get GitHub-like diff status. */
    gitStatus(): Promise<{ changedFiles: string[] }>;
}

export interface DaytonaProviderProxy {
    fs: DaytonaFsProxy;
    process: DaytonaProcessProxy;
    session: DaytonaSessionProxy;
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface DaytonaProviderOptions {
    sandboxId: string;
    /**
     * Optional public preview URL (port 3000) for the sandbox.
     * Can be refreshed via `getPreviewUrl` in the session proxy.
     */
    previewUrl?: string;
    /** Signed token for the preview URL (if applicable). */
    previewToken?: string;
    /** Proxy implementation wired by the host (e.g. tRPC client). */
    proxy: DaytonaProviderProxy;
    /** Polling interval in milliseconds for the file watcher. Defaults to 5000 ms. */
    watchPollIntervalMs?: number;
}

// ---------------------------------------------------------------------------
// DaytonaProvider
// ---------------------------------------------------------------------------

export class DaytonaProvider extends Provider {
    private readonly _sandboxId: string;
    private readonly proxy: DaytonaProviderProxy;
    private readonly watchPollIntervalMs: number;
    private _previewUrl: string | undefined;
    private _previewToken: string | undefined;

    constructor(options: DaytonaProviderOptions) {
        super();
        this._sandboxId = options.sandboxId;
        this.proxy = options.proxy;
        this._previewUrl = options.previewUrl;
        this._previewToken = options.previewToken;
        this.watchPollIntervalMs = options.watchPollIntervalMs ?? 5000;
    }

    // -----------------------------------------------------------------------
    // Provider lifecycle
    // -----------------------------------------------------------------------

    async initialize(_input: InitializeInput): Promise<InitializeOutput> {
        // Nothing to do — the sandbox is already running when the provider is
        // constructed.  The proxy is responsible for lifecycle management.
        return {};
    }

    async setup(_input: SetupInput): Promise<SetupOutput> {
        return {};
    }

    async reload(): Promise<boolean> {
        // Not implemented — callers should re-create the provider.
        return true;
    }

    async reconnect(): Promise<void> {
        // No persistent connection to re-establish for the proxy model.
    }

    async ping(): Promise<boolean> {
        try {
            const result = await this.proxy.process.executeCommand('echo "ping"');
            return result.exitCode === 0;
        } catch {
            return false;
        }
    }

    async destroy(): Promise<void> {
        // Nothing to dispose — the proxy manages its own resources.
    }

    // -----------------------------------------------------------------------
    // Session / project management (static-like operations)
    // -----------------------------------------------------------------------

    async createSession(input: CreateSessionInput): Promise<CreateSessionOutput> {
        // For Daytona the "session" is just the preview URL of the sandbox.
        return {
            signedPreviewUrl: this._previewUrl,
        };
    }

    async pauseProject(_input: PauseProjectInput): Promise<PauseProjectOutput> {
        await this.proxy.session.stopSandbox(this._sandboxId);
        return {};
    }

    async stopProject(_input: StopProjectInput): Promise<StopProjectOutput> {
        await this.proxy.session.stopSandbox(this._sandboxId);
        return {};
    }

    async listProjects(_input: any): Promise<any> {
        return {};
    }

    static async createProject(input: CreateProjectInput): Promise<CreateProjectOutput> {
        // This is a static method — it cannot use the proxy instance.
        // Callers should use the session proxy directly or tRPC instead.
        throw new Error(
            'DaytonaProvider.createProject must be called through the tRPC API (api.daytona.createSandbox) since it requires a server-side context.',
        );
    }

    static async createProjectFromGit(_input: { repoUrl: string; branch: string }): Promise<CreateProjectOutput> {
        throw new Error('DaytonaProvider.createProjectFromGit is not yet implemented.');
    }

    // -----------------------------------------------------------------------
    // Git
    // -----------------------------------------------------------------------

    async gitStatus(_input: GitStatusInput): Promise<GitStatusOutput> {
        const result = await this.proxy.process.executeCommand('git status --porcelain 2>/dev/null || true');
        const lines = result.output.trim().split('\n').filter(Boolean);
        const changedFiles = lines.map((l) => l.slice(3)); // strip status prefix
        return { changedFiles };
    }

    // -----------------------------------------------------------------------
    // File system
    // -----------------------------------------------------------------------

    async readFile(input: ReadFileInput): Promise<ReadFileOutput> {
        const { content } = await this.proxy.fs.readFile(input.args.path);
        return {
            file: {
                path: input.args.path,
                content,
                type: 'text' as const,
                toString: () => (typeof content === 'string' ? content : ''),
            },
        };
    }

    async writeFile(input: WriteFileInput): Promise<WriteFileOutput> {
        const content = typeof input.args.content === 'string'
            ? input.args.content
            : new TextDecoder().decode(input.args.content);
        await this.proxy.fs.writeFile(input.args.path, content, input.args.overwrite);
        return { success: true };
    }

    async statFile(input: StatFileInput): Promise<StatFileOutput> {
        const result = await this.proxy.fs.statFile(input.args.path);
        return { type: result.type };
    }

    async listFiles(input: ListFilesInput): Promise<ListFilesOutput> {
        const files = await this.proxy.fs.listFiles(input.args.path);
        return { files };
    }

    async deleteFiles(input: DeleteFilesInput): Promise<DeleteFilesOutput> {
        await this.proxy.fs.deleteFiles(input.args.path, input.args.recursive);
        return {};
    }

    async renameFile(input: RenameFileInput): Promise<RenameFileOutput> {
        await this.proxy.fs.renameFile(input.args.oldPath, input.args.newPath);
        return {};
    }

    async copyFiles(input: CopyFilesInput): Promise<CopyFileOutput> {
        await this.proxy.fs.copyFiles(
            input.args.sourcePath,
            input.args.targetPath,
            input.args.recursive,
            input.args.overwrite,
        );
        return {};
    }

    async createDirectory(input: CreateDirectoryInput): Promise<CreateDirectoryOutput> {
        await this.proxy.fs.createDirectory(input.args.path);
        return {};
    }

    async downloadFiles(_input: DownloadFilesInput): Promise<DownloadFilesOutput> {
        // Not implemented in this proxy model — could be backed by a tRPC endpoint later.
        return { url: undefined };
    }

    // -----------------------------------------------------------------------
    // File watching (polling-based)
    // -----------------------------------------------------------------------

    async watchFiles(input: WatchFilesInput): Promise<WatchFilesOutput> {
        const watcher = new DaytonaFileWatcher(
            this.proxy.fs,
            input.args.path,
            input.args.recursive ?? true,
            input.args.excludes ?? [],
            this.watchPollIntervalMs,
        );

        if (input.onFileChange) {
            watcher.registerEventCallback(input.onFileChange);
        }

        await watcher.start(input);
        return { watcher };
    }

    // -----------------------------------------------------------------------
    // Terminal / task / background command
    // -----------------------------------------------------------------------

    async createTerminal(_input: CreateTerminalInput): Promise<CreateTerminalOutput> {
        const terminal = new DaytonaTerminal(this.proxy.process);
        return { terminal };
    }

    async getTask(input: GetTaskInput): Promise<GetTaskOutput> {
        // In Daytona there is no separate task registry; we wrap the dev server
        // as a "task" using process management commands.
        const task = new DaytonaDevTask(input.args.id, this.proxy.process);
        return { task };
    }

    async runCommand(input: TerminalCommandInput): Promise<TerminalCommandOutput> {
        const result = await this.proxy.process.executeCommand(input.args.command);
        return { output: result.output };
    }

    async runBackgroundCommand(
        input: TerminalBackgroundCommandInput,
    ): Promise<TerminalBackgroundCommandOutput> {
        const cmd = new DaytonaBackgroundCommand(input.args.command, this.proxy.process);
        return { command: cmd };
    }
}

// ---------------------------------------------------------------------------
// DaytonaFileWatcher — polling-based implementation
// ---------------------------------------------------------------------------

export class DaytonaFileWatcher extends ProviderFileWatcher {
    private callbacks: Array<(event: WatchEvent) => Promise<void>> = [];
    private intervalHandle: ReturnType<typeof setInterval> | null = null;
    private knownFiles = new Map<string, string>(); // path → mtime-ish key
    private isRunning = false;

    constructor(
        private readonly fsProxy: DaytonaFsProxy,
        private readonly watchPath: string,
        private readonly recursive: boolean,
        private readonly excludes: string[],
        private readonly pollIntervalMs: number,
    ) {
        super();
    }

    async start(_input: WatchFilesInput): Promise<void> {
        if (this.isRunning) return;
        this.isRunning = true;

        // Take an initial snapshot
        await this.snapshot();

        this.intervalHandle = setInterval(async () => {
            if (!this.isRunning) return;
            await this.poll();
        }, this.pollIntervalMs);
    }

    async stop(): Promise<void> {
        this.isRunning = false;
        if (this.intervalHandle !== null) {
            clearInterval(this.intervalHandle);
            this.intervalHandle = null;
        }
    }

    registerEventCallback(callback: (event: WatchEvent) => Promise<void>): void {
        this.callbacks.push(callback);
    }

    private async snapshot(): Promise<void> {
        try {
            const files = await this.flatList(this.watchPath);
            for (const f of files) {
                this.knownFiles.set(f.path, f.size);
            }
        } catch {
            // Ignore errors during initial snapshot
        }
    }

    private async poll(): Promise<void> {
        try {
            const files = await this.flatList(this.watchPath);
            const currentMap = new Map(files.map((f) => [f.path, f.size]));

            const added: string[] = [];
            const changed: string[] = [];
            const removed: string[] = [];

            for (const [path, size] of currentMap) {
                if (!this.knownFiles.has(path)) {
                    added.push(path);
                } else if (this.knownFiles.get(path) !== size) {
                    changed.push(path);
                }
            }

            for (const path of this.knownFiles.keys()) {
                if (!currentMap.has(path)) {
                    removed.push(path);
                }
            }

            this.knownFiles = currentMap;

            if (added.length > 0) {
                await this.emit({ type: 'add', paths: added });
            }
            if (changed.length > 0) {
                await this.emit({ type: 'change', paths: changed });
            }
            if (removed.length > 0) {
                await this.emit({ type: 'remove', paths: removed });
            }
        } catch {
            // Silently ignore polling errors
        }
    }

    private async emit(event: WatchEvent): Promise<void> {
        for (const cb of this.callbacks) {
            try {
                await cb(event);
            } catch {
                // Ignore individual callback errors
            }
        }
    }

    private async flatList(
        dir: string,
    ): Promise<Array<{ path: string; size: string }>> {
        const results: Array<{ path: string; size: string }> = [];
        try {
            const entries = await this.fsProxy.listFiles(dir);
            for (const entry of entries) {
                const fullPath = dir === './' ? entry.name : `${dir}/${entry.name}`;
                const isExcluded = this.excludes.some(
                    (excl) => fullPath.includes(excl) || entry.name === excl,
                );
                if (isExcluded) continue;

                if (entry.type === 'directory' && this.recursive) {
                    const sub = await this.flatList(fullPath);
                    results.push(...sub);
                } else if (entry.type === 'file') {
                    // Use a cheap size proxy – the path itself is the key;
                    // we use the entry name as a surrogate since we can't
                    // easily get mtime without a stat call in the proxy.
                    results.push({ path: fullPath, size: entry.name });
                }
            }
        } catch {
            // ignore
        }
        return results;
    }
}

// ---------------------------------------------------------------------------
// DaytonaTerminal
// ---------------------------------------------------------------------------

export class DaytonaTerminal extends ProviderTerminal {
    private readonly _id: string;
    private outputCallbacks: Array<(data: string) => void> = [];
    private pollHandle: ReturnType<typeof setInterval> | null = null;
    private currentExecId: string | null = null;

    constructor(private readonly processProxy: DaytonaProcessProxy) {
        super();
        this._id = `daytona-terminal-${Date.now()}`;
    }

    get id(): string {
        return this._id;
    }

    get name(): string {
        return 'Daytona Terminal';
    }

    async open(_dimensions?: ProviderTerminalShellSize): Promise<string> {
        // Start a background bash session
        this.currentExecId = await this.processProxy.startBackground('bash -i 2>&1');
        this.startPolling();
        return this._id;
    }

    async write(input: string, _dimensions?: ProviderTerminalShellSize): Promise<void> {
        if (!this.currentExecId) {
            // If the terminal hasn't been opened yet, silently ignore.
            return;
        }
        // Execute the written input as a new command in the sandbox.
        // For a real PTY we'd use the WS endpoint; this is the next best thing.
        const result = await this.processProxy.executeCommand(input.trim());
        this.emit(result.output);
    }

    async run(input: string, _dimensions?: ProviderTerminalShellSize): Promise<void> {
        const result = await this.processProxy.executeCommand(input);
        this.emit(result.output);
    }

    async kill(): Promise<void> {
        this.stopPolling();
        if (this.currentExecId) {
            try {
                await this.processProxy.stopBackground(this.currentExecId);
            } catch {
                // ignore
            }
            this.currentExecId = null;
        }
    }

    onOutput(callback: (data: string) => void): () => void {
        this.outputCallbacks.push(callback);
        return () => {
            this.outputCallbacks = this.outputCallbacks.filter((cb) => cb !== callback);
        };
    }

    private emit(data: string): void {
        for (const cb of this.outputCallbacks) {
            try {
                cb(data);
            } catch {
                // ignore
            }
        }
    }

    private startPolling(): void {
        if (this.pollHandle || !this.currentExecId) return;
        const execId = this.currentExecId;
        this.pollHandle = setInterval(async () => {
            try {
                const output = await this.processProxy.pollOutput(execId);
                if (output) this.emit(output);
            } catch {
                // ignore poll errors
            }
        }, 1000);
    }

    private stopPolling(): void {
        if (this.pollHandle) {
            clearInterval(this.pollHandle);
            this.pollHandle = null;
        }
    }
}

// ---------------------------------------------------------------------------
// DaytonaDevTask — wraps the Next.js dev server as a Provider task
// ---------------------------------------------------------------------------

export class DaytonaDevTask extends ProviderTask {
    private outputCallbacks: Array<(data: string) => void> = [];
    private pollHandle: ReturnType<typeof setInterval> | null = null;
    private execId: string | null = null;

    constructor(
        private readonly taskId: string,
        private readonly processProxy: DaytonaProcessProxy,
    ) {
        super();
    }

    get id(): string {
        return this.taskId;
    }

    get name(): string {
        return this.taskId === 'dev' ? 'Next.js Dev Server' : this.taskId;
    }

    get command(): string {
        return 'npm run dev';
    }

    async open(_dimensions?: ProviderTerminalShellSize): Promise<string> {
        // Return the tail of the dev server log
        const result = await this.processProxy.executeCommand('tail -n 50 /tmp/next-dev.log 2>/dev/null || echo ""');
        this.startPolling();
        return result.output;
    }

    async run(): Promise<void> {
        this.execId = await this.processProxy.startBackground(
            'pkill -f "next dev" 2>/dev/null; sleep 1; cd /tmp/nextapp && npm run dev -- --hostname 0.0.0.0 -p 3000 >> /tmp/next-dev.log 2>&1',
        );
        this.startPolling();
    }

    async restart(): Promise<void> {
        await this.stop();
        await this.run();
    }

    async stop(): Promise<void> {
        this.stopPolling();
        await this.processProxy.executeCommand('pkill -f "next dev" 2>/dev/null || true');
    }

    onOutput(callback: (data: string) => void): () => void {
        this.outputCallbacks.push(callback);
        return () => {
            this.outputCallbacks = this.outputCallbacks.filter((cb) => cb !== callback);
        };
    }

    private emit(data: string): void {
        for (const cb of this.outputCallbacks) {
            try { cb(data); } catch { /* ignore */ }
        }
    }

    private startPolling(): void {
        if (this.pollHandle) return;
        this.pollHandle = setInterval(async () => {
            try {
                const result = await this.processProxy.executeCommand('tail -n 10 /tmp/next-dev.log 2>/dev/null || echo ""');
                if (result.output) this.emit(result.output);
            } catch { /* ignore */ }
        }, 2000);
    }

    private stopPolling(): void {
        if (this.pollHandle) {
            clearInterval(this.pollHandle);
            this.pollHandle = null;
        }
    }
}

// ---------------------------------------------------------------------------
// DaytonaBackgroundCommand
// ---------------------------------------------------------------------------

export class DaytonaBackgroundCommand extends ProviderBackgroundCommand {
    private execId: string | null = null;
    private outputCallbacks: Array<(data: string) => void> = [];
    private pollHandle: ReturnType<typeof setInterval> | null = null;

    constructor(
        private readonly _command: string,
        private readonly processProxy: DaytonaProcessProxy,
    ) {
        super();
    }

    get name(): string | undefined {
        return this._command;
    }

    get command(): string {
        return this._command;
    }

    async open(): Promise<string> {
        this.execId = await this.processProxy.startBackground(this._command);
        this.startPolling();
        return this.execId;
    }

    async restart(): Promise<void> {
        await this.kill();
        await this.open();
    }

    async kill(): Promise<void> {
        this.stopPolling();
        if (this.execId) {
            try {
                await this.processProxy.stopBackground(this.execId);
            } catch { /* ignore */ }
            this.execId = null;
        }
    }

    async write(input: string): Promise<void> {
        // Not easily supported in the polling model; execute as a one-shot command.
        const result = await this.processProxy.executeCommand(input.trim());
        this.emit(result.output);
    }

    onOutput(callback: (data: string) => void): () => void {
        this.outputCallbacks.push(callback);
        return () => {
            this.outputCallbacks = this.outputCallbacks.filter((cb) => cb !== callback);
        };
    }

    private emit(data: string): void {
        for (const cb of this.outputCallbacks) {
            try { cb(data); } catch { /* ignore */ }
        }
    }

    private startPolling(): void {
        if (this.pollHandle || !this.execId) return;
        const execId = this.execId;
        this.pollHandle = setInterval(async () => {
            try {
                const output = await this.processProxy.pollOutput(execId);
                if (output) this.emit(output);
            } catch { /* ignore */ }
        }, 1000);
    }

    private stopPolling(): void {
        if (this.pollHandle) {
            clearInterval(this.pollHandle);
            this.pollHandle = null;
        }
    }
}
