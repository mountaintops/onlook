import { makeAutoObservable, observable, action, computed } from 'mobx';
import type { EditorEngine } from '../engine';
import { v4 as uuidv4 } from 'uuid';
import type { IFrameView } from '@/app/project/[id]/_components/canvas/frame/view';

export interface EditorTweak {
    id: string;
    name: string;
    type: 'number' | 'color';
    cssVariable: string;
    min?: number;
    max?: number;
    value: number | string;
    unit?: string;
    category?: string;
    targetOid?: string;
}

export class TweaksManager {
    _activeTweaks: EditorTweak[] | null = null;

    get activeTweaks(): EditorTweak[] {
        if (this._activeTweaks === null) {
            this.init();
        }
        return this._activeTweaks || [];
    }

    constructor(private editorEngine: EditorEngine) {
        makeAutoObservable(this, {
            _activeTweaks: observable,
            activeTweaks: computed,
        });
    }

    private get storageKey() {
        const projectId = this.editorEngine.projectId;
        if (!projectId) {
            console.error('[TweaksManager] CRITICAL: No project ID found in editorEngine');
            return null;
        }
        return `onlook-tweaks-${projectId}`;
    }

    init() {
        if (typeof window === 'undefined' || this._activeTweaks !== null) {
            return;
        }

        const key = this.storageKey;
        if (!key) {
            return;
        }

        try {
            const stored = localStorage.getItem(key);
            if (stored) {
                const parsed = JSON.parse(stored);
                if (Array.isArray(parsed)) {
                    this._activeTweaks = parsed;
                    console.log(`[TweaksManager] Successfully restored ${parsed.length} tweaks for project: ${this.editorEngine.projectId}`);
                } else {
                    console.warn('[TweaksManager] Stored tweaks data is not an array, resetting');
                    this._activeTweaks = [];
                }
            } else {
                console.log(`[TweaksManager] No existing tweaks found for project: ${this.editorEngine.projectId}`);
                this._activeTweaks = [];
            }
        } catch (e) {
            console.error('[TweaksManager] Failed to initialize from localStorage', e);
            this._activeTweaks = [];
        }
    }

    private save() {
        if (typeof window === 'undefined' || this._activeTweaks === null) {
            return;
        }

        const key = this.storageKey;
        if (!key) {
            return;
        }

        try {
            localStorage.setItem(key, JSON.stringify(this._activeTweaks));
        } catch (e) {
            console.error('[TweaksManager] Failed to save tweaks to localStorage', e);
        }
    }

    addTweaks(tweaksInput: Omit<EditorTweak, 'id'>[]) {
        // Ensure initialized before adding
        if (this._activeTweaks === null) {
            this.init();
        }

        const newTweaks = tweaksInput.map(tweak => ({
            ...tweak,
            id: uuidv4(),
        }));
        
        // Merge with existing tweaks by css variable, to avoid duplication
        const existingMap = new Map((this._activeTweaks || []).map(t => [t.cssVariable, t]));
        for (const newTweak of newTweaks) {
            existingMap.set(newTweak.cssVariable, newTweak);
        }
        
        this._activeTweaks = Array.from(existingMap.values());
        this.save();
        
        // Apply values immediately
        this._activeTweaks.forEach(tweak => {
            this.applyTweakVariableToFrames(tweak.cssVariable, tweak.value, tweak.unit || '');
        });
    }

    updateTweakValue(id: string, value: number | string) {
        const tweak = this.activeTweaks.find(t => t.id === id);
        if (tweak) {
            tweak.value = value;
            this.save();
            this.applyTweakVariableToFrames(tweak.cssVariable, value, tweak.unit || '');
        }
    }

    removeTweak(id: string) {
        this._activeTweaks = (this._activeTweaks || []).filter(t => t.id !== id);
        this.save();
    }

    removeAll() {
        this._activeTweaks = [];
        this.save();
    }

    clear() {
        // Just clear memory, don't wipe storage
        this._activeTweaks = null;
    }

    applyTweaksToFrame(view: IFrameView) {
        this.activeTweaks.forEach(tweak => {
            const valueStr = tweak.type === 'color' ? String(tweak.value) : `${tweak.value}${tweak.unit || ''}`;
            view.updateCssVariable(tweak.cssVariable, valueStr).catch((err) => {
                console.warn('[TweaksManager] Failed to apply tweak to frame', err);
            });
        });
    }

    private applyTweakVariableToFrames(cssVariable: string, value: number | string, unit: string) {
        const tweak = this.activeTweaks.find(t => t.cssVariable === cssVariable);
        const valueStr = tweak?.type === 'color' ? String(value) : `${value}${unit || ''}`;
        
        this.editorEngine.frames.getAll().forEach(frameData => {
            if (frameData.view) {
                frameData.view.updateCssVariable(cssVariable, valueStr).catch((err) => {
                    console.warn('[TweaksManager] Failed to apply tweak to frame', err);
                });
            }
        });
    }
}
