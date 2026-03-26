'use client';

import { Button } from '@onlook/ui/button';
import { Icons } from '@onlook/ui/icons';
import { Tooltip, TooltipContent, TooltipTrigger } from '@onlook/ui/tooltip';
import { useState } from 'react';
import { PrintSandboxModal } from './print-sandbox-modal';

export function PrintSandboxButton() {
    const [isOpen, setIsOpen] = useState(false);

    return (
        <>
            <Tooltip>
                <TooltipTrigger asChild>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-8"
                        onClick={() => setIsOpen(true)}
                    >
                        <Icons.File className="h-4 w-4" />
                    </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="mt-1" hideArrow>
                    Print Context
                </TooltipContent>
            </Tooltip>
            <PrintSandboxModal isOpen={isOpen} onOpenChange={setIsOpen} />
        </>
    );
}
