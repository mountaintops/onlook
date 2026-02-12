import { ProviderTerminal, type ProviderTerminalShellSize } from '../types';

/**
 * A read-only pseudo-terminal for browser sandboxes.
 * Handles basic shell commands by operating on the virtual file system,
 * and captures console output from the Sandpack client.
 */
export class PseudoTerminal extends ProviderTerminal {
    private _id: string;
    private _name: string;
    private outputCallbacks: Array<(data: string) => void> = [];
    private cwd = '/project/sandbox';

    constructor(
        id: string,
        name: string,
        private getFiles: () => Record<string, string>,
    ) {
        super();
        this._id = id;
        this._name = name;
    }

    get id(): string {
        return this._id;
    }

    get name(): string {
        return this._name;
    }

    async open(_dimensions?: ProviderTerminalShellSize): Promise<string> {
        const banner = [
            '\x1b[1;36m╔═══════════════════════════════════════╗\x1b[0m',
            '\x1b[1;36m║   Onlook Browser Sandbox Terminal     ║\x1b[0m',
            '\x1b[1;36m╚═══════════════════════════════════════╝\x1b[0m',
            '',
            '\x1b[33mThis is a browser-based sandbox. Shell commands are emulated.\x1b[0m',
            '\x1b[33mSupported: ls, pwd, cat, echo, npm install\x1b[0m',
            '',
        ].join('\r\n');
        return banner;
    }

    async write(input: string, _dimensions?: ProviderTerminalShellSize): Promise<void> {
        const command = input.trim();
        if (!command) return;

        const output = this.executeCommand(command);
        this.emitOutput(output);
    }

    async run(input: string, _dimensions?: ProviderTerminalShellSize): Promise<void> {
        await this.write(input);
    }

    async kill(): Promise<void> {
        this.outputCallbacks = [];
    }

    onOutput(callback: (data: string) => void): () => void {
        this.outputCallbacks.push(callback);
        return () => {
            this.outputCallbacks = this.outputCallbacks.filter((cb) => cb !== callback);
        };
    }

    /** Push a line of output (e.g., from console.log capture). */
    pushConsoleOutput(message: string): void {
        this.emitOutput(`\x1b[90m[console]\x1b[0m ${message}\r\n`);
    }

    private executeCommand(command: string): string {
        const parts = command.split(/\s+/);
        const cmd = parts[0]?.toLowerCase();

        switch (cmd) {
            case 'pwd':
                return this.cwd + '\r\n';

            case 'ls':
                return this.handleLs(parts[1]) + '\r\n';

            case 'cat': {
                const path = parts[1];
                if (!path) return 'cat: missing operand\r\n';
                return this.handleCat(path) + '\r\n';
            }

            case 'echo':
                return parts.slice(1).join(' ').replace(/^["']|["']$/g, '') + '\r\n';

            case 'cd': {
                const target = parts[1] ?? '/';
                this.cwd = target.startsWith('/') ? target : this.cwd + '/' + target;
                return '';
            }

            case 'clear':
                return '\x1b[2J\x1b[H';

            case 'help':
                return [
                    'Available commands:',
                    '  ls [path]     - List files',
                    '  pwd           - Print working directory',
                    '  cat <file>    - Display file contents',
                    '  echo <text>   - Echo text',
                    '  cd <dir>      - Change directory',
                    '  clear         - Clear terminal',
                    '  help          - Show this help',
                    '',
                ].join('\r\n');

            default:
                return `\x1b[33m[sandbox]\x1b[0m Command not available in browser sandbox: ${command}\r\n`;
        }
    }

    private handleLs(targetDir?: string): string {
        const files = this.getFiles();
        const dir = targetDir
            ? targetDir.startsWith('/')
                ? targetDir
                : '/' + targetDir
            : '/';
        const dirPrefix = dir.endsWith('/') ? dir : dir + '/';

        const entries = new Set<string>();

        for (const filePath of Object.keys(files)) {
            const normalized = filePath.startsWith('/') ? filePath : '/' + filePath;
            if (normalized.startsWith(dirPrefix)) {
                const relative = normalized.slice(dirPrefix.length);
                const firstSegment = relative.split('/')[0];
                if (firstSegment) entries.add(firstSegment);
            } else if (dir === '/' || dir === '') {
                const firstSegment = normalized.slice(1).split('/')[0];
                if (firstSegment) entries.add(firstSegment);
            }
        }

        if (entries.size === 0) {
            return `ls: cannot access '${targetDir ?? '/'}': No such file or directory`;
        }

        return Array.from(entries).sort().join('  ');
    }

    private handleCat(path: string): string {
        const files = this.getFiles();
        const normalized = path.startsWith('/') ? path : '/' + path;

        if (normalized in files) {
            return files[normalized]!;
        }
        if (path in files) {
            return files[path]!;
        }
        return `cat: ${path}: No such file or directory`;
    }

    private emitOutput(data: string): void {
        for (const callback of this.outputCallbacks) {
            try {
                callback(data);
            } catch (err) {
                console.error('[PseudoTerminal] Error in output callback:', err);
            }
        }
    }
}
