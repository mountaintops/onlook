import { type NextRequest } from 'next/server';
import { createUIMessageStream, createUIMessageStreamResponse } from 'ai';
import { v4 as uuidv4 } from 'uuid';

import type { ChatMessage } from '@onlook/models';
import { createRootAgentStream } from '@onlook/ai/src/server';
import { toDbMessage } from '@onlook/db';
import { ChatType, LLMProvider } from '@onlook/models';
import { getProjectMcpServers } from '@onlook/utility/src/mcp.server';

import { createClient as createTRPCClient } from '@/trpc/request-server';
import { trackEvent } from '@/utils/analytics/server';
import {
    checkMessageLimit,
    decrementUsage,
    errorHandler,
    getSupabaseUser,
    incrementUsage,
} from './helpers';
import { MODAL_GLM5_LOCK_KEY, releaseLock, tryAcquireLock } from './locks';

export async function POST(req: NextRequest) {
    try {
        const body = await req.json().catch((err) => {
            const errorMessage = err instanceof Error ? err.message : String(err);
            const errorStack = err instanceof Error ? err.stack : undefined;
            console.error('[Chat Route] Failed to parse JSON body:', {
                error: errorMessage,
                stack: errorStack,
                timestamp: new Date().toISOString(),
            });
            return null;
        });

        if (!body) {
            console.error('[Chat Route] Invalid or missing JSON body', {
                timestamp: new Date().toISOString(),
            });
            return new Response(
                JSON.stringify({
                    error: 'Invalid or missing JSON body',
                    code: 400,
                }),
                {
                    status: 400,
                    headers: { 'Content-Type': 'application/json' },
                },
            );
        }

        const { projectId } = body as {
            projectId: string;
        };

        if (!projectId) {
            console.error('[Chat Route] Missing projectId in request body', {
                body,
                timestamp: new Date().toISOString(),
            });
            return new Response(
                JSON.stringify({
                    error: 'Missing projectId in request body',
                    code: 400,
                }),
                {
                    status: 400,
                    headers: { 'Content-Type': 'application/json' },
                },
            );
        }

        const user = await getSupabaseUser(req);
        if (!user) {
            console.error('[Chat Route] Unauthorized - no user found', {
                timestamp: new Date().toISOString(),
            });
            return new Response(
                JSON.stringify({
                    error: 'Unauthorized, no user found. Please login again.',
                    code: 401,
                }),
                {
                    status: 401,
                    headers: { 'Content-Type': 'application/json' },
                },
            );
        }

        const usageCheckResult = await checkMessageLimit(req);
        if (usageCheckResult.exceeded) {
            trackEvent({
                distinctId: user.id,
                event: 'message_limit_exceeded',
                properties: {
                    usage: usageCheckResult.usage,
                },
            });
            console.error('[Chat Route] Message limit exceeded', {
                usage: usageCheckResult.usage,
                timestamp: new Date().toISOString(),
            });
            return new Response(
                JSON.stringify({
                    error: 'Message limit exceeded. Please upgrade to a paid plan.',
                    code: 402,
                    usage: usageCheckResult.usage,
                }),
                {
                    status: 402,
                    headers: { 'Content-Type': 'application/json' },
                },
            );
        }

        return streamResponse(req, user.id, body);
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : undefined;
        console.error('[Chat Route] Error in POST handler:', {
            error: errorMessage,
            stack: errorStack,
            timestamp: new Date().toISOString(),
        });
        return new Response(
            JSON.stringify({
                error: error instanceof Error ? error.message : String(error),
                code: 500,
            }),
            {
                status: 500,
                headers: { 'Content-Type': 'application/json' },
            },
        );
    }
}

