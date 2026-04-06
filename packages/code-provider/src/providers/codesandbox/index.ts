import {
    CodeSandbox,
    Command,
    Sandbox,
    Task,
    Terminal,
    VMTier,
    WebSocketSession,
    type SandboxBrowserSession,
    type Watcher,
} from '@codesandbox/sdk';
import { connectToSandbox } from '@codesandbox/sdk/browser';
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
import { listFiles } from './utils/list-files';
import { readFile } from './utils/read-file';
import { writeFile } from './utils/write-file';

export interface CodesandboxProviderOptions {
    sandboxId?: string;
    userId?: string;
    keepActiveWhileConnected?: boolean;
    initClient?: boolean;
    tier?: string;
    // returns a session object used by codesandbox SDK
    // only populate this property in the browser
    getSession?: (sandboxId: string, userId?: string) => Promise<SandboxBrowserSession | null>;
    onLog?: (message: string) => void;
}

export interface CodesandboxCreateSessionInput extends CreateSessionInput {}
export interface CodesandboxCreateSessionOutput
    extends CreateSessionOutput,
        SandboxBrowserSession {}

export class CodesandboxProvider extends Provider {
    private readonly options: CodesandboxProviderOptions;

    private sandbox: Sandbox | null = null;
    private _client: WebSocketSession | null = null;

    constructor(options: CodesandboxProviderOptions) {
        super();
        this.options = options;
        this.onLog = options.onLog;
    }

