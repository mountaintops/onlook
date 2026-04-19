import { CodeProvider, createCodeProviderClient, getStaticCodeProvider, type Provider } from '@onlook/code-provider';
import { DaytonaProvider } from '@onlook/code-provider/daytona';

import { getSandboxBackend } from '@/config/sandbox-backend';

export async function forkBuildSandbox(
    sandboxId: string,
    userId: string,
    deploymentId: string,
): Promise<{ provider: Provider; sandboxId: string }> {
    if (getSandboxBackend() === 'daytona') {
        const inst = (await createCodeProviderClient(CodeProvider.Daytona, {
            providerOptions: { daytona: { sandboxId } },
        })) as DaytonaProvider;
        let forkedId: string;
        try {
            const project = await inst.fork('Deployment Fork of ' + sandboxId);
            forkedId = project.id;
        } finally {
            await inst.destroy().catch(() => {});
        }

        const forkedProvider = await createCodeProviderClient(CodeProvider.Daytona, {
            providerOptions: {
                daytona: { sandboxId: forkedId },
            },
        });

        return {
            provider: forkedProvider,
            sandboxId: forkedId,
        };
    }

    const CodesandboxProvider = await getStaticCodeProvider(CodeProvider.CodeSandbox);
    const project = await CodesandboxProvider.createProject({
        source: 'template',
        id: sandboxId,
        title: 'Deployment Fork of ' + sandboxId,
        description: 'Forked sandbox for deployment',
        tags: ['deployment', 'preview', userId, deploymentId],
    });

    const forkedProvider = await createCodeProviderClient(CodeProvider.CodeSandbox, {
        providerOptions: {
            codesandbox: {
                sandboxId: project.id,
                userId,
                initClient: true,
            },
        },
    });

    return {
        provider: forkedProvider,
        sandboxId: project.id,
    };
}
