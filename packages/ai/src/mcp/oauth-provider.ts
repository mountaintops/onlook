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
        this.config.oauthTokens = tokens;
        await this.onSave({ oauthTokens: tokens });
    }

    /**
     * Called by the SDK when it wants to direct the user's browser to the authorization screen.
     * We throw an OAuthRedirectError to bubble this up to the top-level chat loop,
     * so it can reply to the client with a 401 redirect payload.
     */
    redirectToAuthorization(authorizationUrl: URL): void {
        console.log(`[MCP OAuth] Redirecting to authorization for server ${this.config.id}: ${authorizationUrl.toString()}`);
        throw new OAuthRedirectError(authorizationUrl.toString());
    }

    async saveCodeVerifier(codeVerifier: string): Promise<void> {
        this.config.oauthCodeVerifier = codeVerifier;
        await this.onSave({ oauthCodeVerifier: codeVerifier });
    }

    codeVerifier(): string {
        return this.config.oauthCodeVerifier || '';
    }

    private registrationAttempted = false;

    /**
     * The callback URI configured for your application.
     * We revert to the version without a trailing slash as standard 
     * practice for OIDC parity.
     */
    get redirectUrl(): string {
        // Priority: Passed-in origin > env vars > hardcoded fallback.
        let baseUrl = this.preferredOrigin || 
                        process.env.NEXT_PUBLIC_SITE_URL || 
                        process.env.NEXT_PUBLIC_APP_URL || 
                        'https://3000-01kh9dythyhbptgh9052kmzwj7.cloudspaces.litng.ai';
        
        // Sanitize: strip trailing slashes
        baseUrl = baseUrl.replace(/\/+$/, '');
        
        return `${baseUrl}/api/mcp/callback`;
    }

    get clientMetadata(): OAuthClientMetadata {
        return {
            client_name: 'Onlook Agent',
            redirect_uris: [this.redirectUrl],
            grant_types: ['authorization_code'],
            response_types: ['code'],
            token_endpoint_auth_method: 'none',
        };
    }

    clientInformation(): OAuthClientInformation | undefined {
        // Prevent infinite registration loops in a single execution context
        if (this.registrationAttempted) {
            console.warn(`[MCP OAuth] Registration already attempted for ${this.config.id} in this request. Preventing loop.`);
            return this.config.oauthClientInfo as OAuthClientInformation | undefined;
        }

        const info = this.config.oauthClientInfo as OAuthClientInformation | undefined;
        
        // TARGETED RESET: Specifically block the client_id that was rejected by Vercel for this domain.
        // We do this to ensure even if domain matches, this specific ID is purged.
        const BLOCKED_ID = 'cl_WbdtcToDrMR4ZHvXLGAmbfoYCsQjMeS8';

        if (info) {
            // 1. Block known bad IDs
            if (info.client_id === BLOCKED_ID) {
                console.warn(`[MCP OAuth] Blacklisted client detected (${BLOCKED_ID}). Forcing fresh registration.`);
                this.registrationAttempted = true;
                return undefined;
            }

            // 2. URL BINDING: If the server URL changed, the client ID is likely invalid for the new server.
            const storedUrl = this.config.oauthServerUrl;
            if (storedUrl && storedUrl !== this.config.url) {
                console.warn(`[MCP OAuth] Server URL changed for ${this.config.id}: (current: ${this.config.url}, stored: ${storedUrl}). Forcing re-registration.`);
                this.registrationAttempted = true;
                return undefined;
            }

            // 3. REDIRECT PARITY: Trigger re-registration if the redirect URI doesn't match our current domain
            const storedRedirect = this.config.oauthRedirectUri;
            if (!storedRedirect || storedRedirect !== this.redirectUrl) {
                console.warn(`[MCP OAuth] Redirect mismatch for ${this.config.id}: (current: ${this.redirectUrl}, stored: ${storedRedirect || 'none'}). Forcing re-registration.`);
                this.registrationAttempted = true;
                return undefined;
            }
        }

        return info;
    }

    async saveClientInformation(clientInformation: OAuthClientInformation): Promise<void> {
        this.config.oauthClientInfo = clientInformation;
        this.config.oauthRedirectUri = this.redirectUrl;
        this.config.oauthServerUrl = this.config.url; // Bind to current server URL
        this.registrationAttempted = true;
        
        console.log(`[MCP OAuth] Successfully registered client ${clientInformation.client_id} for ${this.config.id} (URL: ${this.config.url}) at ${this.redirectUrl}`);
        
        await this.onSave({ 
            oauthClientInfo: clientInformation,
            oauthRedirectUri: this.redirectUrl,
            oauthServerUrl: this.config.url,
        });
    }

    /**
     * A structured state string to correlate the callback with the exact project and server instance.
     */
    state(): string {
        return `${this.projectId}:${this.config.id}`;
    }
}
