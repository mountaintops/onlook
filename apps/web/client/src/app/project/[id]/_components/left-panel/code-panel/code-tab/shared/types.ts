export interface EditorFile {
    path: string;
    type: 'text' | 'binary';
    content: string | Uint8Array;
    originalHash: string | null;
    originalContent: string | Uint8Array | null;
}

export interface TextEditorFile extends EditorFile {
    type: 'text';
    content: string;
    originalHash: string;
    originalContent: string;
}

// Readonly, no need to dirty or saved content
export interface BinaryEditorFile extends EditorFile {
    type: 'binary';
    content: Uint8Array;
    originalHash: null;
}

export interface HighlightRange {
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
}