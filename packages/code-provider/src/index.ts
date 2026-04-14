import { CodeProvider } from './providers';
import { CodesandboxProvider, type CodesandboxProviderOptions } from './providers/codesandbox';
import { DaytonaProvider, type DaytonaProviderOptions } from './providers/daytona';
import { NodeFsProvider, type NodeFsProviderOptions } from './providers/nodefs';
export * from './providers';
export { CodesandboxProvider } from './providers/codesandbox';
export { DaytonaProvider } from './providers/daytona';
export type { DaytonaProviderOptions, DaytonaProviderProxy, DaytonaFsProxy, DaytonaProcessProxy, DaytonaSessionProxy } from './providers/daytona';
export { NodeFsProvider } from './providers/nodefs';
export * from './types';

export interface CreateClientOptions {
    providerOptions: ProviderInstanceOptions;
}

/**
 * Providers are designed to be singletons; be mindful of this when creating multiple clients
 * or when instantiating in the backend (stateless vs stateful).
 */
export async function createCodeProviderClient(
    codeProvider: CodeProvider,
    { providerOptions }: CreateClientOptions,
) {
    const provider = newProviderInstance(codeProvider, providerOptions);
    await provider.initialize({});
    return provider;
}

export async function getStaticCodeProvider(
    codeProvider: CodeProvider,
): Promise<typeof CodesandboxProvider | typeof NodeFsProvider | typeof DaytonaProvider> {
    if (codeProvider === CodeProvider.CodeSandbox) {
        return CodesandboxProvider;
    }

    if (codeProvider === CodeProvider.NodeFs) {
        return NodeFsProvider;
    }

    if (codeProvider === CodeProvider.Daytona) {
        return DaytonaProvider;
    }

    throw new Error(`Unimplemented code provider: ${codeProvider}`);
}

export interface ProviderInstanceOptions {
    codesandbox?: CodesandboxProviderOptions;
    daytona?: DaytonaProviderOptions;
    nodefs?: NodeFsProviderOptions;
}

function newProviderInstance(codeProvider: CodeProvider, providerOptions: ProviderInstanceOptions) {
    if (codeProvider === CodeProvider.CodeSandbox) {
        if (!providerOptions.codesandbox) {
            throw new Error('Codesandbox provider options are required.');
        }
        return new CodesandboxProvider(providerOptions.codesandbox);
    }

    if (codeProvider === CodeProvider.Daytona) {
        if (!providerOptions.daytona) {
            throw new Error('Daytona provider options are required.');
        }
        return new DaytonaProvider(providerOptions.daytona);
    }

    if (codeProvider === CodeProvider.NodeFs) {
        if (!providerOptions.nodefs) {
            throw new Error('NodeFs provider options are required.');
        }
        return new NodeFsProvider(providerOptions.nodefs);
    }

    throw new Error(`Unimplemented code provider: ${codeProvider}`);
}
