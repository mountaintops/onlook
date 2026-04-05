import { generateText } from 'ai';
import { GOOGLE_MODELS, LLMProvider } from '@onlook/models';
import { initModel } from '../chat/providers';
import { VISUAL_ANALYSIS_PROMPT } from '../prompt/constants/visual';

/**
 * Performs a dedicated visual audit of an image using a separate LLM request.
 * This ensures "full priority" for visual analysis as requested.
 */
export async function generateVisualAudit(image: { base64: string; mimeType: string }): Promise<string> {
    try {
        // Initialize a fast vision-capable model (Gemini 3 Flash)
        const { model, headers } = initModel({
            provider: LLMProvider.GOOGLE,
            model: GOOGLE_MODELS.GEMINI_3_FLASH,
        });

        const { text } = await generateText({
            model,
            headers,
            system: VISUAL_ANALYSIS_PROMPT,
            messages: [
                {
                    role: 'user',
                    content: [
                        { type: 'text', text: 'Please perform a professional UI audit of this screenshot.' },
                        {
                            type: 'image',
                            image: `data:${image.mimeType};base64,${image.base64}`,
                        },
                    ],
                },
            ],
        });

        return text;
    } catch (error) {
        console.error('Failed to generate visual audit:', error);
        return `Visual audit failed: ${error}`;
    }
}
