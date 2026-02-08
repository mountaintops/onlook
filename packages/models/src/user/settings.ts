export interface UserSettings {
    id: string;
    chat: ChatSettings;
    editor: EditorSettings;
    mcp: MCPSettings;
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

export interface MCPSettings {
    enabled: boolean;
    servers: MCPServerConfig[];
}

export interface MCPServerConfig {
    id: string;
    name: string;
    command: string;
    args: string[];
    env?: Record<string, string>;
    enabled: boolean;
}
