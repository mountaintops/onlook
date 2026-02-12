import { ProviderFileWatcher, type WatchEvent, type WatchFilesInput } from '../types';

/**
 * A ProviderFileWatcher backed by in-memory file map snapshots.
 * Polls for changes by comparing the current files map against a previous snapshot.
 */
export class SandpackFileWatcher extends ProviderFileWatcher {
    private callbacks: Array<(event: WatchEvent) => Promise<void>> = [];
    private intervalId: ReturnType<typeof setInterval> | null = null;
    private previousSnapshot: Record<string, string> = {};
    private pollIntervalMs = 500;

    constructor(private getFiles: () => Record<string, string>) {
        super();
    }

    async start(input: WatchFilesInput): Promise<void> {
        // Take initial snapshot
        this.previousSnapshot = { ...this.getFiles() };

        this.intervalId = setInterval(() => {
            this.detectChanges();
        }, this.pollIntervalMs);
    }

    async stop(): Promise<void> {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
        this.callbacks = [];
    }

    registerEventCallback(callback: (event: WatchEvent) => Promise<void>): void {
        this.callbacks.push(callback);
    }

    private detectChanges(): void {
        const currentFiles = this.getFiles();
        const added: string[] = [];
        const changed: string[] = [];
        const removed: string[] = [];

        // Check for additions and changes
        for (const path of Object.keys(currentFiles)) {
            if (!(path in this.previousSnapshot)) {
                added.push(path);
            } else if (currentFiles[path] !== this.previousSnapshot[path]) {
                changed.push(path);
            }
        }

        // Check for removals
        for (const path of Object.keys(this.previousSnapshot)) {
            if (!(path in currentFiles)) {
                removed.push(path);
            }
        }

        // Emit events
        if (added.length > 0) {
            this.emit({ type: 'add', paths: added });
        }
        if (changed.length > 0) {
            this.emit({ type: 'change', paths: changed });
        }
        if (removed.length > 0) {
            this.emit({ type: 'remove', paths: removed });
        }

        // Update snapshot
        this.previousSnapshot = { ...currentFiles };
    }

    private emit(event: WatchEvent): void {
        for (const callback of this.callbacks) {
            callback(event).catch((err) =>
                console.error('[SandpackFileWatcher] Error in callback:', err),
            );
        }
    }
}
