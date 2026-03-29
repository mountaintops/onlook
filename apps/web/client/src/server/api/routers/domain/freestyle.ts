import { env } from '@/env';
import { TRPCError } from '@trpc/server';
import { FreestyleSandboxes } from 'freestyle-sandboxes';

export const initializeFreestyleSdk = () => {
    if (!env.FREESTYLE_API_KEY) {
        console.warn('FREESTYLE_API_KEY is not configured.');
        return null as any;
    }
    return new FreestyleSandboxes({
        apiKey: env.FREESTYLE_API_KEY
    });
};
