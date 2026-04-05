import { Icons } from '@onlook/ui/icons';
import type { EditorEngine } from '@onlook/web-client/src/components/store/editor/engine';
import { z } from 'zod';

import { ClientTool } from '../models/client';
import { BRANCH_ID_SCHEMA } from '../shared/type';
import { UploaderTool } from './uploader';

export class Base64Tool extends ClientTool {
    static readonly toolName = 'base64';
    static readonly description =
        'Decodes a base64 string to text or uploads it as an image. Use action="decode" for text strings. Use action="upload" for image data ONLY if it is a new image. Do not use for screenshots. Warning: Passing very large base64 strings can cause internal errors.';
    static readonly parameters = z.object({
        data: z.string().describe('The base64 encoded string'),
        action: z.enum(['decode', 'upload']).describe('Whether to decode as text or upload as an image'),
        displayName: z.string().optional().describe('Display name if uploading as an image'),
        branchId: BRANCH_ID_SCHEMA,
    });
    static readonly icon = Icons.Layers;

    async handle(
        args: z.infer<typeof Base64Tool.parameters>,
        editorEngine: EditorEngine,
    ): Promise<string> {
        try {
            const { data, action, displayName, branchId } = args;

            // 0. Payload size check (Guard against Internal Error)
            const MAX_SIZE_BYTES = 2 * 1024 * 1024;
            const approxSizeBytes = (data.length * 3) / 4; 
            
            if (approxSizeBytes > MAX_SIZE_BYTES) {
                return `Error: Base64 data is too large (~${(approxSizeBytes / (1024 * 1024)).toFixed(1)}MB). The limit is 2MB to prevent connection timeouts and internal errors. Please provide a smaller string or file.`;
            }

            if (action === 'decode') {
                const decoded = atob(data);
                const MAX_LENGTH = 100000;
                if (decoded.length > MAX_LENGTH) {
                    return `Decoded text (truncated):\n${decoded.substring(0, MAX_LENGTH)}\n\n[RESULTS TRUNCATED: Decoded content exceeds ${MAX_LENGTH} character limit.]`;
                }
                return `Decoded text:\n${decoded}`;
            } else {
                const uploader = new UploaderTool();
                return await uploader.handle({
                    base64: data,
                    displayName,
                    branchId,
                }, editorEngine) as string;
            }
        } catch (error) {
            throw new Error(`Base64 operation failed: ${error}`);
        }
    }

    static getLabel(input?: z.infer<typeof Base64Tool.parameters>): string {
        return input?.action === 'decode' ? 'Decoding base64 text' : 'Processing base64 image';
    }
}
