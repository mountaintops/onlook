import { CodeProvider, createCodeProviderClient, DaytonaProvider } from '@onlook/code-provider';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { createTRPCRouter, publicProcedure } from '../../trpc';

export const setupRouter = createTRPCRouter({
    /**
     * Bootstrap a project with a specific framework and tech stack.
     */
    bootstrapProject: publicProcedure
        .input(
            z.object({
                sandboxId: z.string().optional(),
                framework: z.enum(['next', 'nuxt', 'remix', 'sveltekit']).default('next'),
                libraries: z.array(z.string()).default([]),
                workdir: z.string().default('/home/daytona/onlook-starter'),
                autoStopInterval: z.number().default(10),
                autoArchiveInterval: z.number().optional(),
                subdomain: z.string().optional(),
            }),
        )
        .mutation(async ({ input }) => {
            let sandboxId = input.sandboxId;
            try {
                if (!sandboxId) {
                    console.log(`[Daytona Setup] Creating new sandbox for ${input.framework}...`);
                    const result = await DaytonaProvider.createProject({
                        source: 'typescript',
                        id: '',
                        labels: input.subdomain ? { 'onlook:subdomain': input.subdomain } : undefined,
                    });
                    sandboxId = result.id;
                    console.log(`[Daytona Setup] Created sandbox: ${sandboxId}`);
                }

                const provider = (await createCodeProviderClient(CodeProvider.Daytona, {
                    providerOptions: { daytona: { sandboxId } },
                })) as DaytonaProvider;

                const workdir = input.workdir;
                console.log(`[Daytona Setup] Bootstrapping ${input.framework} project in ${workdir} (Sandbox: ${sandboxId})`);

                // ── 0. Wait for Agent Readiness ──────────────────────────────────
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
                const appDir = input.framework === 'next' ? 'app' : (input.framework === 'sveltekit' ? 'src/routes' : 'app');
                await provider.runCommand({ args: { command: `mkdir -p ${workdir}/${appDir}` } });

                // ── 2. Prepare Tech Stack ─────────────────────────────────────────
                const techStack = {
                    framework: input.framework,
                    libraries: ['Tailwind CSS', 'Lucide Icons', 'GSAP', ...input.libraries],
                    timestamp: new Date().toISOString(),
                };

                // ── 3. Write Files ───────────────────────────────────────────────
                console.log(`[Daytona Setup] Writing configuration files...`);
                
                // Get framework-specific files
                const files = getFrameworkFiles(input.framework, input.libraries);
                for (const [path, content] of Object.entries(files)) {
                    const fullPath = path.startsWith('/') ? path : `${workdir}/${path}`;
                    await provider.writeFile({ args: { path: fullPath, content: content as string } });
                }

                // Write TECH_STACK.txt
                const techStackContent = generateTechStackTxt(techStack);
                await provider.writeFile({ args: { path: `${workdir}/TECH_STACK.txt`, content: techStackContent } });

                // ── 4. Install dependencies ───────────────────────────────────────
                console.log(`[Daytona Setup] Checking memory...`);
                await provider.runCommand({ args: { command: `free -m` } });

                console.log(`[Daytona Setup] Running bun install...`);
                // Use a hint to limit RAM usage to prevent OOM
                const installCmd = `cd ${workdir} && BUN_JSC_forceRAMSize=536870912 bun install --no-save 2>&1`;
                const { output, exitCode } = await provider.runCommand({
                    args: { 
                        command: installCmd,
                        timeout: 300, 
                    },
                });

                if (exitCode !== 0) {
                    console.warn(`[Daytona Setup] bun install failed (Exit ${exitCode})`);
                    
                    // Fallback for OOM (137) or other resolution failures
                    if (exitCode === 137 || exitCode === 1 || output.includes('Out of memory')) {
                        console.log(`[Daytona Setup] Memory issues detected. Initializing fallback to npm...`);
                        const fallbackRes = await provider.runCommand({
                            args: {
                                command: `cd ${workdir} && npm install --prefer-offline --no-audit --no-fund 2>&1`,
                                timeout: 420
                            }
                        });
                        
                        if (fallbackRes.exitCode !== 0) {
                            throw new Error(`Bootstrap failed: Both bun and npm failed. npm output: ${fallbackRes.output.slice(-500)}`);
                        }
                        console.log(`[Daytona Setup] Fallback successful. Continuing...`);
                    } else {
                        throw new Error(`bun install failed (Exit ${exitCode}). Output: ${output.slice(-500)}`);
                    }
                }

                // ── 5. Run post-install for optional libs ──────────────────────────
                if (input.libraries.includes('shadcn')) {
                    console.log(`[Daytona Setup] Post-install: shadcn init...`);
                    // We'll skip the interactive init and just provide the required components.json
                }

                console.log(`[Daytona Setup] Project bootstrapped successfully!`);
                return {
                    success: true,
                    sandboxId,
                    workdir,
                    framework: input.framework,
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
     * Start the development server (auto-detects framework).
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

            // Detect framework command
            let devCommand = 'bun run dev';
            
            // Cleanup previous instances
            await provider.runCommand({
                args: { command: `pkill -9 -f "node" 2>/dev/null; pkill -9 -f "next" 2>/dev/null; pkill -9 -f "nuxt" 2>/dev/null; sleep 1` },
            });

            await provider.runCommand({
                args: { command: `cd ${workdir} && nohup ${devCommand} -- --hostname 0.0.0.0 -p ${port} > /tmp/dev.log 2>&1 &` },
            });
            
            const { output: readyOutput } = await provider.runCommand({
                args: { 
                    command: `for i in $(seq 1 15); do curl -sf http://localhost:${port} > /dev/null 2>&1 && echo ready && exit 0; sleep 2; done; echo timeout`,
                    timeout: 40
                },
            });

            const isReady = readyOutput.trim() === 'ready';
            const previewInfo = await provider.getPreviewLink(port);

            return {
                ready: isReady,
                previewUrl: previewInfo?.url ?? null,
                token: previewInfo?.token ?? null,
            };
        }),
});

// ── Helper Functions ────────────────────────────────────────────────────────

function generateTechStackTxt(stack: any) {
    return `
========================================
🚀 ONLOOK TECH STACK MANIFEST
========================================
Generated: ${new Date().toLocaleString()}

FRAMEWORK: ${stack.framework.toUpperCase()}
LIBRARIES:
${stack.libraries.map((lib: string) => ` - ${lib}`).join('\n')}

----------------------------------------
✨ Features Included:
 - Tailwind CSS (Styling)
 - Lucide Icons (Visuals)
 - GSAP (Animations)
${stack.libraries.includes('shadcn') ? ' - shadcn/ui (Components)' : ''}
${stack.libraries.includes('heroui') ? ' - HeroUI (Components)' : ''}
${stack.libraries.includes('daisyui') ? ' - daisyUI (Theming)' : ''}
${stack.libraries.includes('trpc') ? ' - tRPC (API Layer)' : ''}
${stack.libraries.includes('orpc') ? ' - oRPC (API Layer)' : ''}

Enjoy your new project!
========================================
`;
}

function getFrameworkFiles(framework: string, libraries: string[]) {
    // Shared dependencies
    const baseDeps = {
        "tailwindcss": "^4.0.0",
        "@tailwindcss/postcss": "^4.0.0",
        "postcss": "^8.4.0",
        "lucide-react": "^0.473.0",
        "gsap": "^3.12.5",
        "clsx": "^2.1.1",
        "tailwind-merge": "^2.5.2"
    };

    if (libraries.includes('heroui')) (baseDeps as any)["@heroui/react"] = "latest";
    if (libraries.includes('daisyui')) (baseDeps as any)["daisyui"] = "latest";
    if (libraries.includes('trpc')) (baseDeps as any)["@trpc/server"] = "latest";

    switch (framework) {
        case 'next':
            return getNextjsFiles(baseDeps, libraries);
        case 'nuxt':
            return getNuxtFiles(baseDeps, libraries);
        case 'remix':
            return getRemixFiles(baseDeps, libraries);
        case 'sveltekit':
            return getSvelteKitFiles(baseDeps, libraries);
        default:
            return getNextjsFiles(baseDeps, libraries);
    }
}

function getNextjsFiles(deps: any, libraries: string[]) {
    const pkg = {
        name: 'nextjs-onlook',
        version: '0.1.0',
        private: true,
        scripts: { dev: 'next dev', build: 'next build', start: 'next start' },
        dependencies: {
            "next": "15.1.4",
            "react": "^19",
            "react-dom": "^19",
            ...deps
        },
        devDependencies: {
            "typescript": "^5",
            "@types/node": "^20",
            "@types/react": "^19",
            "@types/react-dom": "^19",
            "postcss": "^8.4.31",
            "@tailwindcss/postcss": "^4.0.0"
        }
    };

    return {
        'package.json': JSON.stringify(pkg, null, 2),
        'next.config.js': `/** @type {import('next').NextConfig} */\nmodule.exports = { reactStrictMode: true };`,
        'postcss.config.mjs': `export default {\n  plugins: {\n    '@tailwindcss/postcss': {},\n  },\n};`,
        'tsconfig.json': `{\n  "compilerOptions": {\n    "target": "es5",\n    "lib": ["dom", "dom.iterable", "esnext"],\n    "allowJs": true,\n    "skipLibCheck": true,\n    "strict": true,\n    "noEmit": true,\n    "esModuleInterop": true,\n    "module": "esnext",\n    "moduleResolution": "bundler",\n    "resolveJsonModule": true,\n    "isolatedModules": true,\n    "jsx": "preserve",\n    "incremental": true,\n    "plugins": [{ "name": "next" }],\n    "paths": { "@/*": ["./*"] }\n  },\n  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],\n  "exclude": ["node_modules"]\n}`,
        'app/layout.tsx': `import './globals.css';\nimport { Inter } from 'next/font/google';\nconst inter = Inter({ subsets: ['latin'] });\nexport default function RootLayout({ children }: { children: React.ReactNode }) {\n  return (<html lang="en"><body className={inter.className}>{children}</body></html>);\n}`,
        'app/page.tsx': getStarterPage('next', libraries),
        'app/globals.css': `@import "tailwindcss";\nbody { background: #fafafa; }`,
    };
}

function getNuxtFiles(deps: any, libraries: string[]) {
    const pkg = {
        name: 'nuxt-onlook',
        scripts: { dev: 'nuxt dev', build: 'nuxt build', generate: 'nuxt generate' },
        devDependencies: { "nuxt": "^3.11.2", "@tailwindcss/vite": "^4.0.0", ...deps }
    };

    return {
        'package.json': JSON.stringify(pkg, null, 2),
        'nuxt.config.ts': `import tailwindcss from "@tailwindcss/vite";\nexport default defineNuxtConfig({\n  vite: {\n    plugins: [tailwindcss()],\n  },\n  css: ['~/assets/css/main.css'],\n  devtools: { enabled: true }\n})`,
        'assets/css/main.css': `@import "tailwindcss";`,
        'app.vue': `<template>\n  <div class="min-h-screen flex items-center justify-center bg-slate-50 font-sans">\n    <div class="p-12 max-w-2xl w-full bg-white/80 backdrop-blur-xl rounded-3xl border border-slate-200 shadow-xl text-center">\n      <h1 class="text-4xl font-extrabold text-slate-900 mb-4">Welcome to Nuxt</h1>\n      <p class="text-slate-600 text-lg">Your new project is ready in the sandbox.</p>\n    </div>\n  </div>\n</template>`,
    };
}

function getRemixFiles(deps: any, libraries: string[]) {
    const pkg = {
        name: 'remix-onlook',
        type: 'module',
        scripts: { dev: 'remix dev --manual', build: 'remix build', start: 'remix-serve ./build/index.js' },
        dependencies: {
            "@remix-run/node": "^2.8.1",
            "@remix-run/react": "^2.8.1",
            "@remix-run/serve": "^2.8.1",
            "isbot": "^4.1.0",
            "react": "^18.2.0",
            "react-dom": "^18.2.0",
            ...deps
        },
        devDependencies: { "@remix-run/dev": "^2.8.1", "vite": "^5.1.4", "typescript": "^5.4.2", "@tailwindcss/vite": "^4.0.0" }
    };

    return {
        'package.json': JSON.stringify(pkg, null, 2),
        'vite.config.ts': `import { vitePlugin as remix } from "@remix-run/dev";\nimport { defineConfig } from "vite";\nimport tailwindcss from "@tailwindcss/vite";\nexport default defineConfig({ plugins: [tailwindcss(), remix()] });`,
        'app/root.tsx': `import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "@remix-run/react";\nimport "./globals.css";\nexport default function App() {\n  return (<html><head><Meta /><Links /></head><body><Outlet /><ScrollRestoration /><Scripts /></body></html>);\n}`,
        'app/routes/_index.tsx': `export default function Index() {\n  return (<div className="p-10 font-sans"><h1>Welcome to Remix</h1></div>);\n}`,
        'app/globals.css': `@import "tailwindcss";`,
    };
}

function getSvelteKitFiles(deps: any, libraries: string[]) {
    const pkg = {
        name: 'sveltekit-onlook',
        type: 'module',
        scripts: { dev: 'vite dev', build: 'vite build', preview: 'vite preview' },
        devDependencies: { "@sveltejs/adapter-auto": "^3.0.0", "@sveltejs/kit": "^2.0.0", "svelte": "^4.2.7", "vite": "^5.0.3", "tailwindcss": "^4.0.0", "@tailwindcss/vite": "^4.0.0", ...deps }
    };

    return {
        'package.json': JSON.stringify(pkg, null, 2),
        'svelte.config.js': `import adapter from '@sveltejs/adapter-auto';\nexport default { kit: { adapter: adapter() } };`,
        'vite.config.js': `import { sveltekit } from '@sveltejs/kit/vite';\nimport tailwindcss from '@tailwindcss/vite';\nimport { defineConfig } from 'vite';\nexport default defineConfig({ plugins: [tailwindcss(), sveltekit()] });`,
        'src/routes/+page.svelte': `<h1 class="text-3xl font-bold p-10">Welcome to SvelteKit</h1>`,
        'src/app.html': `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8" /><link rel="icon" href="%sveltekit.assets%/favicon.png" /><meta name="viewport" content="width=device-width" />%sveltekit.head%</head><body><div style="display: contents">%sveltekit.body%</div></body></html>`,
    };
}

function getStarterPage(framework: string, libraries: string[]) {
    return `
import { Target, LucideIcon, Sparkles, Rocket, Zap, Package } from 'lucide-react';

export default function Home() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-[radial-gradient(circle_at_top_left,#f8fafc,#f1f5f9)] font-sans text-slate-900">
      <div className="p-12 max-w-2xl w-[90%] bg-white/80 backdrop-blur-xl rounded-[2rem] border border-white/40 shadow-[0_25px_50px_-12px_rgba(0,0,0,0.05)] text-center">
        <div className="inline-flex px-4 py-2 bg-blue-500/10 text-blue-600 rounded-full text-sm font-bold mb-6 tracking-wide uppercase">
          <Sparkles className="w-4 h-4 mr-2" />
          Stack Provisioned Successfully
        </div>
        
        <h1 className="text-5xl font-black tracking-tight mb-4 bg-gradient-to-br from-slate-900 to-slate-600 bg-clip-text text-transparent">
          Welcome to Onlook
        </h1>
        
        <p className="text-slate-500 text-xl leading-relaxed mb-10">
          This is a new project waiting for your vision. 
          Everything is ready for you to start building.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-left">
          <div className="p-5 bg-white rounded-2xl border border-slate-200 shadow-sm transition-all hover:shadow-md hover:border-blue-200 group">
            <Rocket className="w-6 h-6 text-blue-500 mb-3 group-hover:scale-110 transition-transform" />
            <h3 className="font-bold text-slate-800">Framework</h3>
            <p className="text-sm text-slate-500">Running on ${framework.toUpperCase()}</p>
          </div>
          
          <div className="p-5 bg-white rounded-2xl border border-slate-200 shadow-sm transition-all hover:shadow-md hover:border-purple-200 group">
            <Package className="w-6 h-6 text-purple-500 mb-3 group-hover:scale-110 transition-transform" />
            <h3 className="font-bold text-slate-800">Libraries</h3>
            <p className="text-sm text-slate-500">${libraries.length > 0 ? libraries.join(', ') : 'Standard Bundle'}</p>
          </div>
        </div>

        <div className="mt-10 pt-8 border-t border-slate-100 flex items-center justify-between text-slate-400 text-[10px] uppercase font-bold tracking-widest">
          <span>Tailwind 4.0 Enabled</span>
          <span>•</span>
          <span>GSAP Powered</span>
          <span>•</span>
          <span>Lucide Icons</span>
        </div>
      </div>
    </main>
  );
}
`;
}
