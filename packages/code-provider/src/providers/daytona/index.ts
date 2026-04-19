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
    type ListProjectsInput,
    type ListProjectsOutput,
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

import type { DaytonaProviderOptions } from '../daytona-options';

export type { DaytonaProviderOptions } from '../daytona-options';

export class DaytonaProvider extends Provider {
    private client: any = null; // Daytona
    private sandbox: any = null; // Sandbox
    private readonly options: DaytonaProviderOptions;

    constructor(options: DaytonaProviderOptions) {
        super();
        this.options = options;
    }

    private async getSDK() {
        if (typeof window !== 'undefined') {
            throw new Error('Daytona SDK is not supported in the browser');
        }
        // Dynamic import to prevent bundling in the browser if possible, 
        // though tRPC procedures are server-side.
        const { Daytona } = await import('@daytonaio/sdk');
        return Daytona;
    }

    async initialize(input: InitializeInput): Promise<InitializeOutput> {
        console.log(`[DaytonaProvider] Initializing (SandboxID: ${this.options.sandboxId || 'none'})`);
        const Daytona = await this.getSDK();
        const apiKey = this.options.apiKey || process.env.SANDBOX_DAYTONA_API_KEY;
        if (!apiKey) {
            console.error('[DaytonaProvider] API key is missing from options and process.env');
            throw new Error('Daytona API key is required');
        }
        this.client = new Daytona({ apiKey });

        // We no longer fetch the sandbox here to avoid failing initialization 
        // if a specific sandbox ID is stale or in transition.
        return {};
    }

    private async ensureSandbox() {
        if (this.sandbox) return this.sandbox;
        if (!this.options.sandboxId) throw new Error('No sandboxId provided to DaytonaProvider');
        if (!this.client) await this.initialize({});
        
        console.log(`[DaytonaProvider] Fetching sandbox ${this.options.sandboxId}...`);
        try {
            this.sandbox = await this.client.get(this.options.sandboxId);
            return this.sandbox;
        } catch (error: any) {
            console.error(`[DaytonaProvider] Failed to fetch sandbox ${this.options.sandboxId}:`, error.message);
            throw error;
        }
    }

    async writeFile(input: WriteFileInput): Promise<WriteFileOutput> {
        const sandbox = await this.ensureSandbox();
        await sandbox.fs.uploadFiles([
            {
                source: typeof input.args.content === 'string' ? Buffer.from(input.args.content) : Buffer.from(input.args.content),
                destination: input.args.path,
            },
        ]);
        return { success: true };
    }

    async renameFile(input: RenameFileInput): Promise<RenameFileOutput> {
        const sandbox = await this.ensureSandbox();
        await sandbox.process.executeCommand(`mv ${input.args.oldPath} ${input.args.newPath}`);
        return {};
    }

    async statFile(input: StatFileInput): Promise<StatFileOutput> {
        const sandbox = await this.ensureSandbox();
        // Simple stat implementation via command
        const res = await sandbox.process.executeCommand(`stat ${input.args.path}`);
        if (res.exitCode !== 0) throw new Error(`File not found: ${input.args.path}`);
        
        const isDirResult = await this.sandbox.process.executeCommand(`[ -d ${input.args.path} ]`);
        return {
            type: isDirResult.exitCode === 0 ? 'directory' : 'file',
        };
    }

    async deleteFiles(input: DeleteFilesInput): Promise<DeleteFilesOutput> {
        const sandbox = await this.ensureSandbox();
        await sandbox.fs.deleteFile(input.args.path); // Handles recursive internally if it's a folder? 
        // Docs say deleteFile, plural usually map to rm -rf
        return {};
    }

    async listFiles(input: ListFilesInput): Promise<ListFilesOutput> {
        const sandbox = await this.ensureSandbox();
        const files = await sandbox.fs.listFiles(input.args.path);
        return {
            files: files.map((f: any) => ({
                name: f.name,
                type: f.isDir ? 'directory' : 'file',
                isSymlink: false,
            })),
        };
    }

    async readFile(input: ReadFileInput): Promise<ReadFileOutput> {
        const sandbox = await this.ensureSandbox();
        const content = await sandbox.fs.downloadFile(input.args.path);
        return {
            file: {
                path: input.args.path,
                content: content.toString(),
                type: 'text',
                toString: () => content.toString(),
            },
        };
    }

