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

export interface DomainAssignResponse {
    success: boolean;
    hostname: string;
    hostnameId: string;
    subdomain: string;
    fullDomain: string;
    lambdaUrl: string;
    baseDomain: string;
    error?: string;
}

export interface DomainRemoveResponse {
    success: boolean;
    hostname: string;
    removed: boolean;
    error?: string;
}

export interface DomainStatusResponse {
    success: boolean;
    hostname: string;
    subdomain: string;
    cloudflare: {
        id: string;
        status: string;
        ssl: unknown;
    } | null;
    kvsTarget: string | null;
    error?: string;
}

export interface DomainListItem {
    id: string;
    hostname: string;
    subdomain: string;
    status: string;
}

export interface CustomDomainAssignResponse {
    success: boolean;
    hostname: string;
    hostnameId: string;
    fullDomain: string;
    lambdaUrl: string;
    fallbackDomain: string;
    ownership_verification: any;
    ssl_validation: any;
    status: string;
    error?: string;
}

export interface CustomDomainStatusResponse extends DomainStatusResponse {
    domain?: string;
    cloudflare: {
        id: string;
        status: string;
        ssl: unknown;
        ownership_verification?: any;
    } | null;
}

export interface DomainListResponse {
    success: boolean;
    baseDomain: string;
    hostnames: DomainListItem[];
    error?: string;
}

// ── API Functions ──────────────────────────────────────────────────────────────

/**
 * Assign a subdomain to a project by calling POST /domain/assign
 * on the screenshit Express API.
 *
 * This creates a Cloudflare custom hostname and writes a KVS routing rule.
 */
export async function screenshitAssignDomain(
    projectId: string,
    lambdaUrl: string,
    subdomain?: string,
): Promise<DomainAssignResponse> {
    const apiBase = getApiBase();
    const url = `${apiBase}/domain/assign`;

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${getApiKey()}`,
        },
        body: JSON.stringify({
            projectId,
            lambdaUrl,
            ...(subdomain ? { subdomain } : {}),
        }),
    });

    if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`/domain/assign failed (HTTP ${response.status}): ${body}`);
    }

    const json = (await response.json()) as DomainAssignResponse;
    if (!json.success) {
        throw new Error(`/domain/assign failed: ${json.error || 'unknown error'}`);
    }
    return json;
}

/**
 * Remove a subdomain from a project by calling DELETE /domain/remove
 * on the screenshit Express API.
 */
export async function screenshitRemoveDomain(
    projectId: string,
    subdomain?: string,
): Promise<DomainRemoveResponse> {
    const apiBase = getApiBase();
    const params = new URLSearchParams({ projectId });
    if (subdomain) params.set('subdomain', subdomain);
    const url = `${apiBase}/domain/remove?${params.toString()}`;

    const response = await fetch(url, {
        method: 'DELETE',
        headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${getApiKey()}`,
        },
    });

    if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`/domain/remove failed (HTTP ${response.status}): ${body}`);
    }

    const json = (await response.json()) as DomainRemoveResponse;
    if (!json.success) {
        throw new Error(`/domain/remove failed: ${json.error || 'unknown error'}`);
    }
    return json;
}

/**
 * Check the status of a subdomain by calling GET /domain/status
 * on the screenshit Express API.
 */
export async function screenshitDomainStatus(
    subdomain: string,
): Promise<DomainStatusResponse> {
    const apiBase = getApiBase();
    const url = `${apiBase}/domain/status?subdomain=${encodeURIComponent(subdomain)}`;

    const response = await fetch(url, {
        headers: {
            Authorization: `Bearer ${getApiKey()}`,
        },
    });

    if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`/domain/status failed (HTTP ${response.status}): ${body}`);
    }

    return (await response.json()) as DomainStatusResponse;
}

/**
 * Assign a custom domain to a project by calling POST /domain/custom/assign
 * on the screenshit Express API.
 */
export async function screenshitAssignCustomDomain(
    projectId: string,
    lambdaUrl: string,
    customDomain: string,
): Promise<CustomDomainAssignResponse> {
    const apiBase = getApiBase();
    const url = `${apiBase}/domain/custom/assign`;

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${getApiKey()}`,
        },
        body: JSON.stringify({
            projectId,
            lambdaUrl,
            customDomain,
        }),
    });

    if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`/domain/custom/assign failed (HTTP ${response.status}): ${body}`);
    }

    const json = (await response.json()) as CustomDomainAssignResponse;
    if (!json.success) {
        throw new Error(`/domain/custom/assign failed: ${json.error || 'unknown error'}`);
    }
    return json;
}

/**
 * Remove a custom domain from a project by calling DELETE /domain/custom/remove
 */
export async function screenshitRemoveCustomDomain(
    domain: string,
): Promise<DomainRemoveResponse> {
    const apiBase = getApiBase();
    const params = new URLSearchParams({ domain });
    const url = `${apiBase}/domain/custom/remove?${params.toString()}`;

    const response = await fetch(url, {
        method: 'DELETE',
        headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${getApiKey()}`,
        },
    });

    if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`/domain/custom/remove failed (HTTP ${response.status}): ${body}`);
    }

    const json = (await response.json()) as DomainRemoveResponse;
    if (!json.success) {
        throw new Error(`/domain/custom/remove failed: ${json.error || 'unknown error'}`);
    }
    return json;
}

/**
 * Check the status of a custom domain by calling GET /domain/status?domain=...
 */
export async function screenshitCustomDomainStatus(
    domain: string,
): Promise<CustomDomainStatusResponse> {
    const apiBase = getApiBase();
    const url = `${apiBase}/domain/status?domain=${encodeURIComponent(domain)}`;

    const response = await fetch(url, {
        headers: {
            Authorization: `Bearer ${getApiKey()}`,
        },
    });

    if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`/domain/status failed (HTTP ${response.status}): ${body}`);
    }

    return (await response.json()) as CustomDomainStatusResponse;
}

/**
 * List all active subdomains by calling GET /domain/list
 * on the screenshit Express API.
 */
export async function screenshitListDomains(): Promise<DomainListResponse> {
    const apiBase = getApiBase();
    const url = `${apiBase}/domain/list`;

    const response = await fetch(url, {
        headers: {
            Authorization: `Bearer ${getApiKey()}`,
        },
    });

    if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`/domain/list failed (HTTP ${response.status}): ${body}`);
    }

    return (await response.json()) as DomainListResponse;
}
