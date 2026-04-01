import type { Provider } from '@onlook/code-provider';
import { env } from '@/env';
import archiver from 'archiver';
import { PassThrough } from 'node:stream';

// Directories to exclude from the ZIP — mirrors deploy.sh exclusion list
const EXCLUDED_DIRS = new Set(['node_modules', '.git', '.next', '.sst']);

const POLL_INTERVAL_MS = 5_000;
const POLL_MAX_WAIT_MS = 30 * 60 * 1_000; // 30 minutes

function getApiBase(): string {
    const url = env.SCREENSHIT_API_URL;
    if (!url) {
        throw new Error('SCREENSHIT_API_URL is not configured');
    }
    return url.replace(/\/$/, '');
}

function getApiKey(): string {
    const key = env.SCREENSHIT_API_KEY;
    if (!key) {
        throw new Error('SCREENSHIT_API_KEY is not configured');
    }
    return key;
}

/**
 * Walk the sandbox provider's file tree, feed every non-excluded file into an
 * archiver ZIP stream, and return the entire ZIP as a Buffer.
 */
export async function zipProjectFromProvider(provider: Provider): Promise<Uint8Array> {
    return new Promise<Uint8Array>((resolve, reject) => {
        const archive = archiver('zip', { zlib: { level: 6 } });
        const passThrough = new PassThrough();
        const chunks: Buffer[] = [];

        passThrough.on('data', (chunk: Buffer) => chunks.push(chunk));
        passThrough.on('end', () => resolve(new Uint8Array(Buffer.concat(chunks))));
        passThrough.on('error', reject);
        archive.on('error', reject);

        archive.pipe(passThrough);

        // Async walk + append must happen before finalize()
        walkAndAppend(provider, './', archive)
            .then(() => archive.finalize())
            .catch(reject);
    });
}

async function walkAndAppend(
    provider: Provider,
    dir: string,
    archive: archiver.Archiver,
): Promise<void> {
    let entries: Awaited<ReturnType<Provider['listFiles']>>['files'];
    try {
        const result = await provider.listFiles({ args: { path: dir } });
        entries = result.files;
    } catch {
        return; // skip unreadable dirs
    }

    for (const entry of entries) {
        const entryName = entry.name;
        // normalise the relative path: strip leading './'
        const relPath = dir === './' ? entryName : `${dir.replace(/^\.\//, '')}/${entryName}`;

        if (entry.type === 'directory') {
            if (EXCLUDED_DIRS.has(entryName)) continue;
            await walkAndAppend(provider, `./${relPath}`, archive);
        } else if (entry.type === 'file') {
            try {
                const { file } = await provider.readFile({ args: { path: `./${relPath}` } });
                let content: Buffer;
                if (file.type === 'binary') {
                    content = (file.content as any) instanceof Uint8Array
                        ? Buffer.from(file.content as unknown as Uint8Array)
                        : Buffer.from(typeof file.content === 'string' ? file.content : file.toString(), 'base64');
                } else {
                    content = (file.content as any) instanceof Uint8Array
                        ? Buffer.from(file.content as unknown as Uint8Array)
                        : Buffer.from(typeof file.content === 'string' ? file.content : file.toString(), 'utf8');
                }
                archive.append(content, { name: relPath });
            } catch {
                // skip unreadable files (e.g. binary sockets)
            }
        }
    }
}

export interface ScreenshitJobResponse {
    jobId: string;
    status: string;
    url?: string;
}

export interface DeployOptions {
    /** Custom domain to route alongside the project subdomain. Must be Cloudflare-verified first. */
    customDomain?: string;
    /** If true, detaches the custom domain from whichever other project currently uses it. */
    removeOld?: boolean;
}

/**
 * Zip the sandbox project and POST it to the screenshit /deploy endpoint.
 * Mirrors the deploy.ts CLI: projectId maps to subdomain automatically;
 * pass customDomain to also wire up worker routing for a custom domain.
 */
