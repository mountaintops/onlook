import { useEditorEngine } from '@/components/store/editor';
import { useStateManager } from '@/components/store/state';
import { api } from '@/trpc/react';
import { ProductType } from '@onlook/stripe';
import { Icons } from '@onlook/ui/icons';
import { observer } from 'mobx-react-lite';
import { UpgradePrompt } from '../upgrade-prompt';
import { DomainVerificationProvider } from './use-domain-verification';
import { Verification } from './verification';
import { Verified } from './verified';

export const CustomDomain = observer(() => {
    const editorEngine = useEditorEngine();
    const stateManager = useStateManager();


    const { data: customDomain } = api.domain.custom.get.useQuery({ projectId: editorEngine.projectId });

    const renderContent = () => {

        if (customDomain) {
            return <Verified />;
        }
        return <Verification />;
    };

    return (
        <DomainVerificationProvider>
            <div className="space-y-4">
                <div className="flex items-center justify-start gap-3">
                    <h2 className="text-lg">Custom Domain</h2>

                </div>
                {renderContent()}
            </div>
        </DomainVerificationProvider>
    );
});
