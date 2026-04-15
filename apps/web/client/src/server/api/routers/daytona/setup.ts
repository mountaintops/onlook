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
            const { output } = await provider.runCommand({
                args: { command: `cd ${workdir} && npm install --prefer-offline --no-audit --no-fund 2>&1 | tail -10` },
            });

            return {
                sandboxId,
                workdir,
                installOutput: output,
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

            // Kill any previous instance and start fresh in background
            // Use -9 for guaranteed termination and wait briefly
            await provider.runCommand({
                args: { command: `pkill -9 -f "next dev" 2>/dev/null; sleep 2; cd ${workdir} && nohup npm run dev -- --hostname 0.0.0.0 -p ${port} > /tmp/next-dev.log 2>&1 &` },
            });
            
            // Poll until the dev server is responding
            // Reduce to 10 attempts (20s total) to prevent RPC timeout (usually 30s)
            const { output: readyOutput } = await provider.runCommand({
                args: { 
                    command: `for i in $(seq 1 10); do curl -sf http://localhost:${port} > /dev/null 2>&1 && echo ready && exit 0; sleep 2; done; echo timeout`,
                    timeout: 25 // Ensure provider doesn't timeout before the loop
                },
            });

            const isReady = readyOutput.trim() === 'ready';

            // Get preview URL
            const previewInfo = await provider.getPreviewLink(port);

            return {
                ready: isReady,
                previewUrl: previewInfo?.url ?? null,
                token: previewInfo?.token ?? null,
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
    <div style={{ padding: '40px', fontFamily: 'system-ui' }}>
      <h1>Daytona Sandbox Test</h1>
      <p>Your Next.js app is running live in a Daytona sandbox.</p>
    </div>
  );
}
`;

const NEXTJS_GLOBALS_CSS = `body { margin: 0; background: #fafafa; }`;
