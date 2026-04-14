import { api } from '@/trpc/client';
import { CodeProvider, createCodeProviderClient, type Provider } from '@onlook/code-provider';
import type { Branch } from '@onlook/models';
import { makeAutoObservable } from 'mobx';
import type { ErrorManager } from '../error';
import { CLISessionImpl, CLISessionType, type CLISession, type TerminalSession } from './terminal';

export class SessionManager {
    provider: Provider | null = null;
    isConnecting = false;
    isReconnecting = false;
    terminalSessions = new Map<string, CLISession>();
    activeTerminalSessionId = 'cli';
    signedPreviewUrl: string | null = null;

    constructor(
        private readonly branch: Branch,
        private readonly errorManager: ErrorManager
    ) {
        makeAutoObservable(this);
    }

    async waitForProvider(): Promise<Provider> {
        if (this.provider) {
            return this.provider;
        }

        if (!this.isConnecting) {
            console.warn('[SessionManager] No provider found and not connecting, this may indicate a connection issue');
            throw new Error('No provider found and not connecting. The sandbox may need to be reconnected.');
        }

        // Wait for provider to be set
        return new Promise((resolve, reject) => {
            const checkProvider = setInterval(() => {
                if (this.provider) {
                    clearInterval(checkProvider);
                    resolve(this.provider);
                } else if (!this.isConnecting) {
                    clearInterval(checkProvider);
                    reject(new Error('Failed to initialize provider'));
                }
            }, 100);

            // Timeout after 30 seconds
            setTimeout(() => {
                clearInterval(checkProvider);
                reject(new Error('Timeout waiting for provider'));
            }, 30000);
        });
    }

    /**
     * Detect which sandbox provider to use based on the sandbox ID format.
     * Daytona sandboxes use UUID v4 format (e.g. 550e8400-e29b-41d4-a716-446655440000).
     * CodeSandbox uses short alphanumeric IDs (e.g. r8pqs3).
     */
    private detectProvider(sandboxId: string): CodeProvider {
        const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        return UUID_REGEX.test(sandboxId) ? CodeProvider.Daytona : CodeProvider.CodeSandbox;
    }

