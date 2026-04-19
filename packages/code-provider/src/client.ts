/**
 * Browser-safe entry: CodeSandbox / NodeFs + shared types.
 * Does not reference `./providers/daytona` or `@daytonaio/sdk` (avoids `async_hooks` in client bundles).
 */
export { CodeProvider } from './providers';
export * from './types';
export { CodesandboxProvider, type CodesandboxProviderOptions } from './providers/codesandbox';
export { NodeFsProvider, type NodeFsProviderOptions } from './providers/nodefs';

import { CodeProvider } from './providers';
import { CodesandboxProvider, type CodesandboxProviderOptions } from './providers/codesandbox';
import { NodeFsProvider, type NodeFsProviderOptions } from './providers/nodefs';
import type { Provider } from './types';

export interface ClientCreateClientOptions {
    providerOptions: {
        codesandbox?: CodesandboxProviderOptions;
        nodefs?: NodeFsProviderOptions;
    };
}

export async function createCodeProviderClient(
    codeProvider: CodeProvider,
    { providerOptions }: ClientCreateClientOptions,
): Promise<Provider> {
    if (codeProvider === CodeProvider.Daytona) {
        throw new Error(
            'Daytona runs only on the server. From the browser use tRPC (api.daytona.*) or DaytonaTrpcProvider.',
        );
    }

    if (codeProvider === CodeProvider.CodeSandbox) {
        if (!providerOptions.codesandbox) {
            throw new Error('Codesandbox provider options are required.');
        }
        const provider = new CodesandboxProvider(providerOptions.codesandbox);
        await provider.initialize({});
        return provider;
    }

    if (codeProvider === CodeProvider.NodeFs) {
        if (!providerOptions.nodefs) {
            throw new Error('NodeFs provider options are required.');
        }
        const provider = new NodeFsProvider(providerOptions.nodefs);
        await provider.initialize({});
        return provider;
    }

    throw new Error(`Unimplemented code provider for client bundle: ${codeProvider}`);
}
