import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import type { OAuthClientInformationFull, OAuthClientMetadata, OAuthTokens, OAuthTokenRevocationRequest } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { AuthorizationParams, OAuthServerProvider } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import express from "express";
import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import ccxt from 'ccxt';
import crypto from 'crypto';
import firebaseConfig from '../../firebase-applet-config.json';

// --- Encryption Helpers ---
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "";
const ALGORITHM = 'aes-256-gcm';

if (!ENCRYPTION_KEY || ENCRYPTION_KEY.length !== 64) {
    throw new Error('ENCRYPTION_KEY must be a 64-character hex string. Generate: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
}

function encrypt(text: string) {
    if (!ENCRYPTION_KEY) throw new Error("ENCRYPTION_KEY not set");
    const iv = crypto.randomBytes(12);
    const key = Buffer.from(ENCRYPTION_KEY, 'hex');
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

function decrypt(ciphertext: string) {
    if (!ENCRYPTION_KEY) throw new Error("ENCRYPTION_KEY not set");
    const [ivHex, authTagHex, encryptedHex] = ciphertext.split(':');
    if (!ivHex || !authTagHex || !encryptedHex) throw new Error("Invalid ciphertext format");
    
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const key = Buffer.from(ENCRYPTION_KEY, 'hex');
    
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
}

// --- Firebase Initialization ---
if (!admin.apps.length) {
    const serviceAccountKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
    admin.initializeApp({
        credential: serviceAccountKey
            ? admin.credential.cert(JSON.parse(serviceAccountKey))
            : admin.credential.applicationDefault(),
        projectId: firebaseConfig.projectId,
    });
}

const db = getFirestore(admin.app(), firebaseConfig.firestoreDatabaseId);

type PendingAuthorization = {
    client: OAuthClientInformationFull;
    params: AuthorizationParams;
    expiresAt: number;
};

type AuthorizationCode = PendingAuthorization & {
    userId: string;
};

type StoredToken = {
    token: string;
    clientId: string;
    userId: string;
    scopes: string[];
    expiresAt: number;
    resource?: URL;
};

class InMemoryClientsStore {
    private clients = new Map<string, OAuthClientInformationFull>();

    async getClient(clientId: string) {
        return this.clients.get(clientId);
    }

    async registerClient(clientMetadata: OAuthClientMetadata & { client_id?: string }) {
        const client: OAuthClientInformationFull = {
            ...clientMetadata,
            client_id: clientMetadata.client_id || crypto.randomUUID(),
            client_id_issued_at: Math.floor(Date.now() / 1000),
            client_secret: clientMetadata.token_endpoint_auth_method === 'none'
                ? undefined
                : crypto.randomBytes(32).toString('hex'),
            client_secret_expires_at: 0,
        };
        this.clients.set(client.client_id, client);
        return client;
    }
}

class FirebaseOAuthProvider implements OAuthServerProvider {
    readonly clientsStore = new InMemoryClientsStore();
    private pending = new Map<string, PendingAuthorization>();
    private codes = new Map<string, AuthorizationCode>();
    private accessTokens = new Map<string, StoredToken>();
    private refreshTokens = new Map<string, StoredToken>();

    constructor(private readonly publicBaseUrl: string) {}

    async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: express.Response) {
        if (!client.redirect_uris.includes(params.redirectUri)) {
            throw new Error('Unregistered redirect_uri');
        }

        const requestId = crypto.randomUUID();
        this.pending.set(requestId, {
            client,
            params,
            expiresAt: Date.now() + 10 * 60 * 1000,
        });

        const target = new URL('/trade-mcp/', this.publicBaseUrl);
        target.searchParams.set('oauth_request', requestId);
        res.redirect(target.href);
    }

    async completeAuthorization(requestId: string, userId: string) {
        const pending = this.pending.get(requestId);
        if (!pending || pending.expiresAt < Date.now()) {
            this.pending.delete(requestId);
            throw new Error('OAuth authorization request expired');
        }

        const code = crypto.randomUUID();
        this.pending.delete(requestId);
        this.codes.set(code, {
            ...pending,
            userId,
            expiresAt: Date.now() + 5 * 60 * 1000,
        });

        const redirectUrl = new URL(pending.params.redirectUri);
        redirectUrl.searchParams.set('code', code);
        if (pending.params.state !== undefined) {
            redirectUrl.searchParams.set('state', pending.params.state);
        }
        return redirectUrl.href;
    }

    async challengeForAuthorizationCode(client: OAuthClientInformationFull, authorizationCode: string) {
        const code = this.getCode(client, authorizationCode);
        return code.params.codeChallenge;
    }

    async getClient(clientId: string) {
        return this.clientsStore.getClient(clientId);
    }

    getAuthorizationCode(client: OAuthClientInformationFull, authorizationCode: string) {
        return this.getCode(client, authorizationCode);
    }

    async exchangeAuthorizationCode(client: OAuthClientInformationFull, authorizationCode: string, _codeVerifier?: string, redirectUri?: string, resource?: URL): Promise<OAuthTokens> {
        const code = this.getCode(client, authorizationCode);
        if (redirectUri && redirectUri !== code.params.redirectUri) {
            throw new Error('redirect_uri mismatch');
        }
        this.codes.delete(authorizationCode);

        return this.issueTokens(client.client_id, code.userId, code.params.scopes || [], resource || code.params.resource);
    }

    async exchangeRefreshToken(client: OAuthClientInformationFull, refreshToken: string, scopes?: string[], resource?: URL): Promise<OAuthTokens> {
        const token = this.refreshTokens.get(refreshToken);
        if (!token || token.clientId !== client.client_id) {
            throw new Error('Invalid refresh token');
        }

        return this.issueTokens(client.client_id, token.userId, scopes || token.scopes, resource || token.resource);
    }

    async verifyAccessToken(token: string): Promise<AuthInfo> {
        const stored = this.accessTokens.get(token);
        if (!stored || stored.expiresAt < Date.now()) {
            this.accessTokens.delete(token);
            throw new Error('Invalid or expired access token');
        }

        return {
            token,
            clientId: stored.clientId,
            scopes: stored.scopes,
            expiresAt: Math.floor(stored.expiresAt / 1000),
            resource: stored.resource,
            extra: { userId: stored.userId },
        };
    }

    async revokeToken(_client: OAuthClientInformationFull, request: OAuthTokenRevocationRequest) {
        this.accessTokens.delete(request.token);
        this.refreshTokens.delete(request.token);
    }

    private getCode(client: OAuthClientInformationFull, authorizationCode: string) {
        const code = this.codes.get(authorizationCode);
        if (!code || code.expiresAt < Date.now()) {
            this.codes.delete(authorizationCode);
            throw new Error('Invalid or expired authorization code');
        }
        if (code.client.client_id !== client.client_id) {
            throw new Error('Authorization code was not issued to this client');
        }
        return code;
    }

    private issueTokens(clientId: string, userId: string, scopes: string[], resource?: URL): OAuthTokens {
        const accessToken = crypto.randomBytes(32).toString('hex');
        const refreshToken = crypto.randomBytes(32).toString('hex');
        const expiresAt = Date.now() + 60 * 60 * 1000;
        const stored: StoredToken = {
            token: accessToken,
            clientId,
            userId,
            scopes,
            expiresAt,
            resource,
        };
        this.accessTokens.set(accessToken, stored);
        this.refreshTokens.set(refreshToken, {
            ...stored,
            token: refreshToken,
            expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
        });

        return {
            access_token: accessToken,
            refresh_token: refreshToken,
            token_type: 'bearer',
            expires_in: 3600,
            scope: scopes.join(' '),
        };
    }
}

const publicBaseUrl = process.env.PUBLIC_BASE_URL || 'https://vmi3245942.contaboserver.net';
const mcpServerUrl = new URL('/api/mcp/', publicBaseUrl);
const oauthProvider = new FirebaseOAuthProvider(publicBaseUrl);
const resourceMetadataUrl = new URL('/api/mcp/.well-known/oauth-protected-resource', publicBaseUrl).href;
const SUPPORTED_PROVIDERS = ['binance', 'bybit'] as const;
const MAX_TOOL_RESPONSE_CHARS = 60_000;

function base64UrlSha256(value: string) {
    return crypto
        .createHash('sha256')
        .update(value)
        .digest('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}

function oauthMetadata() {
    return {
        issuer: mcpServerUrl.href,
        authorization_endpoint: new URL('authorize', mcpServerUrl).href,
        token_endpoint: new URL('token', mcpServerUrl).href,
        registration_endpoint: new URL('register', mcpServerUrl).href,
        revocation_endpoint: new URL('revoke', mcpServerUrl).href,
        response_types_supported: ['code'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['client_secret_post', 'none'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        scopes_supported: ['mcp:tools'],
    };
}

function isAllowedOAuthRedirectUri(redirectUri: string) {
    try {
        const url = new URL(redirectUri);
        return url.protocol === 'https:' &&
            url.hostname === 'chatgpt.com' &&
            (url.pathname.startsWith('/connector/oauth/') || url.pathname === '/oauth/callback');
    } catch {
        return false;
    }
}

function isSupportedProvider(provider: unknown): provider is typeof SUPPORTED_PROVIDERS[number] {
    return typeof provider === 'string' && (SUPPORTED_PROVIDERS as readonly string[]).includes(provider);
}

function safeJson(value: unknown) {
    return JSON.stringify(value, (_key, item) => {
        if (typeof item === 'bigint') {
            return item.toString();
        }
        return item;
    }, 2);
}

function trimToolText(text: string) {
    if (text.length <= MAX_TOOL_RESPONSE_CHARS) {
        return text;
    }
    return `${text.slice(0, MAX_TOOL_RESPONSE_CHARS)}\n\n... truncated at ${MAX_TOOL_RESPONSE_CHARS} characters`;
}

function collectExchangeMethods(exchange: any) {
    const methods = new Set<string>();
    let current = exchange;

    while (current && current !== Object.prototype) {
        for (const name of Object.getOwnPropertyNames(current)) {
            if (name === 'constructor' || name.startsWith('_')) continue;
            try {
                if (typeof exchange[name] === 'function') {
                    methods.add(name);
                }
            } catch {
                // Ignore getters or dynamic fields that throw.
            }
        }
        current = Object.getPrototypeOf(current);
    }

    return [...methods].sort();
}

async function createExchange(provider: string, userId: string | null, options: Record<string, unknown> = {}) {
    if (!isSupportedProvider(provider)) {
        throw new Error(`Unsupported provider: ${provider}`);
    }

    const exchangeClass = (ccxt as any)[provider];
    const config: Record<string, unknown> = {
        enableRateLimit: true,
        ...options,
    };

    if (userId) {
        const connSnap = await db.collection(`users/${userId}/exchange_connections`)
            .where('provider', '==', provider)
            .where('isActive', '==', true)
            .limit(1)
            .get();

        if (!connSnap.empty) {
            const data = connSnap.docs[0].data();
            config.apiKey = decrypt(data.apiKeyEncrypted);
            config.secret = decrypt(data.apiSecretEncrypted);
        }
    }

    return new exchangeClass(config);
}

function assertMethodCallable(exchange: any, method: unknown): asserts method is string {
    if (typeof method !== 'string' || !method.trim()) {
        throw new Error('method must be a non-empty string');
    }

    if (method.startsWith('_') || method === 'constructor' || typeof exchange[method] !== 'function') {
        throw new Error(`Unknown or unsupported exchange method: ${method}`);
    }
}

function createMcpServer(userId: string | null) {
    const server = new Server({
        name: "TradeMCPServer",
        version: "1.0.0"
    }, {
        capabilities: {
            tools: {}
        },
        instructions: "Use this server to inspect connected crypto exchanges and call Binance/Bybit API methods through CCXT for the authenticated dashboard user. Prefer create_trade_proposal for user-approved trading workflows; use raw exchange calls only when the user explicitly asks for a specific exchange method."
    });

    server.setRequestHandler(ListToolsRequestSchema, async () => {
        return {
            tools: [
                {
                    name: "get_account_summary",
                    description: "Use this when the user asks for crypto exchange account balances or a portfolio summary. Returns balances from the user's active Binance/Bybit connections.",
                    inputSchema: {
                        type: "object",
                        properties: {},
                    },
                    annotations: {
                        readOnlyHint: true,
                    },
                },
                {
                    name: "create_trade_proposal",
                    description: "Use this when the user explicitly asks to prepare a trade. This only creates a pending proposal for human approval in the Trade MCP dashboard; it does not execute the trade directly.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            provider: { type: "string", description: "Exchange provider.", enum: ["binance", "bybit"] },
                            symbol: { type: "string", description: "Market symbol in exchange format, for example BTC/USDT." },
                            side: { type: "string", enum: ["buy", "sell"] },
                            orderType: { type: "string", enum: ["market", "limit"] },
                            quantity: { type: "number", description: "Order quantity in base asset units." },
                            price: { type: "number", description: "Limit price. Required for limit orders." },
                            rationale: { type: "string", description: "Short reason for this trade proposal." }
                        },
                        required: ["provider", "symbol", "side", "orderType", "quantity", "rationale"]
                    },
                },
                {
                    name: "list_exchange_methods",
                    description: "List all callable CCXT methods exposed for a Binance or Bybit exchange instance, including unified methods like fetchTicker and exchange-specific raw API methods.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            provider: { type: "string", enum: ["binance", "bybit"] },
                            filter: { type: "string", description: "Optional case-insensitive substring filter, for example order, private, fetch, transfer." },
                            includeHas: { type: "boolean", description: "Include the exchange.has capability map." },
                            options: { type: "object", description: "Optional CCXT exchange constructor options." }
                        },
                        required: ["provider"]
                    },
                    annotations: {
                        readOnlyHint: true,
                    },
                },
                {
                    name: "call_exchange_method",
                    description: "Call any callable CCXT method on the authenticated user's Binance or Bybit connection. Use args for positional arguments exactly as CCXT expects. This can call public, private, read, trading, transfer, and raw exchange-specific methods.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            provider: { type: "string", enum: ["binance", "bybit"] },
                            method: { type: "string", description: "CCXT method name, for example fetchTicker, fetchOpenOrders, privateGetAccount, createOrder." },
                            args: {
                                type: "array",
                                description: "Positional arguments passed directly to the CCXT method.",
                                items: {}
                            },
                            params: {
                                type: "object",
                                description: "Convenience object used as the only argument when args is omitted."
                            },
                            options: { type: "object", description: "Optional CCXT exchange constructor options, for example defaultType." }
                        },
                        required: ["provider", "method"]
                    },
                }
            ]
        };
    });

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
        const { name, arguments: args } = request.params;

        if (name === "get_account_summary") {
            if (!userId) {
                return {
                    content: [{
                        type: "text",
                        text: "Trade MCP is connected. No dashboard user is bound to this public MCP endpoint yet, so account balances are unavailable."
                    }]
                };
            }

            const connectionsSnap = await db.collection(`users/${userId}/exchange_connections`).where('isActive', '==', true).get();
            if (connectionsSnap.empty) {
                return { content: [{ type: "text", text: "No active exchange connections found." }]};
            }
            
            const balances: any = {};
            for (const doc of connectionsSnap.docs) {
                const data = doc.data();
                if (data.provider === 'binance' || data.provider === 'bybit') {
                    try {
                           const exchange = await createExchange(data.provider, userId);
                           const balance = await exchange.fetchBalance();
                           balances[data.provider] = balance.total;
                    } catch (err: any) {
                       balances[data.provider] = { error: err.message };
                    }
                }
            }
            return { content: [{ type: "text", text: JSON.stringify(balances, null, 2) }] };
        }

        if (name === "create_trade_proposal") {
            if (!userId) {
                return {
                    content: [{
                        type: "text",
                        text: "Trade MCP is connected, but no dashboard user is bound to this public MCP endpoint. Trade proposals cannot be created until DEFAULT_MCP_USER_ID is configured on the server."
                    }]
                };
            }

            const proposalRef = db.collection(`users/${userId}/trade_proposals`).doc();
            await proposalRef.set({
                ...args,
                status: 'pending_approval',
                createdAt: admin.firestore.FieldValue.serverTimestamp()
            });
            return { content: [{ type: "text", text: `Proposal created with ID: ${proposalRef.id}. It is pending human approval in the Trade MCP dashboard.` }] };
        }

        if (name === "list_exchange_methods") {
            const provider = args?.provider;
            if (!isSupportedProvider(provider)) {
                throw new Error('provider must be binance or bybit');
            }

            const exchange = await createExchange(provider, userId, (args?.options as Record<string, unknown>) || {});
            const filter = typeof args?.filter === 'string' ? args.filter.toLowerCase() : '';
            const methods = collectExchangeMethods(exchange).filter(method => (
                filter ? method.toLowerCase().includes(filter) : true
            ));
            const payload: Record<string, unknown> = {
                provider,
                methodCount: methods.length,
                methods,
            };

            if (args?.includeHas === true) {
                payload.has = exchange.has;
            }

            return {
                content: [{
                    type: "text",
                    text: trimToolText(safeJson(payload))
                }]
            };
        }

        if (name === "call_exchange_method") {
            const provider = args?.provider;
            if (!isSupportedProvider(provider)) {
                throw new Error('provider must be binance or bybit');
            }

            const exchange = await createExchange(provider, userId, (args?.options as Record<string, unknown>) || {});
            assertMethodCallable(exchange, args?.method);

            const callArgs = Array.isArray(args?.args)
                ? args.args
                : args?.params && typeof args.params === 'object'
                    ? [args.params]
                    : [];
            const result = await exchange[args.method](...callArgs);

            return {
                content: [{
                    type: "text",
                    text: trimToolText(safeJson({
                        provider,
                        method: args.method,
                        result,
                    }))
                }]
            };
        }

        throw new Error(`Unknown tool: ${name}`);
    });

    return server;
}

