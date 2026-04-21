'use client';

import { useEditorEngine } from '@/components/store/editor';
import { transKeys } from '@/i18n/keys';
import { Icons } from '@onlook/ui/icons/index';
import { ResizablePanel } from '@onlook/ui/resizable';
import { observer } from 'mobx-react-lite';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ChatTab } from './chat-tab';
import { ChatControls } from './chat-tab/controls';
import { ChatHistory } from './chat-tab/history';
import { ChatPanelDropdown } from './chat-tab/panel-dropdown';
import { TweaksTab } from './tweaks-tab';
import { MixerHorizontalIcon } from '@radix-ui/react-icons';
import { Button } from '@onlook/ui/button';
import { cn } from '@onlook/ui/utils';

export const RightPanel = observer(() => {
    const editorEngine = useEditorEngine();
    const t = useTranslations();
    const [isChatHistoryOpen, setIsChatHistoryOpen] = useState(false);
    const currentConversation = editorEngine.chat.conversation.current;
    const editPanelWidth = 352

    return (
        <div
            className='flex h-full w-full transition-width duration-300 bg-background/95 group/panel border-[0.5px] backdrop-blur-xl shadow rounded-tl-xl'
        >
            <ResizablePanel
                side="right"
                defaultWidth={editPanelWidth}
                forceWidth={editPanelWidth}
                minWidth={240}
                maxWidth={500}
            >
                <div className='flex flex-col h-full'>
                    <div className="flex flex-row p-1 w-full h-10 border-b border-border ">
                        <ChatPanelDropdown
                            isChatHistoryOpen={isChatHistoryOpen}
                            setIsChatHistoryOpen={setIsChatHistoryOpen}
                        >
                            <div
                                className="flex items-center gap-1.5 bg-transparent p-1 px-2 text-sm text-foreground-secondary hover:text-foreground-primary cursor-pointer group"
                            >
                                <Icons.Sparkles className="mr-0.5 mb-0.5 h-4 w-4" />
                                {t(transKeys.editor.panels.edit.tabs.chat.name)}
                                <Icons.ChevronDown className="ml-0.5 h-3 w-3 text-muted-foreground group-hover:text-foreground-primary" />
                            </div>
                        </ChatPanelDropdown>
                        <div className='ml-auto flex items-center'>
                            <Button
                                variant="ghost"
                                size="icon"
                                className={cn(
                                    "h-7 w-7 mr-1 transition-colors",
                                    editorEngine.tweaks.isOpen
                                        ? "bg-secondary text-foreground"
                                        : "text-muted-foreground hover:text-foreground hover:bg-transparent bg-transparent"
                                )}
                                onClick={() => editorEngine.tweaks.isOpen = !editorEngine.tweaks.isOpen}
                                title="Tweaks Panel"
                            >
                                <MixerHorizontalIcon className="w-4 h-4" />
                            </Button>
                            {!editorEngine.tweaks.isOpen && <ChatControls />}
                        </div>
                    </div>
                    
                    {editorEngine.tweaks.isOpen ? (
                        <TweaksTab />
                    ) : (
                        <>
                            <ChatHistory isOpen={isChatHistoryOpen} onOpenChange={setIsChatHistoryOpen} />

                            <div className='flex-1 overflow-y-auto'>
                                {currentConversation && (
                                    <ChatTab
                                        conversationId={currentConversation.id}
                                        projectId={editorEngine.projectId}
                                    />
                                )}
                            </div>
                        </>
                    )}
                </div>
            </ResizablePanel >
        </div >
    );
});
