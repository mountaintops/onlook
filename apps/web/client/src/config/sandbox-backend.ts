export type SandboxBackend = 'codesandbox' | 'daytona';

/**
 * Which sandbox stack the editor and API use. Set `NEXT_PUBLIC_SANDBOX_BACKEND=codesandbox`
 * to revert to CodeSandbox. Any other value (including unset) selects Daytona.
 */
export function getSandboxBackend(): SandboxBackend {
    return process.env.NEXT_PUBLIC_SANDBOX_BACKEND === 'codesandbox' ? 'codesandbox' : 'daytona';
}
