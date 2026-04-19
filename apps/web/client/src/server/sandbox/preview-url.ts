import { CodeProvider, createCodeProviderClient } from '@onlook/code-provider';
import type { DaytonaProvider } from '@onlook/code-provider/daytona';
import { getSandboxPreviewUrl } from '@onlook/constants';

import { getSandboxBackend } from '@/config/sandbox-backend';

/**
 * Resolves the iframe preview URL for a sandbox. CodeSandbox uses the csb.app pattern;
 * Daytona uses signed preview URLs from the API.
 */
export async function resolveFramePreviewUrl(sandboxId: string, port: number): Promise<string> {
    if (getSandboxBackend() !== 'daytona') {
        return getSandboxPreviewUrl(sandboxId, port);
    }

    const provider = (await createCodeProviderClient(CodeProvider.Daytona, {
        providerOptions: { daytona: { sandboxId } },
    })) as DaytonaProvider;

    try {
        const info = await provider.getPreviewLink(port);
        let url = info?.url ?? '';
        if (!url) {
            return getSandboxPreviewUrl(sandboxId, port);
        }
        if (info?.token) {
            url = url.includes('?') ? `${url}&token=${encodeURIComponent(info.token)}` : `${url}?token=${encodeURIComponent(info.token)}`;
        }
        return url;
    } finally {
        await provider.destroy().catch(() => {});
    }
}
