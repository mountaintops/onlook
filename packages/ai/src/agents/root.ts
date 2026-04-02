import type { ToolCall } from '@ai-sdk/provider-utils';
import { ChatType, LLMProvider, GOOGLE_MODELS, MISTRAL_MODELS, MODAL_MODELS, type ChatMessage, type McpServerConfig, type ModelConfig, type InitialModelPayload } from '@onlook/models';
import { NoSuchToolError, generateObject, generateText, smoothStream, stepCountIs, streamText, type ToolSet } from 'ai';
import { convertToStreamMessages, getArchitectModeClassificationPrompt, getAskModeSystemPrompt, getCreatePageSystemPrompt, getSystemPrompt, getToolSetFromType, initModel } from '../index';
import { McpClientManager } from '../mcp';

const ARCHITECT_FALLBACK_MODELS = [
    { provider: LLMProvider.MISTRAL, model: MISTRAL_MODELS.DEVSTRAL_2512 },
    { provider: LLMProvider.MISTRAL, model: MISTRAL_MODELS.MISTRAL_LARGE_2512 },
    { provider: LLMProvider.GOOGLE, model: GOOGLE_MODELS.GEMINI_3_FLASH },
    { provider: LLMProvider.GOOGLE, model: GOOGLE_MODELS.GEMINI_3_1_FLASH_LITE_PREVIEW },
] as const;

const getSystemPromptFromType = (chatType: ChatType): string => {
    switch (chatType) {
        case ChatType.CREATE:
            return getCreatePageSystemPrompt();
        case ChatType.ASK:
            return getAskModeSystemPrompt();
        case ChatType.ARCHITECT:
        case ChatType.EDIT:
        default:
            return getSystemPrompt();
    }
};

const getModelFromType = (chatType: ChatType, chatModel?: any): ModelConfig => {
    if (chatModel && chatModel.provider && chatModel.model) {
        return initModel({
            provider: chatModel.provider,
            model: chatModel.model,
        } as InitialModelPayload);
    }

    switch (chatType) {
        case ChatType.CREATE:
        case ChatType.FIX:
            return initModel({
                provider: LLMProvider.GOOGLE,
                model: GOOGLE_MODELS.GEMINI_3_1_FLASH_LITE_PREVIEW,
            } as InitialModelPayload);
        case ChatType.ASK:
        case ChatType.EDIT:
        default:
            return initModel({
                provider: LLMProvider.GOOGLE,
                model: GOOGLE_MODELS.GEMINI_3_1_FLASH_LITE_PREVIEW,
            } as InitialModelPayload);
    }
};

export const repairToolCall = async ({ toolCall, tools, error }: { toolCall: ToolCall<string, unknown>, tools: ToolSet, error: Error }) => {
    if (NoSuchToolError.isInstance(error)) {
        throw new Error(
            `Tool "${toolCall.toolName}" not found. Available tools: ${Object.keys(tools).join(', ')}`,
        );
    }
    const tool = tools[toolCall.toolName];
    if (!tool?.inputSchema) {
        throw new Error(`Tool "${toolCall.toolName}" has no input schema`);
    }

    console.warn(
        `Invalid parameter for tool ${toolCall.toolName} with args ${JSON.stringify(toolCall.input)}, attempting to fix`,
    );

    const { model } = initModel({
        provider: LLMProvider.GOOGLE,
        model: GOOGLE_MODELS.GEMINI_3_1_FLASH_LITE_PREVIEW,
    } as InitialModelPayload);

    const { object: repairedArgs } = await generateObject({
        model,
        schema: tool.inputSchema,
        prompt: [
            `The model tried to call the tool "${toolCall.toolName}"` +
            ` with the following arguments:`,
            JSON.stringify(toolCall.input),
            `The tool accepts the following schema:`,
            JSON.stringify(tool?.inputSchema),
            'Please fix the inputs. Return the fixed inputs as a JSON object, DO NOT include any other text.',
        ].join('\n'),
    });

    return {
        type: 'tool-call' as const,
        toolCallId: toolCall.toolCallId,
        toolName: toolCall.toolName,
        input: JSON.stringify(repairedArgs),
    };
};

