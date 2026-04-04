import { BashEditTool } from "../tools/classes/bash-edit";
import { BashReadTool } from "../tools/classes/bash-read";
import { CheckErrorsTool } from "../tools/classes/check-errors";
import { FuzzyEditFileTool } from "../tools/classes/fuzzy-edit-file";
import { GlobTool } from "../tools/classes/glob";
import { GrepTool } from "../tools/classes/grep";
import { ListBranchesTool } from "../tools/classes/list-branches";
import { ListFilesTool } from "../tools/classes/list-files";
import { OnlookInstructionsTool } from "../tools/classes/onlook-instructions";
import { ReadFileTool } from "../tools/classes/read-file";
import { ReadStyleGuideTool } from "../tools/classes/read-style-guide";
import { SandboxTool } from "../tools/classes/sandbox";
import { ScrapeUrlTool } from "../tools/classes/scrape-url";
import { SearchReplaceEditTool } from "../tools/classes/search-replace-edit";
import { SearchReplaceMultiEditFileTool } from "../tools/classes/search-replace-multi-edit";
import { TerminalCommandTool } from "../tools/classes/terminal-command";
import { TypecheckTool } from "../tools/classes/typecheck";
import { WebSearchTool } from "../tools/classes/web-search";
import { WriteFileTool } from "../tools/classes/write-file";

export const allTools = [
    ListFilesTool,
    ReadFileTool,
    BashReadTool,
    OnlookInstructionsTool,
    ReadStyleGuideTool,
    ListBranchesTool,
    ScrapeUrlTool,
    WebSearchTool,
    GlobTool,
    GrepTool,
    TypecheckTool,
    CheckErrorsTool,
    SearchReplaceEditTool,
    SearchReplaceMultiEditFileTool,
    FuzzyEditFileTool,
    WriteFileTool,
    BashEditTool,
    SandboxTool,
    TerminalCommandTool,
];

export const readOnlyRootTools = [
    ListFilesTool,
    ReadFileTool,
    BashReadTool,
    OnlookInstructionsTool,
    ReadStyleGuideTool,
    ListBranchesTool,
    ScrapeUrlTool,
    WebSearchTool,
    GlobTool,
    GrepTool,
    TypecheckTool,
    CheckErrorsTool,
]
const editOnlyRootTools = [
    SearchReplaceEditTool,
    SearchReplaceMultiEditFileTool,
    FuzzyEditFileTool,
    WriteFileTool,
    BashEditTool,
    SandboxTool,
    TerminalCommandTool,
]

export const rootTools = [...readOnlyRootTools, ...editOnlyRootTools];

export const userTools = [
    ListBranchesTool,
    ListFilesTool,
]
