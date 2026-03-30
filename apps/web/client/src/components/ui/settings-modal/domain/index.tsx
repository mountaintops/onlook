import { observer } from 'mobx-react-lite';
import { DangerZone } from './danger-zone';

export const DomainTab = observer(() => {
    return (
        <div className="flex flex-col gap-2">
            <div className="p-6">
                <DangerZone />
            </div>
        </div>
    );
});

export default DomainTab;