    private log(level: 'info' | 'warn' | 'error', message: string, ...args: any[]) {
        const formattedMessage = `[CodesandboxProvider] ${message}`;
        const logFn = this.onLog || this.options.onLog;
        if (logFn) {
            logFn(formattedMessage + (args.length > 0 ? ' ' + args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ') : ''));
        }

        // Only log to server console if no onLog is provided to avoid clutter
        const isBrowser = typeof window !== 'undefined';
        if (isBrowser || !logFn) {
            if (level === 'error') console.error(formattedMessage, ...args);
            else if (level === 'warn') console.warn(formattedMessage, ...args);
            else console.log(formattedMessage, ...args);
        }
    }

    // may be removed in the future once the code completely interfaces through the provider
    get client() {
        return this._client;
    }

    async initialize(input: InitializeInput): Promise<InitializeOutput> {
        this.log('info', `Initializing for sandbox ${this.options.sandboxId || 'unknown'}`);
        if (!this.options.sandboxId) {
            return {};
        }
        if (this.options.getSession) {
            const session = await this.options.getSession(
                this.options.sandboxId,
                this.options.userId,
            );
            if (this.options.initClient) {
                this._client = await connectToSandbox({
                    session,
                    getSession: async (id) =>
                        (await this.options.getSession?.(id, this.options.userId)) || null,
                });
                try {
                    this._client.keepActiveWhileConnected(
                        this.options.keepActiveWhileConnected ?? true,
                    );
                } catch (error) {
                    this.log('warn', 'Failed to set keepActiveWhileConnected:', error);
                }
            }
        } else {
            // backend path, use environment variables
            const sdk = new CodeSandbox();
            try {
                this.sandbox = await sdk.sandboxes.resume(this.options.sandboxId);
            } catch (error) {
                this.log('error', `Failed to resume sandbox ${this.options.sandboxId}:`, error);
                throw new Error(
                    `Failed to resume sandbox: ${
                        error instanceof Error ? error.message : String(error)
                    }`,
                );
            }

            if (!this.sandbox) {
                this.log('error', `Sandbox not found after resume: ${this.options.sandboxId}`);
                throw new Error('Sandbox not found');
            }
            this.log('info', `Sandbox resumed: ${this.options.sandboxId}`);

            try {
                // If tier is not provided or is Pico (default), skip update to avoid redundant restarts/API errors
                const requestedTier = this.options.tier ? this.options.tier.toLowerCase() : 'pico';
                if (requestedTier !== 'pico') {
                    const tier = VMTier.fromName(requestedTier as any);
                    await this.sandbox.updateTier(tier);
                }
            } catch (error) {
                this.log('warn', `Failed to update VM tier to ${this.options.tier}:`, error);
            }

            if (this.options.initClient) {
                try {
                    this._client = await this.sandbox.connect();
                    this.log('info', `Connected to sandbox WebSocket: ${this.options.sandboxId}`);
                } catch (error) {
                    this.log('error', `Failed to connect to sandbox WebSocket ${this.options.sandboxId}:`, error);
                    throw new Error(`Failed to connect to sandbox: ${error instanceof Error ? error.message : String(error)}`);
                }
            }
        }
        return {};
    }

    async reload(): Promise<boolean> {
        if (!this.client) {
            throw new Error('Client not initialized');
        }
        const task = await this.client?.tasks.get('dev');
        if (task) {
            await task.restart();
            return true;
        }
        return false;
    }

    async reconnect(): Promise<void> {
        // TODO: Implement
    }

    async ping(): Promise<boolean> {
        try {
            await this.client?.commands.run('echo "ping"');
            return true;
        } catch (error) {
            this.log('error', 'Failed to ping sandbox', error);
            return false;
        }
    }

    async destroy(): Promise<void> {
        await this.client?.disconnect();
        this._client = null;
        this.sandbox = null;
    }

    static async createProject(input: CreateProjectInput): Promise<CreateProjectOutput> {
        const sdk = new CodeSandbox();
        const newSandbox = await sdk.sandboxes.create({
            id: input.id,
            source: 'template',
            title: input.title,
            description: input.description,
            tags: input.tags,
            vmTier: input.tier ? VMTier.fromName(input.tier as any) : VMTier.Pico,
        });
        return {
            id: newSandbox.id,
        };
    }

    static async createProjectFromGit(input: {
        repoUrl: string;
        branch: string;
        tier?: string;
    }): Promise<CreateProjectOutput> {
        const sdk = new CodeSandbox();
        const TIMEOUT_MS = 30000;

        const createPromise = sdk.sandboxes.create({
            source: 'git',
            url: input.repoUrl,
            branch: input.branch,
            vmTier: input.tier ? VMTier.fromName(input.tier as any) : VMTier.Pico,
            async setup(session) {
                await session.setup.run();
            },
        });

        const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error('Repository access timeout')), TIMEOUT_MS);
        });

        const newSandbox = await Promise.race([createPromise, timeoutPromise]);

        return {
            id: newSandbox.id,
        };
    }

    async pauseProject(input: PauseProjectInput): Promise<PauseProjectOutput> {
        if (this.sandbox && this.options.sandboxId) {
            const sdk = new CodeSandbox();
            await sdk.sandboxes.hibernate(this.options.sandboxId);
        }
        return {};
    }

    async stopProject(input: StopProjectInput): Promise<StopProjectOutput> {
        if (this.sandbox && this.options.sandboxId) {
            const sdk = new CodeSandbox();
            await sdk.sandboxes.shutdown(this.options.sandboxId);
        }
        return {};
    }

    async listProjects(input: ListProjectsInput): Promise<ListProjectsOutput> {
        if (this.sandbox) {
            const sdk = new CodeSandbox();
            const projects = await sdk.sandboxes.list();
            return {
                projects: projects.sandboxes.map((project) => ({
                    id: project.id,
                    name: project.title,
                    description: project.description,
                    createdAt: project.createdAt,
                    updatedAt: project.updatedAt,
                })),
            };
        }
        return { projects: [] };
    }

    async writeFile(input: WriteFileInput): Promise<WriteFileOutput> {
        if (!this.client) {
            throw new Error('Client not initialized');
        }
        return writeFile(this.client, input);
    }

    async renameFile(input: RenameFileInput): Promise<RenameFileOutput> {
        if (!this.client) {
            throw new Error('Client not initialized');
        }
        await this.client.fs.rename(input.args.oldPath, input.args.newPath);
        return {};
    }

    async statFile(input: StatFileInput): Promise<StatFileOutput> {
        if (!this.client) {
            throw new Error('Client not initialized');
        }
        const res = await this.client.fs.stat(input.args.path);
        return {
            type: res.type,
            isSymlink: res.isSymlink,
            size: res.size,
            mtime: res.mtime,
            ctime: res.ctime,
            atime: res.atime,
        };
    }

    async deleteFiles(input: DeleteFilesInput): Promise<DeleteFilesOutput> {
        if (!this.client) {
            throw new Error('Client not initialized');
        }
        await this.client.fs.remove(input.args.path, input.args.recursive);
        return {};
    }

    async listFiles(input: ListFilesInput): Promise<ListFilesOutput> {
        if (!this.client) {
            throw new Error('Client not initialized');
        }
        return listFiles(this.client, input);
    }

    async readFile(input: ReadFileInput): Promise<ReadFileOutput> {
        if (!this.client) {
            throw new Error('Client not initialized');
        }
        return readFile(this.client, input);
    }

    async downloadFiles(input: DownloadFilesInput): Promise<DownloadFilesOutput> {
        if (!this.client) {
            throw new Error('Client not initialized');
        }
        const res = await this.client.fs.download(input.args.path);
        return {
            url: res.downloadUrl,
        };
    }

    async copyFiles(input: CopyFilesInput): Promise<CopyFileOutput> {
        if (!this.client) {
            throw new Error('Client not initialized');
        }
        await this.client.fs.copy(
            input.args.sourcePath,
            input.args.targetPath,
            input.args.recursive,
            input.args.overwrite,
        );
        return {};
    }

    async createDirectory(input: CreateDirectoryInput): Promise<CreateDirectoryOutput> {
        if (!this.client) {
            throw new Error('Client not initialized');
        }
        await this.client.fs.mkdir(input.args.path);
        return {};
    }

    async watchFiles(input: WatchFilesInput): Promise<WatchFilesOutput> {
        if (!this.client) {
            throw new Error('Client not initialized');
        }
        const watcher = new CodesandboxFileWatcher(this.client);

        await watcher.start(input);

        if (input.onFileChange) {
            watcher.registerEventCallback(async (event) => {
                if (input.onFileChange) {
                    await input.onFileChange({
                        type: event.type,
                        paths: event.paths,
                    });
                }
            });
        }

        return {
            watcher,
        };
    }

    async createTerminal(input: CreateTerminalInput): Promise<CreateTerminalOutput> {
        if (!this.client) {
            throw new Error('Client not initialized');
        }
        const csTerminal = await this.client.terminals.create();
        return {
            terminal: new CodesandboxTerminal(csTerminal),
        };
    }

    async getTask(input: GetTaskInput): Promise<GetTaskOutput> {
        if (!this.client) {
            throw new Error('Client not initialized');
        }
        const task = this.client.tasks.get(input.args.id);
        if (!task) {
            throw new Error(`Task ${input.args.id} not found`);
        }
        return {
            task: new CodesandboxTask(task),
        };
    }

    async runCommand({ args }: TerminalCommandInput): Promise<TerminalCommandOutput> {
        if (!this.client) {
            throw new Error('Client not initialized');
        }
        this.log('info', `Running command: ${args.command}`);
        const output = await this.client.commands.run(args.command);
        return {
            output,
        };
    }

    async runBackgroundCommand(
        input: TerminalBackgroundCommandInput,
    ): Promise<TerminalBackgroundCommandOutput> {
        if (!this.client) {
            throw new Error('Client not initialized');
        }
        this.log('info', `Running background command: ${input.args.command}`);
        const command = await this.client.commands.runBackground(input.args.command);
        return {
            command: new CodesandboxBackgroundCommand(command),
        };
    }

    async gitStatus(input: GitStatusInput): Promise<GitStatusOutput> {
        if (!this.client) {
            throw new Error('Client not initialized');
        }
        const status = await this.client.git.status();
        return {
            changedFiles: status.changedFiles,
        };
    }

    async setup(input: SetupInput): Promise<SetupOutput> {
        if (!this.client) {
            throw new Error('Client not initialized');
        }
        await this.client.setup.run();
        await this.client.setup.waitUntilComplete();
        return {};
    }

    async createSession(
        input: CodesandboxCreateSessionInput,
    ): Promise<CodesandboxCreateSessionOutput> {
        if (!this.sandbox) {
            throw new Error('Client not initialized');
        }
        const session = await this.sandbox.createBrowserSession({
            id: input.args.id,
        });

        try {
            // Generate a signed preview URL to bypass the security gateway
            // This uses the host token API which can automatically authorize the browser
            const sdk = new CodeSandbox();
            if (this.options.sandboxId) {
                const hostToken = await sdk.hosts.createToken(this.options.sandboxId);
                const signedPreviewUrl = sdk.hosts.getUrl(hostToken, 3000);

                return {
                    ...session,
                    signedPreviewUrl,
                };
            }
            return session;
        } catch (error) {
            this.log('warn', 'Failed to generate signed preview URL:', error);
            return session;
        }
    }
}

