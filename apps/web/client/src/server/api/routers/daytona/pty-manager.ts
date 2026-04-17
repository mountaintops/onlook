import { type ProviderTerminalShellSize } from '@onlook/code-provider';

/**
 * PtyManager manages active terminal sessions for Daytona sandboxes.
 * Using a global variable ensures that terminal connections persist
 * across Next.js HMR/hot-reloads during development.
 */
class PtyManager {
    private static get sessions() {
        const g = global as any;
        if (!g.__daytona_pty_sessions) {
            g.__daytona_pty_sessions = new Map<string, {
                terminal: any;
                buffer: string[];
                lastPoll: number;
            }>();
        }
        return g.__daytona_pty_sessions as Map<string, {
            terminal: any;
            buffer: string[];
            lastPoll: number;
        }>;
    }

    static async create(sandboxId: string, provider: any, dimensions?: ProviderTerminalShellSize) {
        console.log(`[PtyManager] Creating session for sandbox ${sandboxId}...`);
        const { terminal } = await provider.createTerminal({});
        
        // Use the Daytona sessionId if available after opening, 
        // but we need a unique handle for our manager.
        const handleId = Math.random().toString(36).substring(2, 10);
        
        const session = {
            terminal,
            buffer: [] as string[],
            lastPoll: Date.now()
        };

        terminal.onOutput((data: string) => {
            session.buffer.push(data);
            if (session.buffer.length > 2000) {
                session.buffer.shift();
            }
        });

        await terminal.open(dimensions);
        this.sessions.set(handleId, session);
        return handleId;
    }

    static get(handleId: string) {
        return this.sessions.get(handleId);
    }

    static poll(handleId: string) {
        const session = this.sessions.get(handleId);
        if (!session) return null;
        
        const data = session.buffer.join('');
        session.buffer = [];
        session.lastPoll = Date.now();
        return data;
    }

    static async write(handleId: string, input: string, dimensions?: ProviderTerminalShellSize) {
        const session = this.sessions.get(handleId);
        if (!session) throw new Error('Terminal session not found or expired');
        await session.terminal.write(input, dimensions);
    }

    static async resize(handleId: string, cols: number, rows: number) {
        const session = this.sessions.get(handleId);
        if (!session) throw new Error('Terminal session not found or expired');
        // We use write with dimensions since that's how we implemented it in DaytonaTerminal
        await session.terminal.write('', { cols, rows });
    }

    static async close(handleId: string) {
        const session = this.sessions.get(handleId);
        if (session) {
            console.log(`[PtyManager] Closing session ${handleId}`);
            try {
                await session.terminal.kill();
            } catch (e) {
                console.warn('[PtyManager] Error killing terminal:', e);
            }
            this.sessions.delete(handleId);
        }
    }

    /**
     * Optional: Cleanup stale sessions (e.g., no poll for 5 minutes)
     */
    static cleanupStale() {
        const now = Date.now();
        for (const [id, session] of this.sessions.entries()) {
            if (now - session.lastPoll > 300_000) { // 5 mins
                void this.close(id);
            }
        }
    }
}

// Simple periodic cleanup
if (typeof setInterval !== 'undefined') {
    setInterval(() => PtyManager.cleanupStale(), 60_000);
}

export const ptyManager = PtyManager;
