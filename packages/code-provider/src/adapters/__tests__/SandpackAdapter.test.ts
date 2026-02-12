import { describe, expect, test } from 'bun:test';
import { SandpackAdapter } from '../SandpackAdapter';
import type { SandpackAdapterCallbacks } from '../SandpackAdapter';

function createTestAdapter(initialFiles: Record<string, string> = {}) {
    const files = { ...initialFiles };
    const deletedPaths: string[] = [];
    let latestDeps: Record<string, string> = {};

    const callbacks: SandpackAdapterCallbacks = {
        getFiles: () => files,
        onFileUpdate: (path, content) => {
            files[path] = content;
        },
        onFileDelete: (path) => {
            delete files[path];
            deletedPaths.push(path);
        },
        onDependenciesChanged: (deps) => {
            latestDeps = deps;
        },
    };

    const adapter = new SandpackAdapter(callbacks);
    return { adapter, files, deletedPaths, getLatestDeps: () => latestDeps };
}

describe('SandpackAdapter', () => {
    describe('readFile', () => {
        test('returns content for existing file', async () => {
            const { adapter } = createTestAdapter({
                '/App.js': 'export default function App() { return <h1>Hello</h1>; }',
            });
            const content = await adapter.readFile('/App.js');
            expect(content).toBe('export default function App() { return <h1>Hello</h1>; }');
        });

        test('normalizes paths without leading slash', async () => {
            const { adapter } = createTestAdapter({
                'App.js': 'hello',
            });
            const content = await adapter.readFile('App.js');
            expect(content).toBe('hello');
        });

        test('throws for missing file', async () => {
            const { adapter } = createTestAdapter({});
            await expect(adapter.readFile('/nonexistent.js')).rejects.toThrow('File not found');
        });
    });

    describe('writeFile', () => {
        test('updates file via callback', async () => {
            const { adapter, files } = createTestAdapter({});
            await adapter.writeFile('/App.js', 'new content');
            expect(files['/App.js']).toBe('new content');
        });

        test('rejects binary Uint8Array content', async () => {
            const { adapter, files } = createTestAdapter({});
            await adapter.writeFile('/image.png', new Uint8Array([1, 2, 3]));
            expect(files['/image.png']).toBeUndefined();
        });

        test('skips binary file extensions', async () => {
            const { adapter, files } = createTestAdapter({});
            await adapter.writeFile('/photo.jpg', 'binary data');
            expect(files['/photo.jpg']).toBeUndefined();
        });
    });

    describe('listFiles', () => {
        test('lists files in root directory', async () => {
            const { adapter } = createTestAdapter({
                '/App.js': 'app',
                '/index.js': 'index',
                '/styles.css': 'css',
            });
            const result = await adapter.listFiles('/');
            const names = result.map((f) => f.name).sort();
            expect(names).toEqual(['App.js', 'index.js', 'styles.css']);
        });

        test('lists subdirectories as directory type', async () => {
            const { adapter } = createTestAdapter({
                '/src/App.js': 'app',
                '/src/utils/helper.js': 'helper',
            });
            const result = await adapter.listFiles('/src');
            const utilsEntry = result.find((f) => f.name === 'utils');
            expect(utilsEntry).toBeDefined();
            expect(utilsEntry!.type).toBe('directory');
        });

        test('returns empty for nonexistent directory', async () => {
            const { adapter } = createTestAdapter({
                '/App.js': 'app',
            });
            const result = await adapter.listFiles('/nonexistent');
            expect(result).toEqual([]);
        });
    });

    describe('statFile', () => {
        test('returns file type for existing file', async () => {
            const { adapter } = createTestAdapter({
                '/App.js': 'app',
            });
            const stat = await adapter.statFile('/App.js');
            expect(stat.type).toBe('file');
        });

        test('returns directory type for directory path', async () => {
            const { adapter } = createTestAdapter({
                '/src/App.js': 'app',
            });
            const stat = await adapter.statFile('/src');
            expect(stat.type).toBe('directory');
        });

        test('throws for nonexistent path', async () => {
            const { adapter } = createTestAdapter({});
            await expect(adapter.statFile('/nope')).rejects.toThrow('Path not found');
        });
    });

    describe('deleteFiles', () => {
        test('deletes a single file', async () => {
            const { adapter, files } = createTestAdapter({
                '/App.js': 'app',
                '/index.js': 'index',
            });
            await adapter.deleteFiles('/App.js');
            expect(files['/App.js']).toBeUndefined();
            expect(files['/index.js']).toBe('index');
        });

        test('deletes all files under a directory', async () => {
            const { adapter, files } = createTestAdapter({
                '/src/a.js': 'a',
                '/src/b.js': 'b',
                '/other.js': 'other',
            });
            await adapter.deleteFiles('/src');
            expect(files['/src/a.js']).toBeUndefined();
            expect(files['/src/b.js']).toBeUndefined();
            expect(files['/other.js']).toBe('other');
        });
    });

    describe('renameFile', () => {
        test('renames a file', async () => {
            const { adapter, files } = createTestAdapter({
                '/old.js': 'content',
            });
            await adapter.renameFile('/old.js', '/new.js');
            expect(files['/old.js']).toBeUndefined();
            expect(files['/new.js']).toBe('content');
        });

        test('renames a directory (moves all children)', async () => {
            const { adapter, files } = createTestAdapter({
                '/src/a.js': 'a',
                '/src/b.js': 'b',
            });
            await adapter.renameFile('/src', '/lib');
            expect(files['/src/a.js']).toBeUndefined();
            expect(files['/src/b.js']).toBeUndefined();
            expect(files['/lib/a.js']).toBe('a');
            expect(files['/lib/b.js']).toBe('b');
        });
    });

    describe('runCommand', () => {
        test('handles pwd', async () => {
            const { adapter } = createTestAdapter({});
            const result = await adapter.runCommand('pwd');
            expect(result.output).toContain('/project/sandbox');
        });

        test('handles echo', async () => {
            const { adapter } = createTestAdapter({});
            const result = await adapter.runCommand('echo hello world');
            expect(result.output).toContain('hello world');
        });

        test('handles ls', async () => {
            const { adapter } = createTestAdapter({
                '/App.js': 'app',
                '/index.js': 'index',
            });
            const result = await adapter.runCommand('ls /');
            expect(result.output).toContain('App.js');
            expect(result.output).toContain('index.js');
        });

        test('handles cat for existing file', async () => {
            const { adapter } = createTestAdapter({
                '/readme.txt': 'Hello README',
            });
            const result = await adapter.runCommand('cat /readme.txt');
            expect(result.output).toBe('Hello README');
        });

        test('handles cat for missing file', async () => {
            const { adapter } = createTestAdapter({});
            const result = await adapter.runCommand('cat /missing.txt');
            expect(result.output).toContain('No such file');
        });

        test('npm install adds dependency to package.json', async () => {
            const { adapter, files, getLatestDeps } = createTestAdapter({
                '/package.json': JSON.stringify({ name: 'test', dependencies: {} }),
            });
            const result = await adapter.runCommand('npm install lodash@4.17.21');
            expect(result.output).toContain('lodash@4.17.21');

            const pkg = JSON.parse(files['/package.json']!);
            expect(pkg.dependencies.lodash).toBe('4.17.21');
            expect(getLatestDeps().lodash).toBe('4.17.21');
        });

        test('npm install without version defaults to latest', async () => {
            const { adapter, files } = createTestAdapter({
                '/package.json': JSON.stringify({ name: 'test', dependencies: {} }),
            });
            await adapter.runCommand('npm install react');
            const pkg = JSON.parse(files['/package.json']!);
            expect(pkg.dependencies.react).toBe('latest');
        });

        test('npm install creates package.json if missing', async () => {
            const { adapter, files } = createTestAdapter({});
            await adapter.runCommand('npm install axios');
            expect(files['/package.json']).toBeDefined();
            const pkg = JSON.parse(files['/package.json']!);
            expect(pkg.dependencies.axios).toBe('latest');
        });

        test('returns polyfill message for unknown commands', async () => {
            const { adapter } = createTestAdapter({});
            const result = await adapter.runCommand('git status');
            expect(result.output).toContain('browser polyfill');
        });
    });

    describe('createDirectory', () => {
        test('is a no-op (directories are implicit)', async () => {
            const { adapter } = createTestAdapter({});
            await expect(adapter.createDirectory('/new-dir')).resolves.toBeUndefined();
        });
    });

    describe('watchFiles', () => {
        test('returns a watcher', async () => {
            const { adapter } = createTestAdapter({});
            const { watcher } = await adapter.watchFiles({
                args: { path: '/' },
            });
            expect(watcher).toBeDefined();
            expect(typeof watcher.stop).toBe('function');
            await watcher.stop();
        });
    });
});
