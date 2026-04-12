import { env } from '@/env';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { fetchWithRetry } from './fetch';

export async function createClient() {
    // Validate Supabase URL - data URIs are not supported
    if (env.NEXT_PUBLIC_SUPABASE_URL.startsWith('data:')) {
        throw new Error('NEXT_PUBLIC_SUPABASE_URL cannot be a data URI. Please provide an HTTP/HTTPS URL.');
    }

    const cookieStore = await cookies();

    // Create a server's supabase client with newly configured cookie,
    // which could be used to maintain user's session
    return createServerClient(
        env.NEXT_PUBLIC_SUPABASE_URL,
        env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        {
            cookies: {
                getAll() {
                    return cookieStore.getAll();
                },
                setAll(cookiesToSet) {
                    try {
                        cookiesToSet.forEach(({ name, value, options }) =>
                            cookieStore.set(name, value, options),
                        );
                    } catch {
                        // The `setAll` method was called from a Server Component.
                        // This can be ignored if you have middleware refreshing
                        // user sessions.
                    }
                },
            },
            global: {
                fetch: fetchWithRetry,
            },
        },
    );
}
