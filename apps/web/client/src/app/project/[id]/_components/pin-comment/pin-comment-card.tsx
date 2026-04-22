'use client';

import { getUserChatMessageFromString } from '@/app/project/[id]/_hooks/use-chat/utils';
import { useEditorEngine } from '@/components/store/editor';
import type { PinComment } from '@/components/store/editor/pin-comments';
import { handleToolCall } from '@/components/tools';
import { api } from '@/trpc/client';
import { ChatType, type ChatMessage } from '@onlook/models';
import { Button } from '@onlook/ui/button';
import { Icons } from '@onlook/ui/icons';
import { cn } from '@onlook/ui/utils';
import { useChat as useAiChat } from '@ai-sdk/react';
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithToolCalls } from 'ai';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { jsonClone } from '@onlook/utility';

interface PinCommentCardProps {
    comment: PinComment;
}

/**
 * An isolated AI sub-agent card.
 *
 * Each card owns its own `useAiChat` instance wired to a unique `conversationId`,
 * so multiple cards stream concurrently without interfering with each other or
 * with the main right-panel conversation.
 */
export function PinCommentCard({ comment }: PinCommentCardProps) {
    const editorEngine = useEditorEngine();
    const [isExpanded, setIsExpanded] = useState(false);
    const [isExecutingToolCall, setIsExecutingToolCall] = useState(false);
    const hasFiredRef = useRef(false);

    // Initial user message built once
    const initialMessage = getUserChatMessageFromString(
        comment.instruction,
        [],
        comment.conversationId,
    );

    const {
        messages,
        status,
        setMessages,
        regenerate,
        addToolResult,
    } = useAiChat<ChatMessage>({
        id: `pin-${comment.id}`,
        // Seed with the user instruction so regenerate() can kick off the AI
        messages: [initialMessage],
        sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
        transport: new DefaultChatTransport({
            api: '/api/chat',
            body: {
                conversationId: comment.conversationId,
                projectId: comment.projectId,
                get chatModel() {
                    return editorEngine.state.chatModel;
                },
                chatType: ChatType.EDIT,
            },
        }),
        onToolCall: async ({ toolCall }) => {
            setIsExecutingToolCall(true);
            const addResult = async (result: {
                tool: string;
                toolCallId: string;
                output?: unknown;
                errorText?: string;
            }) => {
                addToolResult({
                    ...result,
                    state: result.errorText ? 'output-error' : 'output-available',
                } as any);
            };
            void handleToolCall(toolCall, editorEngine, addResult).finally(() => {
                setIsExecutingToolCall(false);
            });
        },
        onError: () => {
            editorEngine.pinComments.setStatus(comment.id, 'error');
            setIsExecutingToolCall(false);
        },
        onFinish: () => {
            editorEngine.pinComments.setStatus(comment.id, 'done');
        },
    });

    const isStreaming = status === 'streaming' || status === 'submitted' || isExecutingToolCall;

    // Sync streaming → store
    useEffect(() => {
        if (isStreaming) {
            editorEngine.pinComments.setStatus(comment.id, 'streaming');
        }
    }, [isStreaming, editorEngine.pinComments, comment.id]);

    // Create the backend conversation record and fire the AI request exactly once
    useEffect(() => {
        if (hasFiredRef.current) return;
        hasFiredRef.current = true;

        const fire = async () => {
            try {
                await api.chat.conversation.upsert.mutate({
                    id: comment.conversationId,
                    projectId: comment.projectId,
                });
            } catch (err) {
                console.warn('[PinComment] conversation upsert failed:', err);
            }

            // Push the seeded message and trigger the AI
            setMessages(jsonClone([initialMessage]));
            editorEngine.pinComments.setStatus(comment.id, 'streaming');
            void regenerate({
                body: {
                    chatType: ChatType.EDIT,
                    conversationId: comment.conversationId,
                    projectId: comment.projectId,
                    chatModel: editorEngine.state.chatModel,
                    previewUrl: editorEngine.activeSandbox?.session.signedPreviewUrl,
                },
            });
        };

        void fire();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Last assistant text content for preview
    const lastAssistantText = (() => {
        const lastMsg = messages.filter((m) => m.role === 'assistant').at(-1);
        if (!lastMsg) return undefined;
        const textPart = lastMsg.parts.find((p: any) => p.type === 'text' && typeof (p as any).text === 'string');
        return textPart ? (textPart as any).text as string : undefined;
    })();

    // ─── tag badge colour map ──────────────────────────────────────────────
    const tagColors: Record<string, string> = {
        div: 'bg-blue-500/15 text-blue-400',
        section: 'bg-blue-500/10 text-blue-300',
        span: 'bg-purple-500/15 text-purple-400',
        button: 'bg-orange-500/15 text-orange-400',
        p: 'bg-emerald-500/15 text-emerald-400',
        h1: 'bg-pink-500/15 text-pink-400',
        h2: 'bg-pink-500/15 text-pink-400',
        h3: 'bg-pink-500/15 text-pink-400',
        a: 'bg-cyan-500/15 text-cyan-400',
        img: 'bg-yellow-500/15 text-yellow-400',
    };
    const tagColor =
        tagColors[comment.elementTagName.toLowerCase()] ?? 'bg-foreground/10 text-foreground-secondary';

    // ─── status icon ──────────────────────────────────────────────────────
    const StatusIcon = () => {
        if (comment.status === 'error')
            return <Icons.ExclamationTriangle className="h-3 w-3 text-red-400 shrink-0" />;
        if (comment.status === 'done')
            return <Icons.CheckCircled className="h-3 w-3 text-green-400 shrink-0" />;
        return <Icons.LoadingSpinner className="h-3 w-3 animate-spin text-foreground-secondary shrink-0" />;
    };

    return (
        <motion.div
            layout
            initial={{ opacity: 0, x: 40, scale: 0.95 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 40, scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 260, damping: 22 }}
            className="flex flex-col rounded-xl border border-border bg-background/90 backdrop-blur-xl shadow-xl w-72 overflow-hidden"
        >
            {/* ── Header ── */}
            <div className="flex items-center gap-2 px-3 py-2 bg-background-secondary/40 border-b border-border/60">
                {/* Element tag badge */}
                <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-mono font-semibold shrink-0', tagColor)}>
                    &lt;{comment.elementTagName}&gt;
                </span>

                {/* Instruction preview – truncated */}
                <span className="flex-1 text-xs text-foreground-secondary truncate min-w-0">
                    {comment.instruction}
                </span>

                {/* Controls */}
                <div className="flex items-center gap-0.5 shrink-0">
                    <StatusIcon />
                    <Button
                        size="icon"
                        variant="ghost"
                        title={isExpanded ? 'Collapse' : 'Expand'}
                        className="h-5 w-5 rounded-md text-foreground-secondary/60 hover:text-foreground-secondary"
                        onClick={() => setIsExpanded((v) => !v)}
                    >
                        {isExpanded
                            ? <Icons.ChevronUp className="h-3 w-3" />
                            : <Icons.ChevronDown className="h-3 w-3" />}
                    </Button>
                    <Button
                        size="icon"
                        variant="ghost"
                        title="Dismiss"
                        className="h-5 w-5 rounded-md text-foreground-secondary/60 hover:text-red-400"
                        onClick={() => editorEngine.pinComments.removeComment(comment.id)}
                    >
                        <Icons.CrossL className="h-3 w-3" />
                    </Button>
                </div>
            </div>

            {/* ── Expandable body ── */}
            <AnimatePresence initial={false}>
                {isExpanded && (
                    <motion.div
                        key="body"
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden"
                    >
                        <div className="px-3 py-2.5 max-h-56 overflow-y-auto flex flex-col gap-2">
                            {/* Status label */}
                            <div className="flex items-center gap-1.5">
                                <StatusIcon />
                                <span
                                    className={cn(
                                        'text-[10px] font-medium',
                                        comment.status === 'done' && 'text-green-400',
                                        comment.status === 'error' && 'text-red-400',
                                        (comment.status === 'pending' ||
                                            comment.status === 'streaming') &&
                                            'text-foreground-secondary',
                                    )}
                                >
                                    {comment.status === 'done' && 'Changes applied'}
                                    {comment.status === 'error' && 'Something went wrong'}
                                    {comment.status === 'streaming' && 'Working on it…'}
                                    {comment.status === 'pending' && 'Pending…'}
                                </span>
                            </div>

                            {/* AI response text */}
                            {lastAssistantText ? (
                                <p className="text-xs text-foreground-secondary leading-relaxed whitespace-pre-wrap">
                                    {lastAssistantText.length > 400
                                        ? lastAssistantText.slice(0, 400) + '…'
                                        : lastAssistantText}
                                </p>
                            ) : isStreaming ? (
                                <div className="flex items-center gap-2 text-xs text-foreground-secondary/60">
                                    <Icons.LoadingSpinner className="h-3 w-3 animate-spin" />
                                    <span>AI is working on this…</span>
                                </div>
                            ) : null}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </motion.div>
    );
}
