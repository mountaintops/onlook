import type { LanguageModel } from 'ai';

export enum LLMProvider {
    GOOGLE = 'google',
    MISTRAL = 'mistral',
    MODAL = 'modal',
}

export enum GOOGLE_MODELS {
    GEMINI_3_1_FLASH_LITE_PREVIEW = 'gemini-3.1-flash-lite-preview',
    GEMMA_3_27B = 'gemma-3-27b-it',
}

export enum MISTRAL_MODELS {
    MISTRAL_LARGE_2512 = 'mistral-large-2512',
    MISTRAL_SMALL_2603 = 'mistral-small-2603',
    DEVSTRAL_2512 = 'devstral-2512',
}

export enum MODAL_MODELS {
    GLM_5 = 'zai-org/GLM-5-FP8',
}

interface ModelMapping {
    [LLMProvider.GOOGLE]: GOOGLE_MODELS;
    [LLMProvider.MISTRAL]: MISTRAL_MODELS;
    [LLMProvider.MODAL]: MODAL_MODELS;
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
    [GOOGLE_MODELS.GEMMA_3_27B]: 8192,
    [MISTRAL_MODELS.MISTRAL_LARGE_2512]: 131000,
    [MISTRAL_MODELS.MISTRAL_SMALL_2603]: 32000,
    [MISTRAL_MODELS.DEVSTRAL_2512]: 32000,
    [MODAL_MODELS.GLM_5]: 32768,
} as const;

export const AVAILABLE_MODELS = [
    {
        provider: LLMProvider.GOOGLE,
        model: GOOGLE_MODELS.GEMINI_3_1_FLASH_LITE_PREVIEW,
        displayName: 'gemini 3.1 flash lite',
    },
    {
        provider: LLMProvider.GOOGLE,
        model: GOOGLE_MODELS.GEMMA_3_27B,
        displayName: 'gemma 3 27b',
    },
    {
        provider: LLMProvider.MISTRAL,
        model: MISTRAL_MODELS.MISTRAL_LARGE_2512,
        displayName: 'mistral-large-2512',
    },
    {
        provider: LLMProvider.MISTRAL,
        model: MISTRAL_MODELS.MISTRAL_SMALL_2603,
        displayName: 'mistral-small-2603',
    },
    {
        provider: LLMProvider.MISTRAL,
        model: MISTRAL_MODELS.DEVSTRAL_2512,
        displayName: 'Devstral 2512',
    },
    {
        provider: LLMProvider.MODAL,
        model: MODAL_MODELS.GLM_5,
        displayName: 'GLM-5 (Modal)',
    },
];
