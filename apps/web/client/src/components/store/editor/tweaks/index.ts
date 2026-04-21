import { makeAutoObservable, observable, action, computed } from 'mobx';
import type { EditorEngine } from '../engine';
import { v4 as uuidv4 } from 'uuid';
import { debounce } from 'lodash';
import type { IFrameView } from '@/app/project/[id]/_components/canvas/frame/view';

export interface EditorTweak {
    id: string;
    name: string;
    type: 'number' | 'color';
    cssVariable: string;
    min?: number;
    max?: number;
    value: number | string;
    initialValue?: number | string;
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
            initialValue: tweak.value, // Capture initial value for undo
        }));
        
        // Merge with existing tweaks by css variable, to avoid duplication
        const existingMap = new Map((this._activeTweaks || []).map(t => [t.cssVariable, t]));
        for (const newTweak of newTweaks) {
            // Keep existing initialValue if we already have this tweak
            const existing = existingMap.get(newTweak.cssVariable);
            if (existing && existing.initialValue !== undefined) {
                newTweak.initialValue = existing.initialValue;
            }
            existingMap.set(newTweak.cssVariable, newTweak);
        }
        
        this._activeTweaks = Array.from(existingMap.values());
        this.save();
        
        // Apply values immediately to webview
        this._activeTweaks.forEach(tweak => {
            this.applyTweakVariableToFrames(tweak.cssVariable, tweak.value, tweak.unit || '');
        });
    }

    updateTweakValue(id: string, value: number | string, autoSave = true) {
        const tweak = this.activeTweaks.find(t => t.id === id);
        if (tweak) {
            tweak.value = value;
            this.save();
            this.applyTweakVariableToFrames(tweak.cssVariable, value, tweak.unit || '');
            
            if (autoSave) {
                this.debouncedSaveToCode(id);
            }
        }
    }

    private debouncedSaveToCode = debounce((id: string) => {
        this.saveTweakToCode(id);
    }, 1000);

    async saveTweakToCode(id: string) {
        const tweak = this.activeTweaks.find(t => t.id === id);
        if (!tweak || !tweak.targetOid) {
            return;
        }

        const valueStr = tweak.type === 'color' ? String(tweak.value) : `${tweak.value}${tweak.unit || ''}`;
        
        try {
            const metadata = await this.editorEngine.ast.getJsxElementMetadata(tweak.targetOid);
            if (!metadata) {
                console.warn('[TweaksManager] No metadata found for target OID', tweak.targetOid);
                return;
            }

            const fileContent = await this.editorEngine.fileSystem.readFile(metadata.path);
            if (typeof fileContent !== 'string') {
                return;
            }

            // Surgical replacement of the fallback value in the var() function
            // Pattern: var(--variable-name, fallback)
            const regex = new RegExp(`var\\(${tweak.cssVariable},\\s*[^)]+\\)`, 'g');
            const replacement = `var(${tweak.cssVariable}, ${valueStr})`;
            
            if (regex.test(fileContent)) {
                const newContent = fileContent.replace(regex, replacement);
                await this.editorEngine.fileSystem.writeFile(metadata.path, newContent);
                console.log(`[TweaksManager] Successfully auto-saved tweak ${tweak.name} to code.`);
            } else {
                console.warn(`[TweaksManager] Could not find CSS variable ${tweak.cssVariable} in code for auto-save.`);
            }
        } catch (err) {
            console.error('[TweaksManager] Failed to auto-save tweak to code', err);
        }
    }

    undoTweak(id: string) {
        const tweak = this.activeTweaks.find(t => t.id === id);
        if (tweak && tweak.initialValue !== undefined) {
            this.updateTweakValue(id, tweak.initialValue, true);
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
