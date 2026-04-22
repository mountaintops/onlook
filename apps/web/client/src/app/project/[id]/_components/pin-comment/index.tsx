'use client';

import { useEditorEngine } from '@/components/store/editor';
import { observer } from 'mobx-react-lite';
import { AnimatePresence } from 'motion/react';
import { PinCommentCard } from './pin-comment-card';

/**
 * Floating panel that renders all active PinCommentCards as a vertical stack
 * in the bottom-right corner of the editor viewport.
 *
 * It persists regardless of element selection state, so users can dismiss
 * or inspect comments after clicking elsewhere.
 */
export const PinCommentPanel = observer(() => {
    const editorEngine = useEditorEngine();
    const comments = editorEngine.pinComments.all;

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
