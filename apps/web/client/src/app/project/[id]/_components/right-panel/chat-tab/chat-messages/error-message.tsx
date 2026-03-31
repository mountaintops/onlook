import { useStateManager } from '@/components/store/state';
import type { Usage } from '@onlook/models';
import { Button } from '@onlook/ui/button';
import { Icons } from '@onlook/ui/icons';
import { observer } from 'mobx-react-lite';

interface ErrorMessageProps {
    error: Error;
}

export const ErrorMessage = observer(({ error: chatError }: ErrorMessageProps) => {
    // Parse error to extract message
    let errorMessage: string | null = null;

    try {
        const parsed = JSON.parse(chatError.message) as {
            code: number;
            error: string;
        };
        if (parsed && typeof parsed === 'object') {
            errorMessage = parsed.error || chatError.toString();
        }
    } catch (e) {
        // Not JSON, use raw error message
        errorMessage = chatError.message || chatError.toString();
    }

    if (errorMessage) {
        return (
            <div className="flex w-full flex-row items-center justify-center gap-2 p-2 text-small text-red">
                <Icons.ExclamationTriangle className="w-6" />
                <p className="w-5/6 text-wrap overflow-auto">{errorMessage}</p>
            </div>
        );
    }

    return null;
});
