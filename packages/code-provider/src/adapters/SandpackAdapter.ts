import type { ISandboxAdapter } from '../interfaces/ISandboxAdapter';
import type {
    ListFilesOutputFile,
    StatFileOutput,
    WatchFilesInput,
    ProviderFileWatcher,
} from '../types';
import { SandpackFileWatcher } from './SandpackFileWatcher';

/**
 * Callbacks that tie the SandpackAdapter to external state (e.g. SandboxManager.files).
 */
export interface SandpackAdapterCallbacks {
    /** Return the current in-memory files map (path → content). */
    getFiles: () => Record<string, string>;
    /** Called when a file is created or updated. */
    onFileUpdate: (path: string, content: string) => void;
    /** Called when a file is deleted. */
    onFileDelete: (path: string) => void;
    /** Called when dependencies change (from npm install polyfill). */
    onDependenciesChanged?: (deps: Record<string, string>) => void;
}

const BINARY_EXTENSIONS = new Set([
    '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.svg',
    '.webp', '.avif', '.mp3', '.mp4', '.wav', '.ogg', '.webm',
    '.woff', '.woff2', '.ttf', '.eot', '.otf',
    '.zip', '.tar', '.gz', '.7z', '.rar',
    '.pdf', '.exe', '.dll', '.so', '.dylib',
]);

function isBinaryPath(path: string): boolean {
    const ext = path.slice(path.lastIndexOf('.')).toLowerCase();
    return BINARY_EXTENSIONS.has(ext);
}

function normalizePath(p: string): string {
    // Ensure paths start with /
    if (!p.startsWith('/')) {
        return '/' + p;
    }
    return p;
}

/**
 * Derives the set of implicit directory paths from a flat file map.
 */
function getDirectories(files: Record<string, string>): Set<string> {
    const dirs = new Set<string>();
    dirs.add('/'); // root always exists
    for (const filePath of Object.keys(files)) {
        const parts = filePath.split('/');
        let current = '';
        for (let i = 1; i < parts.length - 1; i++) {
            current += '/' + parts[i];
            dirs.add(current);
        }
    }
    return dirs;
}

export class SandpackAdapter implements ISandboxAdapter {
    private fileWatcher: SandpackFileWatcher | null = null;

    constructor(private callbacks: SandpackAdapterCallbacks) { }

    async readFile(path: string): Promise<string> {
        const normalized = normalizePath(path);
        const files = this.callbacks.getFiles();

        if (normalized in files) {
            return files[normalized]!;
        }

        // Try without leading slash
        const withoutSlash = normalized.startsWith('/') ? normalized.slice(1) : normalized;
        if (withoutSlash in files) {
            return files[withoutSlash]!;
        }

        throw new Error(`[SandpackAdapter] File not found: ${path}`);
    }

    async writeFile(path: string, content: string | Uint8Array): Promise<void> {
        const normalized = normalizePath(path);

        // Reject binary content — browser sandboxes are text-optimized
        if (content instanceof Uint8Array) {
            console.warn(`[SandpackAdapter] Binary writes are not supported in browser sandbox: ${path}`);
            return;
        }

        if (isBinaryPath(normalized)) {
            console.warn(`[SandpackAdapter] Skipping binary file write: ${path}`);
            return;
        }

        this.callbacks.onFileUpdate(normalized, content);
    }

