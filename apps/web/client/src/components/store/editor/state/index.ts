import {
    type BranchTabValue,
    type BrandTabValue,
    ChatType,
    EditorMode,
    InsertMode,
    type LeftPanelTabValue,
    LLMProvider,
    GOOGLE_MODELS,
    type InitialModelPayload
} from '@onlook/models';
import { debounce } from 'lodash';
import { makeAutoObservable } from 'mobx';

export class StateManager {
    private _canvasScrolling = false;
    hotkeysOpen = false;
    publishOpen = false;
    leftPanelLocked = false;
    canvasPanning = false;
    isDragSelecting = false;
    autoUpdatePublish = false;

    editorMode: EditorMode = EditorMode.DESIGN;
    insertMode: InsertMode | null = null;
    leftPanelTab: LeftPanelTabValue | null = null;
    brandTab: BrandTabValue | null = null;
    branchTab: BranchTabValue | null = null;
    manageBranchId: string | null = null;

    chatMode: ChatType = ChatType.EDIT;
    chatModel: InitialModelPayload = {
        provider: LLMProvider.GOOGLE,
        model: GOOGLE_MODELS.GEMINI_3_1_FLASH_LITE_PREVIEW,
    };

    constructor() {
        makeAutoObservable(this);
    }

    set canvasScrolling(value: boolean) {
        this._canvasScrolling = value;
        this.resetCanvasScrolling();
    }

    get shouldHideOverlay() {
        return this._canvasScrolling || this.canvasPanning
    }

    private resetCanvasScrolling() {
        this.resetCanvasScrollingDebounced();
    }

    private resetCanvasScrollingDebounced = debounce(() => {
        this.canvasScrolling = false;
    }, 150);

    clear() {
        this.hotkeysOpen = false;
        this.publishOpen = false;
        this.branchTab = null;
        this.manageBranchId = null;
        // Note: autoUpdatePublish is intentionally NOT cleared so it persists
        this.resetCanvasScrollingDebounced.cancel();
    }
}
