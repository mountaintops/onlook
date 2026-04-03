import mime from 'mime-lite';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';

import { MessageContextType, type ImageMessageContext } from '@onlook/models';
import { Icons } from '@onlook/ui/icons';
import type { EditorEngine } from '@onlook/web-client/src/components/store/editor/engine';

import { ClientTool } from '../models/client';
import { BRANCH_ID_SCHEMA } from '../shared/type';

export class UploaderTool extends ClientTool {
    static readonly toolName = 'uploader';
    static readonly description =
        'Uploads a base64 encoded image to the project and makes it available in the conversation. Use this ONLY for NEW images provided by the user. Do not use this for screenshots, as screenshot tools automatically upload their results. Warning: Passing very large base64 strings can cause internal errors, so use this sparingly and only when necessary.';
    static readonly parameters = z.object({
        base64: z.string().describe('The base64 encoded image data (with or without data URL prefix)'),
        displayName: z.string().optional().describe('A descriptive name for the image'),
        destinationPath: z.string().optional().describe('Destination path within the project. Defaults to "public/images"'),
        branchId: BRANCH_ID_SCHEMA,
    });
    static readonly icon = Icons.Image;

    async handle(
        args: z.infer<typeof UploaderTool.parameters>,
        editorEngine: EditorEngine,
    ): Promise<string> {
        try {
            const { base64, displayName, destinationPath = 'public/images', branchId } = args;

            // 1. Clean the base64 data and determine mime type
            let mimeType = 'image/png';
            let cleanBase64 = base64;
            const match = base64.match(/^data:([^;]+);base64,(.*)$/);
            if (match) {
                mimeType = match[1] ?? mimeType;
                cleanBase64 = match[2] ?? cleanBase64;
            }

            const extension = mime.getExtension(mimeType) || 'png';
            const filename = `${uuidv4()}.${extension}`;
            const sanitizedPath = destinationPath.endsWith('/') ? destinationPath : `${destinationPath}/`;
            const fullPath = `${sanitizedPath}${filename}`.replace(/\/+/g, '/');
            const name = displayName || filename;

            // 2. Write to project filesystem (Sandbox)
            const sandbox = editorEngine.branches.getSandboxById(branchId);
            if (!sandbox) {
                throw new Error(`Sandbox not found for branch ID: ${branchId}`);
            }

            const binaryData = this.base64ToUint8Array(cleanBase64);
            await sandbox.writeFile(fullPath, binaryData);

            // 3. Add to ChatContext (Available Images)
            const imageContext: ImageMessageContext = {
                type: MessageContextType.IMAGE,
                content: base64.startsWith('data:') ? base64 : `data:${mimeType};base64,${cleanBase64}`,
                displayName: name,
                mimeType,
                source: 'external',
                id: uuidv4(),
                path: fullPath,
                branchId,
            };

            editorEngine.chat.context.addContexts([imageContext]);

            return `Image "${name}" successfully uploaded to ${fullPath} and added to conversation context.`;
        } catch (error) {
            throw new Error(`Failed to upload image: ${error}`);
        }
    }

    private base64ToUint8Array(base64: string): Uint8Array {
        const binaryString = atob(base64);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes;
    }

    static getLabel(input?: z.infer<typeof UploaderTool.parameters>): string {
        return input?.displayName ? `Uploading ${input.displayName}` : 'Uploading image';
    }
}
