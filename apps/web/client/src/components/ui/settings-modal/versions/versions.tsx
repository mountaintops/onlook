import { useEditorEngine } from '@/components/store/editor';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@onlook/ui/accordion';
import { Button } from '@onlook/ui/button';
import { Icons } from '@onlook/ui/icons/index';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@onlook/ui/select';
import { Separator } from '@onlook/ui/separator';
import { toast } from '@onlook/ui/sonner';
import { observer } from 'mobx-react-lite';
import React, { useState } from 'react';
import { NoVersions } from './empty-state/version';
import { VersionRow, VersionRowType } from './version-row';

export const Versions = observer(() => {
    const editorEngine = useEditorEngine();
    const [commitToRename, setCommitToRename] = useState<string | null>(null);
    const [isCreatingBackup, setIsCreatingBackup] = useState(false);
    const selectedBranchId = editorEngine.branches.activeBranch.id;
    const branchData = editorEngine.branches.getBranchDataById(selectedBranchId);
    const sandbox = branchData?.sandbox;

    // Local state for history
    const [versions, setVersions] = useState<any[]>([]);
    const [isLoadingVersions, setIsLoadingVersions] = useState(false);

    React.useEffect(() => {
        if (sandbox) {
            loadVersions();
        }
    }, [sandbox]);

    const loadVersions = async () => {
        if (!sandbox) {
            console.warn('Sandbox not initialized in Versions component');
            return;
        }
        setIsLoadingVersions(true);
        try {
            console.log('Fetching history from sandbox...');
            const history = await sandbox.getHistory();
            console.log('History fetched:', history);
            // Sort by new to old
            setVersions(history.reverse());
        } catch (error) {
            console.error('Failed to load versions:', error);
        } finally {
            setIsLoadingVersions(false);
        }
    };

    // Group versions by date
    const groupedVersions = versions?.reduce(
        (acc, commit) => {
            const date = new Date(commit.timestamp * 1000);
            const today = new Date();
            const yesterday = new Date(today);
            yesterday.setDate(yesterday.getDate() - 1);

            let dateKey: string;
            if (date.toDateString() === today.toDateString()) {
                dateKey = 'Today';
            } else if (date.toDateString() === yesterday.toDateString()) {
                dateKey = 'Yesterday';
            } else {
                // Format the date in a more human-readable way
                dateKey = date.toLocaleDateString('en-US', {
                    month: 'long',
                    day: 'numeric',
                    year: 'numeric',
                });
            }

            if (!acc[dateKey]) {
                acc[dateKey] = [];
            }
            acc[dateKey]?.push(commit);
            return acc;
        },
        {} as Record<string, typeof versions>,
    );

    const handleNewBackup = async () => {
        try {
            setIsCreatingBackup(true);
            if (!sandbox) {
                toast.error('Sandbox not initialized');
                return;
            }

            await sandbox.createSnapshot('New Onlook backup');
            await loadVersions();

            toast.success('Backup created successfully!');
            editorEngine.posthog.capture('versions_create_snapshot_success');
        } catch (error) {
            toast.error('Failed to create backup', {
                description: error instanceof Error ? error.message : 'Unknown error',
            });
        } finally {
            setIsCreatingBackup(false);
        }
    };

    return (
        <div className="flex flex-col text-sm">
            <div className="flex flex-row justify-center items-center gap-3 px-6 py-6">
                <h2 className="text-lg">Backup Versions</h2>

                {isLoadingVersions && (
                    <Icons.LoadingSpinner className="h-4 w-4 animate-spin" />
                )}

                {/* Branch selector */}
                <Select value={selectedBranchId} onValueChange={(value) => { editorEngine.branches.switchToBranch(value); }}>
                    <SelectTrigger className="min-w-38 ml-auto">
                        <SelectValue placeholder="Select branch" />
                    </SelectTrigger>
                    <SelectContent>
                        {editorEngine.branches.allBranches.map((branch) => (
                            <SelectItem key={branch.id} value={branch.id}>
                                {branch.name}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                {sandbox && (
                    <Button
                        variant="outline"
                        className="bg-background-secondary rounded text-sm font-normal "
                        onClick={handleNewBackup}
                        disabled={isLoadingVersions || isCreatingBackup}
                    >
                        {isCreatingBackup ? (
                            <Icons.LoadingSpinner className="h-4 w-4 animate-spin mr-2" />
                        ) : (
                            <Icons.Plus className="mr-2 h-4 w-4" />
                        )}
                        New backup
                    </Button>
                )}
            </div>
            <Separator />

            {versions && versions.length > 0 ? (
                <div className="flex flex-col gap-2">
                    <Accordion type="multiple" defaultValue={Object.keys(groupedVersions || {})}>
                        {groupedVersions &&
                            Object.entries(groupedVersions).map(([date, dateVersions]) => (
                                <AccordionItem key={date} value={date}>
                                    <AccordionTrigger className="text-muted-foreground px-6 py-4 text-base font-normal">
                                        {date}
                                    </AccordionTrigger>
                                    <AccordionContent>
                                        <div className="flex flex-col">
                                            {dateVersions.map((version, index) => (
                                                <React.Fragment key={version.oid}>
                                                    <VersionRow
                                                        commit={version}
                                                        type={
                                                            date === 'Today'
                                                                ? VersionRowType.TODAY
                                                                : VersionRowType.PREVIOUS_DAYS
                                                        }
                                                        autoRename={version.oid === commitToRename}
                                                        onRename={() => setCommitToRename(null)}
                                                    />
                                                    {index < dateVersions.length - 1 && (
                                                        <Separator className="bg-border mx-6 w-[calc(100%-theme(spacing.12))]" />
                                                    )}
                                                </React.Fragment>
                                            ))}
                                        </div>
                                    </AccordionContent>
                                </AccordionItem>
                            ))}
                    </Accordion>
                </div>
            ) : (
                <NoVersions />
            )}
        </div>
    );
});