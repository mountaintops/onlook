'use client';

import React, { useState, useRef, useEffect } from 'react';
import { api } from '~/trpc/react';
import styles from './daytona-test.module.css';
import { DaytonaProvider } from '@onlook/code-provider';
import { CodeProvider } from '@onlook/code-provider';
import { createCodeProviderClient } from '@onlook/code-provider';

/**
 * BypassedIframe component handles fetching the preview content with the
 * required header to skip the Daytona preview warning page.
 */
function BypassedIframe({ url, title, className, allow, sandbox }: {
    url: string;
    title: string;
    className?: string;
    allow?: string;
    sandbox?: string;
}) {
    const [htmlContent, setHtmlContent] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!url) return;

        // If it's a proxy URL (localhost), we don't need the manual bypass 
        // because the proxy handles it.
        if (url.includes('localhost:')) {
            setHtmlContent(null);
            setError(null);
            setLoading(false);
            return;
        }

        let isMounted = true;
        const fetchContent = async () => {
            setLoading(true);
            setError(null);
            try {
                // Fetch the HTML content with the required header
                const response = await fetch(url, {
                    headers: {
                        'X-Daytona-Skip-Preview-Warning': 'true',
                    },
                });

                if (!response.ok) {
                    throw new Error(`Failed to fetch preview: ${response.status} ${response.statusText}`);
                }

                let html = await response.text();

                // Inject <base> tag so relative assets resolve correctly to the Daytona domain
                const baseTag = `<base href="${url}">`;
                if (html.includes('<head>')) {
                    html = html.replace('<head>', `<head>${baseTag}`);
                } else {
                    html = `${baseTag}${html}`;
                }

                if (isMounted) {
                    setHtmlContent(html);
                }
            } catch (err: any) {
                console.error('[Daytona Bypass] Fetch failed:', err);
                if (isMounted) {
                    setError(err.message);
                }
            } finally {
                if (isMounted) {
                    setLoading(false);
                }
            }
        };

        fetchContent();
        return () => { isMounted = false; };
    }, [url]);

    if (loading) {
        return (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#94a3b8' }}>
                <span style={{ marginRight: '8px' }}>🔄</span> Skipping warning page...
            </div>
        );
    }

    if (error) {
        return (
            <div style={{ padding: '20px', color: '#ef4444', textAlign: 'center' }}>
                <h3>⚠️ Bypass Failed</h3>
                <p style={{ fontSize: '0.8rem' }}>{error}</p>
                <a href={url} target="_blank" rel="noreferrer" style={{ color: '#3b82f6', textDecoration: 'underline' }}>Open directly</a>
            </div>
        );
    }

    // If htmlContent is null but we're not loading or in error, 
    // it's likely a proxy URL and we should just use src.
    if (!htmlContent && !loading && !error && url.includes('localhost:')) {
        return (
            <iframe
                src={url}
                className={className}
                title={title}
                allow={allow}
                sandbox={sandbox}
            />
        );
    }

    return (
        <iframe
            srcDoc={htmlContent || ''}
            className={className}
            title={title}
            allow={allow}
            sandbox={sandbox}
        />
    );
}

type Language = 'typescript' | 'javascript' | 'python';
type ActiveTab = 'bootstrap' | 'create' | 'list' | 'exec' | 'code' | 'snapshots';

interface SnapshotItem {
    id: string;
    name: string;
    state: string;
    imageName?: string | null;
    createdAt?: string | null;
    errorReason?: string | null;
    cpu?: number | null;
    memory?: number | null;
    disk?: number | null;
}

interface SandboxItem {
    id: string;
    state: string;
    createdAt?: string | null;
    updatedAt?: string | null;
    snapshot?: string | null;
    cpu?: number | null;
    memory?: number | null;
    disk?: number | null;
    labels?: Record<string, string>;
    autoStopInterval?: number | null;
    autoArchiveInterval?: number | null;
}

interface LogEntry {
    time: string;
    type: 'info' | 'success' | 'error' | 'cmd';
    message: string;
}

type BootstrapStep =
    | 'idle'
    | 'creating-sandbox'
    | 'uploading-files'
    | 'installing-deps'
    | 'starting-server'
    | 'ready'
    | 'error';

const BOOTSTRAP_STEPS: { key: BootstrapStep; label: string; desc: string }[] = [
    { key: 'creating-sandbox', label: 'Create Sandbox', desc: 'Provisioning a fresh Daytona environment' },
    { key: 'uploading-files', label: 'Setup Files', desc: 'Uploading Next.js starter project files' },
    { key: 'installing-deps', label: 'Install Deps', desc: 'Running bun install (fast & modern)' },
    { key: 'starting-server', label: 'Start Server', desc: 'Launching Next.js dev server on port 3000' },
    { key: 'ready', label: 'Preview Ready', desc: 'App is live in the sandbox!' },
];

