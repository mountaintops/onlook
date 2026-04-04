// Check if file content differs from original
export function isDirty(file: EditorFile): boolean {
    if (file.type === 'binary') {
        return false; // Binary files are never considered dirty
    }

    if (file.type === 'text') {
        const textFile = file as TextEditorFile;
        // Optimization: Use direct string comparison instead of hashing on every check.
        return textFile.content !== textFile.originalContent;
    }

    return false;
}