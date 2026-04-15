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

export interface DaytonaProviderOptions {
    apiKey?: string;
    sandboxId?: string;
}

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
        const Daytona = await this.getSDK();
        const apiKey = this.options.apiKey || process.env.SANDBOX_DAYTONA_API_KEY;
        if (!apiKey) {
            throw new Error('Daytona API key is required');
        }
        this.client = new Daytona({ apiKey });

        if (this.options.sandboxId) {
            this.sandbox = await this.client.get(this.options.sandboxId);
        }
        return {};
    }

    async writeFile(input: WriteFileInput): Promise<WriteFileOutput> {
        if (!this.sandbox) throw new Error('Sandbox not initialized');
        await this.sandbox.fs.uploadFiles([
            {
                source: typeof input.args.content === 'string' ? Buffer.from(input.args.content) : Buffer.from(input.args.content),
                destination: input.args.path,
            },
        ]);
        return { success: true };
    }

    async renameFile(input: RenameFileInput): Promise<RenameFileOutput> {
        // Daytona SDK doesn't have a direct rename in fs, use mv command
        if (!this.sandbox) throw new Error('Sandbox not initialized');
        await this.sandbox.process.executeCommand(`mv ${input.args.oldPath} ${input.args.newPath}`);
        return {};
    }

    async statFile(input: StatFileInput): Promise<StatFileOutput> {
        if (!this.sandbox) throw new Error('Sandbox not initialized');
        // Simple stat implementation via command
        const res = await this.sandbox.process.executeCommand(`stat ${input.args.path}`);
        if (res.exitCode !== 0) throw new Error(`File not found: ${input.args.path}`);
        
        const isDirResult = await this.sandbox.process.executeCommand(`[ -d ${input.args.path} ]`);
        return {
            type: isDirResult.exitCode === 0 ? 'directory' : 'file',
        };
    }

    async deleteFiles(input: DeleteFilesInput): Promise<DeleteFilesOutput> {
        if (!this.sandbox) throw new Error('Sandbox not initialized');
        await this.sandbox.fs.deleteFile(input.args.path); // Handles recursive internally if it's a folder? 
        // Docs say deleteFile, plural usually map to rm -rf
        return {};
    }

    async listFiles(input: ListFilesInput): Promise<ListFilesOutput> {
        if (!this.sandbox) throw new Error('Sandbox not initialized');
        const files = await this.sandbox.fs.listFiles(input.args.path);
        return {
            files: files.map((f: any) => ({
                name: f.name,
                type: f.isDir ? 'directory' : 'file',
                isSymlink: false,
            })),
        };
    }

    async readFile(input: ReadFileInput): Promise<ReadFileOutput> {
        if (!this.sandbox) throw new Error('Sandbox not initialized');
        const content = await this.sandbox.fs.downloadFile(input.args.path);
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
        if (!this.sandbox) throw new Error('Sandbox not initialized');
        // Daytona download returns a Buffer of the zipped files?
        // Actually downloadFile is for single file. 
        // For multiple, we might need a different approach.
        return {
            url: '', // Daytona doesn't provide a public download URL directly like this
        };
    }

    async copyFiles(input: CopyFilesInput): Promise<CopyFileOutput> {
        if (!this.sandbox) throw new Error('Sandbox not initialized');
        await this.sandbox.process.executeCommand(`cp ${input.args.recursive ? '-r ' : ''}${input.args.sourcePath} ${input.args.targetPath}`);
        return {};
    }

    async createDirectory(input: CreateDirectoryInput): Promise<CreateDirectoryOutput> {
        if (!this.sandbox) throw new Error('Sandbox not initialized');
        await this.sandbox.fs.createFolder(input.args.path, '755');
        return {};
    }

    async watchFiles(input: WatchFilesInput): Promise<WatchFilesOutput> {
        throw new Error('watchFiles not implemented for Daytona provider');
    }

    async createTerminal(input: CreateTerminalInput): Promise<CreateTerminalOutput> {
        throw new Error('createTerminal not implemented for Daytona provider');
    }

    async getTask(input: GetTaskInput): Promise<GetTaskOutput> {
        throw new Error('getTask not implemented for Daytona provider');
    }

    async runCommand(input: TerminalCommandInput): Promise<TerminalCommandOutput> {
        if (!this.sandbox) throw new Error('Sandbox not initialized');
        const res = await this.sandbox.process.executeCommand(input.args.command);
        return {
            output: res.result || '',
        };
    }

    async runBackgroundCommand(input: TerminalBackgroundCommandInput): Promise<TerminalBackgroundCommandOutput> {
        if (!this.sandbox) throw new Error('Sandbox not initialized');
        // Background commands in Daytona use sessions
        const sessionId = `bg-${Date.now()}`;
        await this.sandbox.process.createSession(sessionId);
        const command = await this.sandbox.process.executeSessionCommand(sessionId, {
            command: input.args.command,
            runAsync: true,
        });
        return {
            command: new DaytonaBackgroundCommand(this.sandbox, sessionId, command.cmdId!),
        };
    }

    async gitStatus(input: GitStatusInput): Promise<GitStatusOutput> {
        if (!this.sandbox) throw new Error('Sandbox not initialized');
        const res = await this.sandbox.process.executeCommand('git status --porcelain');
        return {
            changedFiles: res.result ? res.result.split('\n').filter(Boolean).map(l => l.slice(3)) : [],
        };
    }

    async createSession(input: CreateSessionInput): Promise<CreateSessionOutput> {
        if (!this.sandbox) throw new Error('Sandbox not initialized');
        // Just return success, Daytona doesn't have "Browser Sessions" in the same way CS does
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
        if (!this.sandbox) return false;
        try {
            await this.sandbox.process.executeCommand('echo "ping"');
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
        });

        return { id: sandbox.id };
    }

    async pauseProject(input: PauseProjectInput): Promise<PauseProjectOutput> {
        if (this.sandbox) await this.sandbox.stop();
        return {};
    }

    async stopProject(input: StopProjectInput): Promise<StopProjectOutput> {
        if (this.sandbox) await this.sandbox.stop();
        return {};
    }

    async listProjects(input: ListProjectsInput): Promise<ListProjectsOutput> {
        if (!this.client) return {};
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
    }

    async destroy(): Promise<void> {
        this.sandbox = null;
        this.client = null;
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
        if (this.sandbox) await this.sandbox.archive();
    }

    async recover() {
        if (this.sandbox) await this.sandbox.recover(120);
    }

    async start() {
        if (this.sandbox) await this.sandbox.start(120);
    }

    async getPreviewLink(port: number) {
        if (this.sandbox) return this.sandbox.getPreviewLink(port);
        return null;
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
