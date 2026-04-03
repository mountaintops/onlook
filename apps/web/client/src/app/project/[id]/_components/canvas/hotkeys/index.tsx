import { Hotkey } from '@/components/hotkey';
import { useEditorEngine } from '@/components/store/editor';
import { DefaultSettings } from '@onlook/constants';
import { EditorMode, InsertMode } from '@onlook/models';
import type { ReactNode } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';

function isInputLike(e: KeyboardEvent) {
    const target = e.target as HTMLElement;
    if (!target) return false;
    return (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable
    );
}

export const HotkeysArea = ({ children }: { children: ReactNode }) => {
    const editorEngine = useEditorEngine();

    // Zoom
    useHotkeys(
        Hotkey.ZOOM_FIT.command,
        () => {
            editorEngine.canvas.scale = DefaultSettings.SCALE;
            editorEngine.canvas.position = {
                x: DefaultSettings.PAN_POSITION.x,
                y: DefaultSettings.PAN_POSITION.y,
            };
        },
        { preventDefault: true },
    );
    useHotkeys(Hotkey.ZOOM_IN.command, () => (editorEngine.canvas.scale = editorEngine.canvas.scale * 1.2), {
        preventDefault: true,
    });
    useHotkeys(Hotkey.ZOOM_OUT.command, () => (editorEngine.canvas.scale = editorEngine.canvas.scale * 0.8), {
        preventDefault: true,
    });

    // Modes
    useHotkeys(Hotkey.SELECT.command, () => (editorEngine.state.editorMode = EditorMode.DESIGN));
    useHotkeys(Hotkey.CODE.command, () => (editorEngine.state.editorMode = EditorMode.CODE));
    useHotkeys(Hotkey.ESCAPE.command, () => {
        editorEngine.state.editorMode = EditorMode.DESIGN;
        if (!editorEngine.text.isEditing) {
            editorEngine.clearUI();
        }
    });
    useHotkeys(Hotkey.PAN.command, () => (editorEngine.state.editorMode = EditorMode.PAN));
    useHotkeys(Hotkey.INTERACT.command, () => (editorEngine.state.editorMode = EditorMode.INTERACT));
    useHotkeys(Hotkey.PREVIEW.command, () => (editorEngine.state.editorMode = EditorMode.PREVIEW));

    // Quick mode switching with CMD+1/2/3 (overrides browser defaults)
    useHotkeys('mod+1', () => (editorEngine.state.editorMode = EditorMode.DESIGN), { preventDefault: true });
    useHotkeys('mod+2', () => (editorEngine.state.editorMode = EditorMode.CODE), { preventDefault: true });
    useHotkeys('mod+3', () => (editorEngine.state.editorMode = EditorMode.PREVIEW), { preventDefault: true });
    useHotkeys(
        Hotkey.INSERT_DIV.command,
        () => (editorEngine.state.insertMode = InsertMode.INSERT_DIV),
    );
    useHotkeys(
        Hotkey.INSERT_TEXT.command,
        () => (editorEngine.state.insertMode = InsertMode.INSERT_TEXT),
    );
    useHotkeys('space', () => (editorEngine.state.editorMode = EditorMode.PAN), { keydown: true });
    useHotkeys('space', () => (editorEngine.state.editorMode = EditorMode.DESIGN), { keyup: true });
    useHotkeys('alt', () => editorEngine.overlay.showMeasurement(), { keydown: true });
    useHotkeys('alt', () => editorEngine.overlay.removeMeasurement(), { keyup: true });

    // Actions
    useHotkeys(
        Hotkey.UNDO.command,
        (e) => {
            if (isInputLike(e)) return;
            e.preventDefault();
            editorEngine.action.undo();
        },
        { enableOnFormTags: true, enableOnContentEditable: true },
    );
    useHotkeys(
        Hotkey.REDO.command,
        (e) => {
            if (isInputLike(e)) return;
            e.preventDefault();
            editorEngine.action.redo();
        },
        { enableOnFormTags: true, enableOnContentEditable: true },
    );
    useHotkeys(
        Hotkey.ENTER.command,
        (e) => {
            if (isInputLike(e)) return;
            e.preventDefault();
            editorEngine.text.editSelectedElement();
        },
        { enableOnFormTags: true, enableOnContentEditable: true },
    );
    useHotkeys(
        [Hotkey.BACKSPACE.command, Hotkey.DELETE.command],
        (e) => {
            if (isInputLike(e)) return;
            e.preventDefault();
            if (editorEngine.elements.selected.length > 0) {
                editorEngine.elements.delete();
            } else if (editorEngine.frames.selected.length > 0 && editorEngine.frames.canDelete()) {
                editorEngine.frames.deleteSelected();
            }
        },
        { enableOnFormTags: true, enableOnContentEditable: true },
    );

    // Group
    useHotkeys(Hotkey.GROUP.command, () => editorEngine.group.groupSelectedElements());
    useHotkeys(Hotkey.UNGROUP.command, () => editorEngine.group.ungroupSelectedElement());

    // Copy
    useHotkeys(
        Hotkey.COPY.command,
        (e) => {
            if (isInputLike(e)) return;
            e.preventDefault();
            editorEngine.copy.copy();
        },
        { enableOnFormTags: true, enableOnContentEditable: true },
    );
    useHotkeys(
        Hotkey.PASTE.command,
        (e) => {
            if (isInputLike(e)) return;
            e.preventDefault();
            editorEngine.copy.paste();
        },
        { enableOnFormTags: true, enableOnContentEditable: true },
    );
    useHotkeys(
        Hotkey.CUT.command,
        (e) => {
            if (isInputLike(e)) return;
            e.preventDefault();
            editorEngine.copy.cut();
        },
        { enableOnFormTags: true, enableOnContentEditable: true },
    );
    useHotkeys(
        Hotkey.DUPLICATE.command,
        (e) => {
            if (isInputLike(e)) return;
            e.preventDefault();
            if (editorEngine.elements.selected.length > 0) {
                editorEngine.copy.duplicate();
            } else if (editorEngine.frames.selected.length > 0 && editorEngine.frames.canDuplicate()) {
                editorEngine.frames.duplicateSelected();
            }
        },
        { enableOnFormTags: true, enableOnContentEditable: true },
    );

    // AI
    useHotkeys(
        Hotkey.ADD_AI_CHAT.command,
        () => {
            if (editorEngine.state.editorMode === EditorMode.PREVIEW) {
                editorEngine.state.editorMode = EditorMode.DESIGN;
            }
            editorEngine.chat.focusChatInput();
        }
    );
    useHotkeys(Hotkey.NEW_AI_CHAT.command, () => {
        editorEngine.state.editorMode = EditorMode.DESIGN;
        editorEngine.chat.conversation.startNewConversation();
    });
    useHotkeys(
        Hotkey.CHAT_MODE_TOGGLE.command,
        () => {
            // Toggle between design and preview mode
            if (editorEngine.state.editorMode === EditorMode.PREVIEW) {
                editorEngine.state.editorMode = EditorMode.DESIGN;
            } else {
                editorEngine.state.editorMode = EditorMode.PREVIEW;
            }
        },
        { preventDefault: true },
    );

    // Move
    useHotkeys(Hotkey.MOVE_LAYER_UP.command, () => editorEngine.move.moveSelected('up'));
    useHotkeys(Hotkey.MOVE_LAYER_DOWN.command, () => editorEngine.move.moveSelected('down'));
    useHotkeys(
        Hotkey.SHOW_HOTKEYS.command,
        () => (editorEngine.state.hotkeysOpen = !editorEngine.state.hotkeysOpen),
    );

    return (
        <>
            {children}
        </>
    );
};
