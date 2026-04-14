/**
 * daytona-helper.ts
 *
 * Server-side utilities for creating and bootstrapping Daytona sandboxes.
 * Used by project/branch creation endpoints so that ALL new sandboxes go
 * through Daytona instead of CodeSandbox.
 *
 * Never import the Daytona SDK from browser-side code. These functions
 * run exclusively in the Next.js API route / TRPC context.
 */

import { Daytona, type CreateSandboxFromSnapshotParams } from '@daytonaio/sdk';
import { TRPCError } from '@trpc/server';

// ---------------------------------------------------------------------------
// Client factory
// ---------------------------------------------------------------------------

export function getDaytonaClient(): Daytona {
    const apiKey = process.env.SANDBOX_DAYTONA_API_KEY;
    if (!apiKey) {
        throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'SANDBOX_DAYTONA_API_KEY is not configured',
        });
    }
    return new Daytona({ apiKey });
}

// ---------------------------------------------------------------------------
// Next.js starter templates embedded directly so no file-system reads needed
// ---------------------------------------------------------------------------

const NEXTJS_PACKAGE_JSON = JSON.stringify(
    {
        name: 'onlook-project',
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
  title: 'Onlook Project',
  description: 'A project created with Onlook',
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
    <main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ textAlign: 'center' }}>
        <h1 style={{ fontSize: '3rem', fontWeight: 800, marginBottom: '1rem' }}>Hello World</h1>
        <p style={{ color: '#64748b', fontSize: '1.2rem' }}>Edit <code>app/page.tsx</code> to get started.</p>
      </div>
    </main>
  );
}
`;

const NEXTJS_GLOBALS_CSS = `*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: system-ui, -apple-system, sans-serif; }
`;

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export interface DaytonaCreateResult {
    /** The Daytona sandbox UUID */
    sandboxId: string;
    /**
     * Full preview URL for port 3000.
     * May be null if `getPreviewLink` is unavailable on the server.
     */
    previewUrl: string | null;
    /** Short-lived auth token (if any) returned by getPreviewLink */
    previewToken: string | null;
}

// ---------------------------------------------------------------------------
// Core helper: create sandbox + bootstrap Next.js project
// ---------------------------------------------------------------------------

/**
 * Creates a brand-new Daytona sandbox, uploads a minimal Next.js starter,
 * installs dependencies, and returns the sandbox ID + preview URL.
 *
 * This replaces every `CodesandboxProvider.createProject(...)` call in the
 * project/branch routers.
 *
 * @param title     Human-readable project/branch title (stored on the sandbox as label)
 * @param workdir   Directory inside the sandbox to put project files (default `/tmp/nextapp`)
 */
export async function createDaytonaSandbox(
    title?: string,
    workdir = '/tmp/nextapp',
): Promise<DaytonaCreateResult> {
    const client = getDaytonaClient();

    // 1. Create sandbox
    const params: CreateSandboxFromSnapshotParams = {
        language: 'typescript',
        autoStopInterval: 120,      // stop after 2h inactivity
        autoArchiveInterval: 10080, // archive after 7 days of being stopped
        autoDeleteInterval: 0,      // never auto-delete
        ephemeral: false,
        public: true,
        ...(title ? { labels: { title } } : {}),
    };
    const sandbox = await client.create(params, { timeout: 120 });

    // 2. Create directory structure
    await sandbox.process.executeCommand(`mkdir -p ${workdir}/app`, undefined, undefined, 30);

    // 3. Upload project files
    await sandbox.fs.uploadFiles([
        { source: Buffer.from(NEXTJS_PACKAGE_JSON), destination: `${workdir}/package.json` },
        { source: Buffer.from(NEXTJS_CONFIG),       destination: `${workdir}/next.config.js` },
        { source: Buffer.from(NEXTJS_TSCONFIG),     destination: `${workdir}/tsconfig.json` },
        { source: Buffer.from(NEXTJS_LAYOUT),       destination: `${workdir}/app/layout.tsx` },
        { source: Buffer.from(NEXTJS_PAGE),          destination: `${workdir}/app/page.tsx` },
        { source: Buffer.from(NEXTJS_GLOBALS_CSS),   destination: `${workdir}/app/globals.css` },
    ]);

    // 4. Install dependencies (background, non-blocking — dev server starts on session open)
    //    We run in the background so the create call returns quickly.
    await sandbox.process.executeCommand(
        `cd ${workdir} && npm install --prefer-offline --no-audit --no-fund > /tmp/npm-install.log 2>&1 &`,
        undefined,
        undefined,
        15,
    );

    // 5. Get preview URL (port 3000)
    let previewUrl: string | null = null;
    let previewToken: string | null = null;
    try {
        const previewInfo = await sandbox.getPreviewLink(3000);
        previewUrl = previewInfo?.url ?? null;
        previewToken = previewInfo?.token ?? null;
    } catch {
        // Preview link may not be available immediately — callers handle null gracefully
        console.warn(`[Daytona] Could not get preview URL for sandbox ${sandbox.id}`);
    }

    return {
        sandboxId: sandbox.id,
        previewUrl,
        previewToken,
    };
}

// ---------------------------------------------------------------------------
// Helper: create sandbox from a GitHub repo via git clone
// ---------------------------------------------------------------------------

/**
 * Creates a Daytona sandbox and clones a GitHub repository into it.
 */
export async function createDaytonaSandboxFromGit(
    repoUrl: string,
    branch = 'main',
    workdir = '/tmp/nextapp',
): Promise<DaytonaCreateResult> {
    const client = getDaytonaClient();

    const params: CreateSandboxFromSnapshotParams = {
        language: 'typescript',
        autoStopInterval: 120,
        autoArchiveInterval: 10080,
        autoDeleteInterval: 0,
        ephemeral: false,
        public: true,
    };
    const sandbox = await client.create(params, { timeout: 120 });

    // Clone the repo
    await sandbox.process.executeCommand(
        `git clone --branch ${branch} --single-branch ${repoUrl} ${workdir} 2>&1 || git clone ${repoUrl} ${workdir} 2>&1`,
        undefined,
        undefined,
        120,
    );

    // Install dependencies in the background
    await sandbox.process.executeCommand(
        `cd ${workdir} && npm install --prefer-offline --no-audit --no-fund > /tmp/npm-install.log 2>&1 &`,
        undefined,
        undefined,
        15,
    );

    let previewUrl: string | null = null;
    let previewToken: string | null = null;
    try {
        const previewInfo = await sandbox.getPreviewLink(3000);
        previewUrl = previewInfo?.url ?? null;
        previewToken = previewInfo?.token ?? null;
    } catch {
        console.warn(`[Daytona] Could not get preview URL for sandbox ${sandbox.id}`);
    }

    return {
        sandboxId: sandbox.id,
        previewUrl,
        previewToken,
    };
}

// ---------------------------------------------------------------------------
// Helper: clone/copy an existing Daytona sandbox's source into a new sandbox
// (Used when "forking" a branch — we copy the working directory via git bundle)
// ---------------------------------------------------------------------------

/**
 * Creates a new Daytona sandbox whose contents are initialised from the files
 * in an existing sandbox.
 *
 * Implementation strategy: run `git bundle` in the source sandbox to create a
 * portable archive, then transfer it to the target sandbox and restore it.
 * Falls back to a fresh bootstrap if the source sandbox is unavailable.
 */
export async function forkDaytonaSandbox(
    sourceSandboxId: string,
    title?: string,
    workdir = '/tmp/nextapp',
): Promise<DaytonaCreateResult> {
    const client = getDaytonaClient();

    // 1. Create the new (empty) target sandbox
    const params: CreateSandboxFromSnapshotParams = {
        language: 'typescript',
        autoStopInterval: 120,
        autoArchiveInterval: 10080,
        autoDeleteInterval: 0,
        ephemeral: false,
        public: true,
        ...(title ? { labels: { title } } : {}),
    };
    const targetSandbox = await client.create(params, { timeout: 120 });

    try {
        // 2. Create a git bundle of the source sandbox's workdir
        const sourceSandbox = await client.get(sourceSandboxId);

        // Init git in source if not already a repo, then bundle
        const bundlePath = '/tmp/onlook-fork.bundle';
        await sourceSandbox.process.executeCommand(
            `cd ${workdir} && git init -q 2>/dev/null; git add -A 2>/dev/null; git commit -m "snapshot" 2>/dev/null || true; git bundle create ${bundlePath} HEAD 2>/dev/null`,
            undefined,
            undefined,
            60,
        );

        // 3. Download the bundle from source
        const bundleResult = await sourceSandbox.process.executeCommand(
            `base64 -w0 ${bundlePath} 2>/dev/null || echo ""`,
            undefined,
            undefined,
            30,
        );
        const bundleBase64 = (bundleResult.result ?? '').trim();

        if (bundleBase64) {
            // 4. Upload bundle to target and restore
            const bundleBuffer = Buffer.from(bundleBase64, 'base64');
            await targetSandbox.fs.uploadFiles([
                { source: bundleBuffer, destination: bundlePath },
            ]);
            await targetSandbox.process.executeCommand(
                `mkdir -p ${workdir} && cd ${workdir} && git clone ${bundlePath} . 2>/dev/null || git pull ${bundlePath} HEAD 2>/dev/null`,
                undefined,
                undefined,
                60,
            );
            await targetSandbox.process.executeCommand(
                `cd ${workdir} && npm install --prefer-offline --no-audit --no-fund > /tmp/npm-install.log 2>&1 &`,
                undefined,
                undefined,
                15,
            );
        } else {
            // Fallback: fresh bootstrap if bundle failed
            await bootstrapFreshInSandbox(targetSandbox, workdir);
        }
    } catch (err) {
        console.warn(`[Daytona] Fork from source ${sourceSandboxId} failed, bootstrapping fresh:`, err);
        // Fallback: fresh Next.js bootstrap
        const freshSandbox = await client.get(targetSandbox.id);
        await bootstrapFreshInSandbox(freshSandbox as any, workdir);
    }

    let previewUrl: string | null = null;
    let previewToken: string | null = null;
    try {
        const previewInfo = await targetSandbox.getPreviewLink(3000);
        previewUrl = previewInfo?.url ?? null;
        previewToken = previewInfo?.token ?? null;
    } catch {
        console.warn(`[Daytona] Could not get preview URL for sandbox ${targetSandbox.id}`);
    }

    return {
        sandboxId: targetSandbox.id,
        previewUrl,
        previewToken,
    };
}

// ---------------------------------------------------------------------------
// Internal bootstrap helper
// ---------------------------------------------------------------------------

async function bootstrapFreshInSandbox(sandbox: any, workdir: string): Promise<void> {
    await sandbox.process.executeCommand(`mkdir -p ${workdir}/app`, undefined, undefined, 30);
    await sandbox.fs.uploadFiles([
        { source: Buffer.from(NEXTJS_PACKAGE_JSON), destination: `${workdir}/package.json` },
        { source: Buffer.from(NEXTJS_CONFIG),       destination: `${workdir}/next.config.js` },
        { source: Buffer.from(NEXTJS_TSCONFIG),     destination: `${workdir}/tsconfig.json` },
        { source: Buffer.from(NEXTJS_LAYOUT),       destination: `${workdir}/app/layout.tsx` },
        { source: Buffer.from(NEXTJS_PAGE),          destination: `${workdir}/app/page.tsx` },
        { source: Buffer.from(NEXTJS_GLOBALS_CSS),   destination: `${workdir}/app/globals.css` },
    ]);
    await sandbox.process.executeCommand(
        `cd ${workdir} && npm install --prefer-offline --no-audit --no-fund > /tmp/npm-install.log 2>&1 &`,
        undefined,
        undefined,
        15,
    );
}
