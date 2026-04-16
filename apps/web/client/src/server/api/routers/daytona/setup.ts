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
                    console.log(`[Daytona Setup] Post-install: shadcn baseline setup...`);
                    // Create base shadcn files to avoid interactive init
                    const shadcnFiles = {
                        'components.json': JSON.stringify({
                            "$schema": "https://ui.shadcn.com/schema.json",
                            "style": "new-york",
                            "rsc": true,
                            "tsx": true,
                            "tailwind": {
                                "config": "tailwind.config.js",
                                "css": "app/globals.css",
                                "baseColor": "slate",
                                "cssVariables": true,
                                "prefix": ""
                            },
                            "aliases": {
                                "components": "@/components",
                                "utils": "@/lib/utils",
                                "ui": "@/components/ui",
                                "lib": "@/lib",
                                "hooks": "@/hooks"
                            }
                        }, null, 2),
                        'lib/utils.ts': `import { type ClassValue, clsx } from 'clsx';\nimport { twMerge } from 'tailwind-merge';\n\nexport function cn(...inputs: ClassValue[]) {\n  return twMerge(clsx(inputs));\n}`,
                    };

                    for (const [path, content] of Object.entries(shadcnFiles)) {
                        await provider.writeFile({ args: { path: `${workdir}/${path}`, content } });
                    }
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
    }
    
    // Inject tRPC / oRPC boilerplate if selected
    if (libraries.includes('trpc') || libraries.includes('orpc')) {
        files['server/api.ts'] = `// [Boilerplate] Minimal API router\nexport const router = {\n  hello: async () => "World"\n};`;
        files['lib/api-client.ts'] = `// [Boilerplate] Minimal Client\nexport const api = {\n  hello: async () => "World"\n};`;
    }

    return files;

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

    const files: Record<string, string> = {
        'package.json': JSON.stringify(pkg, null, 2),
        'next.config.js': `/** @type {import('next').NextConfig} */\nmodule.exports = { reactStrictMode: true };`,
        'postcss.config.mjs': `export default {\n  plugins: {\n    '@tailwindcss/postcss': {},\n  },\n};`,
        'tsconfig.json': `{\n  "compilerOptions": {\n    "target": "es5",\n    "lib": ["dom", "dom.iterable", "esnext"],\n    "allowJs": true,\n    "skipLibCheck": true,\n    "strict": true,\n    "noEmit": true,\n    "esModuleInterop": true,\n    "module": "esnext",\n    "moduleResolution": "bundler",\n    "resolveJsonModule": true,\n    "isolatedModules": true,\n    "jsx": "preserve",\n    "incremental": true,\n    "plugins": [{ "name": "next" }],\n    "paths": { "@/*": ["./*"] }\n  },\n  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],\n  "exclude": ["node_modules"]\n}`,
        'app/layout.tsx': `import './globals.css';\nimport { Inter } from 'next/font/google';\n${libraries.includes('heroui') ? "import { HeroUIProvider } from '@heroui/react';" : ""}\nconst inter = Inter({ subsets: ['latin'] });\nexport default function RootLayout({ children }: { children: React.ReactNode }) {\n  return (<html lang="en"><body>${libraries.includes('heroui') ? "<HeroUIProvider>" : ""}<main className={inter.className}>{children}</main>${libraries.includes('heroui') ? "</HeroUIProvider>" : ""}</body></html>);\n}`,
        'app/page.tsx': getStarterPage('next', libraries),
        'app/globals.css': `@import "tailwindcss";\n${libraries.includes('daisyui') ? '@import "daisyui";' : ""}\n\n@theme {\n  --color-background: #ffffff;\n  --color-foreground: #0f172a;\n}\n\nbody { background: var(--color-background); color: var(--color-foreground); }`,
    };

    if (libraries.includes('shadcn')) {
        files['components/ui/button.tsx'] = `import * as React from "react";\nimport { Slot } from "@radix-ui/react-slot";\nimport { cva, type VariantProps } from "class-variance-authority";\nimport { cn } from "@/lib/utils";\n\nconst buttonVariants = cva(\n  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",\n  {\n    variants: {\n      variant: {\n        default: "bg-primary text-primary-foreground shadow hover:bg-primary/90",\n        destructive: "bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90",\n        outline: "border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground",\n        secondary: "bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/80",\n        ghost: "hover:bg-accent hover:text-accent-foreground",\n        link: "text-primary underline-offset-4 hover:underline",\n      },\n      size: {\n        default: "h-9 px-4 py-2",\n        sm: "h-8 rounded-md px-3 text-xs",\n        lg: "h-10 rounded-md px-8",\n        icon: "h-9 w-9",\n      },\n    },\n    defaultVariants: {\n      variant: "default",\n      size: "default",\n    },\n  }\n);\n\nexport interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {\n  asChild?: boolean;\n}\n\nconst Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, asChild = false, ...props }, ref) => {\n  const Comp = asChild ? Slot : "button";\n  return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;\n});\nButton.displayName = "Button";\nexport { Button, buttonVariants };`;
        files['lib/utils.ts'] = `import { clsx, type ClassValue } from "clsx";\nimport { twMerge } from "tailwind-merge";\n\nexport function cn(...inputs: ClassValue[]) {\n  return twMerge(clsx(inputs));\n}`;
        files['components.json'] = `{\n  "$schema": "https://ui.shadcn.com/schema.json",\n  "style": "new-york",\n  "rsc": true,\n  "tsx": true,\n  "tailwind": {\n    "config": "tailwind.config.js",\n    "css": "app/globals.css",\n    "baseColor": "zinc",\n    "cssVariables": true,\n    "prefix": ""\n  },\n  "aliases": {\n    "components": "@/components",\n    "utils": "@/lib/utils"\n  }\n}`;

        // Add dependencies for shadcn
        const p = JSON.parse(files['package.json']);
        p.dependencies["class-variance-authority"] = "^0.7.1";
        p.dependencies["@radix-ui/react-slot"] = "^1.1.0";
        p.dependencies["clsx"] = "^2.1.1";
        p.dependencies["tailwind-merge"] = "^2.5.2";
        files['package.json'] = JSON.stringify(p, null, 2);
    }

    return files;
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
        'app.vue': `<script setup>
import { onMounted, ref } from 'vue';
import gsap from 'gsap';

const container = ref(null);
const title = ref(null);
const sub = ref(null);
const info = ref(null);

onMounted(() => {
  const tl = gsap.timeline({ defaults: { ease: 'power3.out', duration: 1 } });
  tl.fromTo(container.value, { opacity: 0 }, { opacity: 1, duration: 1.5 })
    .fromTo(title.value, { y: 20, opacity: 0 }, { y: 0, opacity: 1 }, 0.3)
    .fromTo(sub.value, { y: 15, opacity: 0 }, { y: 0, opacity: 1 }, 0.5)
    .fromTo(info.value, { y: 10, opacity: 0 }, { y: 0, opacity: 1 }, 0.7);
});
</script>

<template>
  <main ref="container" class="min-h-screen flex items-center justify-center bg-[#fafafa] font-sans text-slate-900">
    <div class="max-w-xl w-full px-8 text-center">
      <h1 ref="title" class="text-5xl font-bold tracking-tight mb-4">
        This is a new project.
      </h1>
      <p ref="sub" class="text-slate-400 text-lg mb-12">
        Edit <code class="text-slate-900 font-medium">app.vue</code> to get started.
      </p>
      
      <div ref="info" class="pt-8 border-t border-slate-100 flex flex-col items-center gap-2 text-[11px] uppercase tracking-widest font-bold text-slate-300">
        <span>Framework: Nuxt.js</span>
        <span class="opacity-40">Libraries: ${libraries.join(', ') || 'Standard Bundle'}</span>
      </div>
    </div>
  </main>
</template>`,
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
        'app/routes/_index.tsx': getStarterPage('remix', libraries),
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
        'src/routes/+page.svelte': `<script>
import { onMount } from 'svelte';
import gsap from 'gsap';

let container;
let title;
let sub;
let info;

onMount(() => {
  const tl = gsap.timeline({ defaults: { ease: 'power3.out', duration: 1 } });
  tl.fromTo(container, { opacity: 0 }, { opacity: 1, duration: 1.5 })
    .fromTo(title, { y: 20, opacity: 0 }, { y: 0, opacity: 1 }, 0.3)
    .fromTo(sub, { y: 15, opacity: 0 }, { y: 0, opacity: 1 }, 0.5)
    .fromTo(info, { y: 10, opacity: 0 }, { y: 0, opacity: 1 }, 0.7);
});
</script>

<main bind:this={container} class="min-h-screen flex items-center justify-center bg-[#fafafa] font-sans text-slate-900">
  <div class="max-w-xl w-full px-8 text-center">
    <h1 bind:this={title} class="text-5xl font-bold tracking-tight mb-4">
      This is a new project.
    </h1>
    <p bind:this={sub} class="text-slate-400 text-lg mb-12">
      Edit <code class="text-slate-900 font-medium">src/routes/+page.svelte</code> to build.
    </p>
    
    <div bind:this={info} class="pt-8 border-t border-slate-100 flex flex-col items-center gap-2 text-[11px] uppercase tracking-widest font-bold text-slate-300">
      <span>Framework: SvelteKit</span>
      <span class="opacity-40">Libraries: ${libraries.join(', ') || 'Standard Bundle'}</span>
    </div>
  </div>
</main>`,
        'src/app.html': `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8" /><link rel="icon" href="%sveltekit.assets%/favicon.png" /><meta name="viewport" content="width=device-width" />%sveltekit.head%</head><body><div style="display: contents">%sveltekit.body%</div></body></html>`,
    };
}

