import { env } from '@/env';
import { createClient } from '@supabase/supabase-js';
import { fetchWithRetry } from './fetch';

/**
 * Admin Supabase client with service role key
 * This client has full access to the database and can bypass RLS policies
 * Use with extreme caution and only in admin procedures
 */
export const createAdminClient = () => {
    // Validate Supabase URL - data URIs are not supported
    if (env.NEXT_PUBLIC_SUPABASE_URL.startsWith('data:')) {
        throw new Error('NEXT_PUBLIC_SUPABASE_URL cannot be a data URI. Please provide an HTTP/HTTPS URL.');
    }

    return createClient(
        env.NEXT_PUBLIC_SUPABASE_URL,
        env.SUPABASE_SERVICE_ROLE_KEY,
        {
            auth: {
                autoRefreshToken: false,
                persistSession: false,
            },
            global: {
                fetch: fetchWithRetry,
            },
        }
    );
};
