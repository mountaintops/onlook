// @ts-nocheck
/**
 * Unit tests for the screenshit Express API integration helpers.
 *
 * Uses Bun's built-in test runner with mock() to stub `fetch`.
 * The env module is mocked so no real env vars are needed.
 */

import { afterEach, beforeAll, describe, expect, it, mock, spyOn } from 'bun:test';

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Build a minimal Response-like object for fetch mocking */
function makeResponse(body: unknown, status = 200) {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
        text: async () => JSON.stringify(body),
    } as Response;
}

// ── Mock environment ─────────────────────────────────────────────────────────
mock.module('@/env', () => ({
    env: {
        SCREENSHIT_API_URL: 'http://localhost:8080',
        SCREENSHIT_API_KEY: 'test-secret-token',
    },
}));

// Override sleep so polls resolve immediately (no 5s wait in tests).
// We do this by replacing setTimeout globally before the test module is loaded.
beforeAll(() => {
    const origSetTimeout = globalThis.setTimeout;
    // Only short-circuit sleeps ≥ 1000ms (test code uses smaller values if any)
    globalThis.setTimeout = ((fn: TimerHandler, ms?: number, ...args: unknown[]) => {
        if (typeof fn === 'function' && ms !== undefined && ms >= 1000) {
            return origSetTimeout(fn as () => void, 0, ...args);
        }
        return origSetTimeout(fn as () => void, ms, ...args);
    }) as typeof setTimeout;
});

// ── Import helpers AFTER mocking env ────────────────────────────────────────
const {
    screenshitDeploy,
    screenshitDelete,
    pollScreenshitStatus,
} = await import(
    '~/server/api/routers/publish/helpers/screenshit'
);

// ── screenshitDeploy ─────────────────────────────────────────────────────────
describe('screenshitDeploy', () => {
    afterEach(() => {
        mock.restore();
    });

    it('returns jobId and status on a 200 response', async () => {
        const expectedResponse = { jobId: 'job-abc-123', status: 'queued' };

        // Provider stub with empty file tree
        const providerStub = {
            listFiles: async () => ({ files: [] }),
        } as never;

        const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValueOnce(
            makeResponse(expectedResponse),
        );

        const result = await screenshitDeploy(providerStub, 'my-project-123');

        expect(result.jobId).toBe('job-abc-123');
        expect(result.status).toBe('queued');

        // Verify correct URL and headers
        expect(fetchSpy.mock.calls.length).toBeGreaterThanOrEqual(1);
        const [calledUrl, calledInit] = fetchSpy.mock.calls[0]!;
        expect(String(calledUrl)).toContain('/deploy?projectId=my-project-123');
        expect((calledInit as RequestInit)?.method).toBe('POST');
        const headers = (calledInit as RequestInit)?.headers as Record<string, string>;
        expect(headers['Authorization']).toContain('Bearer test-secret-token');
        expect(headers['Content-Type']).toBe('application/octet-stream');
    });

    it('throws when the server returns a non-2xx status', async () => {
        const providerStub = { listFiles: async () => ({ files: [] }) } as never;
        spyOn(globalThis, 'fetch').mockResolvedValueOnce(makeResponse({ error: 'Server Error' }, 500));
        await expect(screenshitDeploy(providerStub, 'my-project')).rejects.toThrow('HTTP 500');
    });

    it('throws when the server responds without a jobId', async () => {
        const providerStub = { listFiles: async () => ({ files: [] }) } as never;
        spyOn(globalThis, 'fetch').mockResolvedValueOnce(makeResponse({ status: 'ok' }));
        await expect(screenshitDeploy(providerStub, 'my-project')).rejects.toThrow('no jobId');
    });
});

// ── pollScreenshitStatus ─────────────────────────────────────────────────────
describe('pollScreenshitStatus', () => {
    afterEach(() => {
        mock.restore();
    });

    it('resolves with the deployed URL when status is "completed"', async () => {
        spyOn(globalThis, 'fetch').mockResolvedValue(
            makeResponse({ status: 'completed', result: { url: 'https://my-project.example.com' } }),
        );
        const url = await pollScreenshitStatus('job-abc-123');
        expect(url).toBe('https://my-project.example.com');
    });

    it('resolves with the URL when status is "success"', async () => {
        spyOn(globalThis, 'fetch').mockResolvedValue(
            makeResponse({ status: 'success', result: { url: 'https://success.example.com' } }),
        );
        const url = await pollScreenshitStatus('job-xyz');
        expect(url).toBe('https://success.example.com');
    });

    it('throws a descriptive error when status is "failed"', async () => {
        spyOn(globalThis, 'fetch').mockResolvedValue(
            makeResponse({ status: 'failed', error: 'sst remove error' }),
        );
        await expect(pollScreenshitStatus('job-fail')).rejects.toThrow('sst remove error');
    });

    it('throws when "completed" but no URL is returned', async () => {
        spyOn(globalThis, 'fetch').mockResolvedValue(
            makeResponse({ status: 'completed', result: {} }),
        );
        await expect(pollScreenshitStatus('job-no-url')).rejects.toThrow('no URL was returned');
    });
});

// ── screenshitDelete ─────────────────────────────────────────────────────────
describe('screenshitDelete', () => {
    afterEach(() => {
        mock.restore();
    });

    it('sends a DELETE request with correct headers and returns jobId', async () => {
        const expectedResponse = { jobId: 'del-job-456', status: 'queued' };

        const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValueOnce(
            makeResponse(expectedResponse),
        );

        const result = await screenshitDelete('my-project-123');

        expect(result.jobId).toBe('del-job-456');
        expect(result.status).toBe('queued');

        // This is the first (and only) call in this test
        const [calledUrl, calledInit] = fetchSpy.mock.calls[0]!;
        expect(String(calledUrl)).toContain('/delete?projectId=my-project-123');
        expect((calledInit as RequestInit)?.method).toBe('DELETE');
        const headers = (calledInit as RequestInit)?.headers as Record<string, string>;
        expect(headers['Authorization']).toContain('Bearer test-secret-token');
    });

    it('throws on a non-2xx status', async () => {
        spyOn(globalThis, 'fetch').mockResolvedValueOnce(makeResponse({ error: 'not found' }, 404));
        await expect(screenshitDelete('missing-project')).rejects.toThrow('HTTP 404');
    });

    it('throws when no jobId is returned', async () => {
        spyOn(globalThis, 'fetch').mockResolvedValueOnce(makeResponse({ status: 'ok' }));
        await expect(screenshitDelete('my-project')).rejects.toThrow('no jobId');
    });
});
