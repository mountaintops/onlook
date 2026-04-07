import type { ToolCall } from '@ai-sdk/provider-utils';
import { ChatType, LLMProvider, GOOGLE_MODELS, MISTRAL_MODELS, MODAL_MODELS, type ChatMessage, type McpServerConfig, type ModelConfig, type InitialModelPayload } from '@onlook/models';
import { NoSuchToolError, generateObject, generateText, smoothStream, stepCountIs, streamText, type ToolSet, type StreamTextResult } from 'ai';
import { convertToStreamMessages, getArchitectModeClassificationPrompt, getAskModeSystemPrompt, getCreatePageSystemPrompt, getSystemPrompt, getToolSetFromType, initModel } from '../index';
import { McpClientManager, type PendingOAuth } from '../mcp';


const ARCHITECT_FALLBACK_MODELS = [
    { provider: LLMProvider.GOOGLE, model: GOOGLE_MODELS.GEMMA_4_26B },
    { provider: LLMProvider.MISTRAL, model: MISTRAL_MODELS.DEVSTRAL_2512 },
    { provider: LLMProvider.MISTRAL, model: MISTRAL_MODELS.MISTRAL_LARGE_2512 },
    { provider: LLMProvider.GOOGLE, model: GOOGLE_MODELS.GEMMA_4_31B },
    { provider: LLMProvider.GOOGLE, model: GOOGLE_MODELS.GEMINI_3_FLASH },
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

    const hasGoogleKey = !!(process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GOOGLE_AI_STUDIO_API_KEY);
    const defaultProvider = hasGoogleKey ? LLMProvider.GOOGLE : LLMProvider.MISTRAL;
    const defaultModel = hasGoogleKey ? GOOGLE_MODELS.GEMMA_4_31B : MISTRAL_MODELS.MISTRAL_LARGE_2512;

    switch (chatType) {
        case ChatType.CREATE:
        case ChatType.FIX:
            return initModel({
                provider: defaultProvider,
                model: defaultModel,
            } as InitialModelPayload);
        case ChatType.ASK:
        case ChatType.EDIT:
        default:
            return initModel({
                provider: defaultProvider,
                model: defaultModel,
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

    const hasGoogleKey = !!(process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GOOGLE_AI_STUDIO_API_KEY);
    const { model } = initModel({
        provider: hasGoogleKey ? LLMProvider.GOOGLE : LLMProvider.MISTRAL,
        model: hasGoogleKey ? GOOGLE_MODELS.GEMMA_4_31B : MISTRAL_MODELS.MISTRAL_LARGE_2512,
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

    const contentLower = content.toLowerCase();
    const toolKeywords = [
        'folder', 'directory', 'mkdir', 'bash', 'terminal', 'command', 'mcp', 'run', 'shell', 'npm',
        'git', 'install', 'update', 'build', 'deploy', 'script', 'system', 'process', 'env',
    ];

    // Heuristic: Very short prompts or tool-related keywords favor devstral
    if (content.length < 20 || toolKeywords.some((keyword) => contentLower.includes(keyword))) {
        return {
            provider: LLMProvider.MISTRAL,
            model: MISTRAL_MODELS.DEVSTRAL_2512,
        };
    }

    const hasGoogleKey = !!(process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GOOGLE_AI_STUDIO_API_KEY);
    if (!hasGoogleKey) {
        console.log('[ArchitectMode] No Google API key found, skipping classification and using default fallback (Devstral)');
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
            maxOutputTokens: 5,
            prompt: getArchitectModeClassificationPrompt(content),
        });

        const complexityLower = complexity.trim().toLowerCase();

        if (complexityLower.includes('small') || complexityLower.includes('tools')) {
            return {
                provider: LLMProvider.MISTRAL,
                model: MISTRAL_MODELS.DEVSTRAL_2512,
            };
        } else if (complexityLower.includes('medium')) {
            return {
                provider: LLMProvider.GOOGLE,
                model: GOOGLE_MODELS.GEMMA_4_31B,
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
    onUpdateMcpConfig,
    chatModel,
}: {
    chatType: ChatType;
    conversationId: string;
    projectId: string;
    userId: string;
    traceId: string;
    messages: ChatMessage[];
    mcpServers?: McpServerConfig[];
    onUpdateMcpConfig?: (config: McpServerConfig) => void;
    chatModel?: any;
}) => {
    let finalChatModel = chatModel;
    if (chatType === ChatType.ARCHITECT && !chatModel) {
        finalChatModel = await runArchitectMode(messages);
    }
    const modelConfig = getModelFromType(chatType, finalChatModel);
    const systemPrompt = getSystemPromptFromType(chatType);
    const builtInTools = getToolSetFromType(chatType);

    // Connect to MCP servers and merge their tools with built-in tools
    let mcpManager: McpClientManager | null = null;
    let mergedTools: ToolSet = builtInTools;

    if (mcpServers && mcpServers.length > 0) {
        mcpManager = new McpClientManager(
            mcpServers,
            projectId,
            (type: 'info' | 'error' | 'sent' | 'received', message: string) => {
                const formattedMessage = `[MCP] ${message}`;
                if (type === 'error') {
                    console.error(formattedMessage);
                } else if (type === 'sent' || type === 'received') {
                    console.debug(formattedMessage);
                } else {
                    console.log(formattedMessage);
                }
            },
            onUpdateMcpConfig,
        );
        
        console.log(`[Chat] Connecting to ${mcpServers.length} MCP servers...`);

        try {
            console.log('[MCP] Fetching tools from manager...');
            const mcpTools = await mcpManager.getTools();
            const toolNames = Object.keys(mcpTools);
            console.log(`[MCP] Discovery complete. Found ${toolNames.length} custom tools.`);
            mergedTools = { ...builtInTools, ...mcpTools };
        } catch (error) {
            console.error('[MCP] Error fetching MCP tools, using built-in tools only:', error);
        }
    }

    const isGemma3 = finalChatModel?.model === GOOGLE_MODELS.GEMMA_3_27B;
    const isGLM5 = finalChatModel?.model === MODAL_MODELS.GLM_5;
    const disableTools = isGemma3;

    const runStream = async (config: ModelConfig, attempt: number = 0): Promise<StreamTextResult<any, any>> => {
        try {
            return streamText({
                providerOptions: config.providerOptions,
                messages: await convertToStreamMessages(messages),
                model: config.model,
                system: systemPrompt,
                tools: disableTools ? undefined : mergedTools,
                headers: config.headers,
                stopWhen: stepCountIs(20),
                experimental_repairToolCall: isGLM5 ? undefined : repairToolCall,
                experimental_transform: isGLM5 ? undefined : smoothStream(),
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

    const streamResult = await runStream(modelConfig);
    const pendingAuths: PendingOAuth[] = mcpManager?.getPendingAuths() ?? [];
    return { streamResult, model: finalChatModel, pendingAuths };
};
