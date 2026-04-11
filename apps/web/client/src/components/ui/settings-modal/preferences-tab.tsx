import { observer } from 'mobx-react-lite';
import { McpServersSection } from './mcp-servers-section';
import { UserDeleteSection } from './user-delete-section';

export const PreferencesTab = observer(() => {
    return (
        <div className="flex flex-col gap-8 p-6">
            <McpServersSection />
            <UserDeleteSection />
        </div>
    );
});