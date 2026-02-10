import type {
    ListFilesOutputFile,
    StatFileOutput,
    ProviderFileWatcher,
    WatchFilesInput
} from '../types';

export interface ISandboxAdapter {
    readFile(path: string): Promise<string>;
    writeFile(path: string, content: string | Uint8Array): Promise<void>;
    runCommand(command: string): Promise<{ output: string }>;
    getGitStatus(): Promise<string[]>;
    downloadFiles(path: string): Promise<{ url?: string }>;
    createDirectory(path: string): Promise<void>;
    deleteFiles(path: string): Promise<void>;
    listFiles(path: string): Promise<ListFilesOutputFile[]>;
    renameFile(oldPath: string, newPath: string): Promise<void>;
    statFile(path: string): Promise<StatFileOutput>;
    watchFiles(input: WatchFilesInput): Promise<{ watcher: ProviderFileWatcher }>;
    // TODO: Add refined terminal interface later
}