    async downloadFiles(input: DownloadFilesInput): Promise<DownloadFilesOutput> {
        // Ensure sandbox exists
        await this.ensureSandbox();
        // Daytona download returns a Buffer of the zipped files?
        // Actually downloadFile is for single file. 
        // For multiple, we might need a different approach.
        return {
            url: '', // Daytona doesn't provide a public download URL directly like this
        };
    }

    async copyFiles(input: CopyFilesInput): Promise<CopyFileOutput> {
        const sandbox = await this.ensureSandbox();
        await sandbox.process.executeCommand(`cp ${input.args.recursive ? '-r ' : ''}${input.args.sourcePath} ${input.args.targetPath}`);
        return {};
    }

    async createDirectory(input: CreateDirectoryInput): Promise<CreateDirectoryOutput> {
        const sandbox = await this.ensureSandbox();
        await sandbox.fs.createFolder(input.args.path, '755');
        return {};
    }

    async watchFiles(input: WatchFilesInput): Promise<WatchFilesOutput> {
        throw new Error('watchFiles not implemented for Daytona provider');
    }

    async createTerminal(input: CreateTerminalInput): Promise<CreateTerminalOutput> {
        const sandbox = await this.ensureSandbox();
        
        // We need to manage the multicasting of output here or in DaytonaTerminal
        const terminal = new DaytonaTerminal(sandbox);
        return { terminal };
    }

    async getTask(input: GetTaskInput): Promise<GetTaskOutput> {
        throw new Error('getTask not implemented for Daytona provider');
    }

    async runCommand(input: TerminalCommandInput): Promise<TerminalCommandOutput> {
        const sandbox = await this.ensureSandbox();
        const res = await sandbox.process.executeCommand(
            input.args.command,
            undefined,
            undefined,
            input.args.timeout,
        );
        return {
            output: res.result || '',
            exitCode: res.exitCode,
        };
    }

    async runBackgroundCommand(input: TerminalBackgroundCommandInput): Promise<TerminalBackgroundCommandOutput> {
        const sandbox = await this.ensureSandbox();
        // Background commands in Daytona use sessions
        const sessionId = `bg-${Date.now()}`;
        await sandbox.process.createSession(sessionId);
        const command = await sandbox.process.executeSessionCommand(sessionId, {
            command: input.args.command,
            runAsync: true,
        });
        return {
            command: new DaytonaBackgroundCommand(sandbox, sessionId, command.cmdId!),
        };
    }

    async gitStatus(input: GitStatusInput): Promise<GitStatusOutput> {
        const sandbox = await this.ensureSandbox();
        const res = await sandbox.process.executeCommand('git status --porcelain');
        return {
            changedFiles: res.result ? res.result.split('\n').filter(Boolean).map((l: string) => l.slice(3)) : [],
        };
    }

    async createSession(input: CreateSessionInput): Promise<CreateSessionOutput> {
        await this.ensureSandbox();
        // Daytona does not use CodeSandbox-style browser sessions; callers only need a live VM.
        return {};
    }

    async setup(input: SetupInput): Promise<SetupOutput> {
        return {};
    }

    async reload(): Promise<boolean> {
        return true;
    }

    async reconnect(): Promise<void> {
        if (this.client && this.options.sandboxId) {
            this.sandbox = await this.client.get(this.options.sandboxId);
        }
    }

    async ping(): Promise<boolean> {
        try {
            const sandbox = await this.ensureSandbox();
            await sandbox.process.executeCommand('echo "ping"');
            return true;
        } catch {
            return false;
        }
    }

    static async createProject(input: CreateProjectInput): Promise<CreateProjectOutput> {
        const Daytona = await (async () => {
             const { Daytona } = await import('@daytonaio/sdk');
             return Daytona;
        })();
        const apiKey = process.env.SANDBOX_DAYTONA_API_KEY;
        if (!apiKey) throw new Error('Daytona API key required');
        const client = new Daytona({ apiKey });
        
        const sandbox = await client.create({
            language: input.source as any || 'typescript',
            autoStopInterval: 120,
            autoArchiveInterval: 30,
            ephemeral: false,
            snapshot: input.snapshotName,
            labels: input.labels,
        });

        return { id: sandbox.id };
    }

    async pauseProject(input: PauseProjectInput): Promise<PauseProjectOutput> {
        const sandbox = await this.ensureSandbox();
        await sandbox.stop();
        return {};
    }

