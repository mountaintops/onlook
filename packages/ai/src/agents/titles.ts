import { MISTRAL_MODELS, LLMProvider } from '@onlook/models';
import { generateText } from 'ai';
import { initModel } from '../chat/providers';
import { getGitCommitTitlePrompt, getConversationTitlePrompt } from '../prompt/provider';

/**
 * Titles agent for generating high-quality, concise titles for git commits and conversations.
 * Uses Mistral Small 2603 for optimal performance and quality in summary tasks.
 */
export async function generateGitCommitTitle(instruction: string): Promise<string> {
    try {
        const { model, headers, providerOptions } = initModel({
            provider: LLMProvider.MISTRAL,
            model: MISTRAL_MODELS.MISTRAL_SMALL_2603,
        });

        const { text } = await generateText({
            model,
            headers,
            prompt: getGitCommitTitlePrompt(instruction),
            providerOptions,
            maxOutputTokens: 50,
        });

        return text.trim().replace(/^["']|["']$/g, '');
    } catch (error) {
        console.error('Error generating git commit title:', error);
        return 'Update project';
    }
}

export async function generateConversationTitle(content: string): Promise<string> {
    try {
        const { model, headers, providerOptions } = initModel({
            provider: LLMProvider.MISTRAL,
            model: MISTRAL_MODELS.MISTRAL_SMALL_2603,
        });

        const { text } = await generateText({
            model,
            headers,
            prompt: getConversationTitlePrompt(content),
            providerOptions,
            maxOutputTokens: 50,
        });

        return text.trim().replace(/^["']|["']$/g, '');
    } catch (error) {
        console.error('Error generating conversation title:', error);
        return 'New Conversation';
    }
}