function getApiKey(req: express.Request) {
    const queryKey = req.query.key;
    if (typeof queryKey === 'string' && queryKey.trim()) {
        return queryKey.trim();
    }

    const headerKey = req.header('x-api-key');
    if (headerKey?.trim()) {
        return headerKey.trim();
    }

    const authHeader = req.header('authorization');
    if (authHeader?.startsWith('Bearer ')) {
        return authHeader.slice('Bearer '.length).trim();
    }

    return null;
}

async function userIdFromMcpRequest(req: express.Request) {
    const oauthUserId = req.auth?.extra?.userId;
    if (typeof oauthUserId === 'string' && oauthUserId.trim()) {
        return oauthUserId.trim();
    }

    const token = req.query.token as string | undefined;
    if (token) {
        const decoded = await admin.auth().verifyIdToken(token);
        return decoded.uid;
    }

    const apiKey = getApiKey(req);
    if (!apiKey) {
        throw new Error('Missing auth');
    }

    const snap = await db.collectionGroup('api_keys').where('key', '==', apiKey).limit(1).get();
    if (snap.empty) {
        throw new Error('Invalid API key');
    }

    return snap.docs[0].ref.parent.parent!.id;
}

// We keep a map of legacy SSE transports by session ID.
const transports = new Map<string, SSEServerTransport>();

