import { makeAutoObservable } from 'mobx';
import type { EditorEngine } from '../engine';
import { v4 as uuidv4 } from 'uuid';

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
    isOpen: boolean = false;

    constructor(private editorEngine: EditorEngine) {
        makeAutoObservable(this);
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
        
        // Apply default values immediately
        for (const tweak of this.activeTweaks) {
            this.applyTweakVariableToFrames(tweak.cssVariable, tweak.value, tweak.unit || '');
        }
    }

    updateTweakValue(id: string, value: number) {
        const tweak = this.activeTweaks.find(t => t.id === id);
        if (tweak) {
            tweak.value = value;
            this.applyTweakVariableToFrames(tweak.cssVariable, value, tweak.unit || '');
        }
    }

    removeTweak(id: string) {
        this.activeTweaks = this.activeTweaks.filter(t => t.id !== id);
    }

    clear() {
        this.activeTweaks = [];
    }

    private applyTweakVariableToFrames(cssVariable: string, value: number, unit: string) {
        const valueStr = `${value}${unit || ''}`;
        
        for (const frameData of this.editorEngine.frames.getAll()) {
            if (frameData.view) {
                try {
                    const doc = frameData.view.contentDocument;
                    if (doc) {
                        doc.documentElement.style.setProperty(cssVariable, valueStr);
                    }
                } catch (err) {
                    console.warn('[TweaksManager] Failed to apply tweak to frame', err);
                }
            }
        }
    }
}
