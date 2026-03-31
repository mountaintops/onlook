import { env } from '@/env';
import { createStripeClient } from '@onlook/stripe';

export async function POST(request: Request) {
    const stripe = createStripeClient(env.STRIPE_SECRET_KEY)
    const endpointSecret = env.STRIPE_WEBHOOK_SECRET

    const buf = Buffer.from(await request.arrayBuffer())

    if (!endpointSecret) {
        return new Response('STRIPE_WEBHOOK_SECRET is not set', { status: 400 })
    }

    const signature = request.headers.get('stripe-signature') as string
    try {
        stripe.webhooks.constructEvent(buf, signature, endpointSecret)
    } catch (err: any) {
        console.log(`⚠️  Webhook signature verification failed.`, err.message)
        return new Response('Webhook signature verification failed', { status: 400 })
    }

    return new Response(null, { status: 200 });
}