export const mcpRouter = express.Router();

mcpRouter.get('/.well-known/oauth-protected-resource', (_req, res) => {
    res.json({
        resource: mcpServerUrl.href,
        authorization_servers: [mcpServerUrl.href],
        scopes_supported: ['mcp:tools'],
        resource_name: 'Trade MCP',
    });
});

mcpRouter.get('/.well-known/oauth-authorization-server', (_req, res) => {
    res.json(oauthMetadata());
});

mcpRouter.post('/register', async (req, res) => {
    try {
        const redirectUris = Array.isArray(req.body?.redirect_uris) ? req.body.redirect_uris : [];
        if (!redirectUris.every((uri: unknown) => typeof uri === 'string' && isAllowedOAuthRedirectUri(uri))) {
            res.status(400).json({
                error: 'invalid_client_metadata',
                error_description: 'Only ChatGPT OAuth redirect URIs are allowed',
            });
            return;
        }

        const client = await oauthProvider.clientsStore.registerClient(req.body as OAuthClientMetadata);
        res.status(201).json(client);
    } catch (err: any) {
        res.status(400).json({
            error: 'invalid_client_metadata',
            error_description: err.message || 'Invalid client metadata',
        });
    }
});

mcpRouter.get('/authorize', async (req, res) => {
    try {
        if (req.query.response_type !== 'code') {
            res.status(400).send('Unsupported response_type');
            return;
        }

        const clientId = String(req.query.client_id || '');
        const redirectUri = String(req.query.redirect_uri || '');
        const codeChallenge = String(req.query.code_challenge || '');
        const codeChallengeMethod = String(req.query.code_challenge_method || 'S256');
        if (!clientId || !redirectUri || !codeChallenge || codeChallengeMethod !== 'S256') {
            res.status(400).send('Invalid OAuth authorization request');
            return;
        }

        let client = await oauthProvider.getClient(clientId);
        if (!client) {
            if (!isAllowedOAuthRedirectUri(redirectUri)) {
                res.status(400).send('Unknown OAuth client');
                return;
            }

            client = await oauthProvider.clientsStore.registerClient({
                client_id: clientId,
                redirect_uris: [redirectUri],
                token_endpoint_auth_method: 'none',
                client_name: 'ChatGPT connector',
            } as OAuthClientMetadata & { client_id: string });
        }

        await oauthProvider.authorize(client, {
            state: typeof req.query.state === 'string' ? req.query.state : undefined,
            scopes: typeof req.query.scope === 'string' ? req.query.scope.split(' ').filter(Boolean) : ['mcp:tools'],
            codeChallenge,
            redirectUri,
            resource: typeof req.query.resource === 'string' ? new URL(req.query.resource) : mcpServerUrl,
        }, res);
    } catch (err: any) {
        console.error('OAuth authorize error:', err);
        res.status(400).send(err.message || 'OAuth authorization failed');
    }
});