const runArchitectMode = async (messages: ChatMessage[]) => {
    const lastUserMessage = messages.findLast((message) => message.role === 'user');
    const content = lastUserMessage?.parts
        .filter((p) => p.type === 'text')
        .map((p) => p.text)
        .join('\n') || '';

    // Heuristic: Very short prompts are almost certainly "small"
    if (content.length < 20) {
        return {
            provider: LLMProvider.MISTRAL,
            model: MISTRAL_MODELS.DEVSTRAL_2512,
        };
    }

    try {
        const classificationModel = initModel({
            provider: LLMProvider.GOOGLE,
            model: GOOGLE_MODELS.GEMINI_3_1_FLASH_LITE_PREVIEW,
        } as InitialModelPayload);

        const { text: complexity } = await generateText({
            model: classificationModel.model,
            maxTokens: 5,
            prompt: getArchitectModeClassificationPrompt(content),
        });

        const complexityLower = complexity.trim().toLowerCase();

        if (complexityLower.includes('small')) {
            return {
                provider: LLMProvider.MISTRAL,
                model: MISTRAL_MODELS.DEVSTRAL_2512,
            };
        } else if (complexityLower.includes('medium')) {
            return {
                provider: LLMProvider.GOOGLE,
                model: GOOGLE_MODELS.GEMINI_3_1_FLASH_LITE_PREVIEW,
            };
        } else if (complexityLower.includes('large')) {
            return {
                provider: LLMProvider.MODAL,
                model: MODAL_MODELS.GLM_5,
            };
        }
    } catch (err) {
        console.error('Failed to classify prompt complexity, falling back to default', err);
    }

    // Default or if classification fails
    return {
        provider: LLMProvider.MISTRAL,
        model: MISTRAL_MODELS.DEVSTRAL_2512,
    };
};

export const createRootAgentStream = async ({
    chatType,
    conversationId,
    projectId,
    userId,
    traceId,
    messages,
    mcpServers,
    chatModel,
}: {
    chatType: ChatType;
    conversationId: string;
    projectId: string;
    userId: string;
    traceId: string;
    messages: ChatMessage[];
    mcpServers?: McpServerConfig[];
    chatModel?: any;
}) => {
    let finalChatModel = chatModel;
    if (chatType === ChatType.ARCHITECT) {
        finalChatModel = await runArchitectMode(messages);
    }
    const modelConfig = getModelFromType(chatType, finalChatModel);
    const systemPrompt = getSystemPromptFromType(chatType);
    const builtInTools = getToolSetFromType(chatType);

    // Connect to MCP servers and merge their tools with built-in tools
    let mcpManager: McpClientManager | null = null;
    let mergedTools: ToolSet = builtInTools;

    if (mcpServers && mcpServers.length > 0) {
        mcpManager = new McpClientManager(mcpServers);
        try {
            const mcpTools = await mcpManager.getTools();
            mergedTools = { ...builtInTools, ...mcpTools };
        } catch (error) {
            console.error('[MCP] Error fetching MCP tools, using built-in tools only:', error);
        }
    }

    const isGemma3 = finalChatModel?.model === GOOGLE_MODELS.GEMMA_3_27B;
    const isGLM5 = finalChatModel?.model === MODAL_MODELS.GLM_5;
    const disableTools = isGemma3 || isGLM5;

    const runStream = async (config: ModelConfig, attempt: number = 0): Promise<any> => {
        try {
            return streamText({
                providerOptions: config.providerOptions,
                messages: await convertToStreamMessages(messages),
                model: config.model,
                system: systemPrompt,
                tools: disableTools ? undefined : mergedTools,
                headers: config.headers,
                stopWhen: stepCountIs(20),
                experimental_repairToolCall: repairToolCall,
                experimental_transform: smoothStream(),
                onFinish: async () => {
                    if (mcpManager) {
                        await mcpManager.closeAll();
                    }
                },
                onError: async () => {
                    if (mcpManager) {
                        await mcpManager.closeAll();
                    }
                },
                experimental_telemetry: {
                    isEnabled: true,
                    metadata: {
                        conversationId,
                        projectId,
                        userId,
                        chatType: chatType,
                        tags: ['chat'],
                        langfuseTraceId: traceId,
                        sessionId: conversationId,
                    },
                },
            });
        } catch (error) {
            console.error(`Stream attempt ${attempt} failed:`, error);
            if (chatType === ChatType.ARCHITECT && attempt < ARCHITECT_FALLBACK_MODELS.length) {
                const nextModel = ARCHITECT_FALLBACK_MODELS[attempt];
                if (nextModel) {
                    console.log(`Falling back to ${nextModel.model}...`);
                    const nextConfig = initModel(nextModel as any as InitialModelPayload);
                    return runStream(nextConfig, attempt + 1);
                }
            }
            throw error;
        }
    };

    const stream = await runStream(modelConfig);
    return { stream, model: finalChatModel };
};
