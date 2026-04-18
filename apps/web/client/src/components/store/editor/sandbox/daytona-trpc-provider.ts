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
    type ReadFileOutputFile,
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
} from '@onlook/code-provider';

import { api } from '@/trpc/client';

/**
 * A frontend adapter that implements the unified `Provider` interface
 * but maps all file operations and commands asynchronously over TRPC to the
 * Daytona Node.js SDK backend.
 */
export class TRPCDaytonaProvider extends Provider {
    private sandboxId: string;
    // Map to keep track of any active background tasks
    private activeTasks = new Map<string, ProviderTask>();

    constructor(sandboxId: string) {
        super();
        this.sandboxId = sandboxId;
    }

    async initialize(input: InitializeInput): Promise<InitializeOutput> {
        return {};
    }

    async createSession(input: CreateSessionInput): Promise<CreateSessionOutput> {
        // Use the existing sandbox.ts `start` logic
        const session = await api.sandbox.start.mutate({ sandboxId: this.sandboxId });
        return {
            signedPreviewUrl: session.signedPreviewUrl,
        };
    }

    async setup(input: SetupInput): Promise<SetupOutput> {
        return {};
    }

    async reload(): Promise<boolean> {
        return true;
    }

    async reconnect(): Promise<void> {
        return;
    }

    async ping(): Promise<boolean> {
        return true;
    }

    async destroy(): Promise<void> {
        // Nothing to specifically destroy on frontend, TRPC connections are stateless
    }

    // -- File System --

    async readFile(input: ReadFileInput): Promise<ReadFileOutput> {
        const result = await api.daytona.fs.read.query({ 
            sandboxId: this.sandboxId, 
            path: input.args.path 
        });
        
        return { 
            file: { 
                content: (result.content as string) || '', 
                path: result.path, 
                name: result.path.split('/').pop() || '',
                type: 'text',
                toString: () => result.content?.toString() || '' 
            } as ReadFileOutputFile
        };
    }

    async writeFile(input: WriteFileInput): Promise<WriteFileOutput> {
        await api.daytona.fs.write.mutate({
            sandboxId: this.sandboxId,
            path: input.args.path,
            content: typeof input.args.content === 'string' 
                ? input.args.content 
                : new TextDecoder().decode(input.args.content),
        });
        return { success: true };
    }

    async listFiles(input: ListFilesInput): Promise<ListFilesOutput> {
        const files = await api.daytona.fs.ls.query({
            sandboxId: this.sandboxId,
            path: input.args.path,
        });
        return { 
            files: files.map((f: any) => ({
                name: f.name,
                type: f.type,
                isSymlink: false
            }))
        };
    }

    async renameFile(input: RenameFileInput): Promise<RenameFileOutput> {
        await api.daytona.fs.rename.mutate({
            sandboxId: this.sandboxId,
            oldPath: input.args.oldPath,
            newPath: input.args.newPath
        });
        return {};
    }

    async statFile(input: StatFileInput): Promise<StatFileOutput> {
        const stat = await api.daytona.fs.stat.query({
            sandboxId: this.sandboxId,
            path: input.args.path
        });
        return stat;
    }

    async deleteFiles(input: DeleteFilesInput): Promise<DeleteFilesOutput> {
        await api.daytona.fs.delete.mutate({
            sandboxId: this.sandboxId,
            path: input.args.path,
            recursive: input.args.recursive
        });
        return {};
    }

    async copyFiles(input: CopyFilesInput): Promise<CopyFileOutput> {
        await api.daytona.fs.copy.mutate({
            sandboxId: this.sandboxId,
            sourcePath: input.args.sourcePath,
            targetPath: input.args.targetPath,
            recursive: input.args.recursive,
            overwrite: input.args.overwrite
        });
        return {};
    }

    async createDirectory(input: CreateDirectoryInput): Promise<CreateDirectoryOutput> {
        await api.daytona.fs.mkdir.mutate({
            sandboxId: this.sandboxId,
            path: input.args.path
        });
        return {};
    }

    async downloadFiles(input: DownloadFilesInput): Promise<DownloadFilesOutput> {
        const url = await api.daytona.fs.download.query({
            sandboxId: this.sandboxId,
            path: input.args.path
        });
        return { url };
    }

    async watchFiles(input: WatchFilesInput): Promise<WatchFilesOutput> {
        // File-watcher via TRPC is mocked since we rely on explicit syncing via TRPC requests in CodeProviderSync
        class DummyWatcher extends ProviderFileWatcher {
            async start() {}
            async stop() {}
            registerEventCallback() {}
        }
        return { watcher: new DummyWatcher() };
    }

    // -- Execution & Git --

    async runCommand(input: TerminalCommandInput): Promise<TerminalCommandOutput> {
        const result = await api.daytona.sandbox.runCommand.mutate({
            sandboxId: this.sandboxId,
            command: input.args.command,
        });
        return {
            output: result.output,
            exitCode: result.exitCode
        };
    }

