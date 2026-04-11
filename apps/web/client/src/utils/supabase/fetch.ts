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
    const lastError: Error[] = [];
    
    while (attempt < maxRetries) {
        try {
            return await fetch(input, init);
        } catch (error: any) {
            lastError.push(error);
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
    
    const lastErr = lastError[lastError.length - 1];
    throw new Error(
        `Failed after ${maxRetries} attempts. Last error: ${lastErr?.message || 'Internal error encountered'}. ` +
        `Error details: ${lastErr?.code || lastErr?.cause?.code || 'unknown'}`
    );
}) as typeof fetch;
