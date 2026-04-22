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
            <div className="flex flex-col gap-3 px-4 py-6 border-t bg-muted/5 max-h-[400px] overflow-y-auto custom-scrollbar">
                <div className="flex items-center gap-2 mb-1">
                    <Icons.Sparkles className="w-4 h-4 text-primary" />
                    <h4 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">AI Sub-agents</h4>
                </div>
                {comments.length > 0 ? (
                    <div className="flex flex-col gap-3">
                        <AnimatePresence mode="popLayout">
                            {comments.map((comment) => (
                                <PinCommentCard key={comment.id} comment={comment} />
                            ))}
                        </AnimatePresence>
                    </div>
                ) : (
                    <div className="text-[10px] text-muted-foreground italic px-1">
                        No active sub-agents. Pin a comment to start one.
                    </div>
                )}
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
