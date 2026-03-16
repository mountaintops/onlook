import { Git } from '../constants';

/**
 * Safely escapes and truncates a commit message to prevent command injection
 * and ensure it fits within git's recommended limits
 */
export function sanitizeCommitMessage(message: string): string {
    if (!message || typeof message !== 'string') {
        return 'Empty commit message';
    }

    // Remove any null bytes and control characters that could cause issues
    const sanitized = message
        .replace(/\0/g, '') // Remove null bytes
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // Remove other control chars except \n and \t
        .trim();

    // Handle multi-line messages by preserving line breaks but sanitizing each line
    const lines = sanitized.split('\n');
    const firstLine = lines[0] ?? '';
    const restLines = lines.slice(1);

    // Truncate the first line (commit subject) to recommended length
    let truncatedFirstLine = firstLine.substring(0, Git.MAX_COMMIT_MESSAGE_LENGTH);
    if (firstLine.length > Git.MAX_COMMIT_MESSAGE_LENGTH) {
        // Find last word boundary to avoid cutting words in half
        const lastSpace = truncatedFirstLine.lastIndexOf(' ');
        if (lastSpace > Git.MAX_COMMIT_MESSAGE_LENGTH * 0.7) {
            truncatedFirstLine = truncatedFirstLine.substring(0, lastSpace);
        }
        truncatedFirstLine += '...';
    }

    // Handle the body (remaining lines) if present
    if (restLines.length > 0) {
        const body = restLines.join('\n').trim();
        if (body.length > 0) {
            let truncatedBody = body.substring(0, Git.MAX_COMMIT_MESSAGE_BODY_LENGTH);
            if (body.length > Git.MAX_COMMIT_MESSAGE_BODY_LENGTH) {
                truncatedBody += '...';
            }
            return `${truncatedFirstLine}\n\n${truncatedBody}`;
        }
    }

    return truncatedFirstLine;
}

/**
 * Escapes a string for safe use in shell commands
 * Uses proper shell escaping instead of just replacing quotes
 */
export function escapeShellString(str: string): string {
    if (!str || typeof str !== 'string') {
        return '""';
    }

    // For strings that only contain safe characters, we can avoid quoting
    if (/^[a-zA-Z0-9._\-/]+$/.test(str)) {
        return str;
    }

    // Replace single quotes with '\'' (end quote, escaped quote, start quote)
    // This is the safest way to handle single quotes in shell
    return `'${str.replace(/'/g, "'\\''")}'`;
}

/**
 * Safely prepares a commit message for use in git commands
 * Combines sanitization and escaping
 */
export function prepareCommitMessage(message: string): string {
    const sanitized = sanitizeCommitMessage(message);
    return escapeShellString(sanitized);
}

/**
 * Wraps a git operation with sync pause/unpause to prevent sync issues.
 * Useful for operations like git restore that cause rapid file changes.
 */
export async function withSyncPaused<T>(
    sync: { pause: () => void; unpause: (options?: { changedFiles?: string[] }) => Promise<void> } | null | undefined,
    operation: () => Promise<T>,
    getChangedFiles?: (result: T) => Promise<string[] | undefined>,
    delayMs: number = 1000,
): Promise<T> {
    if (!sync) {
        return operation();
    }

    try {
        sync.pause();
        const result = await operation();

        // Wait for filesystem changes to settle before unpausing
        await new Promise(resolve => setTimeout(resolve, delayMs));

        let changedFiles: string[] | undefined;
        if (getChangedFiles) {
            try {
                changedFiles = await getChangedFiles(result);
            } catch (error) {
                console.warn('[withSyncPaused] Failed to get changed files:', error);
            }
        }

        await sync.unpause({ changedFiles });
        return result;
    } finally {
        // Fallback to ensure unpause is called even if getChangedFiles or unpause({changedFiles}) fails
        // but unpause is idempotent so it's safe to call again or if it was already called in results
        if (sync) {
            // Note: In a real scenario we'd want to be careful not to unpause twice if it's not idempotent,
            // but for this engine it is.
            // If unpause was not called in the try block (e.g., due to an error before it), call it now.
            // If it was called, calling it again should be safe due to idempotency.
            // We call it without changedFiles here as they might not be available or relevant in a fallback.
            await sync.unpause();
        }
    }
}