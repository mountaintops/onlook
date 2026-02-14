// This file handles the Automerge Repo and IndexedDB persistence
import { Repo } from '@automerge/automerge-repo';
import { IndexedDBStorageAdapter } from '@automerge/automerge-repo-storage-indexeddb';
import { BrowserWebSocketClientAdapter } from '@automerge/automerge-repo-network-websocket';

// Define the document schema directly here since it's simple
export interface AutomergeSchema {
    files: Record<string, string>;
}

const DB_NAME = 'onlook-automerge';
const DOC_URL_KEY = 'onlook-automerge-doc-url';

// Initialize the Repo
// We use IndexedDB for local persistence
// We can add a network adapter later for multiplayer
const repo = new Repo({
    storage: new IndexedDBStorageAdapter(DB_NAME),
    network: [], // No network for now, purely local
});

export { repo };

export async function initPersistence(projectId: string): Promise<import('@automerge/automerge-repo').DocHandle<AutomergeSchema>> {
    // Check if we have a stored document URL for this project
    const key = `${DOC_URL_KEY}-${projectId}`;
    let docUrl = localStorage.getItem(key);

    let handle: import('@automerge/automerge-repo').DocHandle<AutomergeSchema>;

    if (docUrl) {
        // Try to load the existing document
        handle = await repo.find<AutomergeSchema>(docUrl as any);
        // We might want to await handling to ensure it exists, but find() returns a handle immediately
        // The handle might be in a 'loading' state
    } else {
        // Create a new document
        handle = repo.create<AutomergeSchema>();
        handle.change((d) => {
            d.files = {};
        });
        localStorage.setItem(key, handle.url);
    }

    // Wait for the document to be ready (loaded from storage)
    await handle.doc();

    return handle;
}
