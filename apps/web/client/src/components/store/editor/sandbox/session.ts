import { api } from '@/trpc/client';
import {
    CodeProvider,
    createCodeProviderClient,
    type ISandboxAdapter,
    LegacySandboxAdapter,
    SandpackAdapter,
    type SandpackAdapterCallbacks,
    PseudoTerminal,
    type Provider,
} from '@onlook/code-provider';
import type { Branch } from '@onlook/models';
import { makeAutoObservable } from 'mobx';
import type { ErrorManager } from '../error';
import { CLISessionImpl, CLISessionType, type CLISession, type TerminalSession } from './terminal';

export class SessionManager {
    provider: Provider | null = null;
    adapter: ISandboxAdapter | null = null;
    isConnecting = false;
    terminalSessions = new Map<string, CLISession>();
    activeTerminalSessionId = 'cli';

    constructor(
        private readonly branch: Branch,
        private readonly errorManager: ErrorManager
    ) {
        makeAutoObservable(this);
    }

    async start(sandboxId: string, userId?: string): Promise<void> {
        const MAX_RETRIES = 3;
        const RETRY_DELAY_MS = 2000;

        if (this.isConnecting || this.provider) {
            return;
        }

        this.isConnecting = true;

        const attemptConnection = async () => {
            const provider = await createCodeProviderClient(CodeProvider.CodeSandbox, {
                providerOptions: {
                    codesandbox: {
                        sandboxId,
                        userId,
                        initClient: true,
                        getSession: async (sandboxId, userId) => {
                            return api.sandbox.start.mutate({ sandboxId });
                        },
                    },
                },
            });

            this.provider = provider;
            this.adapter = new LegacySandboxAdapter(provider);
            await this.createTerminalSessions(provider);
        };

        let lastError: Error | null = null;

        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            try {
                await attemptConnection();
                this.isConnecting = false;
                return;
            } catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));
                console.error(`Failed to start sandbox session (attempt ${attempt + 1}/${MAX_RETRIES + 1}):`, error);

                this.provider = null;

                if (attempt < MAX_RETRIES) {
                    console.log(`Retrying sandbox connection in ${RETRY_DELAY_MS}ms...`);
                    await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
                }
            }
        }

        this.isConnecting = false;
        throw lastError;
    }

    /**
     * Start a Sandpack-mode session that uses in-memory file map polyfills
     * instead of connecting to a CodeSandbox VM.
     */
    async startSandpackSession(callbacks: SandpackAdapterCallbacks): Promise<void> {
        if (this.adapter) return; // already initialized

        this.isConnecting = true;

        // No VM provider — everything is browser-based
        this.provider = null;
        this.adapter = new SandpackAdapter(callbacks);

        // Create a pseudo-terminal for the terminal UI
        const pseudoTerminal = new PseudoTerminal(
            'sandpack-terminal',
            'Browser Terminal',
            callbacks.getFiles,
        );

        // Store the pseudo-terminal reference for console log forwarding
        (this as any)._pseudoTerminal = pseudoTerminal;

        this.isConnecting = false;
    }

    async restartDevServer(): Promise<boolean> {
        if (!this.provider) {
            // In Sandpack mode there's no VM dev server to restart.
            // Sandpack manages its own bundler internally.
            return false;
        }
        const { task } = await this.provider.getTask({
            args: {
                id: 'dev',
            },
        });
        if (task) {
            await task.restart();
            return true;
        }
        return false;
    }

    async readDevServerLogs(): Promise<string> {
        const result = await this.provider?.getTask({ args: { id: 'dev' } });
        if (result) {
            return await result.task.open();
        }
        return 'Dev server not found';
    }

    getTerminalSession(id: string) {
        return this.terminalSessions.get(id) as TerminalSession | undefined;
    }

    async createTerminalSessions(provider: Provider) {
        const task = new CLISessionImpl(
            'server',
            CLISessionType.TASK,
            provider,
            this.errorManager,
        );
        this.terminalSessions.set(task.id, task);
        const terminal = new CLISessionImpl(
            'terminal',
            CLISessionType.TERMINAL,
            provider,
            this.errorManager,
        );

        this.terminalSessions.set(terminal.id, terminal);
        this.activeTerminalSessionId = task.id;

        // Initialize the sessions after creation
        try {
            await Promise.all([
                task.initTask(),
                terminal.initTerminal()
            ]);
        } catch (error) {
            console.error('Failed to initialize terminal sessions:', error);
        }
    }

    async disposeTerminal(id: string) {
        const terminal = this.terminalSessions.get(id) as TerminalSession | undefined;
        if (terminal) {
            if (terminal.type === CLISessionType.TERMINAL) {
                await terminal.terminal?.kill();
                if (terminal.xterm) {
                    terminal.xterm.dispose();
                }
            }
            this.terminalSessions.delete(id);
        }
    }

    async hibernate(sandboxId: string) {
        await api.sandbox.hibernate.mutate({ sandboxId });
    }

    async reconnect(sandboxId: string, userId?: string) {
        try {
            if (!this.provider) {
                // In Sandpack (browser) mode there is no VM provider to reconnect.
                // This is a no-op — the browser sandbox is always "connected".
                return;
            }

            // Check if the session is still connected
            const isConnected = await this.ping();
            if (isConnected) {
                return;
            }

            // Attempt soft reconnect
            await this.provider?.reconnect();

            const isConnected2 = await this.ping();
            if (isConnected2) {
                return;
            }
            await this.restartProvider(sandboxId, userId);
        } catch (error) {
            console.error('Failed to reconnect to sandbox', error);
            this.isConnecting = false;
        }
    }

    async restartProvider(sandboxId: string, userId?: string) {
        if (!this.provider) {
            return;
        }
        await this.provider.destroy();
        this.provider = null;
        this.adapter = null;
        await this.start(sandboxId, userId);
    }

    async ping() {
        if (!this.provider) return false;
        try {
            await this.adapter?.runCommand('echo "ping"');
            return true;
        } catch (error) {
            console.error('Failed to connect to sandbox', error);
            return false;
        }
    }

    async runCommand(
        command: string,
        streamCallback?: (output: string) => void,
        ignoreError: boolean = false,
    ): Promise<{
        output: string;
        success: boolean;
        error: string | null;
    }> {
        try {
            if (!this.adapter) {
                throw new Error('No adapter found in runCommand');
            }

            // Append error suppression if ignoreError is true
            const finalCommand = ignoreError && this.provider ? `${command} 2>/dev/null || true` : command;

            streamCallback?.(finalCommand + '\n');
            const { output } = await this.adapter.runCommand(finalCommand);
            streamCallback?.(output);
            return {
                output,
                success: true,
                error: null,
            };
        } catch (error) {
            console.error('Error running command:', error);
            return {
                output: '',
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error occurred',
            };
        }
    }

    async clear() {
        // probably need to be moved in `Provider.destroy()`
        this.terminalSessions.forEach((terminal) => {
            if (terminal.type === CLISessionType.TERMINAL) {
                terminal.terminal?.kill();
                if (terminal.xterm) {
                    terminal.xterm.dispose();
                }
            }
        });
        if (this.provider) {
            await this.provider.destroy();
        }
        this.provider = null;
        this.adapter = null;
        this.isConnecting = false;
        this.terminalSessions.clear();
    }
}