    async runBackgroundCommand(input: TerminalBackgroundCommandInput): Promise<TerminalBackgroundCommandOutput> {
        const command = new TRPCDaytonaBackgroundCommand(this.sandboxId, input.args.command);
        return { command };
    }

    async getTask(input: GetTaskInput): Promise<GetTaskOutput> {
        let task = this.activeTasks.get(input.args.id);
        if (!task) {
            task = new TRPCDaytonaTask(this.sandboxId, input.args.id);
            this.activeTasks.set(input.args.id, task);
        }
        return { task };
    }

    async createTerminal(input: CreateTerminalInput): Promise<CreateTerminalOutput> {
        return { terminal: new TRPCDaytonaTerminal(this.sandboxId) };
    }

    async gitStatus(input: GitStatusInput): Promise<GitStatusOutput> {
        const res = await this.runCommand({ args: { command: "git status -s" } });
        const changedFiles = res.output
            .split('\n')
            .filter((l) => l.trim().length > 0)
            .map((l) => l.substring(3).trim());

        return { changedFiles };
    }

    // -- Project Management Exceptions --
    
    async pauseProject(input: PauseProjectInput): Promise<PauseProjectOutput> {
        throw new Error('Daytona TRPC frontend: pauseProject not supported.');
    }
    async stopProject(input: StopProjectInput): Promise<StopProjectOutput> {
        throw new Error('Daytona TRPC frontend: stopProject not supported. Call TRPC route manually.');
    }
    async listProjects(input: ListProjectsInput): Promise<ListProjectsOutput> {
        throw new Error('Daytona TRPC frontend: listProjects not supported. Call TRPC route manually.');
    }
}

// ----- Proxy Implementations for Terminals and Commands -----

export class TRPCDaytonaTerminal extends ProviderTerminal {
    private sandboxId: string;
    private termId = `trpc-pty-${Math.random().toString(36).substring(7)}`;

    constructor(sandboxId: string) {
        super();
        this.sandboxId = sandboxId;
    }

    get id(): string { return this.termId; }
    get name(): string { return "Daytona PTY"; }

    async open(dimensions?: ProviderTerminalShellSize): Promise<string> {
        // Using existing Daytona PTY hooks
        const { sessionId } = await api.daytona.sandbox.createPty.mutate({
            sandboxId: this.sandboxId,
            cols: dimensions?.cols,
            rows: dimensions?.rows
        });
        this.termId = sessionId;
        return this.termId;
    }

    async write(input: string, dimensions?: ProviderTerminalShellSize): Promise<void> {
        await api.daytona.sandbox.writePty.mutate({
            sessionId: this.termId,
            input
        });
    }

    async run(input: string, dimensions?: ProviderTerminalShellSize): Promise<void> {
        await this.open(dimensions);
        await this.write(input + '\n', dimensions);
    }

    async kill(): Promise<void> {
        await api.daytona.sandbox.closePty.mutate({ sessionId: this.termId });
    }

    onOutput(callback: (data: string) => void): () => void {
        const interval = setInterval(async () => {
            try {
                const res = await api.daytona.sandbox.pollPty.query({ sessionId: this.termId });
                if (res.data) {
                    callback(res.data);
                }
            } catch (e) {
                // Ignore poll errors
            }
        }, 100);
        return () => clearInterval(interval);
    }
}

export class TRPCDaytonaTask extends ProviderTask {
    private sandboxId: string;
    private taskId: string;

    constructor(sandboxId: string, taskId: string) {
        super();
        this.sandboxId = sandboxId;
        this.taskId = taskId;
    }

    get id(): string { return this.taskId; }
    get name(): string { return this.taskId; }
    get command(): string { return "npm run dev"; }

    async open(dimensions?: ProviderTerminalShellSize): Promise<string> {
        return this.id;
    }

    async run(): Promise<void> {
        await api.daytona.sandbox.runCommand.mutate({
            sandboxId: this.sandboxId,
            command: this.command,
        });
    }

    async restart(): Promise<void> {
        await this.run();
    }

    async stop(): Promise<void> {}

    onOutput(callback: (data: string) => void): () => void {
        return () => {};
    }
}

export class TRPCDaytonaBackgroundCommand extends ProviderBackgroundCommand {
    private sandboxId: string;
    private cmd: string;

    constructor(sandboxId: string, cmd: string) {
        super();
        this.sandboxId = sandboxId;
        this.cmd = cmd;
    }

    get name(): string | undefined { return "daytona-bg"; }
    get command(): string { return this.cmd; }

    async open(): Promise<string> {
        return "bg-1";
    }

    async restart(): Promise<void> {
        await api.daytona.sandbox.runCommand.mutate({
            sandboxId: this.sandboxId,
            command: this.cmd,
        });
    }

    async kill(): Promise<void> {}

    async write(input: string): Promise<void> {}

    onOutput(callback: (data: string) => void): () => void {
        return () => {};
    }
}
