/**
 * Utility for managing npm dependencies in a virtual package.json.
 * Used by SandpackAdapter to polyfill `npm install` commands.
 */

export interface PackageJson {
    name?: string;
    version?: string;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    [key: string]: unknown;
}

/**
 * Parse a package.json string and extract the dependencies object.
 */
export function parseDependencies(packageJsonContent: string): Record<string, string> {
    try {
        const parsed: PackageJson = JSON.parse(packageJsonContent);
        return { ...(parsed.dependencies ?? {}) };
    } catch {
        console.error('[DependencyPolyfill] Failed to parse package.json');
        return {};
    }
}

/**
 * Parse all dependencies (including devDependencies).
 */
export function parseAllDependencies(packageJsonContent: string): {
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
} {
    try {
        const parsed: PackageJson = JSON.parse(packageJsonContent);
        return {
            dependencies: { ...(parsed.dependencies ?? {}) },
            devDependencies: { ...(parsed.devDependencies ?? {}) },
        };
    } catch {
        return { dependencies: {}, devDependencies: {} };
    }
}

/**
 * Add a dependency to a virtual package.json in the files map.
 * Returns the updated dependencies map.
 */
export function addDependency(
    files: Record<string, string>,
    name: string,
    version: string = 'latest',
    pkgJsonPath: string = '/package.json',
): Record<string, string> {
    let packageJson: PackageJson;

    try {
        const existing = files[pkgJsonPath];
        packageJson = existing ? JSON.parse(existing) : { name: 'sandbox', version: '1.0.0' };
    } catch {
        packageJson = { name: 'sandbox', version: '1.0.0' };
    }

    if (!packageJson.dependencies) {
        packageJson.dependencies = {};
    }

    packageJson.dependencies[name] = version;
    files[pkgJsonPath] = JSON.stringify(packageJson, null, 2);

    return { ...packageJson.dependencies };
}

/**
 * Remove a dependency from a virtual package.json in the files map.
 * Returns the updated dependencies map.
 */
export function removeDependency(
    files: Record<string, string>,
    name: string,
    pkgJsonPath: string = '/package.json',
): Record<string, string> {
    let packageJson: PackageJson;

    try {
        const existing = files[pkgJsonPath];
        if (!existing) return {};
        packageJson = JSON.parse(existing);
    } catch {
        return {};
    }

    if (packageJson.dependencies) {
        delete packageJson.dependencies[name];
    }

    files[pkgJsonPath] = JSON.stringify(packageJson, null, 2);

    return { ...(packageJson.dependencies ?? {}) };
}
