export class OAuthRedirectError extends Error {
    constructor(public readonly url: string) {
        super(`Redirecting to OAuth authorization URL: ${url}`);
        this.name = 'OAuthRedirectError';
    }
}
