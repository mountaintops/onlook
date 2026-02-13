/**
 * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially useful
 * for Docker builds.
 */
import { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';
import path from 'node:path';
import './src/env';

const nextConfig: NextConfig = {
    devIndicators: false,
    ...(process.env.STANDALONE_BUILD === 'true' && { output: 'standalone' }),
    eslint: {
        // Don't run ESLint during builds - handle it separately in CI
        ignoreDuringBuilds: true,
    },
    webpack: (config) => {
        config.resolve.alias = {
            ...config.resolve.alias,
            '@automerge/automerge': '@automerge/automerge/slim',
        };
        config.experiments = {
            ...config.experiments,
            asyncWebAssembly: true,
            layers: true,
        };
        return config;
    },
    experimental: {
        turbo: {
            resolveAlias: {
                '@automerge/automerge': '@automerge/automerge/slim',
            },
        },
    },
};

if (process.env.NODE_ENV === 'development') {
    nextConfig.outputFileTracingRoot = path.join(__dirname, '../../..');
}

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');
export default withNextIntl(nextConfig);
