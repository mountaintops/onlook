import type { LanguageModel } from 'ai';

export enum LLMProvider {
    GOOGLE = 'google',
}

export enum GOOGLE_MODELS {
    GEMINI_3_1_FLASH_LITE_PREVIEW = 'gemini-3.1-flash-lite-preview',
}

interface ModelMapping {
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
    providerOptions?: Record<string, any>;
    headers?: Record<string, string>;
    maxOutputTokens: number;
};

export const MODEL_MAX_TOKENS = {
    [GOOGLE_MODELS.GEMINI_3_1_FLASH_LITE_PREVIEW]: 1000000,
} as const;