    async runCommand(command: string): Promise<{ output: string }> {
        // Intercept npm install commands
        const npmInstallMatch = command.match(
            /npm\s+(?:install|i|add)\s+(?:--save\s+|--save-dev\s+|-[SD]\s+)?(.+)/,
        );
        if (npmInstallMatch) {
            return this.handleNpmInstall(npmInstallMatch[1]!.trim());
        }

        // Basic shell command polyfills
        const trimmed = command.trim();

        if (trimmed === 'pwd') {
            return { output: '/project/sandbox\n' };
        }

        if (trimmed.startsWith('echo ')) {
            const echoContent = trimmed.slice(5).replace(/^["']|["']$/g, '');
            return { output: echoContent + '\n' };
        }

        if (trimmed === 'ls' || trimmed.startsWith('ls ')) {
            return this.handleLs(trimmed);
        }

        if (trimmed.startsWith('cat ')) {
            const filePath = trimmed.slice(4).trim();
            try {
                const content = await this.readFile(filePath);
                return { output: content };
            } catch {
                return { output: `cat: ${filePath}: No such file or directory\n` };
            }
        }

        console.log(`[SandpackAdapter] Command not available in browser sandbox: ${command}`);
        return { output: `[sandbox] Command executed (browser polyfill): ${trimmed}\n` };
    }

    private handleNpmInstall(packagesStr: string): { output: string } {
        const files = this.callbacks.getFiles();
        const pkgJsonPath = '/package.json';
        let packageJson: any;

        try {
            const existing = files[pkgJsonPath] ?? files['package.json'];
            packageJson = existing ? JSON.parse(existing) : { name: 'sandbox', version: '1.0.0', dependencies: {} };
        } catch {
            packageJson = { name: 'sandbox', version: '1.0.0', dependencies: {} };
        }

        if (!packageJson.dependencies) {
            packageJson.dependencies = {};
        }

        // Parse packages: "react@18.2.0 lodash" → {react: "18.2.0", lodash: "latest"}
        const packages = packagesStr.split(/\s+/).filter(Boolean);
        const installed: string[] = [];

        for (const pkg of packages) {
            // Skip flags
            if (pkg.startsWith('-')) continue;

            const atIndex = pkg.lastIndexOf('@');
            let name: string;
            let version: string;

            if (atIndex > 0) {
                name = pkg.slice(0, atIndex);
                version = pkg.slice(atIndex + 1);
            } else {
                name = pkg;
                version = 'latest';
            }

            packageJson.dependencies[name] = version;
            installed.push(`${name}@${version}`);
        }

        const updatedContent = JSON.stringify(packageJson, null, 2);
        this.callbacks.onFileUpdate(pkgJsonPath, updatedContent);

        if (this.callbacks.onDependenciesChanged) {
            this.callbacks.onDependenciesChanged({ ...packageJson.dependencies });
        }

        return {
            output: installed.map((p) => `+ ${p}`).join('\n') + '\n\nadded ' + installed.length + ' package(s)\n',
        };
    }

    private handleLs(command: string): { output: string } {
        const files = this.callbacks.getFiles();
        const parts = command.split(/\s+/);
        const targetDir = normalizePath(parts[1] ?? '/');

        const entries = new Set<string>();

        for (const filePath of Object.keys(files)) {
            const normalized = normalizePath(filePath);
            const dir = targetDir.endsWith('/') ? targetDir : targetDir + '/';

            if (normalized.startsWith(dir)) {
                const relative = normalized.slice(dir.length);
                const firstSegment = relative.split('/')[0];
                if (firstSegment) {
                    entries.add(firstSegment);
                }
            }
        }

        if (entries.size === 0) {
            // Maybe it's the root
            if (targetDir === '/') {
                for (const filePath of Object.keys(files)) {
                    const normalized = normalizePath(filePath);
                    const firstSegment = normalized.slice(1).split('/')[0];
                    if (firstSegment) entries.add(firstSegment);
                }
            }
        }

        return { output: Array.from(entries).sort().join('\n') + '\n' };
    }

    async getGitStatus(): Promise<string[]> {
        // No git in browser sandbox
        return [];
    }

    async downloadFiles(_path: string): Promise<{ url?: string }> {
        // In a full implementation, we could create a Blob ZIP here
        console.warn('[SandpackAdapter] downloadFiles is not fully supported in browser sandbox');
        return {};
    }

    async createDirectory(_path: string): Promise<void> {
        // Directories are implicit in the flat file map — no-op
    }

    async deleteFiles(path: string): Promise<void> {
        const normalized = normalizePath(path);
        const files = this.callbacks.getFiles();

        // Delete exact file match
        if (normalized in files) {
            this.callbacks.onFileDelete(normalized);
            return;
        }

        // Delete all files under directory
        const dirPrefix = normalized.endsWith('/') ? normalized : normalized + '/';
        for (const filePath of Object.keys(files)) {
            if (filePath.startsWith(dirPrefix)) {
                this.callbacks.onFileDelete(filePath);
            }
        }
    }

    async listFiles(path: string): Promise<ListFilesOutputFile[]> {
        const files = this.callbacks.getFiles();
        const normalized = normalizePath(path);
        const dir = normalized.endsWith('/') ? normalized : normalized + '/';

        const entries = new Map<string, ListFilesOutputFile>();
        const allDirs = getDirectories(files);

        for (const filePath of Object.keys(files)) {
            const normalizedFile = normalizePath(filePath);
            if (!normalizedFile.startsWith(dir)) continue;

            const relative = normalizedFile.slice(dir.length);
            const firstSegment = relative.split('/')[0];
            if (!firstSegment) continue;

            if (!entries.has(firstSegment)) {
                const fullChildPath = dir + firstSegment;
                const isDirectory = allDirs.has(fullChildPath);
                entries.set(firstSegment, {
                    name: firstSegment,
                    type: isDirectory ? 'directory' : 'file',
                    isSymlink: false,
                });
            }
        }

        return Array.from(entries.values());
    }

    async renameFile(oldPath: string, newPath: string): Promise<void> {
        const normalizedOld = normalizePath(oldPath);
        const normalizedNew = normalizePath(newPath);
        const files = this.callbacks.getFiles();

        if (normalizedOld in files) {
            const content = files[normalizedOld]!;
            this.callbacks.onFileUpdate(normalizedNew, content);
            this.callbacks.onFileDelete(normalizedOld);
        } else {
            // Rename directory: move all children
            const dirPrefix = normalizedOld.endsWith('/') ? normalizedOld : normalizedOld + '/';
            const newDirPrefix = normalizedNew.endsWith('/') ? normalizedNew : normalizedNew + '/';

            for (const filePath of Object.keys(files)) {
                if (filePath.startsWith(dirPrefix)) {
                    const newFilePath = newDirPrefix + filePath.slice(dirPrefix.length);
                    this.callbacks.onFileUpdate(newFilePath, files[filePath]!);
                    this.callbacks.onFileDelete(filePath);
                }
            }
        }
    }

    async statFile(path: string): Promise<StatFileOutput> {
        const normalized = normalizePath(path);
        const files = this.callbacks.getFiles();

        // Direct file match
        if (normalized in files) {
            return { type: 'file' };
        }

        // Check if it's a directory (has children)
        const dirPrefix = normalized.endsWith('/') ? normalized : normalized + '/';
        for (const filePath of Object.keys(files)) {
            if (filePath.startsWith(dirPrefix)) {
                return { type: 'directory' };
            }
        }

        throw new Error(`[SandpackAdapter] Path not found: ${path}`);
    }

    async watchFiles(
        input: WatchFilesInput,
    ): Promise<{ watcher: ProviderFileWatcher }> {
        this.fileWatcher = new SandpackFileWatcher(this.callbacks.getFiles);
        await this.fileWatcher.start(input);
        return { watcher: this.fileWatcher };
    }
}