export class CodesandboxFileWatcher extends ProviderFileWatcher {
    private watcher: Watcher | null = null;

    constructor(private readonly client: WebSocketSession) {
        super();
    }

    async start(input: WatchFilesInput): Promise<void> {
        this.watcher = await this.client.fs.watch(input.args.path, {
            recursive: input.args.recursive,
            excludes: input.args.excludes || [],
        });
    }

    registerEventCallback(callback: (event: WatchEvent) => Promise<void>): void {
        if (!this.watcher) {
            throw new Error('Watcher not initialized');
        }
        this.watcher.onEvent(callback);
    }

    async stop(): Promise<void> {
        if (!this.watcher) {
            throw new Error('Watcher not initialized');
        }
        this.watcher.dispose();
        this.watcher = null;
    }
}

export class CodesandboxTerminal extends ProviderTerminal {
    constructor(private readonly _terminal: Terminal) {
        super();
    }

    get id(): string {
        return this._terminal.id;
    }

    get name(): string {
        return this._terminal.name;
    }

    open(dimensions?: ProviderTerminalShellSize): Promise<string> {
        return this._terminal.open(dimensions);
    }

    write(input: string, dimensions?: ProviderTerminalShellSize): Promise<void> {
        return this._terminal.write(input, dimensions);
    }

