'use client';

import { useEditorEngine } from '@/components/store/editor';
import { observer } from 'mobx-react-lite';
import { AnimatePresence } from 'motion/react';
import { Icons } from '@onlook/ui/icons';
import { PinCommentCard } from './pin-comment-card';

/**
 * Floating panel that renders all active PinCommentCards.
 * Can be rendered as a fixed floating panel or integrated into a sidebar.
 */
export const PinCommentPanel = observer(({ isSidebar = false }: { isSidebar?: boolean }) => {
    const editorEngine = useEditorEngine();
    const comments = editorEngine.pinComments.all;

    if (isSidebar) {
        return (
            <div className="bg-background flex h-full w-full flex-col overflow-hidden">
                <div className="bg-muted/30 flex flex-col gap-3 border-b p-4">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <div className="bg-primary/10 text-primary rounded-md p-1.5">
                                <Icons.Sparkles className="h-4 w-4" />
                            </div>
                            <h3 className="text-foreground text-sm font-semibold">AI Sub-agents</h3>
                        </div>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto custom-scrollbar p-4 flex flex-col gap-4">
                    {comments.length > 0 ? (
                        <AnimatePresence mode="popLayout">
                            {comments.map((comment) => (
                                <PinCommentCard key={comment.id} comment={comment} />
                            ))}
                        </AnimatePresence>
                    ) : (
                        <div className="flex flex-col items-center justify-center h-64 text-center p-6 text-muted-foreground">
                            <Icons.Sparkles className="h-10 w-10 mb-4 opacity-10" />
                            <p className="text-sm font-medium text-foreground mb-1">No Active Sub-agents</p>
                            <p className="text-xs">Pin a comment to an element to spawn a parallel AI agent.</p>
                        </div>
                    )}
                </div>
            </div>
        );
    }

    if (comments.length === 0) return null;

    return (
        <div
            className="fixed bottom-12 right-[360px] z-50 flex flex-col gap-2 pointer-events-auto"
            style={{ maxHeight: 'calc(100vh - 80px)', overflowY: 'auto', paddingRight: 4 }}
        >
            <AnimatePresence mode="popLayout">
                {comments.map((comment) => (
                    <PinCommentCard key={comment.id} comment={comment} />
                ))}
            </AnimatePresence>
        </div>
    );
});
