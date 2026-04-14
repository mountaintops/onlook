import { CodeProvider, createCodeProviderClient, type Provider } from '@onlook/code-provider';
import { createDaytonaSandbox, forkDaytonaSandbox, getDaytonaClient } from '../../project/daytona-helper';

export async function forkBuildSandbox(
    sandboxId: string,
    userId: string,
    deploymentId: string,
): Promise<{ provider: Provider; sandboxId: string }> {
    // Check if source is Daytona (UUID format) or CodeSandbox (short alphanumeric)
    const isDaytonaSource = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sandboxId);

    let result;
    if (isDaytonaSource) {
        // Fork from Daytona source
        result = await forkDaytonaSandbox(
            sandboxId,
            `Deployment Fork of ${sandboxId}`,
        );
    } else {
        // Create fresh Daytona sandbox for CodeSandbox source
        result = await createDaytonaSandbox(`Deployment Fork of ${sandboxId}`);
    }

    // Create a Daytona provider client
    const provider = await createCodeProviderClient(CodeProvider.Daytona, {
        providerOptions: {
            daytona: {
                sandboxId: result.sandboxId,
                previewUrl: result.previewUrl ?? undefined,
                previewToken: result.previewToken ?? undefined,
                proxy: {
                    fs: {
                        readFile: async (path) => {
                            const client = getDaytonaClient();
                            const sandbox = await client.get(result.sandboxId);
                            const r = await sandbox.process.executeCommand(
                                `cat '${path.replace(/'/g, "'\\''")}'`,
                                undefined,
                                undefined,
                                15,
                            );
                            return { content: r.result ?? '', type: 'text' };
                        },
                        writeFile: async (path, content, overwrite) => {
                            const client = getDaytonaClient();
                            const sandbox = await client.get(result.sandboxId);
                            await sandbox.fs.uploadFiles([
                                { source: Buffer.from(content), destination: path },
                            ]);
                        },
                        statFile: async (path) => {
                            const client = getDaytonaClient();
                            const sandbox = await client.get(result.sandboxId);
                            try {
                                await sandbox.process.executeCommand(
                                    `test -f '${path.replace(/'/g, "'\\''")}'`,
                                    undefined,
                                    undefined,
                                    5,
                                );
                                return { type: 'file' };
                            } catch {
                                return { type: 'directory' };
                            }
                        },
                        listFiles: async (path) => {
                            const client = getDaytonaClient();
                            const sandbox = await client.get(result.sandboxId);
                            const r = await sandbox.process.executeCommand(
                                `ls -1 '${path.replace(/'/g, "'\\''")}' 2>/dev/null || echo ""`,
                                undefined,
                                undefined,
                                15,
                            );
                            return (r.result ?? '').split('\n').filter(Boolean);
                        },
                        deleteFiles: async (path, recursive) => {
                            const client = getDaytonaClient();
                            const sandbox = await client.get(result.sandboxId);
                            const recursiveFlag = recursive ? '-r' : '';
                            await sandbox.process.executeCommand(
                                `rm ${recursiveFlag} -f '${path.replace(/'/g, "'\\''")}'`,
                                undefined,
                                undefined,
                                15,
                            );
                        },
                        renameFile: async (oldPath, newPath) => {
                            const client = getDaytonaClient();
                            const sandbox = await client.get(result.sandboxId);
                            await sandbox.process.executeCommand(
                                `mv '${oldPath.replace(/'/g, "'\\''")}' '${newPath.replace(/'/g, "'\\''")}'`,
                                undefined,
                                undefined,
                                15,
                            );
                        },
                        copyFiles: async (sourcePath, targetPath, recursive, overwrite) => {
                            const client = getDaytonaClient();
                            const sandbox = await client.get(result.sandboxId);
                            const recursiveFlag = recursive ? '-r' : '';
                            await sandbox.process.executeCommand(
                                `cp ${recursiveFlag} '${sourcePath.replace(/'/g, "'\\''")}' '${targetPath.replace(/'/g, "'\\''")}'`,
                                undefined,
                                undefined,
                                30,
                            );
                        },
                        createDirectory: async (path) => {
                            const client = getDaytonaClient();
                            const sandbox = await client.get(result.sandboxId);
                            await sandbox.process.executeCommand(
                                `mkdir -p '${path.replace(/'/g, "'\\''")}'`,
                                undefined,
                                undefined,
                                15,
                            );
                        },
                    },
                    process: {
                        executeCommand: async (command) => {
                            const client = getDaytonaClient();
                            const sandbox = await client.get(result.sandboxId);
                            const r = await sandbox.process.executeCommand(command, undefined, undefined, 120);
                            return { exitCode: 0, output: r.result ?? '' };
                        },
                        startBackground: async (command) => {
                            throw new Error('Background commands not supported in deployment forks');
                        },
                        stopBackground: async (execId) => {
                            throw new Error('Background commands not supported in deployment forks');
                        },
                        pollOutput: async (execId) => {
                            throw new Error('Background commands not supported in deployment forks');
                        },
                        getPtyWsUrl: async (terminalId) => {
                            throw new Error('Terminal not supported in deployment forks');
                        },
                    },
                    session: {
                        createProject: async () => {
                            throw new Error('createProject not supported in deployment forks');
                        },
                        startSandbox: async (sandboxId) => {
                            const client = getDaytonaClient();
                            const sandbox = await client.get(sandboxId);
                            const previewInfo = await sandbox.getPreviewLink(3000);
                            return { previewUrl: previewInfo?.url ?? undefined, token: previewInfo?.token ?? undefined };
                        },
                        stopSandbox: async (sandboxId) => {
                            const client = getDaytonaClient();
                            const sandbox = await client.get(sandboxId);
                            await sandbox.stop();
                        },
                        gitStatus: async () => {
                            throw new Error('gitStatus not supported in deployment forks');
                        },
                    },
                },
            },
        },
    });

    return {
        provider,
        sandboxId: result.sandboxId,
    };
}
