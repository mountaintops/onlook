import { createUIMessageStream, createUIMessageStreamResponse } from 'ai';
import { trackEvent } from '@/utils/analytics/server';
import { createClient as createTRPCClient } from '@/trpc/request-server';
import { createRootAgentStream } from '@onlook/ai/src/server';
import { toDbMessage } from '@onlook/db';
import { ChatType, LLMProvider, type ChatMessage } from '@onlook/models';
import { type NextRequest } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { checkMessageLimit, decrementUsage, errorHandler, getSupabaseUser, incrementUsage } from './helpers';
import { MODAL_GLM5_LOCK_KEY, tryAcquireLock, releaseLock } from './locks';

export async function POST(req: NextRequest) {
    try {
        const body = await req.json().catch(err => {
            console.error('Failed to parse JSON body in /api/chat:', err);
            return null;
        });

        if (!body) {
            return new Response(JSON.stringify({
                error: 'Invalid or missing JSON body',
                code: 400,
            }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const { projectId } = body as {
            projectId: string,
        };

        if (!projectId) {
            return new Response(JSON.stringify({
                error: 'Missing projectId in request body',
                code: 400,
            }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const user = await getSupabaseUser(req);
        if (!user) {
            return new Response(JSON.stringify({
                error: 'Unauthorized, no user found. Please login again.',
                code: 401
            }), {
                status: 401,
                headers: { 'Content-Type': 'application/json' }
            });
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
            return new Response(JSON.stringify({
                error: 'Message limit exceeded. Please upgrade to a paid plan.',
                code: 402,
                usage: usageCheckResult.usage,
            }), {
                status: 402,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        return streamResponse(req, user.id, body);
    } catch (error: unknown) {
        console.error('Error in chat route POST handler:', error);
        return new Response(JSON.stringify({
            error: error instanceof Error ? error.message : String(error),
            code: 500,
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

export const streamResponse = async (req: NextRequest, userId: string, body: any) => {
    const { messages, chatType, conversationId, projectId, chatModel } = body as {
        messages: ChatMessage[],
        chatType: ChatType,
        conversationId: string,
        projectId: string,
        chatModel?: any,
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

        const isGLM5 = chatModel?.provider === LLMProvider.MODAL;
        if (isGLM5) {
            if (!tryAcquireLock(MODAL_GLM5_LOCK_KEY)) {
                return new Response(JSON.stringify({
                    error: 'GLM-5 is already processing another request. Please wait and try again.',
                    code: 429,
                }), {
                    status: 429,
                    headers: { 'Content-Type': 'application/json', 'Retry-After': '5' },
                });
            }
        }

        let streamResult;
        let selectedModel;
        try {
            const result = await createRootAgentStream({
                chatType,
                conversationId,
                projectId,
                userId,
                traceId,
                messages,
                chatModel,
            });
            streamResult = result.streamResult;
            selectedModel = result.model;
        } catch (err) {
            if (isGLM5) releaseLock(MODAL_GLM5_LOCK_KEY);
            throw err;
        }

        const stream = createUIMessageStream({
            originalMessages: messages,
            generateId: () => uuidv4(),
            onFinish: async ({ messages: finalMessages }: { messages: ChatMessage[] }) => {
                if (isGLM5) releaseLock(MODAL_GLM5_LOCK_KEY);
                
                const messagesToStore = finalMessages
                    .filter(msg => (msg.role === 'user' || msg.role === 'assistant'))
                    .map(msg => toDbMessage({
                        ...msg,
                        metadata: {
                            ...msg.metadata,
                            createdAt: new Date(),
                            conversationId,
                            chatModel: selectedModel,
                        }
                    } as any, conversationId));

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
                if (streamResult) {
                    writer.merge(streamResult.toUIMessageStream());
                }
            }
        });

        return createUIMessageStreamResponse({ stream });
    } catch (error) {
        console.error('Error in streamResponse setup', error);
        if (usageRecord) {
            await decrementUsage(req, usageRecord);
        }
        throw error;
    }
};
