import { createUIMessageStreamResponse } from 'ai';
import { trackEvent } from '@/utils/analytics/server';
import { createClient as createTRPCClient } from '@/trpc/request-server';
import { createRootAgentStream } from '@onlook/ai/src/server';
import { toDbMessage } from '@onlook/db';
import { ChatType, LLMProvider, type ChatMessage, type ChatMetadata } from '@onlook/models';
import { type NextRequest } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { checkMessageLimit, decrementUsage, errorHandler, getSupabaseUser, incrementUsage } from './helpers';
import { MODAL_GLM5_LOCK_KEY, tryAcquireLock, releaseLock } from './locks';
import { CodeProvider, createCodeProviderClient } from '@onlook/code-provider';

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

        const { messages, chatType, conversationId, projectId, chatModel } = body as {
            messages: ChatMessage[],
            chatType: ChatType,
            conversationId: string,
            projectId: string,
            chatModel?: any,
        };

        if (!projectId) {
            console.error('Missing projectId in /api/chat request body. Detailed debug info:', {
                method: req.method,
                url: req.url,
                headers: Object.fromEntries(req.headers.entries()),
                bodyKeys: Object.keys(body),
                bodyContent: JSON.stringify(body, null, 2),
            });
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
        const mcpServers = projectSettingsData?.mcpServers ?? [];

        // Fetch project branches to get the sandboxId for MCP execution
        let sandboxId: string | undefined;
        try {
            const projectBranches = await api.project.branch.getByProjectId({
                projectId,
                onlyDefault: true
            });
            sandboxId = projectBranches[0]?.sandboxId;
        } catch (error) {
            console.warn(`[Chat] Failed to fetch branches for project ${projectId}, falling back to local MCP execution:`, error);
        }

        let codeProvider;
        if (sandboxId) {
            try {
                codeProvider = createCodeProviderClient(CodeProvider.CodeSandbox, {
                    providerOptions: {
                        codesandbox: {
                            sandboxId,
                            userId,
                            tier: 'Pico',
                            initClient: true,
                        },
                    },
                });
                await codeProvider.initialize({});
                console.log(`[Chat] Initialized CodeSandbox provider for project ${projectId} (sandbox: ${sandboxId})`);
            } catch (error) {
                console.error(`[Chat] Failed to initialize CodeSandbox provider for sandbox ${sandboxId}:`, error);
                codeProvider = undefined;
            }
        }

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

        let stream;
        let selectedModel;
        try {
            const result = await createRootAgentStream({
                chatType,
                conversationId,
                projectId,
                userId,
                traceId,
                messages,
                mcpServers,
                chatModel,
                codeProvider,
            });
            stream = result.stream;
            selectedModel = result.model;
        } catch (err) {
            if (isGLM5) releaseLock(MODAL_GLM5_LOCK_KEY);
            throw err;
        }

        return stream.toUIMessageStreamResponse({
            originalMessages: messages,
            generateMessageId: () => uuidv4(),
            messageMetadata: (options: any) => {
                const part = options.part;
                return {
                    createdAt: new Date(),
                    conversationId,
                    context: [],
                    checkpoints: [],
                    finishReason: part.type === 'finish-step' ? part.finishReason : undefined,
                    usage: part.type === 'finish-step' ? part.usage : undefined,
                    chatModel: selectedModel,
                } satisfies ChatMetadata;
            },
            onFinish: async ({ messages: finalMessages }: { messages: ChatMessage[] }) => {
                if (isGLM5) releaseLock(MODAL_GLM5_LOCK_KEY);
                if (codeProvider) {
                    await codeProvider.destroy().catch(err => console.error('[Chat] Error destroying codeProvider:', err));
                }
                const messagesToStore = finalMessages
                    .filter(msg =>
                        (msg.role === 'user' || msg.role === 'assistant')
                    )
                    .map(msg => toDbMessage(msg, conversationId));

                await api.chat.message.replaceConversationMessages({
                    conversationId,
                    messages: messagesToStore,
                });
            },
            onError: (err: any) => {
                if (isGLM5) releaseLock(MODAL_GLM5_LOCK_KEY);
                if (codeProvider) {
                    codeProvider.destroy().catch(e => console.error('[Chat] Error destroying codeProvider in error handler:', e));
                }
                return errorHandler(err);
            },
        });
    } catch (error) {
        console.error('Error in streamResponse setup', error);
        if (usageRecord) {
            await decrementUsage(req, usageRecord);
        }
        throw error;
    }
}
