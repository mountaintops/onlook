'use client';

import { observer } from 'mobx-react-lite';
import { useEditorEngine } from '@/components/store/editor';
import { Badge } from '@onlook/ui/badge';
import { Button } from '@onlook/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@onlook/ui/dropdown-menu';
import { Icons } from '@onlook/ui/icons';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@onlook/ui/tooltip';

export const VersionControlToolbar = observer(() => {
    const editorEngine = useEditorEngine();
    const activeBranchId = editorEngine.branches.activeBranch.id;
    const allBranches = editorEngine.branches.allBranches;
    const handle = editorEngine.branches.activeAutomergeHandle;

    if (!handle) {
        return null;
    }

    const handleSwitchBranch = (branchId: string) => {
        editorEngine.branches.switchToBranch(branchId);
    };

    const handleForkBranch = () => {
        editorEngine.branches.forkBranch(activeBranchId);
    };

    return (
        <TooltipProvider>
            <div className="flex items-center gap-2 p-1 px-2 border rounded-md bg-background/50 backdrop-blur-sm shadow-sm hover:bg-background/80 transition-colors">
                <div className="flex items-center gap-1.5 mr-2">
                    <Icons.CounterClockwiseClock className="w-4 h-4 text-muted-foreground" />
                    <span className="text-xs font-medium">Automerge</span>
                </div>

                <div className="w-[1px] h-4 bg-border mx-1" />

                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" className="h-7 gap-1.5 px-2">
                            <Icons.Branch className="w-3.5 h-3.5" />
                            <span className="text-xs max-w-[100px] truncate">
                                {editorEngine.branches.activeBranch.name}
                            </span>
                            <Icons.ChevronDown className="w-3 h-3 text-muted-foreground" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48">
                        <div className="px-2 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                            Branches
                        </div>
                        {allBranches.map((branch) => (
                            <DropdownMenuItem
                                key={branch.id}
                                className="flex items-center justify-between text-xs cursor-pointer"
                                onClick={() => handleSwitchBranch(branch.id)}
                            >
                                <span className="truncate">{branch.name}</span>
                                {branch.id === activeBranchId && (
                                    <Icons.Check className="w-3.5 h-3.5 text-primary" />
                                )}
                            </DropdownMenuItem>
                        ))}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                            className="flex items-center gap-2 text-xs cursor-pointer text-primary"
                            onClick={handleForkBranch}
                        >
                            <Icons.Plus className="w-3.5 h-3.5" />
                            <span>New Branch (Clone)</span>
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>

                <div className="w-[1px] h-4 bg-border mx-1" />

                <Tooltip>
                    <TooltipTrigger asChild>
                        <Badge
                            variant="outline"
                            className="font-mono text-[10px] py-0 px-1 cursor-help opacity-70 hover:opacity-100"
                        >
                            {handle?.documentId?.slice(0, 8) ?? 'loading'}...
                        </Badge>
                    </TooltipTrigger>
                    <TooltipContent>
                        <p>Document ID: {handle?.documentId ?? 'Loading...'}</p>
                        <p className="text-[10px] text-muted-foreground">Branch: {activeBranchId}</p>
                    </TooltipContent>
                </Tooltip>

                <div className="w-[1px] h-4 bg-border mx-1" />

                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => editorEngine.branches.undo()}
                            disabled={!editorEngine.branches.canUndo}
                        >
                            <Icons.Reset className="w-4 h-4" />
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent>Undo</TooltipContent>
                </Tooltip>

                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => editorEngine.branches.redo()}
                            disabled={!editorEngine.branches.canRedo}
                        >
                            <Icons.Reload className="w-4 h-4" />
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent>Redo</TooltipContent>
                </Tooltip>

                <div className="w-[1px] h-4 bg-border mx-1" />

                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button variant="ghost" size="sm" className="h-7 gap-1.5" disabled>
                            <Icons.Upload className="w-3.5 h-3.5" />
                            <span className="text-xs">Syncing...</span>
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent>Cloud Cloudflare Sync (Coming in Phase 5)</TooltipContent>
                </Tooltip>
            </div>
        </TooltipProvider>
    );
});