    run(input: string, dimensions?: ProviderTerminalShellSize): Promise<void> {
        return this._terminal.run(input, dimensions);
    }

    kill(): Promise<void> {
        return this._terminal.kill();
    }

    onOutput(callback: (data: string) => void): () => void {
        const disposable = this._terminal.onOutput(callback);
        return () => {
            disposable.dispose();
        };
    }
}

export class CodesandboxTask extends ProviderTask {
    constructor(private readonly _task: Task) {
        super();
    }

    get id(): string {
        return this._task.id;
    }

    get name(): string {
        return this._task.name;
    }

    get command(): string {
        return this._task.command;
    }

    open(): Promise<string> {
        return this._task.open();
    }

    run(): Promise<void> {
        return this._task.run();
    }

    restart(): Promise<void> {
        return this._task.restart();
    }

    stop(): Promise<void> {
        return this._task.stop();
    }

    onOutput(callback: (data: string) => void): () => void {
        const disposable = this._task.onOutput(callback);
        return () => {
            disposable.dispose();
        };
    }
}

export class CodesandboxBackgroundCommand extends ProviderBackgroundCommand {
    constructor(private readonly _command: Command) {
        super();
    }

    get name(): string | undefined {
        return this._command.name;
    }

    get command(): string {
        return this._command.command;
    }

    open(): Promise<string> {
        return this._command.open();
    }

    restart(): Promise<void> {
        return this._command.restart();
    }

    kill(): Promise<void> {
        return this._command.kill();
    }

    write(input: string): Promise<void> {
        return (this._command as any).write?.(input) || Promise.resolve();
    }

    onOutput(callback: (data: string) => void): () => void {
        const disposable = this._command.onOutput(callback);
        return () => {
            disposable.dispose();
        };
    }
}
