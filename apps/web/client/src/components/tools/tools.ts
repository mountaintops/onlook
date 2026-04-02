import type { EditorEngine } from '@/components/store/editor/engine';
import type { ToolCall } from '@ai-sdk/provider-utils';
import { getToolClassesFromType } from '@onlook/ai';
import { ChatType } from '@onlook/models';
import { toast } from '@onlook/ui/sonner';

export async function handleToolCall(toolCall: ToolCall<string, unknown>, editorEngine: EditorEngine, addToolResult: (toolResult: { tool: string, toolCallId: string, output: any }) => Promise<void>) {
    const toolName = toolCall.toolName;
    const currentChatMode = editorEngine.state.chatMode;
    const availableTools = getToolClassesFromType(currentChatMode);
    let output: unknown = null;

    try {
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
                throw new Error(`Tool "${toolName}" is not available in ${currentChatMode} mode`);
            }

            // If it's not a built-in tool, it's likely an MCP tool or unknown. 
            // We should not error here as they are handled by the server.
            return;
        }
        // Parse the input to the tool parameters. Throws if invalid.
        const validatedInput = tool.parameters.parse(toolCall.input);
        const toolInstance = new tool();
        // Can force type with as any because we know the input is valid.
        output = await toolInstance.handle(validatedInput as any, editorEngine);
    } catch (error) {
        output = 'error handling tool call ' + error;
    } finally {
        void addToolResult({
            tool: toolName,
            toolCallId: toolCall.toolCallId,
            output: output,
        });
    }

}
