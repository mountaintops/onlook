import type { ToolCall } from '@ai-sdk/provider-utils';
import { ChatType, GOOGLE_MODELS, LLMProvider, OPENROUTER_MODELS, type ChatMessage, type MCPServerConfig, type ModelConfig } from '@onlook/models';
import { NoSuchToolError, generateObject, smoothStream, stepCountIs, streamText, type ToolSet } from 'ai';
import { convertToStreamMessages, getAskModeSystemPrompt, getCreatePageSystemPrompt, getSystemPrompt, getToolSetFromType, initModel } from '../index';
import type { OnlookMCPClient } from '../mcp/client';

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
    mcpServers?: MCPServerConfig[];
}) => {
    const modelConfig = getModelFromType(chatType);
    const systemPrompt = getSystemPromptFromType(chatType);
    let toolSet = getToolSetFromType(chatType);

    // MCP Integration
    const mcpClients: OnlookMCPClient[] = [];

    // Dynamically import OnlookMCPClient to avoid bundling issues
    let OnlookMCPClient: typeof import('../mcp/client').OnlookMCPClient;
    try {
        const module = await import('../mcp/client');
        OnlookMCPClient = module.OnlookMCPClient;
    } catch (e) {
        console.error('Failed to import OnlookMCPClient', e);
        return streamText({
            providerOptions: modelConfig.providerOptions,
            messages: await convertToStreamMessages(messages),
            model: modelConfig.model,
            system: systemPrompt,
            tools: toolSet,
            headers: modelConfig.headers,
            stopWhen: stepCountIs(20),
            experimental_repairToolCall: repairToolCall,
            experimental_transform: smoothStream(),
            experimental_telemetry: {
                isEnabled: true,
                metadata: {
                    conversationId,
                    projectId,
                    userId,
                    chatType,
                    tags: ['chat'],
                    langfuseTraceId: traceId,
                    sessionId: conversationId,
                },
            },
        });
    }


    if (process.env.MCP_SERVER_COMMAND) {
        try {
            const mcpClient = new OnlookMCPClient('onlook-agent-env');
            await mcpClient.connectViaStdio(
                process.env.MCP_SERVER_COMMAND,
                process.env.MCP_SERVER_ARGS ? JSON.parse(process.env.MCP_SERVER_ARGS) : []
            );
            const mcpTools = await mcpClient.getTools();
            toolSet = { ...toolSet, ...mcpTools };
            mcpClients.push(mcpClient);
            console.log(`[MCP] Connected to env server and loaded ${Object.keys(mcpTools).length} tools`);
        } catch (error) {
            console.error('[MCP] Failed to connect to env server:', error);
        }
    }

    if (mcpServers && mcpServers.length > 0) {
        for (const server of mcpServers) {
            if (!server.enabled) continue;
            try {
                const mcpClient = new OnlookMCPClient(server.name);

                if (server.transport === 'sse' && server.url) {
                    await mcpClient.connectViaSSE(server.url, server.headers);
                } else if (server.transport === 'stdio' && server.command) {
                    await mcpClient.connectViaStdio(server.command, server.args || [], server.env);
                } else {
                    console.warn(`[MCP] Skipping ${server.name}: invalid configuration`);
                    continue;
                }

                const mcpTools = await mcpClient.getTools();
                toolSet = { ...toolSet, ...mcpTools };
                mcpClients.push(mcpClient);
                console.log(`[MCP] Connected to ${server.name} (${server.transport}) and loaded ${Object.keys(mcpTools).length} tools`);
            } catch (error) {
                console.error(`[MCP] Failed to connect to ${server.name}:`, error);
            }
        }
    }

    return streamText({
        providerOptions: modelConfig.providerOptions,
        messages: await convertToStreamMessages(messages),
        model: modelConfig.model,
        system: systemPrompt,
        tools: toolSet,
        headers: modelConfig.headers,
        stopWhen: stepCountIs(20),
        experimental_repairToolCall: repairToolCall,
        experimental_transform: smoothStream(),
        onFinish: async () => {
            for (const client of mcpClients) {
                await client.disconnect();
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

export const getModelFromType = (chatType: ChatType): ModelConfig => {
    switch (chatType) {
        case ChatType.CREATE:
        case ChatType.FIX:
            return initModel({
                provider: LLMProvider.GOOGLE,
                model: GOOGLE_MODELS.GEMINI_3_0_PRO_PREVIEW,
            });
        case ChatType.ASK:
        case ChatType.EDIT:
        default:
            return initModel({
                provider: LLMProvider.GOOGLE,
                model: GOOGLE_MODELS.GEMINI_3_0_PRO_PREVIEW,
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
        model: GOOGLE_MODELS.GEMINI_3_0_PRO_PREVIEW,
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
