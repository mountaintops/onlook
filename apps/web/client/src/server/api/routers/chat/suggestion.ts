import { initModel, SUGGESTION_SYSTEM_PROMPT, AGENT_RULE_GENERATION_PROMPT } from '@onlook/ai';
import { conversations } from '@onlook/db';
import type { ChatSuggestion } from '@onlook/models';
import { LLMProvider, GOOGLE_MODELS, MISTRAL_MODELS } from '@onlook/models';
import { ChatSuggestionsSchema } from '@onlook/models/chat';
import { convertToModelMessages, generateObject, generateText } from 'ai';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { createTRPCRouter, protectedProcedure } from '../../trpc';

export const suggestionsRouter = createTRPCRouter({
    generate: protectedProcedure
        .input(z.object({
            conversationId: z.string(),
            messages: z.array(z.object({
                role: z.enum(['user', 'assistant', 'system']),
                content: z.string(),
            })),
        }))
        .mutation(async ({ ctx, input }) => {
            const { model, headers } = initModel({
                provider: LLMProvider.GOOGLE,
                model: GOOGLE_MODELS.GEMMA_4_31B,
            });
            const { object } = await generateObject({
                model,
                headers,
                schema: ChatSuggestionsSchema,
                messages: [
                    {
                        role: 'system',
                        content: SUGGESTION_SYSTEM_PROMPT,
                    },
                    ...(await convertToModelMessages(input.messages.map((m) => ({
                        role: m.role,
                        parts: [{ type: 'text', text: m.content }],
                    })))),
                    {
                        role: 'user',
                        content: 'Based on our conversation, what should I work on next to improve this page? Provide 3 specific, actionable suggestions. These should be realistic and achievable. Return the suggestions as a JSON object. DO NOT include any other text.',
                    },
                ],
                maxOutputTokens: 10000,
            });
            const suggestions = object.suggestions satisfies ChatSuggestion[];
            try {
                await ctx.db.update(conversations).set({
                    suggestions,
                }).where(eq(conversations.id, input.conversationId));
            } catch (error) {
                console.error('Error updating conversation suggestions:', error);
            }
            return suggestions;
        }),
    generateAgentRules: protectedProcedure
        .mutation(async () => {
            const { model, headers } = initModel({
                provider: LLMProvider.MISTRAL,
                model: 'mistral-small-4' as any, // Cast to any to bypass strict enum check while adding it
            });
            const { text } = await generateText({
                model,
                headers,
                system: AGENT_RULE_GENERATION_PROMPT,
                prompt: 'Generate an agents.md file for this web project.',
                maxOutputTokens: 2000,
            });
            return text;
        }),
});
