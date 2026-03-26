'use client';

import { useEditorEngine } from '@/components/store/editor';
import { api } from '@/trpc/react';
import { Button } from '@onlook/ui/button';
import { Checkbox } from '@onlook/ui/checkbox';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@onlook/ui/dialog';
import { Icons } from '@onlook/ui/icons';
import { Textarea } from '@onlook/ui/textarea';
import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import { toast } from '@onlook/ui/sonner';

export const PrintSandboxModal = observer(
    ({ isOpen, onOpenChange }: { isOpen: boolean; onOpenChange: (open: boolean) => void }) => {
        const editorEngine = useEditorEngine();
        const activeBranch = editorEngine.branches.activeBranch;
        const sandboxId = activeBranch?.sandbox?.id;

        const { data: projectFiles, isLoading: isLoadingFiles } =
            api.sandbox.getProjectFiles.useQuery(
                { sandboxId: sandboxId! },
                { enabled: isOpen && !!sandboxId },
            );

        const getFilesContent = api.sandbox.getFilesContent.useMutation();

        const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
        const [generatedContext, setGeneratedContext] = useState<string>('');
        const [isGenerating, setIsGenerating] = useState(false);

        const handleToggleFile = (file: string) => {
            const newSet = new Set(selectedFiles);
            if (newSet.has(file)) {
                newSet.delete(file);
            } else {
                newSet.add(file);
            }
            setSelectedFiles(newSet);
        };

        const handleGenerate = async () => {
            if (!sandboxId) return;
            setIsGenerating(true);
            try {
                const paths = Array.from(selectedFiles);
                const res = await getFilesContent.mutateAsync({ sandboxId, paths });

                let context = 'Project Directory Structure:\n';
                if (projectFiles?.files) {
                    context += projectFiles.files.join('\n');
                }
                context += '\n\n=========================================\n\n';

                if (res.files.length > 0) {
                    context += `I have added these files to the chat so you can go ahead and edit them\n`;
                    for (const fileData of res.files) {
                        const ext = fileData.path.split('.').pop() ?? 'tsx';
                        context += `<file>\n`;
                        context += `<path>${fileData.path}</path>\n`;
                        context += `\`\`\`${ext}\n`;
                        context += fileData.content;
                        context += `\n\`\`\`\n`;
                        context += `</file>\n`;
                    }
                }
                setGeneratedContext(context);
            } catch (error) {
                console.error('Failed to generate context', error);
                toast.error('Failed to get files content');
            } finally {
                setIsGenerating(false);
            }
        };

        const copyToClipboard = () => {
            navigator.clipboard.writeText(generatedContext);
            toast.success('Copied to clipboard');
        };

        const filesArray = projectFiles?.files || [];

        return (
            <Dialog open={isOpen} onOpenChange={onOpenChange}>
                <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
                    <DialogHeader>
                        <DialogTitle>Sandbox Context</DialogTitle>
                        <DialogDescription>
                            Select files to include their contents in the generated context.
                        </DialogDescription>
                    </DialogHeader>

                    {!generatedContext ? (
                        <div className="flex-1 overflow-y-auto mb-4 border border-border rounded p-4 h-96">
                            {isLoadingFiles ? (
                                <div className="flex justify-center items-center h-full">
                                    <Icons.Spinner className="animate-spin" />
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    <div className="flex items-center space-x-2 pb-2 border-b border-border">
                                        <Checkbox
                                            id="select-all"
                                            checked={
                                                filesArray.length > 0 &&
                                                selectedFiles.size === filesArray.length
                                            }
                                            onCheckedChange={(checked) => {
                                                if (checked) {
                                                    setSelectedFiles(new Set(filesArray));
                                                } else {
                                                    setSelectedFiles(new Set());
                                                }
                                            }}
                                        />
                                        <label htmlFor="select-all" className="font-semibold text-sm cursor-pointer">
                                            Select All
                                        </label>
                                    </div>
                                    <div className="flex flex-col gap-2">
                                        {filesArray.map((file) => (
                                            <div key={file} className="flex items-center space-x-2">
                                                <Checkbox
                                                    id={file}
                                                    checked={selectedFiles.has(file)}
                                                    onCheckedChange={() => handleToggleFile(file)}
                                                />
                                                <label htmlFor={file} className="text-sm cursor-pointer">
                                                    {file}
                                                </label>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="flex-1 flex flex-col gap-2 min-h-[400px]">
                            <Textarea
                                className="flex-1 font-mono text-xs whitespace-pre"
                                readOnly
                                value={generatedContext}
                            />
                            <div className="flex justify-end gap-2 pt-2">
                                <Button variant="outline" onClick={() => setGeneratedContext('')}>
                                    Back
                                </Button>
                                <Button onClick={copyToClipboard}>
                                    <Icons.Copy className="mr-2 h-4 w-4" /> Copy
                                </Button>
                            </div>
                        </div>
                    )}

                    {!generatedContext && (
                        <DialogFooter>
                            <Button variant="outline" onClick={() => onOpenChange(false)}>
                                Cancel
                            </Button>
                            <Button
                                onClick={handleGenerate}
                                disabled={isLoadingFiles || isGenerating || !sandboxId}
                            >
                                {isGenerating ? (
                                    <Icons.Spinner className="animate-spin mr-2 h-4 w-4" />
                                ) : (
                                    <Icons.File className="mr-2 h-4 w-4" />
                                )}
                                Generate Context
                            </Button>
                        </DialogFooter>
                    )}
                </DialogContent>
            </Dialog>
        );
    },
);
