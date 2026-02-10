import type { ISandboxAdapter } from '../interfaces/ISandboxAdapter';

export class SandpackAdapter implements ISandboxAdapter {
    async readFile(path: string): Promise<string> {
        console.warn('SandpackAdapter.readFile not implemented');
        return '';
    }

    async writeFile(path: string, content: string | Uint8Array): Promise<void> {
        // No-op for now as state is managed by SandboxManager.files
    }

    async runCommand(command: string): Promise<{ output: string }> {
        console.log(`[Sandpack] Mock executing: ${command}`);
        return { output: '' };
    }

    async getGitStatus(): Promise<string[]> {
        return [];
    }

    async downloadFiles(path: string): Promise<{ url?: string }> {
        return {};
    }

    async createDirectory(path: string): Promise<void> {
        // No-op
    }

    async deleteFiles(path: string): Promise<void> {
        // No-op
    }

    async listFiles(path: string): Promise<import('../types').ListFilesOutputFile[]> {
        return [];
    }

    async renameFile(oldPath: string, newPath: string): Promise<void> {
        // No-op
    }

    async statFile(path: string): Promise<import('../types').StatFileOutput> {
        return { type: 'file' }; // Dummy return
    }

    async watchFiles(input: import('../types').WatchFilesInput): Promise<{ watcher: import('../types').ProviderFileWatcher }> {
        return {
            watcher: {
                start: async () => { },
                stop: async () => { },
                registerEventCallback: (callback) => { }
            }
        };
    }
}
