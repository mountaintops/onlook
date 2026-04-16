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
                workdir: z.string().default('/home/daytona/onlook-starter'),
                autoStopInterval: z.number().default(10),
                autoArchiveInterval: z.number().optional(),
            }),
        )
        .mutation(async ({ input }) => {
            let sandboxId = input.sandboxId;
            try {
                if (!sandboxId) {
                    console.log('[Daytona Setup] Creating new sandbox...');
                    const result = await DaytonaProvider.createProject({
                        source: 'typescript',
                        id: '',
                    });
                    sandboxId = result.id;
                    console.log(`[Daytona Setup] Created sandbox: ${sandboxId}`);
                }

                const provider = (await createCodeProviderClient(CodeProvider.Daytona, {
                    providerOptions: { daytona: { sandboxId } },
                })) as DaytonaProvider;

                const workdir = input.workdir;
                console.log(`[Daytona Setup] Bootstrapping project in ${workdir} (Sandbox: ${sandboxId})`);

                // ── 0. Wait for Agent Readiness ──────────────────────────────────
                // Even if "create" returns, the agent might need a few seconds to boot fs/process
                let ready = false;
                let attempts = 0;
                while (!ready && attempts < 10) {
                    ready = await provider.ping();
                    if (!ready) {
                        console.log(`[Daytona Setup] Waiting for sandbox agent... (attempt ${attempts + 1})`);
                        await new Promise(r => setTimeout(r, 2000));
                        attempts++;
                    }
                }
                if (!ready) throw new Error('Sandbox agent failed to become ready in time');

                // ── 1. Create directories ─────────────────────────────────────────
                console.log(`[Daytona Setup] Creating directories...`);
                await provider.runCommand({ args: { command: `mkdir -p ${workdir}/app` } });

                // ── 2. Upload project files ───────────────────────────────────────
                console.log(`[Daytona Setup] Writing configuration files...`);
                await provider.writeFile({ args: { path: `${workdir}/package.json`, content: NEXTJS_PACKAGE_JSON } });
                await provider.writeFile({ args: { path: `${workdir}/next.config.js`, content: NEXTJS_CONFIG } });
                await provider.writeFile({ args: { path: `${workdir}/tsconfig.json`, content: NEXTJS_TSCONFIG } });
                await provider.writeFile({ args: { path: `${workdir}/app/layout.tsx`, content: NEXTJS_LAYOUT } });
                await provider.writeFile({ args: { path: `${workdir}/app/page.tsx`, content: NEXTJS_PAGE } });
                await provider.writeFile({ args: { path: `${workdir}/app/globals.css`, content: NEXTJS_GLOBALS_CSS } });

                // ── 3. Install dependencies ───────────────────────────────────────
                console.log(`[Daytona Setup] Running npm install (this may take a few minutes)...`);
                const { output, exitCode } = await provider.runCommand({
                    args: { 
                        command: `cd ${workdir} && npm install --prefer-offline --no-audit --no-fund 2>&1`,
                        timeout: 300, // 5 minute timeout for npm install
                    },
                });

                if (exitCode !== 0) {
                    console.error(`[Daytona Setup] npm install failed:`, output);
                    throw new Error(`npm install failed (Exit ${exitCode}). Output: ${output.slice(-500)}`);
                }

                console.log(`[Daytona Setup] Project bootstrapped successfully!`);
                return {
                    success: true,
                    sandboxId,
                    workdir,
                };
            } catch (error: any) {
                console.error(`[Daytona Setup] Bootstrap failed for ${sandboxId || 'new'}:`, error.message);
                throw new TRPCError({
                    code: 'INTERNAL_SERVER_ERROR',
                    message: `Bootstrap failed: ${error.message}`,
                });
            }
        }),

    /**
     * Start the Next.js dev server.
     */
    startDevServer: publicProcedure
        .input(
            z.object({
                sandboxId: z.string(),
                workdir: z.string().default('/home/daytona/onlook-starter'),
                port: z.number().default(3000),
            }),
        )
        .mutation(async ({ input }) => {
            const provider = (await createCodeProviderClient(CodeProvider.Daytona, {
                providerOptions: { daytona: { sandboxId: input.sandboxId } },
            })) as DaytonaProvider;
            const { workdir, port } = input;

            console.log(`[Daytona Setup] Starting dev server in ${workdir} on port ${port}...`);

            // Kill any previous instance and start fresh in background
            // Use -9 for guaranteed termination and wait briefly
            // We use 'cd' inside a subshell to catch failures early
            const { exitCode: shellExit } = await provider.runCommand({
                args: { command: `pkill -9 -f "next dev" 2>/dev/null; sleep 1; [ -d "${workdir}" ]` },
            });

            if (shellExit !== 0) {
                console.error(`[Daytona Setup] Directory ${workdir} does not exist in sandbox ${input.sandboxId}`);
                throw new TRPCError({
                    code: 'NOT_FOUND',
                    message: `Directory ${workdir} not found in sandbox. Did you bootstrap it?`,
                });
            }

            await provider.runCommand({
                args: { command: `cd ${workdir} && nohup npm run dev -- --hostname 0.0.0.0 -p ${port} > /tmp/next-dev.log 2>&1 &` },
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
