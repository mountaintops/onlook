import type { ISandboxAdapter } from '../interfaces/ISandboxAdapter';
import type { Provider } from '../types';

export class LegacySandboxAdapter implements ISandboxAdapter {
    constructor(private provider: Provider) { }

    async readFile(path: string): Promise<string> {
        const result = await this.provider.readFile({ args: { path } });
        return result.file.toString();
    }

    async writeFile(path: string, content: string | Uint8Array): Promise<void> {
        await this.provider.writeFile({ args: { path, content } });
    }

    async runCommand(command: string): Promise<{ output: string }> {
        const result = await this.provider.runCommand({ args: { command } });
        return { output: result.output };
    }

    async getGitStatus(): Promise<string[]> {
        const result = await this.provider.gitStatus({});
        return result.changedFiles;
    }

    async downloadFiles(path: string): Promise<{ url?: string }> {
        return this.provider.downloadFiles({ args: { path } });
    }

    async createDirectory(path: string): Promise<void> {
        await this.provider.createDirectory({ args: { path } });
    }

    async deleteFiles(path: string): Promise<void> {
        await this.provider.deleteFiles({ args: { path, recursive: true } });
    }

    async listFiles(path: string): Promise<import('../types').ListFilesOutputFile[]> {
        const result = await this.provider.listFiles({ args: { path } });
        return result.files;
    }

    async renameFile(oldPath: string, newPath: string): Promise<void> {
        await this.provider.renameFile({ args: { oldPath, newPath } });
    }

    async statFile(path: string): Promise<import('../types').StatFileOutput> {
        return this.provider.statFile({ args: { path } });
    }

    async watchFiles(input: import('../types').WatchFilesInput): Promise<{ watcher: import('../types').ProviderFileWatcher }> {
        return this.provider.watchFiles(input);
    }
}