mcpRouter.post('/token', express.urlencoded({ extended: false }), async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
        const clientId = String(req.body.client_id || '');
        const client = await oauthProvider.getClient(clientId);
        if (!client) {
            res.status(401).json({ error: 'invalid_client' });
            return;
        }

        if (client.client_secret && req.body.client_secret !== client.client_secret) {
            res.status(401).json({ error: 'invalid_client' });
            return;
        }

        if (req.body.grant_type === 'authorization_code') {
            const code = String(req.body.code || '');
            const verifier = String(req.body.code_verifier || '');
            const codeData = oauthProvider.getAuthorizationCode(client, code);
            if (!verifier || base64UrlSha256(verifier) !== codeData.params.codeChallenge) {
                res.status(400).json({ error: 'invalid_grant', error_description: 'Invalid PKCE verifier' });
                return;
            }

            const tokens = await oauthProvider.exchangeAuthorizationCode(
                client,
                code,
                verifier,
                String(req.body.redirect_uri || ''),
                req.body.resource ? new URL(String(req.body.resource)) : undefined,
            );
            res.json(tokens);
            return;
        }

        if (req.body.grant_type === 'refresh_token') {
            const tokens = await oauthProvider.exchangeRefreshToken(
                client,
                String(req.body.refresh_token || ''),
                typeof req.body.scope === 'string' ? req.body.scope.split(' ').filter(Boolean) : undefined,
                req.body.resource ? new URL(String(req.body.resource)) : undefined,
            );
            res.json(tokens);
            return;
        }

        res.status(400).json({ error: 'unsupported_grant_type' });
    } catch (err: any) {
        console.error('OAuth token error:', err);
        res.status(400).json({ error: 'invalid_grant', error_description: err.message || 'OAuth token exchange failed' });
    }
});

