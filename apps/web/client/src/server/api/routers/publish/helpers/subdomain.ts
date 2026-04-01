import { env } from '@/env';

// ── Configuration ──────────────────────────────────────────────────────────────

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

// ── Types ──────────────────────────────────────────────────────────────────────

/**
 * Response from POST /domain/custom.
 * Contains the Cloudflare verification records the user must add to their DNS.
 */
export interface CustomDomainSetupResponse {
    success: boolean;
    id: string;
    /** Overall custom hostname status: "active", "pending", etc. */
    status: string;
    /** SSL certificate status: "active", "pending_validation", "issuing_certificate", etc. */
    sslStatus: string;
    /** TXT record for domain ownership verification */
    txtOwnership: { name?: string; value?: string };
    /** TXT record for SSL certificate validation */
    txtSsl: { name?: string; value?: string };
    /** CNAME target the user must point their domain to */
    cnameTarget: string;
    error?: string;
}

/**
 * Response from GET /domain/custom/status/:domain.
 */
export interface CustomDomainStatusResponse {
    success: boolean;
    /** Overall custom hostname status: "active", "pending", "issuing_certificate", etc. */
    status?: string;
    /** SSL certificate status */
    sslStatus?: string;
    txtOwnership?: { name?: string; value?: string };
    txtSsl?: { name?: string; value?: string };
    cloudflare?: {
        id: string;
        status: string;
        ssl: unknown;
        ownership_verification?: { name?: string; value?: string };
    } | null;
    error?: string;
}

// ── API Functions ──────────────────────────────────────────────────────────────

/**
 * Initialise a Cloudflare for SaaS custom hostname.
 *
 * Mirrors deploy.ts step 1: POST /domain/custom.
 * Returns verification records (TXT + CNAME) the user must add to their DNS
 * provider before the domain can be activated.
 *
 * After the domain is verified (status === "active"), call screenshitDeploy()
 * with the customDomain option to activate worker routing for the project.
 */
export async function screenshitInitCustomDomain(
    domain: string,
): Promise<CustomDomainSetupResponse> {
    const apiBase = getApiBase();
    const url = `${apiBase}/domain/custom`;

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${getApiKey()}`,
        },
        body: JSON.stringify({ domain }),
    });

    if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`/domain/custom failed (HTTP ${response.status}): ${body}`);
    }

    const json = (await response.json()) as CustomDomainSetupResponse;
    if (!json.success) {
        throw new Error(`/domain/custom failed: ${json.error || 'unknown error'}`);
    }
    return json;
}

/**
 * Check the verification status of a custom domain.
 *
 * Mirrors deploy.ts step 2: GET /domain/custom/status/:domain.
 * Poll until status === "active" && sslStatus === "active" before deploying.
 */
export async function screenshitCustomDomainStatus(
    domain: string,
): Promise<CustomDomainStatusResponse> {
    const apiBase = getApiBase();
    const url = `${apiBase}/domain/custom/status/${encodeURIComponent(domain)}`;

    const response = await fetch(url, {
        headers: {
            Authorization: `Bearer ${getApiKey()}`,
        },
    });

    if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`/domain/custom/status failed (HTTP ${response.status}): ${body}`);
    }

    return (await response.json()) as CustomDomainStatusResponse;
}
