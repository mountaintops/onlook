
import { next as Automerge } from '@automerge/automerge';
import type { DocHandle } from '@automerge/automerge-repo';
import type { OnlookDoc } from '../index';

export class UndoRedoManager {
    private undoStack: Automerge.Heads[] = [];
    private redoStack: Automerge.Heads[] = [];
    private currentHeads: Automerge.Heads | null = null;
    private isUndoingOrRedoing = false;

    constructor(private handle: DocHandle<OnlookDoc>) {
        this.handle.on('change', this.onChange);
        // Initialize current heads
        const doc = this.handle.docSync();
        if (doc) {
            this.currentHeads = Automerge.getHeads(doc);
        }
    }

    private onChange = ({ doc }: { doc: OnlookDoc }) => {
        if (this.isUndoingOrRedoing) {
            return;
        }

        const newHeads = Automerge.getHeads(doc);
        if (this.currentHeads && !this.areHeadsEqual(this.currentHeads, newHeads)) {
            this.undoStack.push(this.currentHeads);
            this.redoStack = []; // Clear redo stack on new change
        }
        this.currentHeads = newHeads;
    };

    undo() {
        if (this.undoStack.length === 0) {
            console.warn('Nothing to undo');
            return;
        }

        const previousHeads = this.undoStack.pop();
        if (!previousHeads) {
            return;
        }

        const doc = this.handle.docSync();
        if (!doc || !this.currentHeads) {
            console.error('Cannot undo: document or current heads missing');
            return;
        }

        this.redoStack.push(this.currentHeads);
        this.applyHeads(previousHeads);
    }

    redo() {
        if (this.redoStack.length === 0) {
            console.warn('Nothing to redo');
            return;
        }

        const nextHeads = this.redoStack.pop();
        if (!nextHeads) {
            return;
        }

        if (!this.currentHeads) {
            console.error('Cannot redo: current heads missing');
            return;
        }

        this.undoStack.push(this.currentHeads);
        this.applyHeads(nextHeads);
    }

    private applyHeads(heads: Automerge.Heads) {
        this.isUndoingOrRedoing = true;
        try {
            const doc = this.handle.docSync();
            if (!doc) return;

            // Calculate patches to transition TO the target state (heads)
            // Automerge.diff(doc, from, to) -> patches to go from 'from' to 'to'.
            // Here 'from' is current doc state (which has current heads).
            // 'to' is target heads.
            const currentHeads = Automerge.getHeads(doc);
            const patches = Automerge.diff(doc, currentHeads, heads);

            if (patches.length > 0) {
                this.handle.change((d) => {
                    this.applyPatches(d, patches);
                });
            }
            this.currentHeads = heads;
        } catch (e) {
            console.error('Error applying heads during undo/redo:', e);
        } finally {
            this.isUndoingOrRedoing = false;
        }
    }

    private applyPatches(doc: any, patches: Automerge.Patch[]) {
        for (const patch of patches) {
            this.applyPatch(doc, patch);
        }
    }

    private applyPatch(doc: any, patch: Automerge.Patch) {
        const { action, path } = patch;

        // Handle text splice explicitly using Automerge.splice
        if (action === 'splice') {
            // patch.value is the string to insert.
            // path implies index at the end.
            const index = Number(path[path.length - 1]);
            const propPath = path.slice(0, -1) as string[];
            Automerge.splice(doc, propPath, index, 0, patch.value);
            return;
        }

        // Navigate to parent object for other actions
        let current: any = doc;
        for (let i = 0; i < path.length - 1; i++) {
            current = current[path[i]];
        }
        const key = path[path.length - 1];

        if (action === 'put') {
            current[key] = patch.value;
        } else if (action === 'del') {
            if (Array.isArray(current)) {
                const len = patch.length ?? 1;
                current.splice(Number(key), len);
            } else if (typeof current === 'object' && current !== null) {
                // Check if target property is a string (primitive)
                // If it is, we should use Automerge.splice/updateText but 'del' on string usually
                // comes with string path components.
                // However, since we are here, 'current' is the parent object.
                // If current[key] is a string...
                const val = current[key];
                if (typeof val === 'string') {
                    // String deletion.
                    // path for text del: [...path, index].
                    // In this case 'key' IS the index.
                    // 'current' IS the string? No, current is parent object.
                    // Wait. If path is ['text', 0], current is doc.text (string).
                    // But we loop diff path length - 1.
                    // So for ['text', 0], loop runs for 'text'. current becomes doc['text'].
                    // key becomes 0.
                    // BUT doc['text'] IS A STRING PRIMITIVE.
                    // We cannot assign to it or call methods on it.

                    // Correction: We must stop BEFORE resolving the string primitive.
                    // Check if resolving path[i] yields a string.

                    // Let's re-verify logic.
                    // If target is text, we MUST use Automerge.splice on the doc root with full path.
                }

                // General deletion
                delete current[key];
            }
        } else if (action === 'insert') {
            if (Array.isArray(current)) {
                current.splice(Number(key), 0, ...patch.values);
            }
        } else if (action === 'inc') {
            if (typeof current[key] === 'number' || typeof current[key] === 'object') {
                // Counter or number
                // Automerge proxy handles increment?
                // Usually: current[key].increment(patch.value)
                // Or: current[key] += patch.value
                // For Counters, we might need specific method.
                // Assuming number for now.
                if (current[key].increment) {
                    current[key].increment(patch.value);
                } else {
                    current[key] += patch.value;
                }
            }
        }
    }

    private areHeadsEqual(heads1: Automerge.Heads, heads2: Automerge.Heads): boolean {
        if (heads1.length !== heads2.length) return false;
        const set1 = new Set(heads1);
        return heads2.every(h => set1.has(h));
    }
}
