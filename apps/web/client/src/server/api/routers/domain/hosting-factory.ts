import { HostingProvider, type HostingProviderAdapter } from '@onlook/models';
import { FreestyleAdapter } from './adapters/freestyle';

export class HostingProviderFactory {
    static create(provider: HostingProvider = HostingProvider.NONE): HostingProviderAdapter {
        switch (provider) {
            case HostingProvider.FREESTYLE:
                return new FreestyleAdapter();
            case HostingProvider.NONE:
                return {
                    deploy: async () => ({ deploymentId: 'none', success: true }),
                } as HostingProviderAdapter;
            default:
                throw new Error(`Unsupported hosting provider: ${provider}`);
        }
    }
} 