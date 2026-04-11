import { httpBatchStreamLink, loggerLink } from '@trpc/client';
import SuperJSON from 'superjson';

export function getBaseUrl() {
    if (typeof window !== 'undefined') return window.location.origin;
    if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
    return `http://localhost:${process.env.PORT ?? 3000}`;
}

export const links = [
    loggerLink({
        enabled: (op) =>
            process.env.NODE_ENV === 'development' ||
            (op.direction === 'down' && op.result instanceof Error),
    }),
    httpBatchStreamLink({
        transformer: SuperJSON,
        url: getBaseUrl() + '/api/trpc',
        headers: () => {
            const headers = new Headers();
            headers.set('x-trpc-source', 'vanilla-client');
            return headers;
        },
        // Add error handler to provide more descriptive error messages
        onError: (opts) => {
            const { error } = opts;
            console.error('[TRPC Error]', {
                path: opts.op.path,
                type: opts.op.type,
                error: error,
                errorMessage: error?.message || 'Unknown error',
                errorShape: error?.shape,
                data: error?.data,
                cause: error?.cause,
            });
            
            // Enhance error message with more details
            if (error) {
                const originalMessage = error.message || 'Unknown error';
                const shapeMessage = error.shape?.message;
                const enhancedMessage = shapeMessage 
                    ? `${shapeMessage} (Original: ${originalMessage})`
                    : originalMessage;
                
                error.message = enhancedMessage;
            }
        },
    }),
];
