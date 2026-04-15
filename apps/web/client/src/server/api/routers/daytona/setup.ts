import { CodeProvider, createCodeProviderClient, DaytonaProvider } from '@onlook/code-provider';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { createTRPCRouter, publicProcedure } from '../../trpc';

export const setupRouter = createTRPCRouter({
    /**
     * Bootstrap a minimal Next.js project.
     */
    bootstrapNextjsProject: publicProcedure
        .input(
            z.object({
                sandboxId: z.string().optional(),
                workdir: z.string().default('/tmp/nextapp'),
                autoStopInterval: z.number().default(10),
                autoArchiveInterval: z.number().optional(),
            }),
        )
        .mutation(async ({ input }) => {
            let sandboxId = input.sandboxId;
            if (!sandboxId) {
                const result = await DaytonaProvider.createProject({
                    source: 'typescript',
                    id: '',
                    title: 'Next.js Bootstrap Sandbox',
                });
                sandboxId = result.id;
            }

            const provider = (await createCodeProviderClient(CodeProvider.Daytona, {
                providerOptions: { daytona: { sandboxId } },
            })) as DaytonaProvider;

            const workdir = input.workdir;

            // ── 1. Create directories ─────────────────────────────────────────
            await provider.runCommand({ args: { command: `mkdir -p ${workdir}/app` } });

            // ── 2. Upload project files ───────────────────────────────────────
            await provider.writeFile({ args: { path: `${workdir}/package.json`, content: NEXTJS_PACKAGE_JSON } });
            await provider.writeFile({ args: { path: `${workdir}/next.config.js`, content: NEXTJS_CONFIG } });
            await provider.writeFile({ args: { path: `${workdir}/tsconfig.json`, content: NEXTJS_TSCONFIG } });
            await provider.writeFile({ args: { path: `${workdir}/app/layout.tsx`, content: NEXTJS_LAYOUT } });
            await provider.writeFile({ args: { path: `${workdir}/app/page.tsx`, content: NEXTJS_PAGE } });
            await provider.writeFile({ args: { path: `${workdir}/app/globals.css`, content: NEXTJS_GLOBALS_CSS } });

            // ── 3. Install dependencies ───────────────────────────────────────
            const { output, exitCode } = await provider.runCommand({
                args: { command: `cd ${workdir} && npm install --prefer-offline --no-audit --no-fund 2>&1` },
            });

            if (exitCode !== 0) {
                console.error(`[Daytona] npm install failed in ${sandboxId}:`, output);
                throw new TRPCError({
                    code: 'INTERNAL_SERVER_ERROR',
                    message: `Dependencies installation failed (Exit ${exitCode}). check logs for details.`,
                });
            }

            return {
                sandboxId,
                workdir,
                installOutput: output.slice(-500), // Return last 500 chars for UI
            };
        }),

    /**
     * Start the Next.js dev server.
     */
    startDevServer: publicProcedure
        .input(
            z.object({
                sandboxId: z.string(),
                workdir: z.string().default('/tmp/nextapp'),
                port: z.number().default(3000),
            }),
        )
        .mutation(async ({ input }) => {
            const provider = (await createCodeProviderClient(CodeProvider.Daytona, {
                providerOptions: { daytona: { sandboxId: input.sandboxId } },
            })) as DaytonaProvider;
            const { workdir, port } = input;

            // Get preview link first to determine HMR host
            const previewLinkData = await provider.getPreviewLink(port);
            let hmrEnv = '';
            if (previewLinkData?.url) {
                try {
                    const url = new URL(previewLinkData.url);
                    // Force HMR to use the secure tunnel host and wss protocol
                    hmrEnv = `NEXT_HMR_PROTOCOL=wss NEXT_HMR_HOST=${url.hostname} NEXT_HMR_PORT=443 `;
                } catch (e) {
                    console.error('Failed to parse preview URL for HMR env', e);
                }
            }

            // Kill any previous instance and start fresh in background
            // Using npx next dev directly for cleaner flag passing and error isolation
            await provider.runCommand({
                args: { command: `pkill -9 -f "next dev" 2>/dev/null; sleep 2; cd ${workdir} && nohup ${hmrEnv}PORT=${port} NODE_ENV=development npx next dev --hostname 0.0.0.0 --port ${port} > /tmp/next-dev.log 2>&1 &` },
            });
            
            // Poll until the dev server is responding
            // Increase to 15 attempts (30s) to handle slower cold starts
            const { output: readyOutput } = await provider.runCommand({
                args: { 
                    command: `for i in $(seq 1 15); do curl -sf http://localhost:${port} > /dev/null 2>&1 && echo ready && exit 0; sleep 2; done; echo timeout`,
                    timeout: 40
                },
            });

            const isReady = readyOutput.trim() === 'ready';

            return {
                ready: isReady,
                previewUrl: previewLinkData?.url ?? null,
                token: previewLinkData?.token ?? null,
            };
        }),
});

// ── Next.js starter file templates ───────────────────────────────────────────

const NEXTJS_PACKAGE_JSON = JSON.stringify(
    {
        name: 'nextjs-daytona',
        version: '0.1.0',
        private: true,
        scripts: {
            dev: 'next dev',
            build: 'next build',
            start: 'next start',
            lint: 'next lint',
        },
        dependencies: {
            next: '15.2.4',
            react: '^19',
            'react-dom': '^19',
        },
        devDependencies: {
            typescript: '^5',
            '@types/node': '^20',
            '@types/react': '^19',
            '@types/react-dom': '^19',
        },
    },
    null,
    2,
);

const NEXTJS_CONFIG = `/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  devIndicators: {
    appIsrStatus: false,
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: "frame-ancestors *",
          },
        ],
      },
    ];
  },
};
module.exports = nextConfig;
`;

const NEXTJS_TSCONFIG = `{
  "compilerOptions": {
    "target": "es5",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [
      {
        "name": "next"
      }
    ],
    "paths": {
      "@/*": ["./*"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
`;

const NEXTJS_LAYOUT = `import './globals.css';
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
`;

const NEXTJS_PAGE = `export default function Home() {
  return (
    <div style={{ padding: '40px', fontFamily: 'system-ui', lineHeight: '1.5' }}>
      <h1 style={{ color: '#0070f3' }}>Daytona Sandbox Test</h1>
      <p>Your Next.js app is running live in a Daytona sandbox.</p>
      <div style={{ marginTop: '20px', padding: '10px', background: '#eee', borderRadius: '5px' }}>
        <strong>HMR Test:</strong> Try editing this file in the terminal!
      </div>
      <p style={{ fontSize: '12px', color: '#666', marginTop: '20px' }}>
        Refreshed at: {new Date().toLocaleTimeString()}
      </p>
    </div>
  );
}
`;

const NEXTJS_GLOBALS_CSS = `body { margin: 0; background: #fafafa; }`;