mcpRouter.post('/revoke', express.urlencoded({ extended: false }), async (req, res) => {
    const clientId = String(req.body.client_id || '');
    const client = clientId ? await oauthProvider.getClient(clientId) : undefined;
    if (client) {
        await oauthProvider.revokeToken?.(client, { token: String(req.body.token || '') });
    }
    res.status(200).send('');
});

mcpRouter.post('/oauth/complete', async (req, res) => {
    const { requestId, idToken } = req.body || {};
    if (!requestId || !idToken) {
        res.status(400).json({ error: 'Missing requestId or idToken' });
        return;
    }

    try {
        const decoded = await admin.auth().verifyIdToken(idToken);
        const redirectUrl = await oauthProvider.completeAuthorization(requestId, decoded.uid);
        res.json({ redirectUrl });
    } catch (err: any) {
        console.error('OAuth completion error:', err);
        res.status(400).json({ error: err.message || 'OAuth completion failed' });
    }
});

const oauthMiddleware = requireBearerAuth({
    verifier: oauthProvider,
    requiredScopes: [],
    resourceMetadataUrl,
});

// Middleware to verify Firebase ID Token
async function verifyAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
        return res.status(401).send('Unauthorized');
    }
    const idToken = authHeader.split('Bearer ')[1];
    try {
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        (req as any).userId = decodedToken.uid;
        next();
    } catch (error) {
        res.status(401).send('Unauthorized');
    }
}

