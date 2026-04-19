'use client';

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
} from '@onlook/code-provider/client';

import { api } from '@/trpc/client';

type TrpcClient = typeof api;

function shellQuote(path: string): string {
    return `'${path.replace(/'/g, `'\\''`)}'`;
}

class DaytonaTrpcNoopBackgroundCommand extends ProviderBackgroundCommand {
    get name(): string | undefined {
        return undefined;
    }
    get command(): string {
        return '';
    }
    async open(): Promise<string> {
        return '';
    }
    async restart(): Promise<void> {}
    async kill(): Promise<void> {}
    async write(): Promise<void> {}
    onOutput(_callback: (data: string) => void): () => void {
        return () => {};
    }
}

class DaytonaTrpcDevTask extends ProviderTask {
    constructor(
        private readonly trpc: TrpcClient,
        private readonly sandboxId: string,
        private readonly workdir: string,
        private readonly port: number,
    ) {
        super();
    }

    get id(): string {
        return 'dev';
    }
    get name(): string {
        return 'dev';
    }
    get command(): string {
        return 'bun run dev';
    }

    async open(): Promise<string> {
        const { output } = await this.trpc.daytona.sandbox.executeCommand.mutate({
            sandboxId: this.sandboxId,
            command: `tail -n 200 /tmp/dev.log 2>/dev/null || echo "(no dev server log yet — start the dev server from the project)"`,
        });
        return output;
    }

    async run(): Promise<void> {}

    async restart(): Promise<void> {
        await this.trpc.daytona.setup.startDevServer.mutate({
            sandboxId: this.sandboxId,
            workdir: this.workdir,
            port: this.port,
        });
    }

    async stop(): Promise<void> {}

    onOutput(callback: (data: string) => void): () => void {
        const interval = setInterval(() => {
            void this.trpc.daytona.sandbox
                .executeCommand.mutate({
                    sandboxId: this.sandboxId,
                    command: `tail -n 120 /tmp/dev.log 2>/dev/null || true`,
                })
                .then((r) => {
                    if (r.output) callback(r.output);
                })
                .catch(() => {});
        }, 3000);
        return () => clearInterval(interval);
    }
}


class DaytonaGitPollingWatcher extends ProviderFileWatcher {
    private timer: ReturnType<typeof setInterval> | null = null;
    private prev = new Map<string, string>();
    private callbacks: Array<(event: WatchEvent) => Promise<void>> = [];

    constructor(
        private readonly trpc: TrpcClient,
        private readonly sandboxId: string,
    ) {
        super();
    }

    registerEventCallback(callback: (event: WatchEvent) => Promise<void>): void {
        this.callbacks.push(callback);
    }

    async start(input: WatchFilesInput): Promise<void> {
        if (input.onFileChange) {
            this.callbacks.push(input.onFileChange);
        }

        const tick = async () => {
            try {
                const { output } = await this.trpc.daytona.sandbox.executeCommand.mutate({
                    sandboxId: this.sandboxId,
                    command: 'git status --porcelain -u 2>/dev/null || true',
                });
                const next = new Map<string, string>();
                for (const line of output.split('\n')) {
                    if (!line.trim()) continue;
                    const status = line.slice(0, 2);
                    const path = line.slice(3).trim();
                    if (!path) continue;
                    next.set(path, status);
                }

                const allPaths = new Set([...this.prev.keys(), ...next.keys()]);
                for (const p of allPaths) {
                    const before = this.prev.get(p);
                    const after = next.get(p);
                    if (before === after) continue;

                    let type: WatchEvent['type'] = 'change';
                    if (!before && after) type = 'add';
                    else if (before && !after) type = 'remove';

                    const events: WatchEvent = { type, paths: [p] };
                    for (const cb of this.callbacks) {
                        await cb(events);
                    }
                }
                this.prev = next;
            } catch {
                // ignore transient git failures
            }
        };

        await tick();
        this.timer = setInterval(() => void tick(), 3500);
    }

    async stop(): Promise<void> {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
        this.prev.clear();
        this.callbacks = [];
    }
}

export interface DaytonaTrpcProviderOptions {
    sandboxId: string;
    /** Preview port (frame URL / dev server). */
    previewPort?: number;
    /** Working directory used by `daytona.setup.startDevServer` (must match VM layout). */
    workdir?: string;
    trpc: TrpcClient;
}

/**
 * Browser-only code provider: every VM operation goes through tRPC so the Daytona SDK
 * stays on the server (see `daytona-test` and `server/api/routers/daytona/*`).
 */
export class DaytonaTrpcProvider extends Provider {

    constructor(private readonly options: DaytonaTrpcProviderOptions) {
        super();
    }

    private get trpc(): TrpcClient {
        return this.options.trpc;
    }

    private get sandboxId(): string {
        return this.options.sandboxId;
    }

    private previewPort(): number {
        return this.options.previewPort ?? 3000;
    }

    private workdir(): string {
        return this.options.workdir ?? '/home/daytona/onlook-starter';
    }

    async initialize(_input: InitializeInput): Promise<InitializeOutput> {
        await this.trpc.daytona.sandbox.start.mutate({ sandboxId: this.sandboxId }).catch(async () => {
            await this.trpc.daytona.sandbox.recover.mutate({ sandboxId: this.sandboxId }).catch(() => {});
            await this.trpc.daytona.sandbox.start.mutate({ sandboxId: this.sandboxId }).catch(() => {});
        });

        // Readiness check: wait for the gRPC/filesystem to be responsive
        let ready = false;
        let attempts = 0;
        const maxAttempts = 5;
        while (!ready && attempts < maxAttempts) {
            try {
                // Simple ls check to see if the sandbox is responsive
                await this.listFiles({ args: { path: '.' } });
                ready = true;
            } catch (e) {
                attempts++;
                if (attempts < maxAttempts) {
                    console.log(`[DaytonaTrpcProvider] Sandbox not ready yet, retrying... (${attempts}/${maxAttempts})`);
                    await new Promise(resolve => setTimeout(resolve, 1500));
                }
            }
        }
        return {};
    }

    async createSession(_input: CreateSessionInput): Promise<CreateSessionOutput> {
        return {};
    }

    async setup(_input: SetupInput): Promise<SetupOutput> {
        return {};
    }

    async reload(): Promise<boolean> {
        try {
            await this.trpc.daytona.setup.startDevServer.mutate({
                sandboxId: this.sandboxId,
                workdir: this.workdir(),
                port: this.previewPort(),
            });
            return true;
        } catch {
            return false;
        }
    }

    async reconnect(): Promise<void> {
        await this.initialize({});
    }

    async ping(): Promise<boolean> {
        try {
            await this.trpc.daytona.sandbox.executeCommand.mutate({
                sandboxId: this.sandboxId,
                command: 'echo ping',
            });
            return true;
        } catch {
            return false;
        }
    }

    async destroy(): Promise<void> {
    }

    async writeFile(input: WriteFileInput): Promise<WriteFileOutput> {
        const content =
            typeof input.args.content === 'string'
                ? input.args.content
                : new TextDecoder().decode(input.args.content);
        await this.trpc.daytona.fs.write.mutate({
            sandboxId: this.sandboxId,
            path: input.args.path,
            content,
        });
        return { success: true };
    }

    async renameFile(input: RenameFileInput): Promise<RenameFileOutput> {
        const oldP = shellQuote(input.args.oldPath);
        const newP = shellQuote(input.args.newPath);
        await this.trpc.daytona.sandbox.executeCommand.mutate({
            sandboxId: this.sandboxId,
            command: `mv ${oldP} ${newP}`,
        });
        return {};
    }

    async statFile(input: StatFileInput): Promise<StatFileOutput> {
        const p = shellQuote(input.args.path);
        const { output } = await this.trpc.daytona.sandbox.executeCommand.mutate({
            sandboxId: this.sandboxId,
            command: `if [ -d ${p} ]; then echo directory; elif [ -e ${p} ]; then echo file; else echo missing; fi`,
        });
        const t = output.trim();
        if (t === 'missing') {
            throw new Error(`File not found: ${input.args.path}`);
        }
        return { type: t === 'directory' ? 'directory' : 'file' };
    }

    async deleteFiles(input: DeleteFilesInput): Promise<DeleteFilesOutput> {
        const p = shellQuote(input.args.path);
        const flag = input.args.recursive ? '-rf' : '-f';
        await this.trpc.daytona.sandbox.executeCommand.mutate({
            sandboxId: this.sandboxId,
            command: `rm ${flag} ${p}`,
        });
        return {};
    }

    async listFiles(input: ListFilesInput): Promise<ListFilesOutput> {
        const files = await this.trpc.daytona.fs.ls.query({
            sandboxId: this.sandboxId,
            path: input.args.path,
        });
        return {
            files: files.map((f) => ({
                name: f.name,
                type: f.type,
                isSymlink: 'isSymlink' in f && typeof f.isSymlink === 'boolean' ? f.isSymlink : false,
            })),
        };
    }

    async readFile(input: ReadFileInput): Promise<ReadFileOutput> {
        const data = await this.trpc.daytona.fs.read.query({
            sandboxId: this.sandboxId,
            path: input.args.path,
        });
        const raw = data.content ?? '';
        const content =
            typeof raw === 'string' ? raw : new TextDecoder().decode(raw);
        return {
            file: {
                path: data.path ?? input.args.path,
                content,
                type: 'text',
                toString: () => content,
            },
        };
    }

    async downloadFiles(_input: DownloadFilesInput): Promise<DownloadFilesOutput> {
        return { url: '' };
    }

    async copyFiles(input: CopyFilesInput): Promise<CopyFileOutput> {
        const s = shellQuote(input.args.sourcePath);
        const t = shellQuote(input.args.targetPath);
        const r = input.args.recursive ? '-r' : '';
        await this.trpc.daytona.sandbox.executeCommand.mutate({
            sandboxId: this.sandboxId,
            command: `cp ${r} ${s} ${t}`,
        });
        return {};
    }

    async createDirectory(input: CreateDirectoryInput): Promise<CreateDirectoryOutput> {
        const p = shellQuote(input.args.path);
        await this.trpc.daytona.sandbox.executeCommand.mutate({
            sandboxId: this.sandboxId,
            command: `mkdir -p ${p}`,
        });
        return {};
    }

    async watchFiles(input: WatchFilesInput): Promise<WatchFilesOutput> {
        const watcher = new DaytonaGitPollingWatcher(this.trpc, this.sandboxId);
        await watcher.start(input);
        return { watcher };
    }

    async createTerminal(_input: CreateTerminalInput): Promise<CreateTerminalOutput> {
        throw new Error('PTY not supported in DaytonaTrpcProvider');
    }

    async getTask(input: GetTaskInput): Promise<GetTaskOutput> {
        if (input.args.id !== 'dev') {
            throw new Error(`Unknown task ${input.args.id}`);
        }
        return {
            task: new DaytonaTrpcDevTask(this.trpc, this.sandboxId, this.workdir(), this.previewPort()),
        };
    }

    async runCommand(input: TerminalCommandInput): Promise<TerminalCommandOutput> {
        const { output, exitCode } = await this.trpc.daytona.sandbox.executeCommand.mutate({
            sandboxId: this.sandboxId,
            command: input.args.command,
        });
        return { output, exitCode };
    }

    async runBackgroundCommand(
        input: TerminalBackgroundCommandInput,
    ): Promise<TerminalBackgroundCommandOutput> {
        await this.trpc.daytona.sandbox.executeCommand.mutate({
            sandboxId: this.sandboxId,
            command: `nohup sh -c ${shellQuote(input.args.command)} > /tmp/onlook-bg.log 2>&1 &`,
        });
        return { command: new DaytonaTrpcNoopBackgroundCommand() };
    }

    async gitStatus(_input: GitStatusInput): Promise<GitStatusOutput> {
        const { output } = await this.trpc.daytona.sandbox.executeCommand.mutate({
            sandboxId: this.sandboxId,
            command: 'git status --porcelain',
        });
        return {
            changedFiles: output
                ? output
                      .split('\n')
                      .filter(Boolean)
                      .map((l) => l.slice(3).trim())
                      .filter(Boolean)
                : [],
        };
    }

    async pauseProject(_input: PauseProjectInput): Promise<PauseProjectOutput> {
        await this.trpc.daytona.sandbox.stop.mutate({ sandboxId: this.sandboxId });
        return {};
    }

    async stopProject(_input: StopProjectInput): Promise<StopProjectOutput> {
        await this.trpc.daytona.sandbox.stop.mutate({ sandboxId: this.sandboxId });
        return {};
    }

    async listProjects(_input: ListProjectsInput): Promise<ListProjectsOutput> {
        const projects = await this.trpc.daytona.sandbox.list.query();
        return {
            projects: projects.map((p: any) => ({
                id: p.id,
                name: p.name ?? p.id,
                state: p.state ?? 'unknown',
                createdAt: p.createdAt ?? '',
                updatedAt: p.updatedAt ?? '',
            })),
        };
    }

    static async createProject(_input: CreateProjectInput): Promise<CreateProjectOutput> {
        throw new Error('createProject must be invoked via tRPC (daytona.sandbox.create) in the browser');
    }

    static async createProjectFromGit(_input: {
        repoUrl: string;
        branch: string;
    }): Promise<CreateProjectOutput> {
        throw new Error('createProjectFromGit must be invoked via tRPC in the browser');
    }
}
