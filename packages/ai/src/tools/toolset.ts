import { ChatType } from '@onlook/models';
import { type InferUITools, type ToolSet } from 'ai';
import { BashEditTool } from './classes/bash-edit';
import { BashReadTool } from './classes/bash-read';
import { CheckWebsiteTool } from './classes/check-website';
import { CheckErrorsTool } from './classes/check-errors';
import { FuzzyEditFileTool } from './classes/fuzzy-edit-file';
import { GlobTool } from './classes/glob';
import { GrepTool } from './classes/grep';
import { ListBranchesTool } from './classes/list-branches';
import { ListFilesTool } from './classes/list-files';
import { OnlookInstructionsTool } from './classes/onlook-instructions';
import { ReadFileTool } from './classes/read-file';
import { ReadStyleGuideTool } from './classes/read-style-guide';
import { SandboxTool } from './classes/sandbox';
import { ScrapeUrlTool } from './classes/scrape-url';
import { ScreenshotWebTool } from './classes/screenshot-web';
import { SearchReplaceEditTool } from './classes/search-replace-edit';
import { SearchReplaceMultiEditFileTool } from './classes/search-replace-multi-edit';
import { TerminalCommandTool } from './classes/terminal-command';
import { TypecheckTool } from './classes/typecheck';
import { UploadImageTool } from './classes/upload-image';
import { UploaderTool } from './classes/uploader';
import { WebSearchTool } from './classes/web-search';
import { WriteFileTool } from './classes/write-file';
import { WriteFilesFoldersTool } from './classes/write-files-folders';
import { Base64Tool } from './classes/base64';
import type { BaseTool } from './models/base';

// Helper function to convert tool classes to ToolSet
function createToolSet(toolClasses: Array<{ toolName: string; getAITool: () => any }>): ToolSet {
    return toolClasses.reduce((acc, toolClass) => {
        acc[toolClass.toolName] = toolClass.getAITool();
        return acc;
    }, {} as ToolSet);
}

const readOnlyToolClasses = [
    ListFilesTool,
    ReadFileTool,
    BashReadTool,
    OnlookInstructionsTool,
    ReadStyleGuideTool,
    ListBranchesTool,
    ScrapeUrlTool,
    WebSearchTool,
    CheckWebsiteTool,
    GlobTool,
    GrepTool,
    TypecheckTool,
    CheckErrorsTool,
    ScreenshotWebTool,
];
const editOnlyToolClasses = [
    SearchReplaceEditTool,
    SearchReplaceMultiEditFileTool,
    FuzzyEditFileTool,
    WriteFileTool,
    WriteFilesFoldersTool,
    BashEditTool,
    SandboxTool,
    TerminalCommandTool,
    UploadImageTool,
    Base64Tool,
    UploaderTool,
];
const allToolClasses = [...readOnlyToolClasses, ...editOnlyToolClasses];

export const readOnlyToolset: ToolSet = createToolSet(readOnlyToolClasses);
export const allToolset: ToolSet = createToolSet(allToolClasses);
export const TOOLS_MAP: Map<string, typeof BaseTool> = new Map(allToolClasses.map(toolClass => [toolClass.toolName, toolClass]));

export function getToolClassesFromType(chatType: ChatType) {
    return chatType === ChatType.ASK ? readOnlyToolClasses : allToolClasses
}

export function getToolSetFromType(chatType: ChatType) {
    return chatType === ChatType.ASK ? readOnlyToolset : allToolset;
}

export type ChatTools = InferUITools<typeof allToolset>;