    async stopProject(input: StopProjectInput): Promise<StopProjectOutput> {
        const sandbox = await this.ensureSandbox();
        await sandbox.stop();
        return {};
    }

    async listProjects(input: ListProjectsInput): Promise<ListProjectsOutput> {
        if (!this.client) await this.initialize({});
        console.log('[DaytonaProvider] Listing projects...');
        try {
            const res = await this.client.list(undefined, 1, 100);
            return {
                projects: res.items.map((s: any) => ({
                    id: s.id,
                    name: s.id,
                    state: s.state,
                    createdAt: s.createdAt,
                    updatedAt: s.updatedAt,
                })),
            };
        } catch (error: any) {
            console.error('[DaytonaProvider] Failed to list projects:', error.message);
            throw error;
        }
    }

    async destroy(): Promise<void> {
        this.sandbox = null;
        this.client = null;
    }

    async deleteProject(input: { sandboxId?: string }): Promise<void> {
        const id = input.sandboxId || this.options.sandboxId;
        if (!id) throw new Error('sandboxId is required for deletion');

        if (!this.client) await this.initialize({});
        console.log(`[DaytonaProvider] Deleting sandbox ${id}...`);
        try {
            const sandbox = await this.client.get(id);
            // Ensure it is stopped before deletion if we have the instance
            try { await sandbox.stop(); } catch (e) { /* Ignore stop errors */ }
            await this.client.delete(sandbox);
        } catch (error: any) {
            console.error(`[DaytonaProvider] Deletion failed for ${id}:`, error.message);
            throw error;
        }
    }

    async get(input: { sandboxId: string }) {
        if (!this.client) {
             const Daytona = await this.getSDK();
             const apiKey = this.options.apiKey || process.env.SANDBOX_DAYTONA_API_KEY;
             if (!apiKey) throw new Error('Daytona API key required');
             this.client = new Daytona({ apiKey });
        }
        return await this.client.get(input.sandboxId);
    }

    // Daytona specific extensions
    async archive() {
        const sandbox = await this.ensureSandbox();
        // Ensure it is stopped first as archive might fail if running
        try { await sandbox.stop(); } catch (e) { /* Ignore */ }
        await sandbox.archive();
    }

    async recover() {
        const sandbox = await this.ensureSandbox();
        await sandbox.recover(120);
    }

    async start() {
        const sandbox = await this.ensureSandbox();
        await sandbox.start(120);
    }

    async getPreviewLink(port: number) {
        const sandbox = await this.ensureSandbox();
        // Use getSignedPreviewUrl if available as it is better for iframing (bypasses login)
        if (typeof sandbox.getSignedPreviewUrl === 'function') {
            console.log(`[DaytonaProvider] Fetching signed preview URL for port ${port}...`);
            return await sandbox.getSignedPreviewUrl(port);
        }
        return sandbox.getPreviewLink(port);
    }

    // Interval settings
    async setAutoArchiveInterval(interval: number) {
        const sandbox = await this.ensureSandbox();
        await sandbox.setAutoArchiveInterval(interval);
    }

    async setAutoStopInterval(interval: number) {
        const sandbox = await this.ensureSandbox();
        await sandbox.setAutostopInterval(interval);
    }

    // Snapshot management
    async listSnapshots() {
        if (!this.client) await this.initialize({});
        console.log('[DaytonaProvider] Listing snapshots...');
        try {
            const result = await this.client.snapshot.list(1, 100);
            return result.items || [];
        } catch (error: any) {
            console.error('[DaytonaProvider] Failed to list snapshots:', error.message);
            throw error;
        }
    }

    async createSnapshot(name: string, image: string) {
        if (!this.client) {
             const Daytona = await this.getSDK();
             const apiKey = this.options.apiKey || process.env.SANDBOX_DAYTONA_API_KEY;
             if (!apiKey) throw new Error('Daytona API key required');
             this.client = new Daytona({ apiKey });
        }
        return await this.client.snapshot.create({ name, image });
    }
    async fork(name?: string) {
        console.log(`[DaytonaProvider] Forking sandbox... ${name ? `(name: ${name})` : ''}`);
        const sandbox = await this.ensureSandbox();
        
        // Use the experimental fork method on the sandbox object
        const forkMethod = (sandbox as any)._experimental_fork || (sandbox as any).fork;
        
        if (typeof forkMethod === 'function') {
            const methodName = (sandbox as any).fork ? 'fork' : '_experimental_fork';
            console.log(`[DaytonaProvider] Invoking ${methodName} for clone operation`);
            // The SDK method returns a new Sandbox instance and automatically waits for it to start
            const forkedSandbox = await forkMethod.call(sandbox, { name });
            return {
                id: forkedSandbox.id,
                state: forkedSandbox.state,
                createdAt: forkedSandbox.createdAt,
            };
        } else {
            throw new Error('Daytona SDK version does not support cloning/forking from a running sandbox.');
        }
    }

