import { SystemTheme } from '@onlook/models';

export function getTheme(): SystemTheme {
    try {
        return (window?.localStorage.getItem('theme') as SystemTheme) || SystemTheme.SYSTEM;
    } catch (error) {
        console.warn('Failed to get theme', error);
        return SystemTheme.SYSTEM;
    }
}

export function setTheme(theme: SystemTheme) {
    try {
        const isDarkModePreference = window.matchMedia('(prefers-color-scheme: dark)').matches;
        const isDark =
            theme === SystemTheme.DARK || (theme === SystemTheme.SYSTEM && isDarkModePreference);

        const applyTheme = () => {
            if (isDark) {
                document.documentElement.classList.add('dark');
                document.documentElement.setAttribute('data-theme', 'dark');
                document.documentElement.style.colorScheme = 'dark';
                document.body?.classList.add('dark');
                document.body?.setAttribute('data-theme', 'dark');
            } else {
                document.documentElement.classList.remove('dark');
                document.documentElement.setAttribute('data-theme', 'light');
                document.documentElement.style.colorScheme = 'light';
                document.body?.classList.remove('dark');
                document.body?.setAttribute('data-theme', 'light');
            }
        };

        // Use setTimeout to ensure theme application doesn't interfere with React's initial hydration synchronous phase
        setTimeout(applyTheme, 0);

        // Always update localStorage so that the sandboxed app (e.g. using next-themes) picks it up
        window?.localStorage.setItem('theme', theme);
        return true;
    } catch (error) {
        console.warn('Failed to set theme', error);
        return false;
    }
}