function getStarterPage(framework: string, libraries: string[]) {
    return `'use client';
import { useEffect, useRef } from 'react';
import gsap from 'gsap';

export default function Home() {
  const containerRef = useRef(null);
  const titleRef = useRef(null);
  const subRef = useRef(null);
  const infoRef = useRef(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      const tl = gsap.timeline({ defaults: { ease: 'power3.out', duration: 1 } });
      tl.fromTo(containerRef.current, { opacity: 0 }, { opacity: 1, duration: 1.5 })
        .fromTo(titleRef.current, { y: 20, opacity: 0 }, { y: 0, opacity: 1 }, 0.3)
        .fromTo(subRef.current, { y: 15, opacity: 0 }, { y: 0, opacity: 1 }, 0.5)
        .fromTo(infoRef.current, { y: 10, opacity: 0 }, { y: 0, opacity: 1 }, 0.7);
    });
    return () => ctx.revert();
  }, []);

  return (
    <main 
      ref={containerRef}
      className="min-h-screen flex items-center justify-center bg-[#fafafa] font-sans text-slate-900"
    >
      <div className="max-w-xl w-full px-8 text-center">
        <h1 
          ref={titleRef}
          className="text-5xl font-bold tracking-tight mb-4"
        >
          This is a new project.
        </h1>
        
        <p ref={subRef} className="text-slate-400 text-lg mb-12 font-medium">
          Edit <code className="text-slate-900">app/page.tsx</code> to start building.
        </p>

        <div ref={infoRef} className="pt-8 border-t border-slate-100 flex flex-col items-center gap-2 text-[11px] uppercase tracking-[0.2em] font-black text-slate-300">
           <span>Framework: ${framework.toUpperCase()}</span>
           <span class="opacity-40">Libraries: ${libraries.join(', ') || 'Standard Bundle'}</span>
        </div>
      </div>
    </main>
  );
}
`;
}
