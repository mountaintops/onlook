import { api } from '@/trpc/client';
import { getBranchDocHandle, cloneBranchDoc } from '@/services/automerge/repo';
import type { DocHandle } from '@automerge/automerge-repo';
import { CodeFileSystem } from '@onlook/file-system';
import type { Branch, RouterType } from '@onlook/models';
import { toast } from '@onlook/ui/sonner';
import type { ParsedError } from '@onlook/utility';
import { makeAutoObservable, reaction } from 'mobx';
import type { EditorEngine } from '../engine';
import { ErrorManager } from '../error';
import { HistoryManager } from '../history';
import { SandboxManager } from '../sandbox';

// Dynamically import Heads to avoid SSR WASM issues
type Heads = any; 

export interface BranchData {
    branch: Branch;
    sandbox: SandboxManager;
    history: HistoryManager;
    error: ErrorManager;
    codeEditor: CodeFileSystem;
    automergeHandle?: DocHandle<any>;
    undoStack: Heads[];
    redoStack: Heads[];
}

export class BranchManager {
    private editorEngine: EditorEngine;
    private currentBranchId: string | null = null;
    private branchMap = new Map<string, BranchData>();
    private reactionDisposer: (() => void) | null = null;
    private automergeLib: any = null;

    constructor(editorEngine: EditorEngine) {
        this.editorEngine = editorEngine;
        makeAutoObservable(this);
    }

    private async getAutomerge() {
        if (typeof window === 'undefined') return null;
        if (!this.automergeLib) {
            this.automergeLib = await import('@automerge/automerge');
        }
        return this.automergeLib;
    }

    initBranches(branches: Branch[]): void {
        this.reactionDisposer?.();
        this.reactionDisposer = null;
        for (const { sandbox, history, error, codeEditor } of this.branchMap.values()) {
            sandbox.clear();
            history.clear();
            error.clear();
            void codeEditor.cleanup();
        }
        this.branchMap.clear();
        for (const branch of branches) {
            this.createBranchData(branch);
        }
        // Preserve previous selection if still present; else default; else first; else null
        const prev = this.currentBranchId;
        if (prev && this.branchMap.has(prev)) {
            this.currentBranchId = prev;
        } else {
            this.currentBranchId =
                branches.find((b) => b.isDefault)?.id ?? branches[0]?.id ?? null;
        }
    }

    async init(): Promise<void> {
        // Find the branch that should be active first
        const activeBranchId = this.currentBranchId;
        if (!activeBranchId) return;

        // Initialize active branch first to unblock the UI
        const activeData = this.branchMap.get(activeBranchId);
        if (activeData) {
            console.log(`[BranchManager] Initializing active branch: ${activeBranchId}`);
            const handle = await getBranchDocHandle(activeBranchId);
            activeData.automergeHandle = handle;
            (activeData.codeEditor as any).automergeHandle = handle;
            await activeData.codeEditor.initialize();
            
            // Re-detect router if needed
            const routerConfig = await activeData.sandbox.getRouterConfig().catch(() => null);
            if (routerConfig) {
                (activeData.codeEditor as any).options.routerType = routerConfig.type;
            }

            // Start sandbox in background
            void activeData.sandbox.init();
        }

        // Initialize other branches in the background without awaiting them
        Array.from(this.branchMap.entries()).forEach(async ([branchId, data]) => {
            if (branchId === activeBranchId) return;
            
            try {
                const handle = await getBranchDocHandle(branchId);
                data.automergeHandle = handle;
                (data.codeEditor as any).automergeHandle = handle;
                await data.codeEditor.initialize();
                void data.sandbox.init();
            } catch (e) {
                console.error(`[BranchManager] Background init failed for branch ${branchId}:`, e);
            }
        });

        this.setupActiveFrameReaction();
    }

    private setupActiveFrameReaction(): void {
        this.reactionDisposer?.();
        this.reactionDisposer = reaction(
            () => {
                const selectedFrames = this.editorEngine.frames.selected;
                const activeFrame =
                    selectedFrames.length > 0
                        ? selectedFrames[0]
                        : this.editorEngine.frames.getAll()[0];
                return activeFrame?.frame?.branchId || null;
            },
            (activeBranchId) => {
                if (
                    activeBranchId &&
                    activeBranchId !== this.currentBranchId &&
                    this.branchMap.has(activeBranchId)
                ) {
                    this.currentBranchId = activeBranchId;
                }
            },
        );
    }

    get activeBranchData(): BranchData {
        if (!this.currentBranchId) {
            throw new Error(
                'No branch selected. This should not happen after proper initialization.',
            );
        }
        const branchData = this.branchMap.get(this.currentBranchId);
        if (!branchData) {
            throw new Error(
                `Branch not found for branch ${this.currentBranchId}. This should not happen after proper initialization.`,
            );
        }
        return branchData;
    }

    get activeBranch(): Branch {
        return this.activeBranchData.branch;
    }

    get activeSandbox(): SandboxManager {
        return this.activeBranchData.sandbox;
    }