    async deleteSnapshot(name: string) {
        if (!this.client) {
             const Daytona = await this.getSDK();
             const apiKey = this.options.apiKey || process.env.SANDBOX_DAYTONA_API_KEY;
             if (!apiKey) throw new Error('Daytona API key required');
             this.client = new Daytona({ apiKey });
        }
        const snapshot = await this.client.snapshot.get(name);
        await this.client.snapshot.delete(snapshot);
    }

    async activateSnapshot(name: string) {
        if (!this.client) {
             const Daytona = await this.getSDK();
             const apiKey = this.options.apiKey || process.env.SANDBOX_DAYTONA_API_KEY;
             if (!apiKey) throw new Error('Daytona API key required');
             this.client = new Daytona({ apiKey });
        }
        const snapshot = await this.client.snapshot.get(name);
        return await this.client.snapshot.activate(snapshot);
    }
}

export class DaytonaTerminal extends ProviderTerminal {
    private ptyHandle: any = null;
    private outputCallbacks: Set<(data: string) => void> = new Set();
    private decoder = new TextDecoder();

    constructor(private readonly sandbox: any) {
        super();
    }

    get id(): string {
        return this.ptyHandle?.sessionId || 'pending';
    }

    get name(): string {
        return 'Daytona Terminal';
    }

    async open(dimensions?: ProviderTerminalShellSize): Promise<string> {
        if (this.ptyHandle) return this.id;

        const ptyId = `pty-${Math.random().toString(36).substring(2, 10)}`;
        this.ptyHandle = await this.sandbox.process.createPty({
            id: ptyId,
            cols: dimensions?.cols || 80,
            rows: dimensions?.rows || 24,
            onData: (data: Uint8Array) => {
                const text = this.decoder.decode(data);
                this.outputCallbacks.forEach(cb => cb(text));
            }
        });

        await this.ptyHandle.waitForConnection();
        return this.id;
    }

    async write(input: string, dimensions?: ProviderTerminalShellSize): Promise<void> {
        if (!this.ptyHandle) await this.open(dimensions);
        if (dimensions) {
            await this.ptyHandle.resize(dimensions.cols, dimensions.rows);
        }
        await this.ptyHandle.sendInput(input);
    }

    async run(input: string, dimensions?: ProviderTerminalShellSize): Promise<void> {
        await this.write(input + '\n', dimensions);
    }

    async kill(): Promise<void> {
        if (this.ptyHandle) {
            await this.ptyHandle.kill();
            await this.ptyHandle.disconnect();
            this.ptyHandle = null;
        }
    }

    onOutput(callback: (data: string) => void): () => void {
        this.outputCallbacks.add(callback);
        return () => {
            this.outputCallbacks.delete(callback);
        };
    }
}

export class DaytonaBackgroundCommand extends ProviderBackgroundCommand {
    constructor(
        private readonly sandbox: any,
        private readonly sessionId: string,
        private readonly cmdId: string
    ) {
        super();
    }

    get name(): string | undefined { return this.cmdId; }
    get command(): string { return ''; }

    async open(): Promise<string> { return this.cmdId; }
    
    async restart(): Promise<void> {
        // Not directly supported in Daytona SDK via session command?
    }

    async kill(): Promise<void> {
        // Not directly supported in Daytona SDK?
    }

    async write(input: string): Promise<void> {
        // Not directly supported?
    }

    onOutput(callback: (data: string) => void): () => void {
        const interval = setInterval(async () => {
            try {
                const logs = await this.sandbox.process.getSessionCommandLogs(this.sessionId, this.cmdId);
                if (logs.output) callback(logs.output);
            } catch (e) {
                console.warn('Failed to get Daytona logs', e);
            }
        }, 2000);
        return () => clearInterval(interval);
    }
}
