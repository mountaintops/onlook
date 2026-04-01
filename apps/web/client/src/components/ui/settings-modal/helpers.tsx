export enum SettingsTabValue {
    PROJECT = 'project',
    PREFERENCES = 'account',
    SUBSCRIPTION = 'subscription',
    VERSIONS = 'versions',
    ADVANCED = 'advanced',
    MCP_SERVERS = 'mcp-servers',
}

export interface SettingTab {
    label: SettingsTabValue | string;
    icon: React.ReactNode;
    component: React.ReactNode;
}

export const ComingSoonTab = () => {
    return <div>Coming soon...</div>;
};
