'use client';

import { api } from '~/trpc/react';
import { useState } from 'react';
import styles from './daytona-test.module.css';

type Language = 'typescript' | 'javascript' | 'python';

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

export default function DaytonaTestPage() {
    const [language, setLanguage] = useState<Language>('typescript');
    const [autoStop, setAutoStop] = useState(10);
    const [selectedSandboxId, setSelectedSandboxId] = useState('');
    const [command, setCommand] = useState('echo "Hello from Daytona!"');
    const [code, setCode] = useState(
        `// TypeScript code running inside Daytona sandbox\nconst greeting = (name: string) => \`Hello, \${name}!\`;\nconsole.log(greeting("Onlook"));`,
    );
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [activeTab, setActiveTab] = useState<'create' | 'list' | 'exec' | 'code'>('create');

    function addLog(type: LogEntry['type'], message: string) {
        const time = new Date().toLocaleTimeString();
        setLogs((prev) => [...prev, { time, type, message }]);
    }

    /* ── Mutations & Queries ─────────────────────────────────────────── */
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

    const runCode = api.daytona.runCode.useMutation({
        onSuccess: (data) => {
            addLog('cmd', `[code run]`);
            addLog(data.success ? 'success' : 'error', data.output || '(no output)');
        },
        onError: (err) => addLog('error', `❌ Code run failed: ${err.message}`),
    });

    const listQuery = api.daytona.listSandboxes.useQuery(undefined, {
        refetchInterval: 15_000,
    });

    /* ── Derived state ───────────────────────────────────────────────── */
    const sandboxes: SandboxItem[] = listQuery.data ?? [];
    const isLoading =
        createSandbox.isPending ||
        deleteSandbox.isPending ||
        executeCommand.isPending ||
        runCode.isPending;

    function stateColor(state: string) {
        if (state === 'started' || state === 'running') return '#22c55e';
        if (state === 'stopped' || state === 'archived') return '#f59e0b';
        if (state === 'error' || state === 'failed' || state === 'build_failed') return '#ef4444';
        if (state === 'creating' || state === 'building') return '#6366f1';
        return '#94a3b8';
    }

    return (
        <div className={styles.page}>
            {/* ── Header ───────────────────────────────────────────────── */}
            <header className={styles.header}>
                <div className={styles.headerInner}>
                    <div className={styles.logo}>
                        <div className={styles.logoIcon}>
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                                <rect
                                    x="2"
                                    y="2"
                                    width="20"
                                    height="20"
                                    rx="5"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                />
                                <path
                                    d="M8 12h8M12 8v8"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                />
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
                            { key: 'create', label: '+ Create' },
                            { key: 'list', label: '◈ Sandboxes' },
                            { key: 'exec', label: '$ Command' },
                            { key: 'code', label: '≫ Run Code' },
                        ] as { key: typeof activeTab; label: string }[]
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
                    {/* ── Create Panel ─────────────────────────────── */}
                    {activeTab === 'create' && (
                        <div className={styles.panel}>
                            <h2 className={styles.panelTitle}>Create a New Sandbox</h2>
                            <p className={styles.panelDesc}>
                                Provision a fresh isolated environment on Daytona infrastructure.
                            </p>

                            <div className={styles.formGrid}>
                                <div className={styles.field}>
                                    <label className={styles.label}>Language</label>
                                    <div className={styles.segmented}>
                                        {(['typescript', 'javascript', 'python'] as Language[]).map(
                                            (lang) => (
                                                <button
                                                    key={lang}
                                                    id={`lang-${lang}`}
                                                    className={`${styles.segment} ${language === lang ? styles.segmentActive : ''}`}
                                                    onClick={() => setLanguage(lang)}
                                                >
                                                    {lang}
                                                </button>
                                            ),
                                        )}
                                    </div>
                                </div>

                                <div className={styles.field}>
                                    <label className={styles.label}>
                                        Auto-stop interval:{' '}
                                        <strong className={styles.accentText}>
                                            {autoStop} min
                                        </strong>
                                    </label>
                                    <input
                                        id="auto-stop-range"
                                        type="range"
                                        min={1}
                                        max={120}
                                        value={autoStop}
                                        onChange={(e) => setAutoStop(Number(e.target.value))}
                                        className={styles.range}
                                    />
                                </div>
                            </div>

                            <button
                                id="btn-create-sandbox"
                                className={styles.btnPrimary}
                                disabled={createSandbox.isPending}
                                onClick={() =>
                                    createSandbox.mutate({ language, autoStopInterval: autoStop })
                                }
                            >
                                {createSandbox.isPending ? (
                                    <>
                                        <span className={styles.spinner} />
                                        Provisioning…
                                    </>
                                ) : (
                                    '+ Create Sandbox'
                                )}
                            </button>
                        </div>
                    )}

                    {/* ── List Panel ───────────────────────────────── */}
                    {activeTab === 'list' && (
                        <div className={styles.panel}>
                            <div className={styles.panelHeader}>
                                <h2 className={styles.panelTitle}>Active Sandboxes</h2>
                                <button
                                    id="btn-refresh-list"
                                    className={styles.btnSecondary}
                                    onClick={() => void listQuery.refetch()}
                                    disabled={listQuery.isFetching}
                                >
                                    {listQuery.isFetching ? 'Refreshing…' : '↻ Refresh'}
                                </button>
                            </div>

                            {sandboxes.length === 0 ? (
                                <div className={styles.emptyState}>
                                    <span className={styles.emptyIcon}>⬡</span>
                                    <p>No sandboxes found. Create one to get started.</p>
                                </div>
                            ) : (
                                <div className={styles.sandboxList}>
                                    {sandboxes.map((sb) => (
                                        <div
                                            key={sb.id}
                                            id={`sandbox-${sb.id}`}
                                            className={`${styles.sandboxCard} ${selectedSandboxId === sb.id ? styles.sandboxCardSelected : ''}`}
                                            onClick={() => setSelectedSandboxId(sb.id)}
                                        >
                                            <div className={styles.sbTop}>
                                                <div className={styles.sbId}>
                                                    <span className={styles.sbIdLabel}>ID</span>
                                                    <code className={styles.sbIdValue}>
                                                        {sb.id.slice(0, 20)}…
                                                    </code>
                                                </div>
                                                <span
                                                    className={styles.sbState}
                                                    style={{ color: stateColor(sb.state) }}
                                                >
                                                    ● {sb.state}
                                                </span>
                                            </div>
                                            <div className={styles.sbMeta}>
                                                {sb.cpu != null && (
                                                    <span className={styles.sbChip}>
                                                        CPU {sb.cpu}
                                                    </span>
                                                )}
                                                {sb.memory != null && (
                                                    <span className={styles.sbChip}>
                                                        {sb.memory} GB RAM
                                                    </span>
                                                )}
                                                {sb.disk != null && (
                                                    <span className={styles.sbChip}>
                                                        {sb.disk} GB Disk
                                                    </span>
                                                )}
                                                {sb.snapshot && (
                                                    <span className={styles.sbChip}>
                                                        {sb.snapshot}
                                                    </span>
                                                )}
                                            </div>
                                            <div className={styles.sbActions}>
                                                <button
                                                    id={`btn-select-${sb.id}`}
                                                    className={styles.btnXs}
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setSelectedSandboxId(sb.id);
                                                        setActiveTab('exec');
                                                    }}
                                                >
                                                    Select
                                                </button>
                                                <button
                                                    id={`btn-delete-${sb.id}`}
                                                    className={`${styles.btnXs} ${styles.btnDanger}`}
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        if (
                                                            confirm(
                                                                `Delete sandbox ${sb.id.slice(0, 12)}…?`,
                                                            )
                                                        ) {
                                                            deleteSandbox.mutate({
                                                                sandboxId: sb.id,
                                                            });
                                                        }
                                                    }}
                                                >
                                                    Delete
                                                </button>
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
                                <input
                                    id="exec-sandbox-id"
                                    type="text"
                                    placeholder="Paste sandbox ID or select from list…"
                                    value={selectedSandboxId}
                                    onChange={(e) => setSelectedSandboxId(e.target.value)}
                                    className={styles.input}
                                />
                            </div>

                            <div className={styles.field}>
                                <label className={styles.label}>Command</label>
                                <div className={styles.cmdRow}>
                                    <span className={styles.prompt}>$</span>
                                    <input
                                        id="exec-command"
                                        type="text"
                                        value={command}
                                        onChange={(e) => setCommand(e.target.value)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter' && selectedSandboxId) {
                                                executeCommand.mutate({
                                                    sandboxId: selectedSandboxId,
                                                    command,
                                                });
                                            }
                                        }}
                                        className={styles.cmdInput}
                                    />
                                </div>
                            </div>

                            <div className={styles.quickCmds}>
                                {[
                                    'pwd',
                                    'node --version',
                                    'ls -la',
                                    'cat /etc/os-release',
                                    'df -h',
                                ].map((cmd) => (
                                    <button
                                        key={cmd}
                                        className={styles.quickCmd}
                                        onClick={() => setCommand(cmd)}
                                    >
                                        {cmd}
                                    </button>
                                ))}
                            </div>

                            <button
                                id="btn-execute-command"
                                className={styles.btnPrimary}
                                disabled={!selectedSandboxId || executeCommand.isPending}
                                onClick={() =>
                                    executeCommand.mutate({
                                        sandboxId: selectedSandboxId,
                                        command,
                                    })
                                }
                            >
                                {executeCommand.isPending ? (
                                    <>
                                        <span className={styles.spinner} />
                                        Running…
                                    </>
                                ) : (
                                    '▶ Run Command'
                                )}
                            </button>
                        </div>
                    )}

                    {/* ── Code Panel ───────────────────────────────── */}
                    {activeTab === 'code' && (
                        <div className={styles.panel}>
                            <h2 className={styles.panelTitle}>Run Code in Sandbox</h2>

                            <div className={styles.field}>
                                <label className={styles.label}>Sandbox ID</label>
                                <input
                                    id="code-sandbox-id"
                                    type="text"
                                    placeholder="Paste sandbox ID or select from list…"
                                    value={selectedSandboxId}
                                    onChange={(e) => setSelectedSandboxId(e.target.value)}
                                    className={styles.input}
                                />
                            </div>

                            <div className={styles.field}>
                                <label className={styles.label}>Code</label>
                                <textarea
                                    id="code-input"
                                    value={code}
                                    onChange={(e) => setCode(e.target.value)}
                                    className={styles.codeArea}
                                    rows={10}
                                    spellCheck={false}
                                />
                            </div>

                            <div className={styles.quickCmds}>
                                {[
                                    {
                                        label: 'Hello World',
                                        code: `console.log("Hello from Daytona!");`,
                                    },
                                    {
                                        label: 'Date',
                                        code: `console.log(new Date().toISOString());`,
                                    },
                                    {
                                        label: 'Math',
                                        code: `const sum = (a: number, b: number) => a + b;\nconsole.log("3 + 4 =", sum(3, 4));`,
                                    },
                                    {
                                        label: 'Fetch',
                                        code: `const res = await fetch("https://api.github.com/zen");\nconst text = await res.text();\nconsole.log(text);`,
                                    },
                                ].map((s) => (
                                    <button
                                        key={s.label}
                                        className={styles.quickCmd}
                                        onClick={() => setCode(s.code)}
                                    >
                                        {s.label}
                                    </button>
                                ))}
                            </div>

                            <button
                                id="btn-run-code"
                                className={styles.btnPrimary}
                                disabled={!selectedSandboxId || runCode.isPending}
                                onClick={() =>
                                    runCode.mutate({ sandboxId: selectedSandboxId, code })
                                }
                            >
                                {runCode.isPending ? (
                                    <>
                                        <span className={styles.spinner} />
                                        Executing…
                                    </>
                                ) : (
                                    '≫ Execute Code'
                                )}
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
                    <button
                        id="btn-clear-logs"
                        className={styles.consoleClear}
                        onClick={() => setLogs([])}
                    >
                        Clear
                    </button>
                </div>
                <div className={styles.consoleBody}>
                    {logs.length === 0 ? (
                        <span className={styles.consolePlaceholder}>
                            Waiting for output…
                        </span>
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
