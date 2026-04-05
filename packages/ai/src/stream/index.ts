import { type ChatMessage } from '@onlook/models';
import { convertToModelMessages, type ModelMessage, type ToolUIPart } from 'ai';
import { getHydratedUserMessage, type HydrateMessageOptions } from '../prompt';

export async function convertToStreamMessages(messages: ChatMessage[]): Promise<ModelMessage[]> {
    const totalMessages = messages.length;
    const lastUserMessageIndex = messages.findLastIndex((message) => message.role === 'user');
    const lastAssistantMessageIndex = messages.findLastIndex(
        (message) => message.role === 'assistant',
    );

    const streamMessages = messages.map((message, index) => {
        const opt: HydrateMessageOptions = {
            totalMessages,
            currentMessageIndex: index,
            lastUserMessageIndex,
            lastAssistantMessageIndex,
        };
        return toStreamMessage(message, opt);
    });

    const messagesForModel = stripImagesFromToolResults(streamMessages);
    return await convertToModelMessages(messagesForModel);
}

export const toStreamMessage = (message: ChatMessage, opt: HydrateMessageOptions): ChatMessage => {
    if (message.role === 'assistant') {
        let transformedParts = ensureToolCallResults(message.parts);
        transformedParts = transformToolResultsWithImages(transformedParts);
        return {
            ...message,
            parts: transformedParts,
        };
    } else if (message.role === 'user') {
        const hydratedMessage = getHydratedUserMessage(
            message.id,
            message.parts,
            message.metadata?.context ?? [],
            opt,
        );
        return hydratedMessage;
    }
    return message;
};

export const extractTextFromParts = (parts: ChatMessage['parts']): string => {
    return parts
        ?.map((part) => {
            if (part.type === 'text') {
                return part.text;
            }
            return '';
        })
        .join('');
};

export const ensureToolCallResults = (parts: ChatMessage['parts']): ChatMessage['parts'] => {
    if (!parts) return parts;

    const toolResultIds = new Set<string>();

    // First pass: identify which tool calls already have results
    parts.forEach((part) => {
        if (part.type?.startsWith('tool-')) {
            const toolPart = part as ToolUIPart;
            if (toolPart.toolCallId && toolPart.state === 'output-available') {
                toolResultIds.add(toolPart.toolCallId);
            }
        }
    });

    // Second pass: update parts that need stub results
    return parts.map((part) => {
        if (part.type?.startsWith('tool-')) {
            const toolPart = part as ToolUIPart;
            if (
                toolPart.toolCallId &&
                (toolPart.state === 'input-available' || toolPart.state === 'input-streaming') &&
                !toolResultIds.has(toolPart.toolCallId)
            ) {
                // Update existing part to have stub result
                return {
                    ...toolPart,
                    state: 'output-available',
                    output: 'No tool result returned',
                };
            }
        }
        return part;
    });
};

export const transformToolResultsWithImages = (parts: ChatMessage['parts']): ChatMessage['parts'] => {
    if (!parts) return parts;

    return parts.map((part) => {
        if (part.type?.startsWith('tool-')) {
            const toolPart = part as ToolUIPart;
            if (toolPart.state === 'output-available' && toolPart.output && typeof toolPart.output === 'object') {
                const output = toolPart.output as any;
                
                // Handle single image (ScreenshotWebTool)
                if (output.image && typeof output.image === 'object' && output.image.base64) {
                    return {
                        ...toolPart,
                        output: [
                            { type: 'text', text: output.message || 'Screenshot captured.' },
                            {
                                type: 'image',
                                image: output.image.base64,
                                mimeType: output.image.mimeType || 'image/png',
                            },
                        ],
                    };
                }

                // Handle multiple images (ScreenshotRelevantTool)
                if (Array.isArray(output.images) && output.images.length > 0) {
                    const resultParts: any[] = [{ type: 'text', text: output.message || 'Screenshots captured.' }];
                    output.images.forEach((img: any) => {
                        if (img.base64) {
                            if (img.displayName) {
                                resultParts.push({ type: 'text', text: `\n### ${img.displayName}` });
                            }
                            resultParts.push({
                                type: 'image',
                                image: img.base64,
                                mimeType: img.mimeType || 'image/png',
                            });
                        }
                    });
                    return {
                        ...toolPart,
                        output: resultParts,
                    };
                }
            }
        }
        return part;
    });
};

export const stripImagesFromToolResults = (messages: ChatMessage[]): ChatMessage[] => {
    return messages.map((message) => {
        if (!message.parts) return message;

        const strippedParts = message.parts.map((part) => {
            // Only strip from tool results that we have already processed into parts
            if (part.type === 'tool-invocation' || part.type === 'tool-result') {
                const toolPart = part as ToolUIPart;
                if (toolPart.state === 'output-available' && Array.isArray(toolPart.output)) {
                    // Filter out the image parts for the LLM context
                    return {
                        ...toolPart,
                        output: toolPart.output.filter((p: any) => p.type !== 'image'),
                    };
                }
            }
            return part;
        });

        return {
            ...message,
            parts: strippedParts,
        };
    });
};