// --- API Endpoints ---

// Create connection
mcpRouter.post('/connections', verifyAuth, async (req, res) => {
    const { provider, apiKey, apiSecret } = req.body;
    const userId = (req as any).userId;

    if (!provider || !apiKey || !apiSecret) {
        return res.status(400).send('Missing required fields');
    }

    try {
        const apiKeyEncrypted = encrypt(apiKey);
        const apiSecretEncrypted = encrypt(apiSecret);
        const apiKeyPreview = `${apiKey.slice(0, 8)}...`;

        const docRef = db.collection(`users/${userId}/exchange_connections`).doc();
        await docRef.set({
            provider,
            apiKeyEncrypted,
            apiSecretEncrypted,
            apiKeyPreview,
            isActive: true,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });

        res.json({ success: true, id: docRef.id });
    } catch (err: any) {
        console.error("Error creating connection:", err);
        res.status(500).send(err.message);
    }
});

// Delete connection
mcpRouter.delete('/connections/:id', verifyAuth, async (req, res) => {
    const { id } = req.params;
    const userId = (req as any).userId;

    try {
        await db.doc(`users/${userId}/exchange_connections/${id}`).delete();
        res.json({ success: true });
    } catch (err: any) {
        res.status(500).send(err.message);
    }
});

// Generate long-lived API key
mcpRouter.post('/keys', verifyAuth, async (req, res) => {
    const userId = (req as any).userId;
    const key = crypto.randomBytes(32).toString('hex');
    const docRef = db.collection(`users/${userId}/api_keys`).doc();
    await docRef.set({
        key,
        label: req.body.label || 'Default',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    res.json({ success: true, id: docRef.id, key });
});

// Revoke API key
mcpRouter.delete('/keys/:id', verifyAuth, async (req, res) => {
    const userId = (req as any).userId;
    await db.collection(`users/${userId}/api_keys`).doc(req.params.id).delete();
    res.json({ success: true });
});

mcpRouter.post('/', oauthMiddleware, async (req, res) => {
    let server: Server | undefined;
    let transport: StreamableHTTPServerTransport | undefined;

    try {
        const userId = await userIdFromMcpRequest(req);
        server = createMcpServer(userId);
        transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: undefined,
        });

        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);

        res.on('close', () => {
            transport?.close();
            server?.close();
        });
    } catch (err: any) {
        console.error("MCP streamable HTTP error:", err);
        if (!res.headersSent) {
            res.status(err.message === 'Missing auth' || err.message === 'Invalid API key' ? 401 : 500).json({
                jsonrpc: "2.0",
                error: {
                    code: err.message === 'Missing auth' || err.message === 'Invalid API key' ? -32001 : -32603,
                    message: err.message,
                },
                id: null,
            });
        }
    }
});

