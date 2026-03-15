// Note: We use dynamic imports for Automerge to avoid SSR WASM errors in Next.js.
// These libraries expect a browser environment and attempt to load WASM immediately upon import.

export interface AutomergeDoc {
    files: Record<string, string | Uint8Array>;
}

// Singleton Repo instance, initialized lazily on the client
let repo: any = null;

async function getRepo(): Promise<any> {
    if (typeof window === 'undefined') {
        throw new Error('Automerge Repo can only be initialized in the browser');
    }
    if (!repo) {
        // Dynamic imports to prevent server-side evaluation
        const { Repo } = await import('@automerge/automerge-repo');
        const { IndexedDBStorageAdapter } = await import('@automerge/automerge-repo-storage-indexeddb');
        
        repo = new Repo({
            storage: new IndexedDBStorageAdapter('onlook-automerge'),
            network: [], // Network adapters could be added here for sync later
        });
    }
    return repo;
}

/**
 * Ensures a document exists for the given projectId/branchId.
 * If it exists in storage, it's loaded. Otherwise, a new one is created.
 */
export async function getBranchDocHandle(branchId: string): Promise<any> {
    if (typeof window === 'undefined') {
        throw new Error('getBranchDocHandle can only be called in the browser');
    }

    const r = await getRepo();
    const storageKey = `onlook-automerge-doc-id-${branchId}`;
    const docId = localStorage.getItem(storageKey);

    if (docId) {
        try {
            // Use AbortController for a 5-second timeout on find()
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);
            
            try {
                const handle = await r.find(docId, { signal: controller.signal });
                clearTimeout(timeoutId);
                return handle;
            } catch (e: any) {
                clearTimeout(timeoutId);
                if (e.name === 'AbortError') {
                    console.warn(`[Automerge] Timeout finding doc ${docId} for branch ${branchId}. Creating new doc instead.`);
                } else {
                    throw e;
                }
            }
        } catch (e) {
            console.error(`[Automerge] Failed to load doc ${docId}, creating new one`, e);
        }
    }

    // Create new doc
    const handle = r.create();
    handle.change((d: any) => {
        d.files = {};
    });

    // Save ID for next time
    localStorage.setItem(storageKey, handle.documentId);
    console.log(`[Automerge] Created new document for branch ${branchId}: ${handle.documentId}`);
    return handle;
}

export async function getProjectDocHandle(projectId: string): Promise<any> {
    return getBranchDocHandle(projectId);
}

/**
 * Clones an existing branch's document for a new branch.
 * This is the "Zero-Copy" core logic.
 */
export async function cloneBranchDoc(
    sourceBranchId: string,
    targetBranchId: string,
): Promise<any> {
    if (typeof window === 'undefined') {
        throw new Error('cloneBranchDoc can only be called in the browser');
    }

    const r = await getRepo();
    const sourceStorageKey = `onlook-automerge-doc-id-${sourceBranchId}`;
    const sourceDocId = localStorage.getItem(sourceStorageKey);

    if (!sourceDocId) {
        console.warn(
            `[Automerge] No source document found for branch ${sourceBranchId}, creating fresh instead`,
        );
        return getBranchDocHandle(targetBranchId);
    }

    try {
        const sourceHandle = await r.find(sourceDocId);
        // repo.clone() creates a new doc with all the history and state of the source
        const targetHandle = r.clone(sourceHandle);

        const targetStorageKey = `onlook-automerge-doc-id-${targetBranchId}`;
        localStorage.setItem(targetStorageKey, targetHandle.documentId);

        console.log(
            `[Automerge] Cloned ${sourceBranchId} (${sourceDocId}) -> ${targetBranchId} (${targetHandle.documentId})`,
        );
        return targetHandle;
    } catch (e) {
        console.error(`[Automerge] Failed to clone ${sourceBranchId}, fallback to fresh`, e);
        return getBranchDocHandle(targetBranchId);
    }
}