    get activeHistory(): HistoryManager {
        return this.activeBranchData.history;
    }

    get activeError(): ErrorManager {
        return this.activeBranchData.error;
    }

    get activeCodeEditor(): CodeFileSystem {
        return this.activeBranchData.codeEditor;
    }

    get activeAutomergeHandle(): DocHandle<any> | undefined {
        return this.activeBranchData.automergeHandle;
    }

    get canUndo(): boolean {
        try {
            return this.activeBranchData.undoStack.length > 0;
        } catch {
            return false;
        }
    }

    get canRedo(): boolean {
        try {
            return this.activeBranchData.redoStack.length > 0;
        } catch {
            return false;
        }
    }

    async recordChange(): Promise<void> {
        const handle = this.activeAutomergeHandle;
        if (!handle) return;

        const automerge = await this.getAutomerge();
        if (!automerge) return;

        const doc = handle.docSync();
        if (!doc) return;

        const heads = automerge.getHeads(doc);
        const data = this.activeBranchData;

        // If stack is empty or heads are different from last recorded, record them
        const lastHeads = data.undoStack[data.undoStack.length - 1];
        if (!lastHeads || JSON.stringify(lastHeads) !== JSON.stringify(heads)) {
            data.undoStack.push(heads);
            data.redoStack = []; // Clear redo stack on new change

            // Limit stack size to 50
            if (data.undoStack.length > 50) {
                data.undoStack.shift();
            }
        }
    }

    async undo(): Promise<void> {
        const data = this.activeBranchData;
        if (data.undoStack.length === 0 || !data.automergeHandle) {
            return;
        }

        const automerge = await this.getAutomerge();
        if (!automerge) return;

        const doc = data.automergeHandle.docSync();
        if (!doc) return;

        const currentHeads = automerge.getHeads(doc);
        const targetHeads = data.undoStack.pop()!;
        data.redoStack.push(currentHeads);

        this.applyHeads(targetHeads);
    }

    async redo(): Promise<void> {
        const data = this.activeBranchData;
        if (data.redoStack.length === 0 || !data.automergeHandle) {
            return;
        }

        const automerge = await this.getAutomerge();
        if (!automerge) return;

        const doc = data.automergeHandle.docSync();
        if (!doc) return;

        const currentHeads = automerge.getHeads(doc);
        const targetHeads = data.redoStack.pop()!;
        data.undoStack.push(currentHeads);

        this.applyHeads(targetHeads);
    }

    private async applyHeads(targetHeads: any): Promise<void> {
        const handle = this.activeAutomergeHandle;
        if (!handle) return;

        const automerge = await this.getAutomerge();
        if (!automerge) return;

        handle.change((doc) => {
            const currentHeads = automerge.getHeads(doc);
            const patches = automerge.diff(doc, currentHeads, targetHeads);
            automerge.applyPatches(doc, patches);
        });
    }

    async switchToBranch(branchId: string): Promise<void> {
        if (this.currentBranchId === branchId) {
            return;
        }
        this.currentBranchId = branchId;
    }

    getBranchDataById(branchId: string): BranchData | null {
        return this.branchMap.get(branchId) ?? null;
    }

    getBranchById(branchId: string): Branch | null {
        return this.getBranchDataById(branchId)?.branch ?? null;
    }

    getSandboxById(branchId: string): SandboxManager | null {
        return this.getBranchDataById(branchId)?.sandbox ?? null;
    }

    async forkBranch(branchId: string): Promise<void> {
        if (!branchId) {
            throw new Error('No active branch to fork');
        }

        const branch = this.getBranchById(branchId);
        if (!branch) {
            throw new Error('Branch not found');
        }

        try {
            toast.loading(`Forking branch "${branch.name}"...`);
            // Call the fork API
            const result = await api.branch.fork.mutate({ branchId });

            // Create branch metadata synchronously
            const branchData = this.createBranchData(result.branch, undefined);
            
            // Load handle asynchronously
            const handle = await cloneBranchDoc(branchId, result.branch.id);
            branchData.automergeHandle = handle;
            (branchData.codeEditor as any).automergeHandle = handle;

            await branchData.codeEditor.initialize();
            await branchData.sandbox.init();

            // Add the created frames to the frame manager
            if (result.frames && result.frames.length > 0) {
                this.editorEngine.frames.applyFrames(result.frames);
            }

            // Switch to the new branch
            await this.switchToBranch(result.branch.id);
        } catch (error) {
            console.error('Failed to fork branch:', error);
            toast.error('Failed to fork branch');
            throw error;
        } finally {
            toast.dismiss();
        }
    }

