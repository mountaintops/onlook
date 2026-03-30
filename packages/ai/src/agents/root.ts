import type { ToolCall } from '@ai-sdk/provider-utils';
import { ChatType, LLMProvider, GOOGLE_MODELS, type ChatMessage, type McpServerConfig, type ModelConfig } from '@onlook/models';
import { NoSuchToolError, generateObject, smoothStream, stepCountIs, streamText, type ToolSet } from 'ai';
import { convertToStreamMessages, getAskModeSystemPrompt, getCreatePageSystemPrompt, getSystemPrompt, getToolSetFromType, initModel } from '../index';
import { McpClientManager } from '../mcp';

export const createRootAgentStream = async ({
    chatType,
    conversationId,
    projectId,
    userId,
    traceId,
    messages,
    mcpServers,
}: {
    chatType: ChatType;
    conversationId: string;
    projectId: string;
    userId: string;
    traceId: string;
    messages: ChatMessage[];
    mcpServers?: McpServerConfig[];
}) => {
    const modelConfig = getModelFromType(chatType);
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

    return streamText({
        providerOptions: modelConfig.providerOptions,
        messages: await convertToStreamMessages(messages),
        model: modelConfig.model,
        system: systemPrompt,
        tools: mergedTools,
        headers: modelConfig.headers,
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
}

const getSystemPromptFromType = (chatType: ChatType): string => {
    switch (chatType) {
        case ChatType.CREATE:
            return getCreatePageSystemPrompt();
        case ChatType.ASK:
            return getAskModeSystemPrompt();
        case ChatType.EDIT:
        default:
            return getSystemPrompt();
    }
}

const getModelFromType = (chatType: ChatType): ModelConfig => {
    switch (chatType) {
        case ChatType.CREATE:
        case ChatType.FIX:
            return initModel({
                provider: LLMProvider.GOOGLE,
                model: GOOGLE_MODELS.GEMINI_3_1_FLASH_LITE_PREVIEW,
            });
        case ChatType.ASK:
        case ChatType.EDIT:
        default:
            return initModel({
                provider: LLMProvider.GOOGLE,
                model: GOOGLE_MODELS.GEMINI_3_1_FLASH_LITE_PREVIEW,
            });
    }
}

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
    });

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
}
