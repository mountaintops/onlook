import { env } from '@/env';

export async function callUserWebhook(user: {
    email: string | null;
    firstName: string;
    lastName: string;
    source: string;
    subscribed: boolean;
}) {
    const WEBHOOK_URL = env.N8N_WEBHOOK_URL;
    const API_KEY = env.N8N_API_KEY;

    if (!WEBHOOK_URL || !API_KEY) {
        console.warn('N8N_WEBHOOK_URL or N8N_API_KEY is not set, skipping user webhook');
        return;
    }

    // Validate URL - data URIs are not supported
    if (WEBHOOK_URL.startsWith('data:')) {
        console.error('N8N_WEBHOOK_URL cannot be a data URI. Please provide an HTTP/HTTPS URL.');
        return;
    }

    try {
        await fetch(WEBHOOK_URL, {
            method: 'POST',
            headers: {
                'n8n-api-key': API_KEY,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                email: user.email,
                firstName: user.firstName,
                lastName: user.lastName,
                source: user.source,
                subscribed: user.subscribed,
            }),
        });
    } catch (error) {
        console.error('Failed to call user webhook', error);
    }
}