    async start(sandboxId: string, userId?: string): Promise<void> {
        const MAX_RETRIES = 3;
        const RETRY_DELAY_MS = 2000;
        const CONNECTION_TIMEOUT_MS = 60000; // 60 second timeout for total connection attempt

        if (this.isConnecting || this.provider) {
            return;
        }

        this.isConnecting = true;

        // Set a timeout to reset isConnecting if connection takes too long
        const connectionTimeout = setTimeout(() => {
            if (this.isConnecting) {
                console.error('[SessionManager] Connection timeout, resetting isConnecting flag');
                this.isConnecting = false;
            }
        }, CONNECTION_TIMEOUT_MS);

        const detectedProvider = this.detectProvider(sandboxId);
        console.log(`[SessionManager] Detected provider: ${detectedProvider} for sandbox ${sandboxId}`);

        const attemptConnection = async () => {
            if (detectedProvider === CodeProvider.Daytona) {
                // ── Daytona provider ─────────────────────────────────────────
                const sid = sandboxId;

                // Fetch preview URL upfront for the iframe
                let previewUrl: string | undefined;
                let previewToken: string | undefined;
                try {
                    const previewInfo = await api.daytona.getPreviewUrl.query({ sandboxId: sid, port: 3000 });
                    previewUrl = previewInfo.url ?? undefined;
                    previewToken = previewInfo.token ?? undefined;
                    if (previewUrl) this.signedPreviewUrl = previewUrl;
                } catch (e) {
                    console.warn('[SessionManager] Could not fetch Daytona preview URL:', e);
                }

                const provider = await createCodeProviderClient(CodeProvider.Daytona, {
                    providerOptions: {
                        daytona: {
                            sandboxId: sid,
                            previewUrl,
                            previewToken,
                                proxy: {
                                fs: {
                                    readFile: async (path) => {
                                        try {
                                            const r = await api.daytona.fsReadFile.mutate({ sandboxId: sid, path });
                                            return { content: r.content, type: r.type };
                                        } catch (error) {
                                            console.warn('[SessionManager] Read file failed, returning empty:', error);
                                            return { content: '', type: 'text' };
                                        }
                                    },
                                    writeFile: async (path, content, overwrite) => {
                                        try {
                                            await api.daytona.fsWriteFile.mutate({ sandboxId: sid, path, content, overwrite: overwrite ?? true });
                                        } catch (error) {
                                            console.error('[SessionManager] Write file failed:', error);
                                            // Silently fail to prevent flooding
                                        }
                                    },
                                    statFile: async (path) => {
                                        try {
                                            const r = await api.daytona.fsStatFile.mutate({ sandboxId: sid, path });
                                            return { type: r.type };
                                        } catch (error) {
                                            console.warn('[SessionManager] Stat file failed, returning file type:', error);
                                            return { type: 'file' };
                                        }
                                    },
                                    listFiles: async (path) => {
                                        try {
                                            const r = await api.daytona.fsListFiles.mutate({ sandboxId: sid, path });
                                            return r.files;
                                        } catch (error) {
                                            console.warn('[SessionManager] List files failed, returning empty:', error);
                                            return [];
                                        }
                                    },
                                    deleteFiles: async (path, recursive) => {
                                        try {
                                            await api.daytona.fsDeleteFiles.mutate({ sandboxId: sid, path, recursive: recursive ?? false });
                                        } catch (error) {
                                            console.warn('[SessionManager] Delete files failed:', error);
                                            // Silently fail to prevent flooding
                                        }
                                    },
                                    renameFile: async (oldPath, newPath) => {
                                        try {
                                            await api.daytona.fsRenameFile.mutate({ sandboxId: sid, oldPath, newPath });
                                        } catch (error) {
                                            console.warn('[SessionManager] Rename file failed:', error);
                                            // Silently fail to prevent flooding
                                        }
                                    },
                                    copyFiles: async (sourcePath, targetPath, recursive, overwrite) => {
                                        try {
                                            await api.daytona.fsCopyFiles.mutate({ sandboxId: sid, sourcePath, targetPath, recursive: recursive ?? false, overwrite: overwrite ?? true });
                                        } catch (error) {
                                            console.warn('[SessionManager] Copy files failed:', error);
                                            // Silently fail to prevent flooding
                                        }
                                    },
                                    createDirectory: async (path) => {
                                        try {
                                            await api.daytona.fsCreateDirectory.mutate({ sandboxId: sid, path });
                                        } catch (error) {
                                            console.warn('[SessionManager] Create directory failed:', error);
                                            // Silently fail to prevent flooding
                                        }
                                    },
                                },
                                process: {
                                    executeCommand: async (command) => {
                                        try {
                                            const r = await api.daytona.processExecuteCommand.mutate({ sandboxId: sid, command });
                                            return { exitCode: r.exitCode, output: r.output };
                                        } catch (error) {
                                            console.warn('[SessionManager] Command execution failed, returning error:', error);
                                            return { exitCode: 1, output: 'Command execution failed' };
                                        }
                                    },
                                    startBackground: async (command) => {
                                        try {
                                            const r = await api.daytona.processStartBackground.mutate({ sandboxId: sid, command });
                                            return r.execId;
                                        } catch (error) {
                                            console.warn('[SessionManager] Start background failed:', error);
                                            return 'error-exec-id';
                                        }
                                    },
                                    stopBackground: async (execId) => {
                                        try {
                                            await api.daytona.processStopBackground.mutate({ sandboxId: sid, execId });
                                        } catch (error) {
                                            console.warn('[SessionManager] Stop background failed:', error);
                                            // Silently fail to prevent flooding
                                        }
                                    },
                                    pollOutput: async (execId) => {
                                        try {
                                            const r = await api.daytona.processGetBackgroundOutput.query({ sandboxId: sid, execId });
                                            return r.output;
                                        } catch (error) {
                                            console.warn('[SessionManager] Poll output failed, returning empty:', error);
                                            return '';
                                        }
                                    },
                                    getPtyWsUrl: async (terminalId) => {
                                        try {
                                            const r = await api.daytona.processGetPtyWsUrl.mutate({ sandboxId: sid, terminalId });
                                            return { wsUrl: r.wsUrl ?? '', token: r.token ?? undefined };
                                        } catch (error) {
                                            console.warn('[SessionManager] Get PTY URL failed, returning empty:', error);
                                            return { wsUrl: '', token: undefined };
                                        }
                                    },
                                },
                                session: {
                                    createProject: async () => {
                                        try {
                                            const r = await api.daytona.bootstrapNextjsProject.mutate({});
                                            return { sandboxId: r.sandboxId };
                                        } catch (error) {
                                            console.error('[SessionManager] Create project failed:', error);
                                            throw error; // This should throw as it's a critical operation
                                        }
                                    },
                                    startSandbox: async (sandboxId) => {
                                        try {
                                            await api.daytona.startSandbox.mutate({ sandboxId });
                                            const preview = await api.daytona.getPreviewUrl.query({ sandboxId, port: 3000 });
                                            return { previewUrl: preview.url ?? undefined, token: preview.token ?? undefined };
                                        } catch (error) {
                                            console.error('[SessionManager] Start sandbox failed:', error);
                                            throw error; // This should throw as it's a critical operation
                                        }
                                    },
                                    stopSandbox: async (sandboxId) => {
                                        try {
                                            await api.daytona.stopSandbox.mutate({ sandboxId });
                                        } catch (error) {
                                            console.warn('[SessionManager] Stop sandbox failed:', error);
                                            // Silently fail to prevent flooding
                                        }
                                    },
                                    gitStatus: async () => {
                                        try {
                                            const r = await api.daytona.processExecuteCommand.mutate({
                                                sandboxId: sid,
                                                command: 'cd /tmp/nextapp && git status --porcelain 2>/dev/null || true',
                                            });
                                            const lines = r.output.trim().split('\n').filter(Boolean);
                                            return { changedFiles: lines.map((l: string) => l.slice(3)) };
                                        } catch (error) {
                                            console.warn('[SessionManager] Git status check failed, returning empty:', error);
                                            return { changedFiles: [] };
                                        }
                                    },
                                },
                            },
                        },
                    },
                });

                this.provider = provider;
                await this.createTerminalSessions(provider);
            } else {
                // ── CodeSandbox provider (original) ───────────────────────────
                const provider = await createCodeProviderClient(CodeProvider.CodeSandbox, {
                    providerOptions: {
                        codesandbox: {
                            sandboxId,
                            userId,
                            initClient: true,
                            keepActiveWhileConnected: false,
                            getSession: async (sandboxId, userId) => {
                                const session = await api.sandbox.start.mutate({ sandboxId });
                                if (session.signedPreviewUrl) {
                                    this.signedPreviewUrl = session.signedPreviewUrl;
                                }
                                return session;
                            },
                        },
                    },
                });

                this.provider = provider;
                await this.createTerminalSessions(provider);
            }
        };

        let lastError: Error | null = null;

        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            try {
                await attemptConnection();
                clearTimeout(connectionTimeout);
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

        clearTimeout(connectionTimeout);
        this.isConnecting = false;
        throw lastError;
    }

    async restartDevServer(): Promise<boolean> {
        const provider = await this.waitForProvider();
        const { task } = await provider.getTask({
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
        const provider = await this.waitForProvider();
        const result = await provider.getTask({ args: { id: 'dev' } });
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

    async reconnect(sandboxId: string, userId?: string): Promise<boolean> {
        // Prevent concurrent reconnect attempts
        if (this.isConnecting || this.isReconnecting) {
            console.log('[SessionManager] Already connecting or reconnecting, skipping reconnect');
            return false;
        }

        this.isReconnecting = true;
        try {
            if (!this.provider) {
                console.log('[SessionManager] No provider found in reconnect, attempting to start new connection');
                await this.start(sandboxId, userId);
                
                // Wait a bit for the provider to be set
                await new Promise(resolve => setTimeout(resolve, 1000));
                
                if (this.provider) {
                    console.log('[SessionManager] Successfully reconnected to sandbox');
                    return true;
                } else {
                    console.error('[SessionManager] Failed to establish provider after start');
                    return false;
                }
            }

            // Check if the session is still connected
            const isConnected = await this.ping();
            if (isConnected) {
                console.log('[SessionManager] Provider is already connected');
                return true;
            }

            console.log('[SessionManager] Provider exists but not connected, attempting soft reconnect');
            // Attempt soft reconnect
            await this.provider?.reconnect();

            const isConnected2 = await this.ping();
            if (isConnected2) {
                console.log('[SessionManager] Successfully reconnected via soft reconnect');
                return true;
            }

            console.log('[SessionManager] Soft reconnect failed, attempting full restart');
            await this.restartProvider(sandboxId, userId);
            
            // Wait for restart to complete
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            if (this.provider) {
                console.log('[SessionManager] Successfully reconnected via full restart');
                return true;
            }
            
            return false;
        } catch (error) {
            console.error('[SessionManager] Failed to reconnect to sandbox:', error);
            this.isConnecting = false;
            return false;
        } finally {
            this.isReconnecting = false;
        }
    }

    async restartProvider(sandboxId: string, userId?: string) {
        if (!this.provider) {
            return;
        }
        await this.provider.destroy();
        this.provider = null;
        await this.start(sandboxId, userId);
    }

    async ping() {
        try {
            const provider = await this.waitForProvider();
            await provider.runCommand({ args: { command: 'echo "ping"' } });
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
        retryCount = 0,
    ): Promise<{
        output: string;
        success: boolean;
        error: string | null;
    }> {
        try {
            const provider = await this.waitForProvider();

            // Append error suppression if ignoreError is true
            const finalCommand = ignoreError ? `${command} 2>/dev/null || true` : command;

            streamCallback?.(finalCommand + '\n');
            const { output } = await provider.runCommand({ args: { command: finalCommand } });
            

            streamCallback?.(output);
            return {
                output,
                success: true,
                error: null,
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);

            // Handle "Shell does not exist" error by attempting to reconnect
            if (errorMessage.includes('Shell with id') && errorMessage.includes('does not exist') && retryCount < 1) {
                console.warn(`[SessionManager] Shell expired, attempting to reconnect... (retry ${retryCount + 1})`);

                try {
                    // Attempt to reconnect/restart provider to get a fresh shell
                    await this.reconnect(this.branch.sandbox.id);

                    // Retry the command once with fresh session
                    return this.runCommand(command, streamCallback, ignoreError, retryCount + 1);
                } catch (reconnectError) {
                    console.error('[SessionManager] Failed to reconnect after shell expiry:', reconnectError);
                }
            }


            console.error('Error running command:', error);
            return {
                output: '',
                success: false,
                error: errorMessage,
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
        this.isConnecting = false;
        this.isReconnecting = false;
        this.terminalSessions.clear();
    }
}
