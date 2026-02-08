import type { LanguageModel } from 'ai';

export enum LLMProvider {
    OPENROUTER = 'openrouter',
    GOOGLE = 'google',
}

export enum OPENROUTER_MODELS {
    // Generate object does not work for Anthropic models https://github.com/OpenRouterTeam/ai-sdk-provider/issues/165
    CLAUDE_4_5_SONNET = 'anthropic/claude-sonnet-4.5',
    CLAUDE_3_5_HAIKU = 'anthropic/claude-3.5-haiku',
    OPEN_AI_GPT_5 = 'openai/gpt-5',
    OPEN_AI_GPT_5_MINI = 'openai/gpt-5-mini',
    OPEN_AI_GPT_5_NANO = 'openai/gpt-5-nano',
}

export enum GOOGLE_MODELS {
    GEMINI_3_0_PRO_PREVIEW = 'gemini-3-pro-preview',
    GEMINI_3_0_FLASH_PREVIEW = 'gemini-3-flash-preview',
    GEMINI_2_5_PRO = 'gemini-2.5-pro-preview-06-05',
    GEMINI_2_5_FLASH = 'gemini-2.5-flash-preview-05-20',
    GEMINI_2_0_FLASH = 'gemini-2.0-flash',
}

interface ModelMapping {
    [LLMProvider.OPENROUTER]: OPENROUTER_MODELS;
    [LLMProvider.GOOGLE]: GOOGLE_MODELS;
}

export type InitialModelPayload = {
    [K in keyof ModelMapping]: {
        provider: K;
        model: ModelMapping[K];
    };
}[keyof ModelMapping];

export type ModelConfig = {
    model: LanguageModel;
    modelName: string;
    providerOptions?: Record<string, any>;
    headers?: Record<string, string>;
    maxOutputTokens: number;
};

export const MODEL_MAX_TOKENS = {
    [OPENROUTER_MODELS.CLAUDE_4_5_SONNET]: 200000,
    [OPENROUTER_MODELS.CLAUDE_3_5_HAIKU]: 200000,
    [OPENROUTER_MODELS.OPEN_AI_GPT_5_NANO]: 400000,
    [OPENROUTER_MODELS.OPEN_AI_GPT_5_MINI]: 400000,
    [OPENROUTER_MODELS.OPEN_AI_GPT_5]: 400000,
    [GOOGLE_MODELS.GEMINI_3_0_PRO_PREVIEW]: 1000000,
    [GOOGLE_MODELS.GEMINI_3_0_FLASH_PREVIEW]: 1000000,
    [GOOGLE_MODELS.GEMINI_2_5_PRO]: 1000000,
    [GOOGLE_MODELS.GEMINI_2_5_FLASH]: 1000000,
    [GOOGLE_MODELS.GEMINI_2_0_FLASH]: 1000000,
} as const;
