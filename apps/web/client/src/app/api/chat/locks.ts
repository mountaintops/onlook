/**
 * Simple in-process mutex for limiting GLM-5 (Modal AI) to 1 concurrent request.
 *
 * Because Modal's GLM-5 endpoint only supports a single concurrent request, any
 * second call while one is already in-flight gets an immediate 429 response
 * rather than queuing (which would risk timeouts / resource exhaustion).
 *
 * NOTE: This is process-level only. If you have multiple server instances
 * (e.g. Kubernetes replicas) you'll need a distributed lock (Redis SETNX, etc.).
 * For a single Next.js dev/prod server process this is reliable and zero-overhead.
 */

const locks = new Map<string, boolean>();

export const MODAL_GLM5_LOCK_KEY = 'modal-glm5';

/**
 * Try to acquire the named lock.
 * Returns `true` if acquired, `false` if already held.
 */
export function tryAcquireLock(key: string): boolean {
    if (locks.get(key)) {
        return false;
    }
    locks.set(key, true);
    return true;
}

/**
 * Release the named lock.
 */
export function releaseLock(key: string): void {
    locks.delete(key);
}

/**
 * Returns true if the named lock is currently held.
 */
export function isLocked(key: string): boolean {
    return locks.get(key) === true;
}
