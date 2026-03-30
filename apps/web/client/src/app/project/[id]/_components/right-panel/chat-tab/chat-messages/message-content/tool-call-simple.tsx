import { BaseTool, TOOLS_MAP } from '@onlook/ai';
import { Tool, ToolContent, ToolHeader, ToolInput, ToolOutput } from '@onlook/ui/ai-elements';
import { Icons } from '@onlook/ui/icons';
import type { ToolUIPart } from 'ai';
import { memo } from 'react';

const ToolCallSimpleComponent = ({
    toolPart,
    className,
    loading,
}: {
    toolPart: ToolUIPart;
    className?: string;
    loading?: boolean;
}) => {
    const toolName = (toolPart as any).toolName || '';
    const ToolClass = TOOLS_MAP.get(toolName);
    const Icon = ToolClass?.icon ?? Icons.Sparkles;
    const title = getFormattedTitle(toolName, toolPart.input, ToolClass);
    const isMcp = !ToolClass && toolName.includes('_');

    return (
        <Tool className={className}>
            <ToolHeader
                loading={loading}
                title={title}
                type={toolPart.type}
                state={toolPart.state}
                icon={<Icon className="w-4 h-4 flex-shrink-0" />}
                isMcp={isMcp}
            />
            <ToolContent>
                <ToolInput input={toolPart.input} isStreaming={loading} />
                <ToolOutput
                    errorText={toolPart.errorText}
                    output={toolPart.output}
                    isStreaming={loading}
                />
            </ToolContent>
        </Tool>
    );
};

export const ToolCallSimple = memo(ToolCallSimpleComponent);

function getFormattedTitle(toolName: string, input: unknown, ToolClass?: typeof BaseTool): string {
    if (ToolClass) {
        try {
            return ToolClass.getLabel(input);
        } catch (error) {
            console.error('Error getting tool label:', error);
        }
    }

    // Handle MCP prefixed tools (server_tool)
    const underscoreIndex = toolName.indexOf('_');
    if (underscoreIndex !== -1) {
        const prefix = toolName.substring(0, underscoreIndex);
        const baseName = toolName.substring(underscoreIndex + 1);
        const formattedPrefix = formatLabel(prefix);
        const formattedBaseName = formatLabel(baseName);
        return `${formattedPrefix}: ${formattedBaseName}`;
    }

    return formatLabel(toolName);
}

function formatLabel(label: string): string {
    return label
        .replace(/[-_]/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase());
}