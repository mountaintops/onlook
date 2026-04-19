import { registerOTel } from '@vercel/otel';
import { LangfuseExporter } from 'langfuse-vercel';

export function register() {
    // Langfuse vs @vercel/otel span types can diverge across transitive OpenTelemetry versions.
    registerOTel({
        serviceName: 'Onlook Web',
        traceExporter: new LangfuseExporter() as any,
    });
}
