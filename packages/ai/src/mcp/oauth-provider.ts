import type { OAuthClientInformation, OAuthClientMetadata, OAuthClientProvider, OAuthTokens } from '@ai-sdk/mcp';
import type { McpServerConfig } from '@onlook/models';
import { OAuthRedirectError } from './errors';

type OnSaveCallback = (patch: Partial<McpServerConfig>) => Promise<void>;

export class McpOAuthProvider implements OAuthClientProvider {
    private readonly config: McpServerConfig;
    private readonly onSave: OnSaveCallback;
    private readonly projectId: string;

    private readonly preferredOrigin?: string;

    constructor(
        projectId: string, 
        config: McpServerConfig, 
        onSave: OnSaveCallback,
        preferredOrigin?: string
    ) {
        this.projectId = projectId;
        this.config = config;
        this.onSave = onSave;
        this.preferredOrigin = preferredOrigin;
    }

    /**
     * Called by the SDK to get the current tokens for the request.
     */
    tokens(): OAuthTokens | undefined {
        return this.config.oauthTokens as OAuthTokens | undefined;
    }

    /**
     * Called by the SDK to persist newly obtained tokens (e.g. after code exchange or refresh).
     */
    async saveTokens(tokens: OAuthTokens): Promise<void> {
        await this.onSave({ oauthTokens: tokens });
    }

    /**
     * Called by the SDK when it wants to direct the user's browser to the authorization screen.
     * We throw an OAuthRedirectError to bubble this up to the top-level chat loop,
     * so it can reply to the client with a 401 redirect payload.
     */
    redirectToAuthorization(authorizationUrl: URL): void {
        throw new OAuthRedirectError(authorizationUrl.toString());
    }

    async saveCodeVerifier(codeVerifier: string): Promise<void> {
        await this.onSave({ oauthCodeVerifier: codeVerifier });
    }

    codeVerifier(): string {
        return this.config.oauthCodeVerifier || '';
    }

    /**
     * The callback URI configured for your application.
     * Often localhost needs 127.0.0.1 for native RFC 8252 compliance.
     * We use a resolved relative origin if NEXT_PUBLIC_APP_URL is not set.
     */
    get redirectUrl(): string {
        // Priority: Passed-in origin > env vars > hardcoded fallback.
        let baseUrl = this.preferredOrigin || 
                        process.env.NEXT_PUBLIC_SITE_URL || 
                        process.env.NEXT_PUBLIC_APP_URL || 
                        'https://3000-01kh9dythyhbptgh9052kmzwj7.cloudspaces.litng.ai';
        
        // Sanitize: strip trailing slashes to prevent double slashes in path
        baseUrl = baseUrl.replace(/\/+$/, '');
        
        return `${baseUrl}/api/mcp/callback`;
    }

    get clientMetadata(): OAuthClientMetadata {
        return {
            client_name: 'Onlook AI Agent',
            redirect_uris: [this.redirectUrl],
            grant_types: ['authorization_code'],
            response_types: ['code'],
            client_uri: this.redirectUrl.split('/api/mcp/callback')[0],
            token_endpoint_auth_method: 'none',
        };
    }

    clientInformation(): OAuthClientInformation | undefined {
        const info = this.config.oauthClientInfo as OAuthClientInformation | undefined;
        
        // DCR SELF-HEALING: If we have stored client info, check if it was registered with our current redirect URI.
        // If not, we return undefined to force a fresh Dynamic Client Registration for the new domain.
        if (info && this.config.oauthRedirectUri !== this.redirectUrl) {
            console.warn(`[MCP OAuth] Redirect URI mismatch (expected ${this.redirectUrl}, was ${this.config.oauthRedirectUri}). Forcing re-registration.`);
            return undefined;
        }

        return info;
    }

    async saveClientInformation(clientInformation: OAuthClientInformation): Promise<void> {
        await this.onSave({ 
            oauthClientInfo: clientInformation,
            oauthRedirectUri: this.redirectUrl,
        });
    }

    /**
     * A structured state string to correlate the callback with the exact project and server instance.
     */
    state(): string {
        return `${this.projectId}:${this.config.id}`;
    }
}
