'use client';

import { useEditorEngine } from '@/components/store/editor';
import { Button } from '@onlook/ui/button';
import { Icons } from '@onlook/ui/icons';
import { cn } from '@onlook/ui/utils';
import { observer } from 'mobx-react-lite';
import { useRef, useState } from 'react';

interface PinCommentInputProps {
    elementDomId: string;
    elementTagName: string;
}

export const PinCommentInput = observer(({ elementDomId, elementTagName }: PinCommentInputProps) => {
    const editorEngine = useEditorEngine();
    const [inputValue, setInputValue] = useState('');
    const [isSending, setIsSending] = useState(false);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    const isEmpty = !inputValue.trim();

    function handleInput(e: React.ChangeEvent<HTMLTextAreaElement>) {
        e.currentTarget.style.height = 'auto';
        e.currentTarget.style.height = `${e.currentTarget.scrollHeight}px`;
    }

    async function handleSubmit() {
        const instruction = inputValue.trim();
        if (!instruction || isSending) return;

        setIsSending(true);
        try {
            // Register comment in the store; PinCommentCard will pick it up
            editorEngine.pinComments.addComment({
                elementDomId,
                elementTagName,
                instruction,
                projectId: editorEngine.projectId,
            });
            setInputValue('');
            if (textareaRef.current) {
                textareaRef.current.style.height = 'auto';
            }
        } finally {
            setIsSending(false);
        }
    }

    function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            void handleSubmit();
        }
    }

    return (
        <div className="flex flex-col gap-1 mt-1 border-t border-border/60 pt-1.5 px-1">
            {/* Header row */}
            <div className="flex items-center gap-1.5 text-[10px] text-foreground-secondary/70 px-1">
                <Icons.ChatBubble className="h-3 w-3 shrink-0" />
                <span>
                    Pin AI instruction on{' '}
                    <code className="font-mono text-foreground-secondary">&lt;{elementTagName}&gt;</code>
                </span>
            </div>

            {/* Input row */}
            <div className="flex items-end gap-1">
                <textarea
                    ref={textareaRef}
                    className={cn(
                        'flex-1 resize-none rounded-lg border border-border/50 bg-background-secondary/40',
                        'text-xs text-foreground-primary placeholder:text-foreground-secondary/50',
                        'px-2 py-1.5 min-h-[32px] max-h-24 overflow-auto',
                        'focus:outline-none focus:ring-1 focus:ring-foreground-secondary/20',
                        'transition-colors duration-150',
                    )}
                    placeholder="e.g. make it blue, increase font size…"
                    rows={1}
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onInput={handleInput}
                    onKeyDown={handleKeyDown}
                />
                <Button
                    size="icon"
                    variant="secondary"
                    disabled={isEmpty || isSending}
                    onClick={() => void handleSubmit()}
                    className={cn(
                        'h-7 w-7 rounded-full shrink-0 transition-all',
                        isEmpty
                            ? 'text-foreground-secondary/40'
                            : 'bg-foreground-primary text-background hover:bg-foreground-primary/80',
                    )}
                >
                    <Icons.ArrowRight className="h-3.5 w-3.5" />
                </Button>
            </div>
        </div>
    );
});