mcpRouter.get('/', oauthMiddleware, (_req, res) => {
    res.status(405).json({
        jsonrpc: "2.0",
        error: {
            code: -32000,
            message: "Method not allowed. Use POST for Streamable HTTP MCP, or /sse for legacy SSE.",
        },
        id: null,
    });
});

mcpRouter.get('/sse', oauthMiddleware, async (req, res) => {
    try {
        const userId = await userIdFromMcpRequest(req);
        const transport = new SSEServerTransport("/api/mcp/messages", res);
        const server = createMcpServer(userId);
        await server.connect(transport);
        transports.set(transport.sessionId, transport);
        
        res.on('close', () => {
             transports.delete(transport.sessionId);
             server.close();
        });

    } catch (err: any) {
        console.error("MCP auth error:", err);
        res.status(401).send(err.message);
    }
});

mcpRouter.post('/messages', async (req, res) => {
    const sessionId = req.query.sessionId as string;
    const transport = transports.get(sessionId);
    if (!transport) {
        res.status(404).send('Session not found');
        return;
    }
    await transport.handlePostMessage(req, res);
});

// --- Execution Engine ---
// Listen to all trade proposals across all users
db.collectionGroup('trade_proposals')
    .where('status', '==', 'approved')
    .onSnapshot(async (snapshot) => {
        for (const change of snapshot.docChanges()) {
            if (change.type === 'added' || change.type === 'modified') {
                const doc = change.doc;
                const data = doc.data();
                const userId = doc.ref.parent.parent?.id;
                
                if (!userId) continue;

                try {
                    await doc.ref.update({
                        status: 'executing',
                        executionStartedAt: admin.firestore.FieldValue.serverTimestamp(),
                    });
                } catch (claimErr: any) {
                    console.error("Failed to claim proposal, skipping:", claimErr);
                    continue;
                }

                try {
                    const connRef = db.collection(`users/${userId}/exchange_connections`)
                                        .where('provider', '==', data.provider)
                                        .where('isActive', '==', true)
                                        .limit(1);
                    const connSnap = await connRef.get();

                    if (connSnap.empty) {
                        throw new Error(`Active connection for ${data.provider} not found`);
                    }

                    const connData = connSnap.docs[0].data();
                    const exchangeClass = (ccxt as any)[data.provider];
                    const exchange = new exchangeClass({
                        apiKey: decrypt(connData.apiKeyEncrypted),
                        secret: decrypt(connData.apiSecretEncrypted),
                    });

                    let order;
                    if (data.orderType === 'market') {
                        order = await exchange.createMarketOrder(data.symbol, data.side, data.quantity);
                    } else if (data.orderType === 'limit' && data.price) {
                        order = await exchange.createLimitOrder(data.symbol, data.side, data.quantity, data.price);
                    } else {
                        throw new Error('Invalid order type or missing price');
                    }

                    await doc.ref.update({
                        status: 'executed',
                        executionResult: JSON.stringify(order),
                        executionHash: order.id,
                        executedAt: admin.firestore.FieldValue.serverTimestamp()
                    });

                    await db.collection(`users/${userId}/audit_logs`).add({
                        eventType: 'trade_executed',
                        source: 'execution_engine',
                        payload: JSON.stringify(order),
                        createdAt: admin.firestore.FieldValue.serverTimestamp()
                    });

                } catch (err: any) {
                    console.error("Execution error:", err);
                    await doc.ref.update({
                        status: 'failed',
                        executionResult: err.message,
                        executedAt: admin.firestore.FieldValue.serverTimestamp()
                    });
                }
            }
        }
    }, err => {
        console.error("Execution engine listener error", err);
    });
