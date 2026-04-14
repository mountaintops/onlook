'use client';

import { api } from '~/trpc/react';
import { useState, useRef, useEffect } from 'react';
import styles from './daytona-test.module.css';

type Language = 'typescript' | 'javascript' | 'python';
type ActiveTab = 'bootstrap' | 'create' | 'list' | 'exec' | 'code';

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
    { key: 'installing-deps', label: 'Install Deps', desc: 'Running npm install (may take 2–4 min)' },
    { key: 'starting-server', label: 'Start Server', desc: 'Launching Next.js dev server on port 3000' },
    { key: 'ready', label: 'Preview Ready', desc: 'App is live in the sandbox!' },
];

export default function DaytonaTestPage() {
    const [language, setLanguage] = useState<Language>('typescript');
    const [autoStop, setAutoStop] = useState(10);
    const [selectedSandboxId, setSelectedSandboxId] = useState('');
    const [command, setCommand] = useState('echo "Hello from Daytona!"');
    const [code, setCode] = useState(
        `// TypeScript code running inside Daytona sandbox\nconst greeting = (name: string) => \`Hello, \${name}!\`;\nconsole.log(greeting("Onlook"));`,
    );
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [activeTab, setActiveTab] = useState<ActiveTab>('bootstrap');

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
    const bootstrapMutation = api.daytona.bootstrapNextjsProject.useMutation({
        onSuccess: (data) => {
            setBootstrapSandboxId(data.sandboxId);
            setSelectedSandboxId(data.sandboxId);
            addLog('success', `✅ Project ready in sandbox ${data.sandboxId.slice(0, 12)}…`);
            addLog('info', data.installOutput);
            // Auto-proceed to starting server
            setBootstrapStep('starting-server');
            startServerMutation.mutate({ sandboxId: data.sandboxId });
        },
        onError: (err) => {
            setBootstrapStep('error');
            addLog('error', `❌ Bootstrap failed: ${err.message}`);
        },
    });

    const startServerMutation = api.daytona.startDevServer.useMutation({
        onSuccess: (data) => {
            setBootstrapStep('ready');
            if (data.previewUrl) {
                const url = data.token
                    ? `${data.previewUrl}?token=${data.token}`
                    : data.previewUrl;
                setPreviewUrl(url);
                setPreviewToken(data.token ?? null);
                setIframeKey((k) => k + 1);
                addLog('success', `🌐 Preview URL: ${data.previewUrl}`);
            } else {
                addLog(data.ready ? 'success' : 'error', data.ready ? '✅ Server started (no public URL)' : '⚠️ Server may not be ready yet');
            }
        },
        onError: (err) => {
            setBootstrapStep('error');
            addLog('error', `❌ Server start failed: ${err.message}`);
        },
    });

    const createSandbox = api.daytona.createSandbox.useMutation({
        onSuccess: (data) => {
            addLog('success', `✅ Sandbox created! ID: ${data.id} | State: ${data.state}`);
            setSelectedSandboxId(data.id);
            void listQuery.refetch();
        },
        onError: (err) => addLog('error', `❌ Create failed: ${err.message}`),
    });

    const deleteSandbox = api.daytona.deleteSandbox.useMutation({
        onSuccess: (data) => {
            addLog('success', `🗑️ Sandbox ${data.sandboxId} deleted.`);
            if (selectedSandboxId === data.sandboxId) setSelectedSandboxId('');
            void listQuery.refetch();
        },
        onError: (err) => addLog('error', `❌ Delete failed: ${err.message}`),
    });

    const executeCommand = api.daytona.executeCommand.useMutation({
        onSuccess: (data) => {
            addLog('cmd', `$ ${command}`);
            addLog(data.exitCode === 0 ? 'success' : 'error', data.output || '(no output)');
        },
        onError: (err) => addLog('error', `❌ Exec failed: ${err.message}`),
    });

    const stopSandbox = api.daytona.stopSandbox.useMutation({
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

    const deleteAllSandboxes = api.daytona.deleteAllSandboxes.useMutation({
        onSuccess: (data) => {
            addLog('success', `🗑️ Deleted ${data.count} sandboxes.`);
            void listQuery.refetch();
        },
        onError: (err) => addLog('error', `❌ Cleanup failed: ${err.message}`),
    });

    const runCode = api.daytona.runCode.useMutation({
        onSuccess: (data) => {
            addLog('cmd', '[code run]');
            addLog(data.success ? 'success' : 'error', data.output || '(no output)');
        },
        onError: (err) => addLog('error', `❌ Code run failed: ${err.message}`),
    });

    const listQuery = api.daytona.listSandboxes.useQuery(undefined, { refetchInterval: 15_000 });
    const sandboxes: SandboxItem[] = listQuery.data ?? [];

    function startBootstrap(existingSandboxId?: string) {
        setPreviewUrl(null);
        setPreviewToken(null);
        setBootstrapStep('creating-sandbox');
        addLog('info', '🚀 Bootstrapping Next.js project in Daytona…');
        bootstrapMutation.mutate({ sandboxId: existingSandboxId });
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

    return (
        <div className={styles.page}>
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
                                                <p className={styles.previewHint}>This takes 2–5 min on first run (npm install)</p>
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
                                        <iframe
                                            key={iframeKey}
                                            ref={iframeRef}
                                            src={previewUrl}
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
                                    <input id="auto-stop-range" type="range" min={1} max={120} value={autoStop} onChange={(e) => setAutoStop(Number(e.target.value))} className={styles.range} />
                                </div>
                            </div>

                            <button id="btn-create-sandbox" className={styles.btnPrimary} disabled={createSandbox.isPending} onClick={() => createSandbox.mutate({ language, autoStopInterval: autoStop })}>
                                {createSandbox.isPending ? <><span className={styles.spinner} /> Provisioning…</> : '+ Create Sandbox'}
                            </button>
                        </div>
                    )}

                    {/* ── List Panel ───────────────────────────────── */}
                    {activeTab === 'list' && (
                        <div className={styles.panel}>
                            <div className={styles.panelHeader}>
                                <h2 className={styles.panelTitle}>Active Sandboxes</h2>
                                <div style={{ display: 'flex', gap: '8px' }}>
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
                            {sandboxes.length === 0 ? (
                                <div className={styles.emptyState}><span className={styles.emptyIcon}>⬡</span><p>No sandboxes found.</p></div>
                            ) : (
                                <div className={styles.sandboxList}>
                                    {sandboxes.map((sb) => (
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
                                            </div>
                                            <div className={styles.sbActions}>
                                                <button id={`btn-select-${sb.id}`} className={styles.btnXs} onClick={(e) => { e.stopPropagation(); setSelectedSandboxId(sb.id); setActiveTab('exec'); }}>Select</button>
                                                <button id={`btn-delete-${sb.id}`} className={`${styles.btnXs} ${styles.btnDanger}`} onClick={(e) => { e.stopPropagation(); if (confirm(`Delete ${sb.id.slice(0, 12)}…?`)) deleteSandbox.mutate({ sandboxId: sb.id }); }}>Delete</button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
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
