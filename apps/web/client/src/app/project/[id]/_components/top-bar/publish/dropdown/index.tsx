import { Separator } from '@onlook/ui/separator';
import { observer } from 'mobx-react-lite';
import { AdvancedSettingsSection } from './advanced-settings';
import { PreviewDomainSection } from './preview-domain-section';
import { ScreenshitCustomDomainSection } from './screenshit-custom-domain-section';

export const PublishDropdown = observer(() => {
    return (
        <div className="rounded-md flex flex-col text-foreground-secondary">
            <PreviewDomainSection />
            <Separator />
            <ScreenshitCustomDomainSection />
            <Separator />
            <AdvancedSettingsSection />
        </div>
    );
});