    async createBlankSandbox(branchName?: string): Promise<void> {
        try {
            toast.loading('Creating blank sandbox...');
            // Get current active frame for positioning
            const activeFrames = this.editorEngine.frames.selected;
            const activeFrame =
                activeFrames.length > 0 ? activeFrames[0] : this.editorEngine.frames.getAll()[0];

            let framePosition;
            if (activeFrame) {
                const frame = activeFrame.frame;
                framePosition = {
                    x: frame.position.x,
                    y: frame.position.y,
                    width: frame.dimension.width,
                    height: frame.dimension.height,
                };
            }

            // Get current project ID from existing branches
            const currentBranches = Array.from(this.branchMap.values());
            if (currentBranches.length === 0) {
                throw new Error('No project context available');
            }
            const projectId = currentBranches[0]!.branch.projectId;

            // Call the createBlank API
            const result = await api.branch.createBlank.mutate({
                projectId,
                branchName,
                framePosition,
            });

            const routerConfig = await this.activeSandbox.getRouterConfig();

            // Add the new branch to the local branch map
            const branchData = this.createBranchData(result.branch, routerConfig?.type);
            
            // Load handle asynchronously
            const handle = await getBranchDocHandle(result.branch.id);
            branchData.automergeHandle = handle;
            (branchData.codeEditor as any).automergeHandle = handle;

            await branchData.codeEditor.initialize();
            await branchData.sandbox.init();

            // Add the created frames to the frame manager
            if (result.frames && result.frames.length > 0) {
                this.editorEngine.frames.applyFrames(result.frames);
            }

            // Switch to the new branch
            await this.switchToBranch(result.branch.id);
        } catch (error) {
            console.error('Failed to create blank sandbox:', error);
            toast.error('Failed to create blank sandbox');
            throw error;
        } finally {
            toast.dismiss();
        }
    }

    async updateBranch(branchId: string, updates: Partial<Branch>): Promise<void> {
        const branchData = this.branchMap.get(branchId);
        if (!branchData) {
            throw new Error('Branch not found');
        }

        try {
            const success = await api.branch.update.mutate({
                id: branchId,
                ...updates,
            });

            if (success) {
                // Update local branch state
                Object.assign(branchData.branch, updates);
            } else {
                throw new Error('Failed to update branch');
            }
        } catch (error) {
            console.error('Failed to update branch:', error);
            throw error;
        }
    }

    async removeBranch(branchId: string): Promise<void> {
        const branchData = this.branchMap.get(branchId);
        if (branchData) {
            // Remove all frames associated with this branch
            const framesToRemove = this.editorEngine.frames.getAll().filter(
                (frameState) => frameState.frame.branchId === branchId,
            );

            for (const frameState of framesToRemove) {
                this.editorEngine.frames.delete(frameState.frame.id);
            }

            // Clean up the sandbox, history, error manager, and code editor
            branchData.sandbox.clear();
            branchData.history.clear();
            branchData.error.clear();

            // Clean up the entire branch directory
            await branchData.codeEditor.cleanup();
            // Remove from the map
            this.branchMap.delete(branchId);

            // If this was the current branch, switch to default or first available
            if (this.currentBranchId === branchId) {
                const remainingBranches = Array.from(this.branchMap.values()).map(
                    ({ branch }) => branch,
                );
                this.currentBranchId =
                    remainingBranches.find((b) => b.isDefault)?.id ??
                    remainingBranches[0]?.id ??
                    null;
            }
        }
    }

    async clear(): Promise<void> {
        this.reactionDisposer?.();
        this.reactionDisposer = null;
        for (const branchData of this.branchMap.values()) {
            branchData.sandbox.clear();
            branchData.history.clear();
            branchData.error.clear();
            await branchData.codeEditor.cleanup();
        }
        this.branchMap.clear();
        this.currentBranchId = null;
    }

    get allBranches(): Branch[] {
        return Array.from(this.branchMap.values()).map(({ branch }) => branch);
    }

    async listBranches(): Promise<Branch[]> {
        return this.allBranches;
    }

    private createBranchData(
        branch: Branch,
        routerType?: RouterType,
    ): BranchData {
        const codeEditorApi = new CodeFileSystem(this.editorEngine.projectId, branch.id, {
            routerType,
            // Handle will be set later asynchronously
        });
        const errorManager = new ErrorManager(branch);
        const sandboxManager = new SandboxManager(
            branch,
            this.editorEngine,
            errorManager,
            codeEditorApi,
        );
        const historyManager = new HistoryManager(this.editorEngine);

        const branchData: BranchData = {
            branch,
            sandbox: sandboxManager,
            history: historyManager,
            error: errorManager,
            codeEditor: codeEditorApi,
            undoStack: [],
            redoStack: [],
        };

        this.branchMap.set(branch.id, branchData);

        return branchData;
    }

    // Helper methods for error management
    getAllErrors(): ParsedError[] {
        const allErrors: ParsedError[] = [];
        for (const branchData of this.branchMap.values()) {
            const branchErrors = branchData.error.errors.map(error => ({
                ...error,
                branchId: branchData.branch.id,
                branchName: branchData.branch.name,
            }));
            allErrors.push(...branchErrors);
        }
        return allErrors;
    }

    getTotalErrorCount(): number {
        return Array.from(this.branchMap.values()).reduce(
            (total, branchData) => total + branchData.error.errors.length,
            0
        );
    }

    getErrorsForBranch(branchId: string): ParsedError[] {
        const branchData = this.getBranchDataById(branchId);
        return branchData?.error.errors || [];
    }
}