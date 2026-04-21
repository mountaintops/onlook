import { makeAutoObservable } from 'mobx';
import type { EditorEngine } from '../engine';
import { v4 as uuidv4 } from 'uuid';
import type { IFrameView } from '@/app/project/[id]/_components/canvas/frame/view';

export interface EditorTweak {
    id: string;
    name: string;
    cssVariable: string;
    min: number;
    max: number;
    value: number;
    unit?: string;
}

export class TweaksManager {
    activeTweaks: EditorTweak[] = [];

    constructor(private editorEngine: EditorEngine) {
        makeAutoObservable(this);
    }

    private get storageKey() {
        return `onlook-tweaks-${this.editorEngine.projectId}`;
    }

    init() {
        if (typeof window === 'undefined') {
            return;
        }
        const stored = localStorage.getItem(this.storageKey);
        if (stored) {
            try {
                this.activeTweaks = JSON.parse(stored);
            } catch (e) {
                console.error('[TweaksManager] Failed to parse stored tweaks', e);
            }
        }
    }

    private save() {
        if (typeof window === 'undefined') {
            return;
        }
        localStorage.setItem(this.storageKey, JSON.stringify(this.activeTweaks));
    }

    addTweaks(tweaksInput: Omit<EditorTweak, 'id'>[]) {
        const newTweaks = tweaksInput.map(tweak => ({
            ...tweak,
            id: uuidv4(),
        }));
        
        // Merge with existing tweaks by css variable, to avoid duplication
        const existingMap = new Map(this.activeTweaks.map(t => [t.cssVariable, t]));
        for (const newTweak of newTweaks) {
            existingMap.set(newTweak.cssVariable, newTweak);
        }
        
        this.activeTweaks = Array.from(existingMap.values());
        this.save();
        
        // Apply values immediately
        for (const tweak of this.activeTweaks) {
            this.applyTweakVariableToFrames(tweak.cssVariable, tweak.value, tweak.unit || '');
        }
    }

    updateTweakValue(id: string, value: number) {
        const tweak = this.activeTweaks.find(t => t.id === id);
        if (tweak) {
            tweak.value = value;
            this.save();
            this.applyTweakVariableToFrames(tweak.cssVariable, value, tweak.unit || '');
        }
    }

    removeTweak(id: string) {
        this.activeTweaks = this.activeTweaks.filter(t => t.id !== id);
        this.save();
    }

    clear() {
        this.activeTweaks = [];
        this.save();
    }

    applyTweaksToFrame(view: IFrameView) {
        for (const tweak of this.activeTweaks) {
            const valueStr = `${tweak.value}${tweak.unit || ''}`;
            view.updateCssVariable(tweak.cssVariable, valueStr).catch((err) => {
                console.warn('[TweaksManager] Failed to apply tweak to frame', err);
            });
        }
    }

    private applyTweakVariableToFrames(cssVariable: string, value: number, unit: string) {
        const valueStr = `${value}${unit || ''}`;

        for (const frameData of this.editorEngine.frames.getAll()) {
            if (frameData.view) {
                frameData.view.updateCssVariable(cssVariable, valueStr).catch((err) => {
                    console.warn('[TweaksManager] Failed to apply tweak to frame', err);
                });
            }
        }
    }
}
