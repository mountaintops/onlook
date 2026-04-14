import type { Metadata } from 'next';

export const metadata: Metadata = {
    title: 'Daytona Sandbox Tester | Onlook',
    description: 'Interactive test harness for Daytona sandbox provisioning, command execution, and code running.',
};

export default function DaytonaTestLayout({ children }: { children: React.ReactNode }) {
    return children;
}