export default function DaytonaTestPage() {
    const [language, setLanguage] = useState<Language>('typescript');
    const [autoStop, setAutoStop] = useState(10);
    const [autoArchive, setAutoArchive] = useState(20);
    const [selectedSandboxId, setSelectedSandboxId] = useState('');
    const [command, setCommand] = useState('echo "Hello from Daytona!"');
    const [code, setCode] = useState(
        `// TypeScript code running inside Daytona sandbox\nconst greeting = (name: string) => \`Hello, \${name}!\`;\nconsole.log(greeting("Onlook"));`,
    );
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [activeTab, setActiveTab] = useState<ActiveTab>('bootstrap');
    const [archivedFilter, setArchivedFilter] = useState<'all' | 'active' | 'archived'>('all');

    // Proxy settings
    const [useProxy, setUseProxy] = useState(true);
    const [proxyPort, setProxyPort] = useState(8788);
    const [proxySlug, setProxySlug] = useState('');

    const [showStackModal, setShowStackModal] = useState(false);
    const [selectedFramework, setSelectedFramework] = useState<'next' | 'nuxt' | 'remix' | 'sveltekit'>('next');
    const [selectedLibs, setSelectedLibs] = useState<string[]>([]);
    
    // Bootstrap state
    const [bootstrapStep, setBootstrapStep] = useState<BootstrapStep>('idle');
    const [bootstrapSandboxId, setBootstrapSandboxId] = useState('');
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [previewToken, setPreviewToken] = useState<string | null>(null);
    const [iframeKey, setIframeKey] = useState(0);
    const iframeRef = useRef<HTMLIFrameElement>(null);

    function addLog(type: LogEntry['type'], message: string) {
        const time = new Date().toLocaleTimeString();
        setLogs((prev) => [...prev, { time, type, message }]);
    }

    /* ── Mutations & Queries ─────────────────────────────────────────── */
    const bootstrapMutation = api.daytona.setup.bootstrapProject.useMutation({
        onSuccess: (data) => {
            setBootstrapSandboxId(data.sandboxId);
            setSelectedSandboxId(data.sandboxId);
            addLog('success', `✅ Project ready in sandbox ${data.sandboxId.slice(0, 12)}…`);
            // Auto-proceed to starting server
            setBootstrapStep('starting-server');
            startServerMutation.mutate({ sandboxId: data.sandboxId, workdir: data.workdir });
        },
        onError: (err) => {
            setBootstrapStep('error');
            addLog('error', `❌ Bootstrap failed: ${err.message}`);
        },
    });

    const startServerMutation = api.daytona.setup.startDevServer.useMutation({
        onSuccess: (data, variables) => {
            setBootstrapStep('ready');
            if (data.previewUrl) {
                let url = data.previewUrl;

                if (useProxy && variables.sandboxId) {
                    // Use custom slug if provided, otherwise fallback to sandboxId
                    const identifier = proxySlug || variables.sandboxId;
                    url = `http://${identifier}.localhost:${proxyPort}`;
                } else if (data.token) {
                    url = `${data.previewUrl}?token=${data.token}`;
                }

                setPreviewUrl(url);
                setPreviewToken(data.token ?? null);
                setIframeKey((k) => k + 1);
                addLog('success', `🌐 Preview URL: ${url}`);
            } else {
                addLog(data.ready ? 'success' : 'error', data.ready ? '✅ Server started (no public URL)' : '⚠️ Server may not be ready yet');
            }
        },
        onError: (err) => {
            setBootstrapStep('error');
            addLog('error', `❌ Server start failed: ${err.message}`);
        },
    });

    const createSandbox = api.daytona.sandbox.create.useMutation({
        onSuccess: (data) => {
            addLog('success', `✅ Sandbox created! ID: ${data.id} | State: ${data.state}`);
            setSelectedSandboxId(data.id);
            void listQuery.refetch();
        },
        onError: (err) => addLog('error', `❌ Create failed: ${err.message}`),
    });

    const deleteSandbox = api.daytona.sandbox.delete.useMutation({
        onSuccess: (data) => {
            const id = (data as any).sandboxId || '';
            addLog('success', `🗑️ Sandbox ${id.slice(0, 12)} deleted.`);
            if (selectedSandboxId === id) setSelectedSandboxId('');
            void listQuery.refetch();
        },
        onError: (err) => addLog('error', `❌ Delete failed: ${err.message}`),
    });

    const executeCommand = api.daytona.sandbox.executeCommand.useMutation({
        onSuccess: (data) => {
            addLog('cmd', `$ ${command}`);
            addLog(data.exitCode === 0 ? 'success' : 'error', data.output || '(no output)');
        },
        onError: (err) => addLog('error', `❌ Exec failed: ${err.message}`),
    });

    const stopSandbox = api.daytona.sandbox.stop.useMutation({
        onSuccess: (data) => {
            addLog('info', `🛑 Sandbox ${data.sandboxId.slice(0, 12)} stopped.`);
            if (activeTab === 'bootstrap' && bootstrapSandboxId === data.sandboxId) {
                setBootstrapStep('idle');
                setPreviewUrl(null);
            }
            void listQuery.refetch();
        },
        onError: (err) => addLog('error', `❌ Stop failed: ${err.message}`),
    });

    const deleteAllSandboxes = api.daytona.sandbox.deleteAll.useMutation({
        onSuccess: (data) => {
            addLog('success', `🗑️ Deleted ${data.count} sandboxes.`);
            void listQuery.refetch();
        },
        onError: (err) => addLog('error', `❌ Cleanup failed: ${err.message}`),
    });

    const archiveSandbox = api.daytona.sandbox.archive.useMutation({
        onSuccess: (data) => {
            addLog('success', `📦 Sandbox ${data.sandboxId.slice(0, 12)} archived.`);
            void listQuery.refetch();
        },
        onError: (err) => addLog('error', `❌ Archive failed: ${err.message}`),
    });

    const startSandbox = api.daytona.sandbox.start.useMutation({
        onSuccess: (data) => {
            addLog('success', `▶️ Sandbox ${data.sandboxId.slice(0, 12)} started. Booting dev server...`);
            startServerMutation.mutate({ sandboxId: data.sandboxId }); // Uses consistent default in router now
            void listQuery.refetch();
        },
        onError: (err) => addLog('error', `❌ Start failed: ${err.message}`),
    });

    const recoverSandbox = api.daytona.sandbox.recover.useMutation({
        onSuccess: (data) => {
            addLog('success', `🔧 Sandbox ${data.sandboxId.slice(0, 12)} recovered.`);
            void listQuery.refetch();
        },
        onError: (err) => addLog('error', `❌ Recover failed: ${err.message}`),
    });

    const setAutoArchiveInterval = api.daytona.sandbox.setAutoArchiveInterval.useMutation({
        onSuccess: (data) => {
            addLog('success', `⏰ Sandbox ${data.sandboxId.slice(0, 12)} auto-archive set to ${data.interval} min.`);
            void listQuery.refetch();
        },
        onError: (err) => addLog('error', `❌ Failed to set auto-archive: ${err.message}`),
    });

    const setAutoStopInterval = api.daytona.sandbox.setAutoStopInterval.useMutation({
        onSuccess: (data) => {
            addLog('success', `⏰ Sandbox ${data.sandboxId.slice(0, 12)} auto-stop set to ${data.interval} min.`);
            void listQuery.refetch();
        },
        onError: (err) => addLog('error', `❌ Failed to set auto-stop: ${err.message}`),
    });

    // ── Snapshot state ────────────────────────────────────────────────────
    const [snapshotName, setSnapshotName] = useState('');
    const [snapshotImage, setSnapshotImage] = useState('node:20-slim');
    const [fromSnapshotName, setFromSnapshotName] = useState('');

    const snapshotsQuery = api.daytona.snapshot.list.useQuery(undefined, { refetchInterval: 30_000 });
    const snapshots: SnapshotItem[] = snapshotsQuery.data ?? [];

    const createSnapshot = api.daytona.snapshot.create.useMutation({
        onSuccess: (data) => {
            addLog('success', `📸 Snapshot '${data.name}' created (${data.state}).`);
            setSnapshotName('');
            void snapshotsQuery.refetch();
        },
        onError: (err) => addLog('error', `❌ Snapshot creation failed: ${err.message}`),
    });

    const deleteSnapshot = api.daytona.snapshot.delete.useMutation({
        onSuccess: (data) => {
            addLog('success', `🗑️ Snapshot '${data.snapshotName}' deleted.`);
            void snapshotsQuery.refetch();
        },
        onError: (err) => addLog('error', `❌ Snapshot delete failed: ${err.message}`),
    });


    const activateSnapshot = api.daytona.snapshot.activate.useMutation({
        onSuccess: (data) => {
            addLog('success', `✅ Snapshot '${data.name}' activated (${data.state}).`);
            void snapshotsQuery.refetch();
        },
        onError: (err) => addLog('error', `❌ Snapshot activation failed: ${err.message}`),
    });

    const createFromSnapshot = api.daytona.sandbox.createFromSnapshot.useMutation({
        onSuccess: (data) => {
            addLog('success', `🚀 Sandbox ${data.id.slice(0, 12)} created from snapshot (${data.state}).`);
            setSelectedSandboxId(data.id);
            void listQuery.refetch();
        },
        onError: (err) => addLog('error', `❌ Create from snapshot failed: ${err.message}`),
    });

    function snapshotStateColor(state: string) {
        if (state === 'active') return '#22c55e';
        if (state === 'pending' || state === 'building') return '#f59e0b';
        if (state === 'error' || state === 'build_failed') return '#ef4444';
        return '#94a3b8';
    }

    const runCode = api.daytona.sandbox.runCode.useMutation({
        onSuccess: (data) => {
            addLog('cmd', '[code run]');
            addLog(data.success ? 'success' : 'error', data.output || '(no output)');
        },
        onError: (err) => addLog('error', `❌ Code run failed: ${err.message}`),
    });

    const listQuery = api.daytona.sandbox.list.useQuery(undefined, { refetchInterval: 15_000 });
    const sandboxes: SandboxItem[] = (listQuery.data ?? []).sort((a, b) => {
        const dateA = new Date(a.updatedAt || a.createdAt || 0).getTime();
        const dateB = new Date(b.updatedAt || b.createdAt || 0).getTime();
        return dateB - dateA; // Newest first
    });

    const archivedSandboxes = sandboxes.filter(s => s.state === 'archived');
    const activeSandboxes = sandboxes.filter(s => s.state !== 'archived');

    const filteredSandboxes = archivedFilter === 'active'
        ? activeSandboxes
        : archivedFilter === 'archived'
            ? archivedSandboxes
            : sandboxes;

    function startBootstrap(existingSandboxId?: string) {
        if (!existingSandboxId && !showStackModal) {
            setShowStackModal(true);
            return;
        }
        
        setShowStackModal(false);
        setPreviewUrl(null);
        setPreviewToken(null);
        setBootstrapStep('creating-sandbox');
        const stackLabel = `${selectedFramework.toUpperCase()} ${selectedLibs.length > 0 ? `+ ${selectedLibs.join(', ')}` : ''}`;
        addLog('info', `🚀 Bootstrapping ${stackLabel} in Daytona…`);
        
        bootstrapMutation.mutate({ 
            sandboxId: existingSandboxId, 
            framework: selectedFramework,
            libraries: selectedLibs,
            autoStopInterval: autoStop, 
            autoArchiveInterval: autoArchive,
            subdomain: proxySlug || undefined
        });
    }

    // When bootstrap mutation is running step 2 (uploading), update visual step
    useEffect(() => {
        if (bootstrapMutation.isPending && bootstrapStep === 'creating-sandbox') {
            // After ~3s move to uploading visual step (mutation is actually doing everything)
            const t1 = setTimeout(() => setBootstrapStep('uploading-files'), 3000);
            const t2 = setTimeout(() => setBootstrapStep('installing-deps'), 8000);
            return () => { clearTimeout(t1); clearTimeout(t2); };
        }
    }, [bootstrapMutation.isPending, bootstrapStep]);

    // Automatic teardown when leaving the dashboard
    useEffect(() => {
        const handleTeardown = () => {
            if (selectedSandboxId) {
                try {
                    const blob = new Blob([JSON.stringify({ sandboxId: selectedSandboxId })], {
                        type: 'application/json',
                    });
                    navigator.sendBeacon('/api/daytona/teardown', blob);
                } catch (e) {
                    // Ignore beacon errors
                }
            }
        };

        window.addEventListener('pagehide', handleTeardown);
        window.addEventListener('beforeunload', handleTeardown);

        return () => {
            window.removeEventListener('pagehide', handleTeardown);
            window.removeEventListener('beforeunload', handleTeardown);
        };
    }, [selectedSandboxId]);


    function getStepStatus(stepKey: BootstrapStep): 'done' | 'active' | 'pending' | 'error' {
        if (bootstrapStep === 'error') {
            const errorAt = ['creating-sandbox', 'uploading-files', 'installing-deps', 'starting-server'];
            const stepIdx = BOOTSTRAP_STEPS.findIndex((s) => s.key === stepKey);
            const currentIdx = errorAt.indexOf(bootstrapStep);
            if (stepIdx <= currentIdx) return 'error';
            return 'pending';
        }
        const order: BootstrapStep[] = [
            'creating-sandbox', 'uploading-files', 'installing-deps', 'starting-server', 'ready',
        ];
        const current = order.indexOf(bootstrapStep);
        const step = order.indexOf(stepKey);
        if (current < 0 || step < 0) return 'pending';
        if (step < current) return 'done';
        if (step === current) return 'active';
        return 'pending';
    }

    function stateColor(state: string) {
        if (state === 'started' || state === 'running') return '#22c55e';
        if (state === 'stopped' || state === 'archived') return '#f59e0b';
        if (state === 'error' || state === 'failed') return '#ef4444';
        if (state === 'creating' || state === 'building') return '#6366f1';
        return '#94a3b8';
    }

    const isBootstrapping = bootstrapMutation.isPending || startServerMutation.isPending;

    // ── Stack Selector Modal ───────────────────────────────────────
    const StackSelectorModal = () => {
        if (!showStackModal) return null;

        const frameworks = [
            { id: 'next', name: 'Next.js' },
            { id: 'nuxt', name: 'Nuxt 3' },
            { id: 'remix', name: 'Remix' },
            { id: 'sveltekit', name: 'SvelteKit' },
        ];

        const libraries = [
            { id: 'shadcn', name: 'shadcn/ui', desc: 'Beautifully designed components' },
            { id: 'heroui', name: 'HeroUI', desc: 'Premium component library' },
            { id: 'daisyui', name: 'daisyUI', desc: 'DaisyUI component library' },
            { id: 'trpc', name: 'tRPC', desc: 'End-to-end typesafe APIs' },
            { id: 'orpc', name: 'oRPC', desc: 'Modern RPC for everyone' },
        ];

        return (
            <div style={{
                position: 'fixed',
                inset: 0,
                zIndex: 9999,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'rgba(15, 23, 42, 0.7)',
                backdropFilter: 'blur(4px)',
                padding: '1rem',
            }}>
                <div style={{
                    background: 'white',
                    borderRadius: '24px',
                    width: '100%',
                    maxWidth: '600px',
                    overflow: 'hidden',
                    boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
                    border: '1px solid #e2e8f0',
                    display: 'flex',
                    flexDirection: 'column',
                }}>
                    <div style={{ padding: '24px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                        <h2 style={{ fontSize: '1.5rem', fontWeight: 900, color: '#0f172a', margin: 0 }}>Select Your Stack</h2>
                        <p style={{ fontSize: '0.875rem', color: '#64748b', margin: '4px 0 0 0' }}>Configure your project before provisioning.</p>
                    </div>

                    <div style={{ padding: '24px', overflowY: 'auto', maxHeight: '60vh' }}>
                        <h3 style={{ fontSize: '0.65rem', fontWeight: 800, textTransform: 'uppercase', color: '#94a3b8', letterSpacing: '0.1em', marginBottom: '12px' }}>Framework</h3>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px', marginBottom: '24px' }}>
                            {frameworks.map(f => (
                                <button
                                    key={f.id}
                                    onClick={() => setSelectedFramework(f.id as any)}
                                    style={{
                                        padding: '12px',
                                        borderRadius: '12px',
                                        border: '2px solid',
                                        borderColor: selectedFramework === f.id ? '#3b82f6' : '#f1f5f9',
                                        background: selectedFramework === f.id ? '#eff6ff' : 'white',
                                        color: selectedFramework === f.id ? '#1e40af' : '#475569',
                                        fontWeight: 'bold',
                                        cursor: 'pointer',
                                        transition: 'all 0.2s',
                                        textAlign: 'center',
                                    }}
                                >
                                    {f.name}
                                </button>
                            ))}
                        </div>

                        <h3 style={{ fontSize: '0.65rem', fontWeight: 800, textTransform: 'uppercase', color: '#94a3b8', letterSpacing: '0.1em', marginBottom: '12px' }}>Add-ons</h3>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px' }}>
                            {libraries.map(lib => (
                                <label
                                    key={lib.id}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        padding: '12px',
                                        borderRadius: '12px',
                                        border: '2px solid',
                                        borderColor: selectedLibs.includes(lib.id) ? '#8b5cf6' : '#f1f5f9',
                                        background: selectedLibs.includes(lib.id) ? '#f5f3ff' : 'white',
                                        cursor: 'pointer',
                                    }}
                                >
                                    <input
                                        type="checkbox"
                                        checked={selectedLibs.includes(lib.id)}
                                        onChange={() => setSelectedLibs(prev => prev.includes(lib.id) ? prev.filter(i => i !== lib.id) : [...prev, lib.id])}
                                        style={{ marginRight: '8px' }}
                                    />
                                    <div style={{ textAlign: 'left' }}>
                                        <div style={{ fontSize: '0.8rem', fontWeight: 'bold', color: selectedLibs.includes(lib.id) ? '#5b21b6' : '#1e293b' }}>{lib.name}</div>
                                        <div style={{ fontSize: '0.6rem', color: '#94a3b8' }}>{lib.desc}</div>
                                    </div>
                                </label>
                            ))}
                        </div>

                        <div style={{ marginTop: '24px', padding: '12px', background: '#f8fafc', borderRadius: '12px', fontSize: '0.7rem', color: '#64748b', textAlign: 'center' }}>
                            🚀 Defaults included: <strong>Tailwind 4, Lucide Icons, GSAP</strong>
                        </div>
                    </div>

                    <div style={{ padding: '24px', borderTop: '1px solid #e2e8f0', display: 'flex', gap: '8px' }}>
                        <button
                            onClick={() => setShowStackModal(false)}
                            style={{ flex: 1, padding: '12px', borderRadius: '12px', border: '1px solid #e2e8f0', background: 'white', fontWeight: 'bold', cursor: 'pointer' }}
                        >
                            Cancel
                        </button>
                        <button
                            onClick={() => startBootstrap()}
                            style={{ flex: 2, padding: '12px', borderRadius: '12px', background: '#0f172a', color: 'white', fontWeight: 'bold', border: 'none', cursor: 'pointer' }}
                        >
                            Bootstrap Project
                        </button>
                    </div>
                </div>
            </div>
        );
    };

    return (
        <div className={styles.page}>
            <StackSelectorModal />
            {/* ── Header ─────────────────────────────────────────────── */}
            <header className={styles.header}>
                <div className={styles.headerInner}>
                    <div className={styles.logo}>
                        <div className={styles.logoIcon}>
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                                <rect x="2" y="2" width="20" height="20" rx="5" stroke="currentColor" strokeWidth="2" />
                                <path d="M8 12h8M12 8v8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                            </svg>
                        </div>
                        <span>Daytona Sandbox Tester</span>
                    </div>
                    <div className={styles.statusBadge}>
                        <span className={styles.statusDot} />
                        {listQuery.isFetching ? 'Syncing…' : `${sandboxes.length} sandbox${sandboxes.length !== 1 ? 'es' : ''}`}
                    </div>
                </div>
            </header>

            <main className={styles.main}>
                {/* ── Tabs ─────────────────────────────────────────── */}
                <nav className={styles.tabs}>
                    {(
                        [
                            { key: 'bootstrap', label: '⚡ Bootstrap' },
                            { key: 'create', label: '+ Create' },
                            { key: 'list', label: '◈ Sandboxes' },
                            { key: 'snapshots', label: '📸 Snapshots' },
                            { key: 'exec', label: '$ Command' },
                            { key: 'code', label: '≫ Run Code' },
                        ] as { key: ActiveTab; label: string }[]
                    ).map((t) => (
                        <button
                            key={t.key}
                            id={`daytona-tab-${t.key}`}
                            className={`${styles.tab} ${activeTab === t.key ? styles.tabActive : ''}`}
                            onClick={() => setActiveTab(t.key)}
                        >
                            {t.label}
                        </button>
                    ))}
                </nav>

                <div className={styles.content}>
                    {/* ── Bootstrap Panel ────────────────────────────── */}
                    {activeTab === 'bootstrap' && (
                        <div className={styles.bootstrapLayout}>
                            {/* Left: Controls + Steps */}
                            <div className={styles.bootstrapControls}>
                                <div className={styles.panel}>
                                    <h2 className={styles.panelTitle}>Bootstrap Next.js Project</h2>
                                    <p className={styles.panelDesc}>
                                        Spin up a fresh Daytona sandbox, deploy a Next.js 15 starter, and preview it live in an iframe.
                                    </p>

                                    {/* Sandbox ID input (optional reuse) */}
                                    <div className={styles.field}>
                                        <label className={styles.label}>Reuse existing sandbox <span style={{ color: '#475569', textTransform: 'none', letterSpacing: 0 }}>(optional)</span></label>
                                        <input
                                            id="bootstrap-sandbox-id"
                                            type="text"
                                            placeholder="Leave blank to create a new sandbox"
                                            value={bootstrapSandboxId}
                                            onChange={(e) => setBootstrapSandboxId(e.target.value)}
                                            className={styles.input}
                                            disabled={isBootstrapping}
                                        />
                                    </div>

                                    <div className={styles.formGrid}>
                                        <div className={styles.field}>
                                            <label className={styles.label}>Auto-stop: <strong className={styles.accentText}>{autoStop} min</strong></label>
                                            <input type="range" min={1} max={120} value={autoStop} onChange={(e) => {
                                                const val = Number(e.target.value);
                                                setAutoStop(val);
                                                if (autoArchive <= val) setAutoArchive(val + 10);
                                            }} className={styles.range} />
                                        </div>
                                        <div className={styles.field}>
                                            <label className={styles.label}>Auto-archive: <strong className={styles.accentText}>{autoArchive} min</strong></label>
                                            <input type="range" min={0} max={240} value={autoArchive} onChange={(e) => setAutoArchive(Number(e.target.value))} className={styles.range} />
                                            <span style={{ fontSize: '0.65rem', color: '#475569' }}>Set to 0 for platform default (7d)</span>
                                        </div>
                                    </div>

                                    {/* Proxy Settings */}
                                    <div className={styles.field} style={{ borderTop: '1px solid #1e293b', paddingTop: '16px', marginTop: '8px' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                                            <input
                                                id="use-proxy-toggle"
                                                type="checkbox"
                                                checked={useProxy}
                                                onChange={(e) => setUseProxy(e.target.checked)}
                                                style={{ cursor: 'pointer' }}
                                            />
                                            <label htmlFor="use-proxy-toggle" className={styles.label} style={{ marginBottom: 0, cursor: 'pointer', textTransform: 'none' }}>
                                                Use Cloudflare Proxy <span style={{ color: '#475569', fontSize: '0.7rem' }}>(requires tool/proxy dev running)</span>
                                            </label>
                                        </div>
                                        {useProxy && (
                                            <div className={styles.formGrid} style={{ marginTop: '8px' }}>
                                                <div className={styles.field}>
                                                    <label className={styles.label}>Proxy Port</label>
                                                    <input
                                                        type="number"
                                                        value={proxyPort}
                                                        onChange={(e) => setProxyPort(Number(e.target.value))}
                                                        className={styles.input}
                                                    />
                                                </div>
                                                <div className={styles.field}>
                                                    <label className={styles.label}>Custom Slug <span style={{ color: '#475569', textTransform: 'none', letterSpacing: 0 }}>(optional)</span></label>
                                                    <input
                                                        type="text"
                                                        placeholder="e.g. my-app"
                                                        value={proxySlug}
                                                        onChange={(e) => setProxySlug(e.target.value)}
                                                        className={styles.input}
                                                    />
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    <button
                                        id="btn-bootstrap"
                                        className={styles.btnPrimary}
                                        style={{ width: '100%', justifyContent: 'center' }}
                                        disabled={isBootstrapping}
                                        onClick={() => startBootstrap(bootstrapSandboxId || undefined)}
                                    >
                                        {isBootstrapping ? (
                                            <><span className={styles.spinner} /> Bootstrapping…</>
                                        ) : bootstrapStep === 'ready' ? (
                                            '↺ Re-bootstrap'
                                        ) : (
                                            '⚡ Bootstrap Next.js App'
                                        )}
                                    </button>

                                    {/* Progress steps */}
                                    {bootstrapStep !== 'idle' && (
                                        <div className={styles.stepper}>
                                            {BOOTSTRAP_STEPS.map((step, i) => {
                                                const status = getStepStatus(step.key);
                                                return (
                                                    <div key={step.key} className={`${styles.stepRow} ${styles[`step-${status}`]}`}>
                                                        <div className={styles.stepDot}>
                                                            {status === 'done' && '✓'}
                                                            {status === 'active' && <span className={styles.spinner} style={{ width: 12, height: 12, borderWidth: 2 }} />}
                                                            {status === 'pending' && <span className={styles.stepNum}>{i + 1}</span>}
                                                            {status === 'error' && '✕'}
                                                        </div>
                                                        <div className={styles.stepText}>
                                                            <span className={styles.stepLabel}>{step.label}</span>
                                                            <span className={styles.stepDesc}>{step.desc}</span>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}

                                    {/* Preview URL copy */}
                                    {previewUrl && (
                                        <div className={styles.previewUrlBar}>
                                            <span className={styles.previewUrlIcon}>🌐</span>
                                            <code className={styles.previewUrlText}>{previewUrl.split('?')[0]}</code>
                                            <a href={previewUrl} target="_blank" rel="noreferrer" className={styles.previewUrlOpen}>↗</a>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Right: iframe preview */}
                            <div className={styles.previewPanel}>
                                {!previewUrl ? (
                                    <div className={styles.previewPlaceholder}>
                                        {bootstrapStep === 'idle' ? (
                                            <>
                                                <div className={styles.previewPlaceholderIcon}>🖥️</div>
                                                <p>Press <strong>Bootstrap Next.js App</strong> to spin up a live preview</p>
                                            </>
                                        ) : bootstrapStep === 'error' ? (
                                            <>
                                                <div className={styles.previewPlaceholderIcon}>⚠️</div>
                                                <p>Bootstrap failed. Check the console below.</p>
                                            </>
                                        ) : (
                                            <>
                                                <div className={`${styles.previewPlaceholderIcon} ${styles.spinFast}`}>⚙️</div>
                                                <p>Setting up your Next.js sandbox…</p>
                                                <p className={styles.previewHint}>This takes 1–2 min on first run (bun install)</p>
                                            </>
                                        )}
                                    </div>
                                ) : (
                                    <div className={styles.iframeWrapper}>
                                        <div className={styles.iframeBar}>
                                            <div className={styles.iframeBarDots}>
                                                <span style={{ background: '#ef4444' }} />
                                                <span style={{ background: '#f59e0b' }} />
                                                <span style={{ background: '#22c55e' }} />
                                            </div>
                                            <div className={styles.iframeBarUrl}>
                                                <span>🔒</span>
                                                <span>{previewUrl.split('?')[0]}</span>
                                            </div>
                                            <button
                                                className={`${styles.iframeReload} ${styles.stopBtn}`}
                                                title="Stop sandbox"
                                                disabled={stopSandbox.isPending}
                                                onClick={() => {
                                                    if (bootstrapSandboxId) stopSandbox.mutate({ sandboxId: bootstrapSandboxId });
                                                }}
                                            >
                                                {stopSandbox.isPending ? <span className={styles.spinner} /> : '🛑'}
                                            </button>
                                            <button
                                                className={styles.iframeReload}
                                                title="Reload preview"
                                                onClick={() => setIframeKey((k) => k + 1)}
                                            >↺</button>
                                        </div>
                                        <BypassedIframe
                                            url={previewUrl}
                                            className={styles.iframe}
                                            title="Next.js Daytona Preview"
                                            allow="cross-origin-isolated; clipboard-read; clipboard-write; geolocation"
                                            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads"
                                        />
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* ── Create Panel ─────────────────────────────── */}
                    {activeTab === 'create' && (
                        <div className={styles.panel}>
                            <h2 className={styles.panelTitle}>Create a New Sandbox</h2>
                            <p className={styles.panelDesc}>Provision a fresh isolated environment on Daytona infrastructure.</p>

                            <div className={styles.formGrid}>
                                <div className={styles.field}>
                                    <label className={styles.label}>Language</label>
                                    <div className={styles.segmented}>
                                        {(['typescript', 'javascript', 'python'] as Language[]).map((lang) => (
                                            <button key={lang} id={`lang-${lang}`} className={`${styles.segment} ${language === lang ? styles.segmentActive : ''}`} onClick={() => setLanguage(lang)}>{lang}</button>
                                        ))}
                                    </div>
                                </div>
                                <div className={styles.field}>
                                    <label className={styles.label}>Auto-stop: <strong className={styles.accentText}>{autoStop} min</strong></label>
                                    <input id="auto-stop-range" type="range" min={1} max={120} value={autoStop} onChange={(e) => {
                                        const val = Number(e.target.value);
                                        setAutoStop(val);
                                        if (autoArchive <= val) setAutoArchive(val + 10);
                                    }} className={styles.range} />
                                </div>
                                <div className={styles.field}>
                                    <label className={styles.label}>Auto-archive: <strong className={styles.accentText}>{autoArchive} min</strong></label>
                                    <input id="auto-archive-range" type="range" min={0} max={240} value={autoArchive} onChange={(e) => setAutoArchive(Number(e.target.value))} className={styles.range} />
                                    <span style={{ fontSize: '0.65rem', color: '#475569' }}>Set to 0 for platform default (7d)</span>
                                </div>
                            </div>

                            <button 
                                id="btn-create-sandbox" 
                                className={styles.btnPrimary} 
                                disabled={createSandbox.isPending} 
                                onClick={() => createSandbox.mutate({ 
                                    language, 
                                    autoStopInterval: autoStop, 
                                    autoArchiveInterval: autoArchive,
                                    subdomain: proxySlug || undefined
                                })}
                            >
                                {createSandbox.isPending ? <><span className={styles.spinner} /> Provisioning…</> : '+ Create Sandbox'}
                            </button>
                        </div>
                    )}

                    {/* ── List Panel ───────────────────────────────── */}
                    {activeTab === 'list' && (
                        <div className={styles.panel}>
                            <div className={styles.panelHeader}>
                                <h2 className={styles.panelTitle}>Sandboxes</h2>
                                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                    <div className={styles.segmented} style={{ marginRight: '12px' }}>
                                        {[
                                            { key: 'all', label: 'All' },
                                            { key: 'active', label: 'Active' },
                                            { key: 'archived', label: 'Archived' },
                                        ].map((f) => (
                                            <button
                                                key={f.key}
                                                className={`${styles.segment} ${archivedFilter === f.key ? styles.segmentActive : ''}`}
                                                onClick={() => setArchivedFilter(f.key as any)}
                                            >
                                                {f.label}
                                            </button>
                                        ))}
                                    </div>
                                    <button
                                        id="btn-cleanup-all"
                                        className={`${styles.btnSecondary} ${styles.btnDanger}`}
                                        onClick={() => {
                                            if (confirm('Delete ALL sandboxes? This cannot be undone.')) {
                                                deleteAllSandboxes.mutate();
                                            }
                                        }}
                                        disabled={deleteAllSandboxes.isPending || listQuery.isFetching}
                                    >
                                        {deleteAllSandboxes.isPending ? <span className={styles.spinner} /> : '🗑 Cleanup All'}
                                    </button>
                                    <button id="btn-refresh-list" className={styles.btnSecondary} onClick={() => void listQuery.refetch()} disabled={listQuery.isFetching}>
                                        {listQuery.isFetching ? 'Refreshing…' : '↻ Refresh'}
                                    </button>
                                </div>
                            </div>

                            {/* Recently Archived Highlight */}
                            {archivedFilter === 'all' && archivedSandboxes.length > 0 && (
                                <div className={styles.archivedHighlight}>
                                    <div className={styles.subTitle} style={{ color: '#fbbf24', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                        <span>📦</span> Recently Archived
                                    </div>
                                    <div className={styles.sandboxList} style={{ marginBottom: '24px' }}>
                                        {archivedSandboxes.slice(0, 3).map((sb) => (
                                            <div key={sb.id} className={`${styles.sandboxCard} ${styles.archivedCard}`} onClick={() => setSelectedSandboxId(sb.id)}>
                                                <div className={styles.sbTop}>
                                                    <div className={styles.sbId}><span className={styles.sbIdLabel}>RESUME</span><code className={styles.sbIdValue}>{sb.id.slice(0, 12)}…</code></div>
                                                    <button
                                                        className={`${styles.btnXs} ${styles.btnSuccess}`}
                                                        style={{ padding: '6px 14px' }}
                                                        onClick={(e) => { e.stopPropagation(); startSandbox.mutate({ sandboxId: sb.id }); }}
                                                    >
                                                        🔄 Restore & Run
                                                    </button>
                                                </div>
                                                <div className={styles.sbMeta}>
                                                    <span className={styles.sbChip}>Last active: {sb.updatedAt ? new Date(sb.updatedAt).toLocaleString() : 'unknown'}</span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {filteredSandboxes.length === 0 ? (
                                <div className={styles.emptyState}>
                                    <span className={styles.emptyIcon}>{archivedFilter === 'archived' ? '📦' : '⬡'}</span>
                                    <p>{archivedFilter === 'archived' ? 'No archived sandboxes found.' : 'No sandboxes found.'}</p>
                                </div>
                            ) : (
                                <div className={styles.sandboxList}>
                                    {filteredSandboxes.map((sb) => (
                                        <div key={sb.id} id={`sandbox-${sb.id}`} className={`${styles.sandboxCard} ${selectedSandboxId === sb.id ? styles.sandboxCardSelected : ''}`} onClick={() => setSelectedSandboxId(sb.id)}>
                                            <div className={styles.sbTop}>
                                                <div className={styles.sbId}><span className={styles.sbIdLabel}>ID</span><code className={styles.sbIdValue}>{sb.id.slice(0, 20)}…</code></div>
                                                <span className={styles.sbState} style={{ color: stateColor(sb.state) }}>● {sb.state}</span>
                                            </div>
                                            <div className={styles.sbMeta}>
                                                {sb.cpu != null && <span className={styles.sbChip}>CPU {sb.cpu}</span>}
                                                {sb.memory != null && <span className={styles.sbChip}>{sb.memory} GB RAM</span>}
                                                {sb.disk != null && <span className={styles.sbChip}>{sb.disk} GB Disk</span>}
                                                {sb.snapshot && <span className={styles.sbChip}>{sb.snapshot}</span>}
                                                <span className={styles.sbChip}>Stop: {sb.autoStopInterval ?? '?'}m</span>
                                                <span className={styles.sbChip}>Archive: {sb.autoArchiveInterval ?? '?'}m</span>
                                            </div>
                                            <div className={styles.sbActions}>
                                                <button id={`btn-select-${sb.id}`} className={styles.btnXs} onClick={(e) => { e.stopPropagation(); setSelectedSandboxId(sb.id); setActiveTab('exec'); }}>Select</button>
                                                {(sb.state === 'stopped' || sb.state === 'archived' || sb.state === 'error') && (
                                                    <button
                                                        id={`btn-start-${sb.id}`}
                                                        className={`${styles.btnXs} ${styles.btnSuccess}`}
                                                        disabled={startSandbox.isPending}
                                                        onClick={(e) => { e.stopPropagation(); startSandbox.mutate({ sandboxId: sb.id }); }}
                                                    >
                                                        {sb.state === 'archived' ? '🔄 Restore' : '▶ Start'}
                                                    </button>
                                                )}
                                                {sb.state === 'error' && (
                                                    <button
                                                        id={`btn-recover-${sb.id}`}
                                                        className={`${styles.btnXs} ${styles.btnWarning}`}
                                                        disabled={recoverSandbox.isPending}
                                                        onClick={(e) => { e.stopPropagation(); recoverSandbox.mutate({ sandboxId: sb.id }); }}
                                                    >
                                                        🔧 Recover
                                                    </button>
                                                )}
                                                {(sb.state === 'started' || sb.state === 'stopped') && (
                                                    <button
                                                        id={`btn-archive-${sb.id}`}
                                                        className={`${styles.btnXs} ${styles.btnWarning}`}
                                                        disabled={archiveSandbox.isPending}
                                                        onClick={(e) => { e.stopPropagation(); if (confirm(`Archive ${sb.id.slice(0, 12)}…? It will be stopped first.`)) archiveSandbox.mutate({ sandboxId: sb.id }); }}
                                                    >
                                                        📦 Archive
                                                    </button>
                                                )}
                                                {(sb.state === 'started' || sb.state === 'running') && (
                                                    <button
                                                        id={`btn-stop-${sb.id}`}
                                                        className={styles.btnXs}
                                                        disabled={stopSandbox.isPending}
                                                        onClick={(e) => { e.stopPropagation(); stopSandbox.mutate({ sandboxId: sb.id }); }}
                                                    >
                                                        ⏹ Stop
                                                    </button>
                                                )}

                                                <button
                                                    id={`btn-set-stop-${sb.id}`}
                                                    className={styles.btnXs}
                                                    disabled={setAutoStopInterval.isPending}
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        const val = prompt('Enter auto-stop interval in minutes (0 for default):', String(sb.autoStopInterval ?? 10));
                                                        if (val !== null) setAutoStopInterval.mutate({ sandboxId: sb.id, interval: parseInt(val) || 0 });
                                                    }}
                                                >
                                                    ⏹ Auto-stop
                                                </button>
                                                <button
                                                    id={`btn-set-archive-${sb.id}`}
                                                    className={styles.btnXs}
                                                    disabled={setAutoArchiveInterval.isPending}
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        const val = prompt('Enter auto-archive interval in minutes (0 for default):', String(sb.autoArchiveInterval ?? 20));
                                                        if (val !== null) setAutoArchiveInterval.mutate({ sandboxId: sb.id, interval: parseInt(val) || 0 });
                                                    }}
                                                >
                                                    📦 Auto-arch
                                                </button>
                                                <button id={`btn-delete-${sb.id}`} className={`${styles.btnXs} ${styles.btnDanger}`} onClick={(e) => { e.stopPropagation(); if (confirm(`Delete ${sb.id.slice(0, 12)}…?`)) deleteSandbox.mutate({ sandboxId: sb.id }); }}>Delete</button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {/* ── Snapshots Panel ────────────────────────── */}
                    {activeTab === 'snapshots' && (
                        <div className={styles.panel}>
                            <div className={styles.panelHeader}>
                                <h2 className={styles.panelTitle}>Snapshot Manager</h2>
                                <button id="btn-refresh-snapshots" className={styles.btnSecondary} onClick={() => void snapshotsQuery.refetch()} disabled={snapshotsQuery.isFetching}>
                                    {snapshotsQuery.isFetching ? 'Refreshing…' : '↻ Refresh'}
                                </button>
                            </div>

                            {/* Create Snapshot */}
                            <div className={styles.subSection}>
                                <h3 className={styles.subTitle}>Create Snapshot from Docker Image</h3>
                                <div className={styles.formGrid}>
                                    <div className={styles.field}>
                                        <label className={styles.label}>Snapshot Name</label>
                                        <input id="snapshot-name" type="text" placeholder="e.g. my-nextjs-snapshot" value={snapshotName} onChange={(e) => setSnapshotName(e.target.value)} className={styles.input} />
                                    </div>
                                    <div className={styles.field}>
                                        <label className={styles.label}>Base Docker Image</label>
                                        <input id="snapshot-image" type="text" value={snapshotImage} onChange={(e) => setSnapshotImage(e.target.value)} className={styles.input} />
                                        <div className={styles.quickCmds} style={{ marginTop: 8 }}>
                                            {['node:20-slim', 'python:3.12-slim', 'ubuntu:22.04'].map((img) => (
                                                <button key={img} className={styles.quickCmd} onClick={() => setSnapshotImage(img)}>{img}</button>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                                <button
                                    id="btn-create-snapshot"
                                    className={styles.btnPrimary}
                                    disabled={!snapshotName || !snapshotImage || createSnapshot.isPending}
                                    onClick={() => createSnapshot.mutate({ name: snapshotName, image: snapshotImage })}
                                >
                                    {createSnapshot.isPending ? <><span className={styles.spinner} /> Creating…</> : '📸 Create Snapshot'}
                                </button>
                            </div>

                            {/* Launch from Snapshot */}
                            <div className={styles.subSection}>
                                <h3 className={styles.subTitle}>Launch Sandbox from Snapshot</h3>
                                <div className={styles.field}>
                                    <label className={styles.label}>Snapshot Name</label>
                                    <input id="from-snapshot-name" type="text" placeholder="Enter snapshot name…" value={fromSnapshotName} onChange={(e) => setFromSnapshotName(e.target.value)} className={styles.input} />
                                </div>
                                <button
                                    id="btn-launch-from-snapshot"
                                    className={styles.btnPrimary}
                                    disabled={!fromSnapshotName || createFromSnapshot.isPending}
                                    onClick={() => createFromSnapshot.mutate({ snapshotName: fromSnapshotName, subdomain: proxySlug || undefined })}
                                >
                                    {createFromSnapshot.isPending ? <><span className={styles.spinner} /> Launching…</> : '🚀 Launch from Snapshot'}
                                </button>
                            </div>

                            {/* Snapshot List */}
                            <div className={styles.subSection}>
                                <h3 className={styles.subTitle}>Your Snapshots ({snapshots.length})</h3>
                                {snapshots.length === 0 ? (
                                    <div className={styles.emptyState}><span className={styles.emptyIcon}>📷</span><p>No snapshots found.</p></div>
                                ) : (
                                    <div className={styles.sandboxList}>
                                        {snapshots.map((snap) => (
                                            <div key={snap.id} id={`snapshot-${snap.id}`} className={styles.sandboxCard}>
                                                <div className={styles.sbTop}>
                                                    <div className={styles.sbId}>
                                                        <span className={styles.sbIdLabel}>NAME</span>
                                                        <code className={styles.sbIdValue}>{snap.name}</code>
                                                    </div>
                                                    <span className={styles.sbState} style={{ color: snapshotStateColor(snap.state) }}>● {snap.state}</span>
                                                </div>
                                                <div className={styles.sbMeta}>
                                                    {snap.imageName && <span className={styles.sbChip}>{snap.imageName}</span>}
                                                    {snap.cpu != null && <span className={styles.sbChip}>CPU {snap.cpu}</span>}
                                                    {snap.memory != null && <span className={styles.sbChip}>{snap.memory} GB RAM</span>}
                                                    {snap.disk != null && <span className={styles.sbChip}>{snap.disk} GB Disk</span>}
                                                </div>
                                                {snap.errorReason && <p style={{ color: '#ef4444', fontSize: '0.8rem', marginTop: 4 }}>⚠️ {snap.errorReason}</p>}
                                                <div className={styles.sbActions}>
                                                    <button
                                                        id={`btn-launch-snap-${snap.id}`}
                                                        className={`${styles.btnXs} ${styles.btnSuccess}`}
                                                        disabled={createFromSnapshot.isPending}
                                                        onClick={() => { setFromSnapshotName(snap.name); createFromSnapshot.mutate({ snapshotName: snap.name, subdomain: proxySlug || undefined }); }}
                                                    >🚀 Launch</button>
                                                    {snap.state !== 'active' && (
                                                        <button
                                                            id={`btn-activate-snap-${snap.id}`}
                                                            className={styles.btnXs}
                                                            disabled={activateSnapshot.isPending}
                                                            onClick={() => activateSnapshot.mutate({ snapshotName: snap.name })}
                                                        >✅ Activate</button>
                                                    )}
                                                    <button
                                                        id={`btn-delete-snap-${snap.id}`}
                                                        className={`${styles.btnXs} ${styles.btnDanger}`}
                                                        disabled={deleteSnapshot.isPending}
                                                        onClick={() => { if (confirm(`Delete snapshot '${snap.name}'?`)) deleteSnapshot.mutate({ snapshotName: snap.name }); }}
                                                    >Delete</button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* ── Execute Panel ────────────────────────────── */}
                    {activeTab === 'exec' && (
                        <div className={styles.panel}>
                            <h2 className={styles.panelTitle}>Execute Shell Command</h2>
                            <div className={styles.field}>
                                <label className={styles.label}>Sandbox ID</label>
                                <input id="exec-sandbox-id" type="text" placeholder="Paste sandbox ID…" value={selectedSandboxId} onChange={(e) => setSelectedSandboxId(e.target.value)} className={styles.input} />
                            </div>
                            <div className={styles.field}>
                                <label className={styles.label}>Command</label>
                                <div className={styles.cmdRow}>
                                    <span className={styles.prompt}>$</span>
                                    <input id="exec-command" type="text" value={command} onChange={(e) => setCommand(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && selectedSandboxId) executeCommand.mutate({ sandboxId: selectedSandboxId, command }); }} className={styles.cmdInput} />
                                </div>
                            </div>
                            <div className={styles.quickCmds}>
                                {['pwd', 'node --version', 'ls -la', 'cat /etc/os-release', 'df -h'].map((cmd) => (
                                    <button key={cmd} className={styles.quickCmd} onClick={() => setCommand(cmd)}>{cmd}</button>
                                ))}
                            </div>
                            <button id="btn-execute-command" className={styles.btnPrimary} disabled={!selectedSandboxId || executeCommand.isPending} onClick={() => executeCommand.mutate({ sandboxId: selectedSandboxId, command })}>
                                {executeCommand.isPending ? <><span className={styles.spinner} /> Running…</> : '▶ Run Command'}
                            </button>
                        </div>
                    )}

                    {/* ── Code Panel ───────────────────────────────── */}
                    {activeTab === 'code' && (
                        <div className={styles.panel}>
                            <h2 className={styles.panelTitle}>Run Code in Sandbox</h2>
                            <div className={styles.field}>
                                <label className={styles.label}>Sandbox ID</label>
                                <input id="code-sandbox-id" type="text" placeholder="Paste sandbox ID…" value={selectedSandboxId} onChange={(e) => setSelectedSandboxId(e.target.value)} className={styles.input} />
                            </div>
                            <div className={styles.field}>
                                <label className={styles.label}>Code</label>
                                <textarea id="code-input" value={code} onChange={(e) => setCode(e.target.value)} className={styles.codeArea} rows={10} spellCheck={false} />
                            </div>
                            <div className={styles.quickCmds}>
                                {[
                                    { label: 'Hello', code: `console.log("Hello from Daytona!");` },
                                    { label: 'Date', code: `console.log(new Date().toISOString());` },
                                    { label: 'Math', code: `const sum = (a: number, b: number) => a + b;\nconsole.log("3 + 4 =", sum(3, 4));` },
                                ].map((s) => (
                                    <button key={s.label} className={styles.quickCmd} onClick={() => setCode(s.code)}>{s.label}</button>
                                ))}
                            </div>
                            <button id="btn-run-code" className={styles.btnPrimary} disabled={!selectedSandboxId || runCode.isPending} onClick={() => runCode.mutate({ sandboxId: selectedSandboxId, code })}>
                                {runCode.isPending ? <><span className={styles.spinner} /> Executing…</> : '≫ Execute Code'}
                            </button>
                        </div>
                    )}
                </div>
            </main>

            {/* ── Log Console ──────────────────────────────────────────── */}
            <section className={styles.console}>
                <div className={styles.consoleHeader}>
                    <span className={styles.consoleDots}>
                        <span className={styles.dot} style={{ background: '#ef4444' }} />
                        <span className={styles.dot} style={{ background: '#f59e0b' }} />
                        <span className={styles.dot} style={{ background: '#22c55e' }} />
                    </span>
                    <span className={styles.consoleTitle}>Output Console</span>
                    <button id="btn-clear-logs" className={styles.consoleClear} onClick={() => setLogs([])}>Clear</button>
                </div>
                <div className={styles.consoleBody}>
                    {logs.length === 0 ? (
                        <span className={styles.consolePlaceholder}>Waiting for output…</span>
                    ) : (
                        logs.map((l, i) => (
                            <div key={i} className={`${styles.logLine} ${styles[`log-${l.type}`]}`}>
                                <span className={styles.logTime}>{l.time}</span>
                                <span className={styles.logMsg}>{l.message}</span>
                            </div>
                        ))
                    )}
                </div>
            </section>
        </div>
    );
}
