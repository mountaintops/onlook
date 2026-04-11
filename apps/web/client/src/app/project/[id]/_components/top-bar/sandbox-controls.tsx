'use client';

import { useEditorEngine } from '@/components/store/editor';
import { Button } from '@onlook/ui/button';
import { Icons } from '@onlook/ui/icons';
import { Tooltip, TooltipContent, TooltipTrigger } from '@onlook/ui/tooltip';
import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import { toast } from '@onlook/ui/sonner';

export const SandboxControls = observer(() => {
    const editorEngine = useEditorEngine();
    const sandboxManager = editorEngine.activeSandbox;
    const sessionManager = sandboxManager.session;
    const [isLoading, setIsLoading] = useState(false);

    const isConnected = !!sessionManager.provider;
    const isConnecting = sessionManager.isConnecting;

    const handleAction = async (action: 'stop' | 'restart' | 'resume', promise: Promise<void>) => {
        setIsLoading(true);
        try {
            await promise;
            toast.success(`Sandbox ${action}ed successfully`);
        } catch (error) {
            console.error(`Failed to ${action} sandbox:`, error);
            toast.error(`Failed to ${action} sandbox`);
        } finally {
            setIsLoading(false);
        }
    };

    const handleStop = () => {
        if (!isConnected || isConnecting || isLoading) return;
        const activeBranch = editorEngine.branches.activeBranch;
        if (activeBranch) {
             void handleAction('stop', sessionManager.hibernate(activeBranch.sandbox.id));
        }
    };

    const handleRestart = () => {
        if (!isConnected || isConnecting || isLoading) return;
        const activeBranch = editorEngine.branches.activeBranch;
        if (activeBranch) {
             void handleAction('restart', sessionManager.restartProvider(activeBranch.sandbox.id));
        }
    };
    
    const handleResume = () => {
         if (isConnected || isConnecting || isLoading) return;
         const activeBranch = editorEngine.branches.activeBranch;
         if (activeBranch) {
             void handleAction('resume', sessionManager.start(activeBranch.sandbox.id));
         }
    }


    const getStatusText = () => {
        switch (status) {
            case 'connecting':
                return 'Connecting...';
            case 'reconnecting':
                return 'Reconnecting...';
            case 'connected':
                return 'Connected';
            case 'disconnected':
                return 'Disconnected';
            default:
                return '';
        }
    };

    const getStatusColor = () => {
        switch (status) {
            case 'connecting':
            case 'reconnecting':
                return 'text-foreground-secondary';
            case 'connected':
                return 'text-green-500';
            case 'disconnected':
                return 'text-foreground-secondary/50';
            default:
                return '';
        }
    };

    if (isConnecting) {
         return (
             <div className="flex items-center gap-2">
                 <Button variant="ghost" size="icon" className="h-8" disabled>
                     <Icons.Spinner className="h-4 w-4 animate-spin" />
                 </Button>
                 <span className={`text-xs ${getStatusColor()}`}>{getStatusText()}</span>
             </div>
         );
    }

    return (
        <div className="flex items-center gap-2 border-r border-border pr-2 mr-2">
           {!isConnected ? (
              <>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 text-foreground-secondary hover:text-foreground"
                            onClick={handleResume}
                            disabled={isLoading}
                        >
                            <Icons.Play className="h-4 w-4" />
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="mt-1" hideArrow>
                        Resume Sandbox
                    </TooltipContent>
                </Tooltip>
                <span className={`text-xs ${getStatusColor()}`}>{getStatusText()}</span>
              </>
           ) : (
             <>
                 <Tooltip>
                    <TooltipTrigger asChild>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 text-foreground-secondary hover:text-foreground"
                            onClick={handleRestart}
                            disabled={isLoading}
                        >
                            <Icons.Reload className="h-4 w-4" />
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="mt-1" hideArrow>
                        Restart Sandbox
                    </TooltipContent>
                </Tooltip>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 text-foreground-secondary hover:text-destructive"
                            onClick={handleStop}
                            disabled={isLoading}
                        >
                            <Icons.Stop className="h-4 w-4" />
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="mt-1" hideArrow>
                        Stop Sandbox
                    </TooltipContent>
                </Tooltip>
                <span className={`text-xs ${getStatusColor()}`}>{getStatusText()}</span>
             </>
           )}
        </div>
    );
});
