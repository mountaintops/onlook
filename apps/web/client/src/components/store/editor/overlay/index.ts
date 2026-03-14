import type { DomElement, DomElementStyles, RectDimensions } from '@onlook/models';
import { debounce } from 'lodash';
import { makeAutoObservable, reaction } from 'mobx';
import type { EditorEngine } from '../engine';
import { OverlayState } from './state';
import { adaptRectToCanvas } from './utils';

export class OverlayManager {
    state: OverlayState = new OverlayState();
    private canvasReactionDisposer?: () => void;

    constructor(private editorEngine: EditorEngine) {
        makeAutoObservable(this);
    }

    init() {
        this.canvasReactionDisposer = reaction(
            () => ({
                position: this.editorEngine.canvas?.position,
                scale: this.editorEngine.canvas?.scale,
                shouldHideOverlay: this.editorEngine.state?.shouldHideOverlay,
            }),
            () => {
                this.refresh();
            },
        );
    }

    undebouncedRefresh = async () => {
        this.state.removeHoverRect();

        // Refresh click rects
        const newClickRects: { rect: RectDimensions; styles: DomElementStyles | null }[] = [];
        for (const selectedElement of this.editorEngine.elements.selected) {
            const frameData = this.editorEngine.frames.get(selectedElement.frameId);
            if (!frameData) {
                continue;
            }
            const { view } = frameData;
            if (!view) {
                continue;
            }
            try {
                const el: DomElement | null = await view.getElementByDomId(selectedElement.domId, true);
                if (!el) {
                    continue;
                }
                const adaptedRect = adaptRectToCanvas(el.rect, view);
                newClickRects.push({ rect: adaptedRect, styles: el.styles });
            } catch (e) {
                console.warn(`Failed to get element ${selectedElement.domId} for overlay:`, e);
                continue;
            }
        }

        this.state.removeClickRects();
        for (const clickRect of newClickRects) {
            this.state.addClickRect(clickRect.rect, clickRect.styles);
        }

        // Refresh text editor position if it's active
        if (this.editorEngine.text.isEditing && this.editorEngine.text.targetElement) {
            const targetElement = this.editorEngine.text.targetElement;
            const frameData = this.editorEngine.frames.get(targetElement.frameId);
            const view = frameData?.view;
            if (view) {
                try {
                    const el: DomElement | null = await view.getElementByDomId(
                        targetElement.domId,
                        true,
                    );
                    if (el) {
                        const adaptedRect = adaptRectToCanvas(el.rect, view);
                        this.state.updateTextEditor(adaptedRect, {
                            styles: el.styles?.computed
                        });
                    }
                } catch (e) {
                    console.warn('Failed to refresh text editor position:', e);
                }
            }
        }
    };

    refresh = debounce(this.undebouncedRefresh, 100, { leading: true });

    showMeasurement() {
        this.editorEngine.overlay.removeMeasurement();
        if (!this.editorEngine.elements.selected.length || !this.editorEngine.elements.hovered) {
            return;
        }

        const selectedEl = this.editorEngine.elements.selected[0];
        if (!selectedEl) {
            return;
        }

        const hoverEl = this.editorEngine.elements.hovered;
        const frameId = selectedEl.frameId;
        const frameData = this.editorEngine.frames.get(frameId);
        if (!frameData) {
            return;
        }

        const { view } = frameData;

        if (!view) {
            console.error('No frame view found');
            return;
        }

        const selectedRect = adaptRectToCanvas(selectedEl.rect, view);
        const hoverRect = adaptRectToCanvas(hoverEl.rect, view);

        this.editorEngine.overlay.updateMeasurement(selectedRect, hoverRect);
    }

    updateMeasurement = (fromRect: RectDimensions, toRect: RectDimensions) => {
        this.state.updateMeasurement(fromRect, toRect);
    };

    removeMeasurement = () => {
        this.state.removeMeasurement();
    };

    clearUI = () => {
        this.removeMeasurement();
        this.state.clear();
    };

    clear = () => {
        this.canvasReactionDisposer?.();
        this.canvasReactionDisposer = undefined;
    };
}
