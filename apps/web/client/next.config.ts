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
    async rewrites() {
        return [
            {
                source: '/__sw__.js',
                destination: '/assets/empty.js',
            },
        ];
    },
    transpilePackages: ['@onlook/ai', '@onlook/code-provider'],
    experimental: {
        optimizeCss: true,
        optimizePackageImports: [
            '@onlook/ui',
            '@onlook/models',
            '@onlook/ai',
            'lucide-react',
            'date-fns',
            'recharts',
            'motion',
        ],
    },
};

if (process.env.NODE_ENV === 'development') {
    nextConfig.outputFileTracingRoot = path.join(__dirname, '../../..');
}

const withNextIntl = createNextIntlPlugin({
    experimental: {
        createMessagesDeclaration: './messages/en.json'
    }
});
export default withNextIntl(nextConfig);
