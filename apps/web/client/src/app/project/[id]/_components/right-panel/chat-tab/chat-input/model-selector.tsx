import { ChatType, AVAILABLE_MODELS, type InitialModelPayload } from '@onlook/models';
import { Button } from '@onlook/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@onlook/ui/dropdown-menu';
import { Icons } from '@onlook/ui/icons';
import { HoverOnlyTooltip } from '../../../editor-bar/hover-tooltip';
import { cn } from '@onlook/ui/utils';
import { observer } from 'mobx-react-lite';
import { useState } from 'react';

interface ModelSelectorProps {
    chatModel: InitialModelPayload;
    onModelChange: (model: InitialModelPayload) => void;
    disabled?: boolean;
}

export const ModelSelector = observer(({ chatModel, onModelChange, disabled = false }: ModelSelectorProps) => {
    const [isOpen, setIsOpen] = useState(false);

    const currentModelDetails = AVAILABLE_MODELS.find(
        (m) => m.model === chatModel.model && m.provider === chatModel.provider
    );

    const getModelLabel = () => {
        return currentModelDetails?.displayName || chatModel.model || 'Select Model';
    };

    return (
        <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
            <HoverOnlyTooltip 
                className='mb-1'
                content={
                    <span>
                        Change AI Model
                    </span>
                }
                side="top"
                hideArrow
            >
                <DropdownMenuTrigger asChild>
                    <Button
                        variant="ghost"
                        size="sm"
                        disabled={disabled}
                        className={cn(
                            'h-8 px-2 text-foreground-onlook group flex items-center gap-1.5',
                            disabled && 'opacity-50 cursor-not-allowed'
                        )}
                    >
                        <Icons.Sparkles 
                            className={cn(
                                'w-3 h-3 text-foreground-secondary group-hover:text-foreground',
                            )} 
                        />
                        <span className="text-xs font-medium text-foreground-secondary group-hover:text-foreground">
                            {getModelLabel()}
                        </span>
                        <Icons.ChevronDown className="w-3 h-3 text-foreground-secondary opacity-50" />
                    </Button>
                </DropdownMenuTrigger>
            </HoverOnlyTooltip>
            <DropdownMenuContent align="start" className="w-56">
                {AVAILABLE_MODELS.map((modelOpt) => (
                    <DropdownMenuItem
                        key={`${modelOpt.provider}-${modelOpt.model}`}
                        onClick={() => onModelChange({ provider: modelOpt.provider, model: modelOpt.model } as InitialModelPayload)}
                        className={cn(
                            'flex items-center gap-2 px-3 py-2 cursor-pointer',
                            chatModel.model === modelOpt.model && chatModel.provider === modelOpt.provider && 'bg-background-onlook'
                        )}
                    >
                        <span className="text-sm">{modelOpt.displayName}</span>
                        {chatModel.model === modelOpt.model && chatModel.provider === modelOpt.provider && (
                            <Icons.Check className="w-4 h-4 ml-auto text-active" />
                        )}
                    </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    );
});
