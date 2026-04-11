import type { McpServerConfig } from '../mcp';

export interface UserSettings {
    id: string;
    chat: ChatSettings;
    editor: EditorSettings;
    mcpServers?: McpServerConfig[];
}

export interface ChatSettings {
    showSuggestions: boolean;
    autoApplyCode: boolean;
    expandCodeBlocks: boolean;
    showMiniChat: boolean;
}

export interface EditorSettings {
    shouldWarnDelete: boolean;
}
