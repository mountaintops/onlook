'use client';

import { MODEL_MAX_INPUT_TOKENS, GOOGLE_MODELS } from '@onlook/models';
import {
    Context,
    ContextCacheUsage,
    ContextContent,
    ContextContentBody,
    ContextContentFooter,
    ContextContentHeader,
    ContextInputUsage,
    ContextOutputUsage,
    ContextReasoningUsage,
    ContextTrigger
} from '@onlook/ui/ai-elements/context';
import type { LanguageModelUsage } from 'ai';
import { useMemo } from 'react';

export const ChatContextWindow = ({ usage }: { usage: LanguageModelUsage }) => {
    const showCost = false;
    // Hardcoded for now, but should be dynamic based on the model used
    const maxTokens = MODEL_MAX_INPUT_TOKENS[GOOGLE_MODELS.GEMMA_4_31B];
    const usedTokens = useMemo(() => {
        if (!usage) return 0;
        const input = usage.inputTokens ?? 0;
        const cached = usage.cachedInputTokens ?? 0;
        return input + cached;
    }, [usage]);

    return (
        <Context
            maxTokens={maxTokens}
            usedTokens={usedTokens}
            usage={usage}
        >
            <ContextTrigger />
            <ContextContent>
                <ContextContentHeader />
                <ContextContentBody>
                    <ContextInputUsage />
                    <ContextOutputUsage />
                    <ContextReasoningUsage />
                    <ContextCacheUsage />
                </ContextContentBody>
                {showCost && <ContextContentFooter />}
            </ContextContent>
        </Context>
    );
};