export const streamResponse = async (req: NextRequest, userId: string, body: any) => {
    const { messages, chatType, conversationId, projectId, chatModel, previewUrl } = body as {
        messages: ChatMessage[];
        chatType: ChatType;
        conversationId: string;
        projectId: string;
        chatModel?: any;
        previewUrl?: string;
    };

    let usageRecord: {
        usageRecordId: string | undefined;
        rateLimitId: string | undefined;
    } | null = null;

    try {
        const lastUserMessage = messages.findLast((message) => message.role === 'user');
        const traceId = lastUserMessage?.id ?? uuidv4();

        if (chatType === ChatType.EDIT) {
            usageRecord = await incrementUsage(req, traceId);
        }

        const { api } = await createTRPCClient(req);
        const projectSettingsData = await api.settings.get({ projectId });
        const userData = await api.user.settings.get();

        const isGLM5 = chatModel?.provider === LLMProvider.MODAL;
        if (isGLM5) {
            if (!tryAcquireLock(MODAL_GLM5_LOCK_KEY)) {
                console.warn('[Chat Route] GLM-5 is already processing another request', {
                    userId,
                    projectId,
                    timestamp: new Date().toISOString(),
                });
                return new Response(
                    JSON.stringify({
                        error: 'GLM-5 is already processing another request. Please wait and try again.',
                        code: 429,
                    }),
                    {
                        status: 429,
                        headers: { 'Content-Type': 'application/json', 'Retry-After': '5' },
                    },
                );
            }
        }

        let selectedModel = chatModel;
        const stream = createUIMessageStream({
            originalMessages: messages,
            generateId: () => uuidv4(),
            onFinish: async ({ messages: finalMessages }: { messages: ChatMessage[] }) => {
                if (isGLM5) releaseLock(MODAL_GLM5_LOCK_KEY);

                const messagesToStore = finalMessages
                    .filter((msg) => msg.role === 'user' || msg.role === 'assistant')
                    .map((msg) =>
                        toDbMessage(
                            {
                                ...msg,
                                metadata: {
                                    ...msg.metadata,
                                    createdAt: new Date(),
                                    conversationId,
                                    chatModel: selectedModel,
                                },
                            } as any,
                            conversationId,
                        ),
                    );

                await api.chat.message.replaceConversationMessages({
                    conversationId,
                    messages: messagesToStore,
                });
            },
            onError: (err: any) => {
                if (isGLM5) releaseLock(MODAL_GLM5_LOCK_KEY);
                return errorHandler(err);
            },
            execute: async ({ writer }) => {
                // Send an empty text start to start the stream immediately and end the 'submitted' state on client
                writer.write({ type: 'text-start', id: uuidv4() });

                try {
                    // Combine MCP servers from three sources:
                    // 1. Permanent (site-wide, from JSON config)
                    // 2. Global (per user, from user settings)
                    // 3. Project-specific (per project, from project settings)
                    const mcpServers = getProjectMcpServers(
                        projectSettingsData?.mcpServers ?? [],
                        userData?.mcpServers ?? [],
                    );

                    const { streamResult, model } = await createRootAgentStream({
                        chatType,
                        conversationId,
                        projectId,
                        userId,
                        traceId,
                        messages,
                        chatModel,
                        mcpServers,
                        previewUrl,
                        updateMcpServer: async (serverId, patch) => {
                            const currentData = await api.settings.get({ projectId });
                            const servers = currentData?.mcpServers ?? [];
                            const updated = servers.map((s: any) =>
                                s.id === serverId ? { ...s, ...patch } : s,
                            );
                            await api.settings.upsert({
                                projectId,
                                settings: { mcpServers: updated },
                            });
                        },
                    });

                    selectedModel = model;
                    if (streamResult) {
                        writer.merge(streamResult.toUIMessageStream());
                    }
                } catch (err) {
                    if (isGLM5) releaseLock(MODAL_GLM5_LOCK_KEY);
                    writer.write({
                        type: 'error',
                        errorText: err instanceof Error ? err.message : String(err),
                    });
                }
            },
        });

        return createUIMessageStreamResponse({ stream });
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : undefined;
        console.error('[Chat Route] Error in streamResponse setup:', {
            error: errorMessage,
            stack: errorStack,
            userId,
            projectId,
            conversationId,
            timestamp: new Date().toISOString(),
        });
        if (usageRecord) {
            await decrementUsage(req, usageRecord);
        }
        throw error;
    }
};
