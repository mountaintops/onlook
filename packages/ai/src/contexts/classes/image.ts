import { MessageContextType, type ImageMessageContext } from '@onlook/models';
import { Icons } from '@onlook/ui/icons';
import { BaseContext } from '../models/base';

export class ImageContext extends BaseContext {
    static readonly contextType = MessageContextType.IMAGE;
    static readonly displayName = 'Image';
    static readonly icon = Icons.Image;

    static getPrompt(context: ImageMessageContext): string {
        // Images don't generate text prompts - they're handled as file attachments
        return `[Image: ${context.mimeType}]`;
    }

    static getLabel(context: ImageMessageContext): string {
        return context.displayName || 'Image';
    }

    /**
     * Convert image contexts to file UI parts for AI SDK
     */
    static toFileUIParts(images: ImageMessageContext[]) {
        // Filter out data: URLs as they are not supported by AI SDK ModelMessage schema
        const validImages = images.filter((i) => !i.content.startsWith('data:'));
        if (images.length !== validImages.length) {
            console.warn(`[ImageContext] Filtered out ${images.length - validImages.length} image(s) with data: URLs (not supported by AI SDK). Upload images to storage and use HTTP URLs instead.`);
        }
        return validImages.map((i) => ({
            type: 'file' as const,
            mediaType: i.mimeType,
            url: i.content,
        }));
    }
}