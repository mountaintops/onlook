import {
    LLMProvider,
    MODEL_MAX_OUTPUT_TOKENS,
    GOOGLE_MODELS,
    MISTRAL_MODELS,
    MODAL_MODELS,
    type InitialModelPayload,
    type ModelConfig
} from '@onlook/models';
import { assertNever } from '@onlook/utility';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createMistral } from '@ai-sdk/mistral';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModel } from 'ai';

export function initModel({
    provider: requestedProvider,
    model: incomingModel,
}: InitialModelPayload): ModelConfig {
    const requestedModel = (incomingModel as string) === 'mistral-small-4' 
        ? MISTRAL_MODELS.MISTRAL_SMALL_2603 
        : incomingModel;
    let model: LanguageModel;
    let providerOptions: Record<string, any> | undefined;
    let headers: Record<string, string> | undefined;
    let maxOutputTokens: number = MODEL_MAX_OUTPUT_TOKENS[requestedModel as keyof typeof MODEL_MAX_OUTPUT_TOKENS];

    switch (requestedProvider) {
        case LLMProvider.GOOGLE:
            model = getGoogleProvider(requestedModel as GOOGLE_MODELS);
            headers = {
                'HTTP-Referer': 'https://onlook.com',
                'X-Title': 'Onlook',
            };
            break;
        case LLMProvider.MISTRAL:
            model = getMistralProvider(requestedModel as MISTRAL_MODELS);
            break;
        case LLMProvider.MODAL:
            model = getModalProvider(requestedModel as MODAL_MODELS);
            break;
        default:
            assertNever(requestedProvider);
    }

    return {
        model,
        providerOptions,
        headers,
        maxOutputTokens,
    };
}

function getGoogleProvider(model: GOOGLE_MODELS): LanguageModel {
    if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
        throw new Error('GOOGLE_GENERATIVE_AI_API_KEY must be set');
    }
    const google = createGoogleGenerativeAI({ apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY });
    return google(model);
}

function getMistralProvider(model: MISTRAL_MODELS): LanguageModel {
    if (!process.env.MISTRAL_API_KEY) {
        throw new Error('MISTRAL_API_KEY must be set');
    }
    const mistral = createMistral({ apiKey: process.env.MISTRAL_API_KEY });
    return mistral(model);
}

function getModalProvider(model: MODAL_MODELS): LanguageModel {
    const secret = process.env.MODAL_TOKEN_SECRET;
    const id = process.env.MODAL_TOKEN_ID;
    if (!secret || !id) {
        throw new Error('MODAL_TOKEN_SECRET and MODAL_TOKEN_ID must be set');
    }
    const modalProvider = createOpenAICompatible({
        name: 'modal',
        baseURL: 'https://api.us-west-2.modal.direct/v1',
        headers: {
            Authorization: `Bearer ${secret}`,
        },
        transformRequestBody: (body) => {
            if (body.tools) {
                body.parallel_tool_calls = false;
            }
            return body;
        },
    });
    return modalProvider.chatModel(model);
}
