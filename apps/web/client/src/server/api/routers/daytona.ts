import { Daytona, type CreateSandboxFromSnapshotParams } from '@daytonaio/sdk';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { createTRPCRouter, publicProcedure } from '../trpc';

/**
 * Get a configured Daytona client using the API key from env.
 */
function getDaytonaClient(): Daytona {
    const apiKey = process.env.SANDBOX_DAYTONA_API_KEY;
    if (!apiKey) {
        throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'SANDBOX_DAYTONA_API_KEY is not configured',
        });
    }
    return new Daytona({ apiKey });
}

export const daytonaRouter = createTRPCRouter({
    /**
     * Create a new Daytona sandbox.
     */
    createSandbox: publicProcedure
        .input(
            z.object({
                language: z.enum(['typescript', 'javascript', 'python']).default('typescript'),
                autoStopInterval: z.number().min(0).max(240).default(10),
                envVars: z.record(z.string(), z.string()).optional(),
            }),
        )
        .mutation(async ({ input }) => {
            const client = getDaytonaClient();
            try {
                // CreateSandboxFromSnapshotParams is intersection with base; cast to satisfy overload
                const params = {
                    language: input.language,
                    autoStopInterval: input.autoStopInterval,
                    autoArchiveInterval: input.autoStopInterval + 10,
                    autoDeleteInterval: 0,
                    ephemeral: true, // Auto-delete on stop
                    public: true,
                    ...(input.envVars && { envVars: input.envVars as Record<string, string> }),
                } satisfies CreateSandboxFromSnapshotParams;
                const sandbox = await client.create(params, { timeout: 120 });

                return {
                    id: sandbox.id,
                    state: (sandbox as any).state ?? 'started',
                    createdAt: (sandbox as any).createdAt ?? new Date().toISOString(),
                };
            } catch (error) {
                throw new TRPCError({
                    code: 'INTERNAL_SERVER_ERROR',
                    message: `Failed to create Daytona sandbox: ${error instanceof Error ? error.message : String(error)}`,
                    cause: error,
                });
            }
        }),

    /**
     * Stop a Daytona sandbox.
     */
    stopSandbox: publicProcedure
        .input(z.object({ sandboxId: z.string() }))
        .mutation(async ({ input }) => {
            const client = getDaytonaClient();
            try {
                const sandbox = await client.get(input.sandboxId);
                await sandbox.stop();
                return { success: true, sandboxId: input.sandboxId };
            } catch (error) {
                throw new TRPCError({
                    code: 'INTERNAL_SERVER_ERROR',
                    message: `Failed to stop sandbox: ${error instanceof Error ? error.message : String(error)}`,
                    cause: error,
                });
            }
        }),

    /**
     * List all Daytona sandboxes (first page, up to 50).
     */
    listSandboxes: publicProcedure.query(async () => {
        const client = getDaytonaClient();
        try {
            // list() returns PaginatedSandboxes { items: Sandbox[], total, page, limit }
            const result = await client.list(undefined, 1, 50);
            return result.items.map((s) => ({
                id: s.id,
                state: String((s as any).state ?? 'unknown'),
                createdAt: (s as any).createdAt ?? null,
                updatedAt: (s as any).updatedAt ?? null,
                snapshot: (s as any).snapshot ?? null,
                cpu: (s as any).cpu ?? null,
                memory: (s as any).memory ?? null,
                disk: (s as any).disk ?? null,
                labels: (s as any).labels ?? {},
            }));
        } catch (error) {
            throw new TRPCError({
                code: 'INTERNAL_SERVER_ERROR',
                message: `Failed to list Daytona sandboxes: ${error instanceof Error ? error.message : String(error)}`,
                cause: error,
            });
        }
    }),

    /**
     * Get info about a specific sandbox by ID or name.
     */
    getSandbox: publicProcedure
        .input(z.object({ sandboxId: z.string() }))
        .query(async ({ input }) => {
            const client = getDaytonaClient();
            try {
                const sandbox = await client.get(input.sandboxId);
                return {
                    id: sandbox.id,
                    state: String((sandbox as any).state ?? 'unknown'),
                    createdAt: (sandbox as any).createdAt ?? null,
                    updatedAt: (sandbox as any).updatedAt ?? null,
                    snapshot: (sandbox as any).snapshot ?? null,
                    cpu: (sandbox as any).cpu ?? null,
                    memory: (sandbox as any).memory ?? null,
                    disk: (sandbox as any).disk ?? null,
                };
            } catch (error) {
                throw new TRPCError({
                    code: 'NOT_FOUND',
                    message: `Sandbox ${input.sandboxId} not found: ${error instanceof Error ? error.message : String(error)}`,
                    cause: error,
                });
            }
        }),

    /**
     * Execute a shell command inside a specific sandbox.
     */
    executeCommand: publicProcedure
        .input(
            z.object({
                sandboxId: z.string(),
                command: z.string().min(1),
            }),
        )
        .mutation(async ({ input }) => {
            const client = getDaytonaClient();
            try {
                const sandbox = await client.get(input.sandboxId);
                const result = await sandbox.process.executeCommand(input.command);
                return {
                    exitCode: result.exitCode ?? 0,
                    output: result.result ?? (result as any).artifacts?.stdout ?? '',
                };
            } catch (error) {
                throw new TRPCError({
                    code: 'INTERNAL_SERVER_ERROR',
                    message: `Command execution failed: ${error instanceof Error ? error.message : String(error)}`,
                    cause: error,
                });
            }
        }),

    /**
     * Run TypeScript/JS/Python code inside a sandbox using the code interpreter.
     */
    runCode: publicProcedure
        .input(
            z.object({
                sandboxId: z.string(),
                code: z.string().min(1),
            }),
        )
        .mutation(async ({ input }) => {
            const client = getDaytonaClient();
            try {
                const sandbox = await client.get(input.sandboxId);
                const result = await sandbox.process.codeRun(input.code);
                return {
                    exitCode: result.exitCode ?? 0,
                    output: result.result ?? '',
                    success: (result.exitCode ?? 0) === 0,
                };
            } catch (error) {
                throw new TRPCError({
                    code: 'INTERNAL_SERVER_ERROR',
                    message: `Code execution failed: ${error instanceof Error ? error.message : String(error)}`,
                    cause: error,
                });
            }
        }),

    /**
     * Delete a Daytona sandbox by ID.
     */
    deleteSandbox: publicProcedure
        .input(z.object({ sandboxId: z.string() }))
        .mutation(async ({ input }) => {
            const client = getDaytonaClient();
            try {
                // client.get() fetches the Sandbox instance, then client.delete() removes it
                const sandbox = await client.get(input.sandboxId);
                await client.delete(sandbox);
                return { success: true, sandboxId: input.sandboxId };
            } catch (error) {
                throw new TRPCError({
                    code: 'INTERNAL_SERVER_ERROR',
                    message: `Failed to delete sandbox: ${error instanceof Error ? error.message : String(error)}`,
                    cause: error,
                });
            }
        }),

    /**
     * Delete all Daytona sandboxes (up to 100).
     */
    deleteAllSandboxes: publicProcedure.mutation(async () => {
        const client = getDaytonaClient();
        try {
            const result = await client.list(undefined, 1, 100);
            const deletions = result.items.map((s) => client.delete(s));
            await Promise.all(deletions);
            return { success: true, count: result.items.length };
        } catch (error) {
            throw new TRPCError({
                code: 'INTERNAL_SERVER_ERROR',
                message: `Failed to delete all sandboxes: ${error instanceof Error ? error.message : String(error)}`,
                cause: error,
            });
        }
    }),

    /**
     * Get the public preview URL for a given port of a sandbox.
     */
    getPreviewUrl: publicProcedure
        .input(
            z.object({
                sandboxId: z.string(),
                port: z.number().default(3000),
            }),
        )
        .query(async ({ input }) => {
            const client = getDaytonaClient();
            try {
                const sandbox = await client.get(input.sandboxId);
                const previewInfo = await sandbox.getPreviewLink(input.port);
                return {
                    url: previewInfo?.url ?? null,
                    token: previewInfo?.token ?? null,
                };
            } catch (error) {
                throw new TRPCError({
                    code: 'INTERNAL_SERVER_ERROR',
                    message: `Failed to get preview URL: ${error instanceof Error ? error.message : String(error)}`,
                    cause: error,
                });
            }
        }),

    /**
     * Bootstrap a minimal Next.js project inside a (new or existing) Daytona sandbox.
     * Creates project files and runs npm install. Returns the sandbox ID.
     */
    bootstrapNextjsProject: publicProcedure
        .input(
            z.object({
                sandboxId: z.string().optional(), // reuse existing sandbox or create new one
                workdir: z.string().default('/tmp/nextapp'),
            }),
        )
        .mutation(async ({ input }) => {
            const client = getDaytonaClient();
            const workdir = input.workdir;

            // ── 1. Create or retrieve sandbox ─────────────────────────────────
            let sandbox;
            if (input.sandboxId) {
                sandbox = await client.get(input.sandboxId);
            } else {
                const params = {
                    language: 'typescript',
                    autoStopInterval: 10, // Reduced from 30 to 10 to save quota
                    autoArchiveInterval: 20,
                    autoDeleteInterval: 0,
                    ephemeral: true, // Auto-delete on stop/timeout
                    public: true,
                } satisfies CreateSandboxFromSnapshotParams;
                sandbox = await client.create(params, { timeout: 120 });
            }

            // ── 2. Create directories ─────────────────────────────────────────
            await sandbox.process.executeCommand(
                `mkdir -p ${workdir}/app`,
                undefined,
                undefined,
                30,
            );

            // ── 3. Upload project files ───────────────────────────────────────
            await sandbox.fs.uploadFiles([
                {
                    source: Buffer.from(NEXTJS_PACKAGE_JSON),
                    destination: `${workdir}/package.json`,
                },
                {
                    source: Buffer.from(NEXTJS_CONFIG),
                    destination: `${workdir}/next.config.js`,
                },
                {
                    source: Buffer.from(NEXTJS_TSCONFIG),
                    destination: `${workdir}/tsconfig.json`,
                },
                {
                    source: Buffer.from(NEXTJS_LAYOUT),
                    destination: `${workdir}/app/layout.tsx`,
                },
                {
                    source: Buffer.from(NEXTJS_PAGE),
                    destination: `${workdir}/app/page.tsx`,
                },
                {
                    source: Buffer.from(NEXTJS_GLOBALS_CSS),
                    destination: `${workdir}/app/globals.css`,
                },
            ]);

            // ── 4. Install dependencies ───────────────────────────────────────
            // Optimized flags to reduce disk/network overhead
            const installResult = await sandbox.process.executeCommand(
                `cd ${workdir} && npm install --prefer-offline --no-audit --no-fund 2>&1 | tail -10`,
                undefined,
                undefined,
                300, // 5 min
            );

            return {
                sandboxId: sandbox.id,
                workdir,
                installOutput: installResult.result ?? '',
            };
        }),

    /**
     * Start the Next.js dev server inside an already-bootstrapped sandbox.
     * Polls until server is ready, then returns preview URL + token.
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
            const client = getDaytonaClient();
            const sandbox = await client.get(input.sandboxId);
            const { workdir, port } = input;

            // Kill any previous instance and start fresh in background
            await sandbox.process.executeCommand(
                `pkill -f "next dev" 2>/dev/null; sleep 1; cd ${workdir} && nohup npm run dev -- --hostname 0.0.0.0 -p ${port} > /tmp/next-dev.log 2>&1 &`,
                undefined,
                undefined,
                15,
            );

            // Poll until the dev server is responding (up to ~60s)
            const readyResult = await sandbox.process.executeCommand(
                `for i in $(seq 1 30); do curl -sf http://localhost:${port} > /dev/null 2>&1 && echo ready && exit 0; sleep 2; done; echo timeout`,
                undefined,
                undefined,
                75,
            );

            const isReady = (readyResult.result ?? '').trim() === 'ready';

            // Get preview URL
            const previewInfo = await sandbox.getPreviewLink(port);

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
        },
        dependencies: {
            next: '15.2.4',
            react: '^19',
            'react-dom': '^19',
        },
        devDependencies: {
            '@types/node': '^20',
            '@types/react': '^19',
            '@types/react-dom': '^19',
            typescript: '^5',
        },
    },
    null,
    2,
);

const NEXTJS_CONFIG = `/** @type {import('next').NextConfig} */
const nextConfig = {};
module.exports = nextConfig;
`;

const NEXTJS_TSCONFIG = JSON.stringify(
    {
        compilerOptions: {
            lib: ['dom', 'dom.iterable', 'esnext'],
            allowJs: true,
            skipLibCheck: true,
            strict: true,
            noEmit: true,
            esModuleInterop: true,
            module: 'esnext',
            moduleResolution: 'bundler',
            resolveJsonModule: true,
            isolatedModules: true,
            jsx: 'preserve',
            incremental: true,
            plugins: [{ name: 'next' }],
            paths: { '@/*': ['./*'] },
        },
        include: ['next-env.d.ts', '**/*.ts', '**/*.tsx', '.next/types/**/*.ts'],
        exclude: ['node_modules'],
    },
    null,
    2,
);

const NEXTJS_LAYOUT = `import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Next.js on Daytona',
  description: 'A Next.js app running inside a Daytona sandbox',
};

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
    <main className="container">
      <div className="hero">
        <div className="badge">⚡ Running on Daytona</div>
        <h1 className="title">
          Next<span className="accent">.js</span> Sandbox
        </h1>
        <p className="subtitle">
          A fresh Next.js project running live inside an isolated Daytona sandbox.
        </p>
        <div className="cards">
          <div className="card">
            <span className="card-icon">🏗️</span>
            <div>
              <strong>Framework</strong>
              <p>Next.js 15 · App Router · TypeScript</p>
            </div>
          </div>
          <div className="card">
            <span className="card-icon">📦</span>
            <div>
              <strong>Runtime</strong>
              <p>Node.js · Daytona Sandbox</p>
            </div>
          </div>
          <div className="card">
            <span className="card-icon">🚀</span>
            <div>
              <strong>Provisioned by</strong>
              <p>Onlook · Daytona SDK</p>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
`;

const NEXTJS_GLOBALS_CSS = `*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: system-ui, -apple-system, sans-serif;
  background: #0a0a0f;
  color: #e2e8f0;
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
}

.container { width: 100%; max-width: 780px; padding: 2rem; }

.hero { text-align: center; }

.badge {
  display: inline-block;
  padding: 6px 16px;
  background: rgba(99,102,241,0.15);
  border: 1px solid rgba(99,102,241,0.35);
  border-radius: 20px;
  font-size: 0.85rem;
  color: #818cf8;
  margin-bottom: 1.5rem;
}

.title {
  font-size: clamp(2.5rem, 8vw, 4rem);
  font-weight: 800;
  letter-spacing: -0.03em;
  color: #f1f5f9;
  margin-bottom: 1rem;
}

.accent {
  background: linear-gradient(135deg, #6366f1, #c084fc);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}

.subtitle {
  color: #64748b;
  font-size: 1.15rem;
  max-width: 480px;
  margin: 0 auto 2.5rem;
  line-height: 1.6;
}

.cards {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.card {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 16px 20px;
  background: rgba(255,255,255,0.03);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 12px;
  text-align: left;
}

.card-icon { font-size: 1.6rem; flex-shrink: 0; }

.card strong { display: block; color: #f1f5f9; font-size: 0.95rem; margin-bottom: 2px; }

.card p { color: #64748b; font-size: 0.85rem; }
`;
