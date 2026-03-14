/**
 * A custom fetch wrapper that retries requests on connection errors.
 * This is particularly useful for server-side Next.js fetching where Supabase connections
 * might be dropped unexpectedly (ECONNRESET, socket disconnect).
 */
export const fetchWithRetry = (async (
    input: RequestInfo | URL,
    init?: RequestInit,
): Promise<Response> => {
    let attempt = 0;
    const maxRetries = 3;
    
    while (attempt < maxRetries) {
        try {
            return await fetch(input, init);
        } catch (error: any) {
            const isConnectionError = 
                error?.code === 'ECONNRESET' ||
                error?.message?.includes('socket disconnected') ||
                error?.message?.includes('fetch failed') ||
                error?.cause?.code === 'ECONNRESET';
                
            if (isConnectionError && attempt < maxRetries - 1) {
                attempt++;
                // Exponential backoff (e.g., 500ms, 1000ms, 2000ms)
                const delay = Math.min(500 * Math.pow(2, attempt - 1), 3000);
                await new Promise((resolve) => setTimeout(resolve, delay));
                continue;
            }
            throw error;
        }
    }
    
    throw new Error('Max retries reached');
}) as typeof fetch;
