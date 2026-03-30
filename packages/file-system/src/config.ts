import ZenFS, { configure, InMemory } from '@zenfs/core';
import { IndexedDB } from '@zenfs/dom';

let configPromise: Promise<void> | null = null;
let isConfigured = false;

export async function getFS(): Promise<typeof ZenFS> {
    if (isConfigured) {
        return ZenFS;
    }

    // Use a single promise to ensure configuration only happens once
    configPromise ??= configure({
        mounts: {
            '/': typeof window === 'undefined'
                ? { backend: InMemory }
                : { backend: IndexedDB, storeName: 'browser-fs' },
        },
    }).then(() => {
        isConfigured = true;
    }).catch((err) => {
        // Reset on error so it can be retried
        configPromise = null;
        throw err;
    });

    await configPromise;
    return ZenFS;
}
