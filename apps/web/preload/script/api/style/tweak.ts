export function updateCssVariable(name: string, value: string): void {
    try {
        document.documentElement.style.setProperty(name, value);
    } catch (error) {
        console.warn(`[Preload] Failed to update CSS variable ${name}:`, error);
    }
}