export async function screenshitDeploy(
    provider: Provider,
    projectId: string,
    opts: DeployOptions = {},
): Promise<ScreenshitJobResponse> {
    const zipBuffer = await zipProjectFromProvider(provider);
    const apiBase = getApiBase();

    let url = `${apiBase}/deploy?projectId=${encodeURIComponent(projectId)}`;
    if (opts.customDomain) {
        url += `&customDomain=${encodeURIComponent(opts.customDomain)}`;
        if (opts.removeOld) url += '&removeOld=true';
    }

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/octet-stream',
            Authorization: `Bearer ${getApiKey()}`,
            'Accept-Encoding': 'identity',
        },
        body: zipBuffer.buffer as ArrayBuffer,
    });

    if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`screenshit /deploy failed (HTTP ${response.status}): ${body}`);
    }

    const json = (await response.json()) as ScreenshitJobResponse;
    if (!json.jobId) {
        throw new Error(`screenshit /deploy returned no jobId. Body: ${JSON.stringify(json)}`);
    }
    return json;
}

export interface PollResult {
    /** Lambda URL (internal, used for routing and storage). */
    url: string;
    /** Public subdomain assigned by the server, e.g. projectId.weliketech.eu.org */
    subdomain: string;
}

interface PollResponse {
    status: string;
    result?: {
        /** New field: Lambda URL returned by provisionProject */
        lambdaUrl?: string;
        /** Legacy field for backwards compat */
        url?: string;
        /** Public subdomain, e.g. projectId.weliketech.eu.org */
        subdomain?: string;
    };
    error?: string;
    logs?: string[];
}

/**
 * Poll GET /deploy/status/:jobId until status is "completed" or "failed".
 * Returns { url: lambdaUrl, subdomain } on success, throws on failure.
 * Pass expectUrl=false for delete jobs where no URL is expected.
 */
export async function pollScreenshitStatus(jobId: string, expectUrl = true): Promise<PollResult> {
    const apiBase = getApiBase();
    const statusUrl = `${apiBase}/deploy/status/${encodeURIComponent(jobId)}`;
    const started = Date.now();

    while (true) {
        await sleep(POLL_INTERVAL_MS);

        if (Date.now() - started > POLL_MAX_WAIT_MS) {
            throw new Error(`screenshit deploy timed out after 30 minutes (jobId: ${jobId})`);
        }

        let poll: PollResponse;
        try {
            const res = await fetch(statusUrl, {
                headers: { Authorization: `Bearer ${getApiKey()}` },
            });
            if (!res.ok) continue; // transient error, retry
            poll = (await res.json()) as PollResponse;
        } catch {
            continue; // network blip, retry
        }

        const status = poll.status;

        if (status === 'completed' || status === 'success') {
            // Prefer lambdaUrl (new field) over url (legacy field)
            const deployedUrl = poll.result?.lambdaUrl ?? poll.result?.url ?? '';
            const subdomain = poll.result?.subdomain ?? '';
            if (expectUrl && !deployedUrl) {
                throw new Error(`screenshit deploy completed but no URL was returned (jobId: ${jobId})`);
            }
            return { url: deployedUrl, subdomain };
        }

        if (status === 'failed') {
            throw new Error(
                `screenshit deploy failed (jobId: ${jobId}): ${poll.error ?? 'unknown error'}`,
            );
        }

        // Still queued / in_progress — keep polling
    }
}

/**
 * Send DELETE /delete?projectId=<projectId> to remove the SST deployment.
 * Returns the initial response with a jobId for optional polling.
 */
export async function screenshitDelete(projectId: string): Promise<ScreenshitJobResponse> {
    const apiBase = getApiBase();
    const url = `${apiBase}/delete?projectId=${encodeURIComponent(projectId)}`;

    const response = await fetch(url, {
        method: 'DELETE',
        headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${getApiKey()}`,
        },
    });

    if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`screenshit /delete failed (HTTP ${response.status}): ${body}`);
    }

    const json = (await response.json()) as ScreenshitJobResponse;
    if (!json.jobId) {
        throw new Error(`screenshit /delete returned no jobId. Body: ${JSON.stringify(json)}`);
    }
    return json;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
