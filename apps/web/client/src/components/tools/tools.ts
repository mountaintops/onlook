import type { EditorEngine } from '@/components/store/editor/engine';
import type { ToolCall } from '@ai-sdk/provider-utils';
import { getToolClassesFromType } from '@onlook/ai';
import { ChatType } from '@onlook/models';
import { toast } from '@onlook/ui/sonner';

export async function handleToolCall(toolCall: ToolCall<string, unknown>, editorEngine: EditorEngine, addToolResult: (toolResult: { tool: string, toolCallId: string, output?: any, errorText?: string }) => Promise<void>) {
    const toolName = toolCall.toolName;
    const currentChatMode = editorEngine.state.chatMode;
    let output: unknown = null;
    let errorText: string | undefined = undefined;

    try {
        const availableTools = getToolClassesFromType(currentChatMode);
        const tool = availableTools.find(tool => tool.toolName === toolName);
        if (!tool) {
            // Check if it's a built-in tool that's just disabled in this mode
            const allTools = getToolClassesFromType(ChatType.EDIT);
            const isBuiltInTool = allTools.some(t => t.toolName === toolName);

            if (isBuiltInTool) {
                toast.error(`Tool "${toolName}" not available in ${currentChatMode.toLowerCase()} mode`, {
                    description: `Switch mode to use this tool.`,
                    duration: 2000,
                });
                errorText = `Tool "${toolName}" is not available in ${currentChatMode} mode`;
            } else {
                errorText = `Tool "${toolName}" not found on client.`;
            }
            throw new Error(errorText);
        }
        // Parse the input to the tool parameters. Throws if invalid.
        const validatedInput = tool.parameters.parse(toolCall.input);
        const toolInstance = new tool();
        // Can force type with as any because we know the input is valid.
        output = await toolInstance.handle(validatedInput as any, editorEngine);
    } catch (error) {
        errorText = 'error handling tool call ' + error;
        output = undefined;
    } finally {
        void addToolResult({
            tool: toolName as any,
            toolCallId: toolCall.toolCallId,
            output: output,
            errorText: errorText,
        });
    }
}
