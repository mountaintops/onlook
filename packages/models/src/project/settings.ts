
import type { McpServerConfig } from '../mcp';
import type { Commands } from './command';

export interface ProjectSettings {
    commands: Commands;
    mcpServers?: McpServerConfig[];
}

export const DEFAULT_PROJECT_SETTINGS: ProjectSettings = {
    commands: {
        build: '',
        run: '',
        install: '',
    },
};
