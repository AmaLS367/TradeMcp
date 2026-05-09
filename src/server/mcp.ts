import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import type { OAuthClientInformationFull, OAuthClientMetadata, OAuthTokens, OAuthTokenRevocationRequest } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { AuthorizationParams, OAuthServerProvider } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { ListToolsRequestSchema, CallToolRequestSchema, type Tool } from "@modelcontextprotocol/sdk/types.js";
import express from "express";
import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import ccxt from 'ccxt';
import crypto from 'crypto';
import firebaseConfig from '../../firebase-applet-config.json';
import { logger } from './logger.js';
import { validateExchangeKeys } from './exchangeValidator.js';
import { getFxCandles, getFxQuote, getTechnicalIndicator, SUPPORTED_TWELVE_INDICATORS, type MarketDataCredentials } from './marketData.js';
import {
    CRYPTO_ANALYSIS_MCP_TOOL_NAMES,
    askMessariResearch,
    getBinance24hStats,
    getBinanceKlines,
    getBinanceOrderBook,
    getBinanceTicker,
    getCoinGeckoMarketChart,
    getCoinGeckoMarkets,
    getCoinGeckoPrices,
    getCoinGeckoTrending,
    getCryptoPanicNews,
    getMessariTimeseries,
    getMessariTimeseriesCatalog,
    type CoinGeckoCredentials,
    type CryptoPanicCredentials,
    type MessariCredentials,
} from './cryptoAnalysis.js';
import {
    buildDataProviderDocument,
    decryptDataProviderDocument,
    getDataProviderValidationMode,
    isDataProviderId,
    toPublicDataProvider,
    type DataProviderId,
    type DecryptedDataProvider,
    type StoredDataProviderDocument,
} from './dataProviders.js';
import {
    callMarketplaceTool,
    isMcpMarketplaceServerId,
    listMcpMarketplaceCatalog,
    listMarketplaceServerTools,
    listMarketplaceToolsForServerIds,
    marketplaceErrorMessage,
    parseMarketplaceToolName,
    toPublicMcpServerConnection,
    trimMarketplaceToolResult,
    type McpMarketplaceServerId,
    type StoredMcpServerConnection,
} from './mcpMarketplace.js';

// --- Encryption Helpers ---
export const ALGORITHM = 'aes-256-gcm';

export function getEncryptionKey() {
    return process.env.ENCRYPTION_KEY || "";
}

export function encrypt(text: string) {
    const keyStr = getEncryptionKey();
    if (!keyStr || keyStr.length !== 64) {
        throw new Error('ENCRYPTION_KEY must be a 64-character hex string');
    }
    const iv = crypto.randomBytes(12);
    const key = Buffer.from(keyStr, 'hex');
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

export function decrypt(ciphertext: string) {
    const keyStr = getEncryptionKey();
    if (!keyStr || keyStr.length !== 64) {
        throw new Error('ENCRYPTION_KEY must be a 64-character hex string');
    }
    const [ivHex, authTagHex, encryptedHex] = ciphertext.split(':');
    if (!ivHex || !authTagHex || !encryptedHex) throw new Error("Invalid ciphertext format");
    
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const key = Buffer.from(keyStr, 'hex');
    
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

export const db = getFirestore(admin.app(), firebaseConfig.firestoreDatabaseId);

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
    resource?: string; // Store as string for Firestore
};

export function sanitizeFirestoreData<T>(value: T): T {
    if (Array.isArray(value)) {
        return value
            .filter((item) => item !== undefined)
            .map((item) => sanitizeFirestoreData(item)) as T;
    }

    if (value && typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value)
                .filter(([, item]) => item !== undefined)
                .map(([key, item]) => [key, sanitizeFirestoreData(item)])
        ) as T;
    }

    return value;
}

class FirestoreClientsStore {
    private collection: FirebaseFirestore.CollectionReference;

    constructor(db: FirebaseFirestore.Firestore) {
        this.collection = db.collection('oauth_clients');
    }

    async getClient(clientId: string): Promise<OAuthClientInformationFull | undefined> {
        const doc = await this.collection.doc(clientId).get();
        if (!doc.exists) {
            return undefined;
        }
        return doc.data() as OAuthClientInformationFull;
    }

    async registerClient(clientMetadata: OAuthClientMetadata & { client_id?: string }): Promise<OAuthClientInformationFull> {
        const client: OAuthClientInformationFull = {
            ...clientMetadata,
            client_id: clientMetadata.client_id || crypto.randomUUID(),
            client_id_issued_at: Math.floor(Date.now() / 1000),
            client_secret: clientMetadata.token_endpoint_auth_method === 'none'
                ? undefined
                : crypto.randomBytes(32).toString('hex'),
            client_secret_expires_at: 0,
        };
        await this.collection.doc(client.client_id).set(sanitizeFirestoreData(client));
        return client;
    }
}

class FirebaseOAuthProvider implements OAuthServerProvider {
    readonly clientsStore: FirestoreClientsStore;
    private pendingCollection: FirebaseFirestore.CollectionReference;
    private codesCollection: FirebaseFirestore.CollectionReference;
    private tokensCollection: FirebaseFirestore.CollectionReference;

    constructor(private readonly publicBaseUrl: string, db: FirebaseFirestore.Firestore) {
        this.clientsStore = new FirestoreClientsStore(db);
        this.pendingCollection = db.collection('oauth_pending');
        this.codesCollection = db.collection('oauth_codes');
        this.tokensCollection = db.collection('oauth_tokens');
    }

    async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: express.Response) {
        if (!isRegisteredRedirectUri(client, params.redirectUri)) {
            throw new Error('Unregistered redirect_uri');
        }

        const requestId = crypto.randomUUID();
        // Serialize URL to string for Firestore to prevent write errors
        const pendingData: any = {
            client,
            params: {
                ...params,
                resource: params.resource?.toString(),
            },
            expiresAt: Date.now() + 10 * 60 * 1000,
        };
        await this.pendingCollection.doc(requestId).set(sanitizeFirestoreData(pendingData));

        const target = new URL('/trade-mcp/', this.publicBaseUrl);
        target.searchParams.set('oauth_request', requestId);
        res.redirect(target.href);
    }

    async completeAuthorization(requestId: string, userId: string) {
        const pendingDoc = await this.pendingCollection.doc(requestId).get();
        if (!pendingDoc.exists) {
            throw new Error('OAuth authorization request expired or not found');
        }
        const pending = pendingDoc.data() as PendingAuthorization;
        
        if (pending.expiresAt < Date.now()) {
            await this.pendingCollection.doc(requestId).delete();
            throw new Error('OAuth authorization request expired');
        }

        const code = crypto.randomUUID();
        await this.pendingCollection.doc(requestId).delete();
        
        const codeData: AuthorizationCode = {
            ...pending,
            userId,
            expiresAt: Date.now() + 5 * 60 * 1000,
        };
        await this.codesCollection.doc(code).set(sanitizeFirestoreData(codeData));

        const redirectUrl = new URL(pending.params.redirectUri);
        redirectUrl.searchParams.set('code', code);
        if (pending.params.state !== undefined) {
            redirectUrl.searchParams.set('state', pending.params.state);
        }
        return redirectUrl.href;
    }

    async challengeForAuthorizationCode(client: OAuthClientInformationFull, authorizationCode: string) {
        const code = await this.getCode(client, authorizationCode);
        return code.params.codeChallenge;
    }

    async getClient(clientId: string) {
        return this.clientsStore.getClient(clientId);
    }

    async getAuthorizationCode(client: OAuthClientInformationFull, authorizationCode: string) {
        const codeDoc = await this.codesCollection.doc(authorizationCode).get();
        if (!codeDoc.exists) {
            throw new Error('Invalid or expired authorization code');
        }
        const code = codeDoc.data() as AuthorizationCode;
        if (code.client.client_id !== client.client_id) {
             throw new Error('Authorization code was not issued to this client');
        }
        return code;
    }

    async exchangeAuthorizationCode(client: OAuthClientInformationFull, authorizationCode: string, _codeVerifier?: string, redirectUri?: string, resource?: URL): Promise<OAuthTokens> {
        const codeRef = this.codesCollection.doc(authorizationCode);
        
        const result = await db.runTransaction(async (transaction) => {
            const codeDoc = await transaction.get(codeRef);
            if (!codeDoc.exists) {
                throw new Error('Invalid or expired authorization code');
            }
            const code = codeDoc.data() as AuthorizationCode;
            
            if (code.expiresAt < Date.now()) {
                transaction.delete(codeRef);
                throw new Error('Invalid or expired authorization code');
            }
            if (code.client.client_id !== client.client_id) {
                throw new Error('invalid_client');
            }
            if (redirectUri && redirectUri !== code.params.redirectUri) {
                throw new Error('redirect_uri mismatch');
            }

            transaction.delete(codeRef);
            return code;
        });

        return this.issueTokens(client.client_id, result.userId, result.params.scopes || [], resource?.toString() || (result.params.resource as unknown as string));
    }

    async exchangeRefreshToken(client: OAuthClientInformationFull, refreshToken: string, scopes?: string[], resource?: URL): Promise<OAuthTokens> {
        const tokenDoc = await this.tokensCollection.doc(`refresh_${refreshToken}`).get();
        if (!tokenDoc.exists) {
            throw new Error('Invalid refresh token');
        }
        const token = tokenDoc.data() as StoredToken;
        if (token.clientId !== client.client_id) {
            throw new Error('Invalid refresh token');
        }

        return this.issueTokens(client.client_id, token.userId, scopes || token.scopes, resource?.toString() || token.resource);
    }

    async verifyAccessToken(token: string): Promise<AuthInfo> {
        const tokenDoc = await this.tokensCollection.doc(`access_${token}`).get();
        if (!tokenDoc.exists) {
            throw new Error('Invalid or expired access token');
        }
        const stored = tokenDoc.data() as StoredToken;
        
        if (stored.expiresAt < Date.now()) {
            await this.tokensCollection.doc(`access_${token}`).delete();
            throw new Error('Invalid or expired access token');
        }

        return {
            token,
            clientId: stored.clientId,
            scopes: stored.scopes,
            expiresAt: Math.floor(stored.expiresAt / 1000),
            resource: stored.resource ? new URL(stored.resource) : undefined,
            extra: { userId: stored.userId },
        };
    }

    async revokeToken(_client: OAuthClientInformationFull, request: OAuthTokenRevocationRequest) {
        await this.tokensCollection.doc(`access_${request.token}`).delete();
        await this.tokensCollection.doc(`refresh_${request.token}`).delete();
    }

    private async getCode(client: OAuthClientInformationFull, authorizationCode: string) {
        const codeDoc = await this.codesCollection.doc(authorizationCode).get();
        if (!codeDoc.exists) {
            throw new Error('Invalid or expired authorization code');
        }
        const code = codeDoc.data() as AuthorizationCode;
        
        if (code.expiresAt < Date.now()) {
            await this.codesCollection.doc(authorizationCode).delete();
            throw new Error('Invalid or expired authorization code');
        }
        if (code.client.client_id !== client.client_id) {
            throw new Error('Authorization code was not issued to this client');
        }
        return code;
    }

    private async issueTokens(clientId: string, userId: string, scopes: string[], resource?: string): Promise<OAuthTokens> {
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
        
        // Store access token in Firestore
        await this.tokensCollection.doc(`access_${accessToken}`).set(sanitizeFirestoreData(stored));
        
        // Store refresh token in Firestore with longer expiry
        await this.tokensCollection.doc(`refresh_${refreshToken}`).set(sanitizeFirestoreData({
            ...stored,
            token: refreshToken,
            expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
        }));

        return {
            access_token: accessToken,
            refresh_token: refreshToken,
            token_type: 'bearer',
            expires_in: 3600,
            scope: scopes.join(' '),
        };
    }
}

const publicBaseUrl = process.env.PUBLIC_BASE_URL || (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:3000');
if (!publicBaseUrl && process.env.NODE_ENV === 'production') {
    console.warn('WARNING: PUBLIC_BASE_URL is not set in production. OAuth and MCP endpoints may not work correctly.');
}
const mcpServerUrl = new URL('/api/mcp/', publicBaseUrl || 'http://localhost:3000');
const oauthProvider = new FirebaseOAuthProvider(publicBaseUrl || 'http://localhost:3000', db);
const resourceMetadataUrl = new URL('/api/mcp/.well-known/oauth-protected-resource', publicBaseUrl || 'http://localhost:3000').href;
const SUPPORTED_PROVIDERS = ['binance', 'bybit'] as const;
const MAX_TOOL_RESPONSE_CHARS = 60_000;
export const MARKET_DATA_MCP_TOOL_NAMES = ['get_fx_quote', 'get_fx_candles', 'get_technical_indicator'] as const;

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

function protectedResourceMetadata() {
    return {
        resource: mcpServerUrl.href,
        authorization_servers: [mcpServerUrl.href],
        scopes_supported: ['mcp:tools'],
        resource_name: 'Trade MCP',
    };
}

function isAllowedOAuthRedirectUri(redirectUri: string) {
    try {
        const url = new URL(redirectUri);
        if (url.protocol === 'https:' && url.hostname === 'chatgpt.com') {
            return url.pathname.startsWith('/connector/oauth/') || url.pathname === '/oauth/callback';
        }

        if (url.protocol === 'https:' && url.hostname === 'claude.ai') {
            return url.pathname === '/api/mcp/auth_callback';
        }

        if (url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')) {
            return url.pathname === '/callback';
        }

        return false;
    } catch {
        return false;
    }
}

function isLoopbackCallbackUri(uri: string) {
    try {
        const url = new URL(uri);
        return url.protocol === 'http:' &&
            (url.hostname === 'localhost' || url.hostname === '127.0.0.1') &&
            url.pathname === '/callback';
    } catch {
        return false;
    }
}

function isRegisteredRedirectUri(client: OAuthClientInformationFull, redirectUri: string) {
    if (client.redirect_uris.includes(redirectUri)) {
        return true;
    }

    return isLoopbackCallbackUri(redirectUri) &&
        client.redirect_uris.some((registeredUri) => isLoopbackCallbackUri(registeredUri));
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

async function getDataProviderDocument(userId: string, provider: DataProviderId) {
    const doc = await db.doc(`users/${userId}/data_provider_connections/${provider}`).get();
    if (!doc.exists) {
        return null;
    }
    return doc.data() as StoredDataProviderDocument;
}

async function getActiveDataProvider(userId: string | null, provider: DataProviderId): Promise<DecryptedDataProvider> {
    if (!userId) {
        throw new Error(`Connect ${provider} in the dashboard before using this tool`);
    }
    const doc = await getDataProviderDocument(userId, provider);
    if (!doc || !doc.isActive) {
        throw new Error(`Connect ${provider} in the dashboard before using this tool`);
    }
    return decryptDataProviderDocument(doc, decrypt);
}

async function getMarketDataCredentials(userId: string | null): Promise<MarketDataCredentials> {
    if (!userId) {
        return {};
    }

    const [oandaDoc, twelveDoc] = await Promise.all([
        getDataProviderDocument(userId, 'oanda'),
        getDataProviderDocument(userId, 'twelve_data'),
    ]);
    const credentials: MarketDataCredentials = {};
    if (oandaDoc?.isActive) {
        const oanda = decryptDataProviderDocument(oandaDoc, decrypt);
        credentials.oanda = {
            apiKey: oanda.apiKey || '',
            accountId: oanda.accountId || '',
            baseUrl: oanda.baseUrl,
        };
    }
    if (twelveDoc?.isActive) {
        const twelve = decryptDataProviderDocument(twelveDoc, decrypt);
        credentials.twelve_data = {
            apiKey: twelve.apiKey || '',
            baseUrl: twelve.baseUrl,
        };
    }
    return credentials;
}

async function getCoinGeckoCredentials(userId: string | null): Promise<CoinGeckoCredentials> {
    const provider = await getActiveDataProvider(userId, 'coingecko');
    return {
        apiKey: provider.apiKey || '',
        tier: provider.tier === 'pro' ? 'pro' : 'demo',
    };
}

async function getCryptoPanicCredentials(userId: string | null): Promise<CryptoPanicCredentials> {
    const provider = await getActiveDataProvider(userId, 'cryptopanic');
    return {
        apiKey: provider.apiKey || '',
        apiPlan: provider.apiPlan || 'free',
    };
}

async function getMessariCredentials(userId: string | null): Promise<MessariCredentials> {
    const provider = await getActiveDataProvider(userId, 'messari');
    return { apiKey: provider.apiKey || '' };
}

async function getEnabledMarketplaceServerIds(userId: string | null): Promise<McpMarketplaceServerId[]> {
    if (!userId) {
        return [];
    }

    const snap = await db.collection(`users/${userId}/mcp_server_connections`)
        .where('isEnabled', '==', true)
        .get();

    return snap.docs
        .map((doc) => doc.id)
        .filter(isMcpMarketplaceServerId);
}

async function isMarketplaceServerEnabled(userId: string | null, serverId: McpMarketplaceServerId) {
    if (!userId) {
        return false;
    }

    const doc = await db.doc(`users/${userId}/mcp_server_connections/${serverId}`).get();
    return doc.exists && doc.data()?.isEnabled === true;
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
        version: "1.1.0"
    }, {
        capabilities: {
            tools: {}
        },
        instructions: "Trade MCP exposes market data, crypto research, exchange account reads, and human-approved trade proposal tools for the authenticated dashboard user. Prefer read-only analysis tools for research questions. Use create_trade_proposal only when the user asks to prepare a trade for dashboard approval. Use call_exchange_method only when the user explicitly names a CCXT method or asks for raw Binance/Bybit API access."
    });

    server.setRequestHandler(ListToolsRequestSchema, async () => {
        const tools: Tool[] = [
                {
                    name: "get_account_summary",
                    description: "Use this when the user asks for connected exchange balances, portfolio holdings, or account exposure. Returns read-only balances from the user's active Binance/Bybit exchange connections. Do not use for public market prices or trade execution.",
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
                    description: "Use this only when the user explicitly asks to prepare or stage a Binance/Bybit trade. It creates a pending proposal for human approval in the Trade MCP dashboard and never executes the order directly. Do not use for market analysis, price checks, or immediate execution.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            provider: { type: "string", description: "Exchange where the proposal should be reviewed.", enum: ["binance", "bybit"] },
                            symbol: { type: "string", description: "Exchange market symbol, for example BTC/USDT. Use the exact pair the user requested." },
                            side: { type: "string", description: "Trade direction requested by the user.", enum: ["buy", "sell"] },
                            orderType: { type: "string", description: "Order type for the proposed order. Limit orders require price.", enum: ["market", "limit"] },
                            quantity: { type: "number", description: "Order quantity in base asset units, for example BTC amount for BTC/USDT." },
                            price: { type: "number", description: "Limit price in quote currency. Required only for limit orders." },
                            rationale: { type: "string", description: "Short user-facing reason for the proposal, including key market context or risk note." }
                        },
                        required: ["provider", "symbol", "side", "orderType", "quantity", "rationale"]
                    },
                },
                {
                    name: "list_exchange_methods",
                    description: "Use this to discover callable CCXT methods for Binance or Bybit before making a raw exchange call. Prefer this when the user asks what exchange API methods are available. Do not use for normal balances, market data, or trade proposals when a dedicated tool exists.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            provider: { type: "string", description: "Exchange implementation to inspect.", enum: ["binance", "bybit"] },
                            filter: { type: "string", description: "Optional case-insensitive substring filter, for example order, private, fetch, transfer, ticker." },
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
                    description: "Use this only when the user explicitly requests a specific CCXT method or raw Binance/Bybit API call. This can access public, private, trading, transfer, and raw exchange methods on the user's connection. Prefer dedicated read-only tools and create_trade_proposal for normal workflows.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            provider: { type: "string", enum: ["binance", "bybit"] },
                            method: { type: "string", description: "Exact CCXT method name, for example fetchTicker, fetchOpenOrders, privateGetAccount. Avoid trading methods unless explicitly requested." },
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
                },
                {
                    name: MARKET_DATA_MCP_TOOL_NAMES[0],
                    description: "Use this when the user asks for a current FX quote, spot rate, bid/ask, or conversion rate for a forex pair. Uses the user's connected OANDA/Twelve Data provider credentials. Do not use for crypto prices.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            symbol: { type: "string", description: "Forex pair, for example EUR/USD, EUR_USD, or EURUSD." },
                            provider: { type: "string", enum: ["auto", "oanda", "twelve"], description: "Provider preference. Use auto unless the user names OANDA or Twelve Data." }
                        },
                        required: ["symbol"]
                    },
                    annotations: {
                        readOnlyHint: true,
                    },
                },
                {
                    name: MARKET_DATA_MCP_TOOL_NAMES[1],
                    description: "Use this when the user asks for historical FX candles, OHLC data, or a forex chart. Uses the user's connected OANDA/Twelve Data provider credentials. Do not use for crypto OHLCV.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            symbol: { type: "string", description: "Forex pair, for example EUR/USD, EUR_USD, or EURUSD." },
                            provider: { type: "string", enum: ["auto", "oanda", "twelve"], description: "Market-data provider. Defaults to oanda." },
                            granularity: { type: "string", description: "OANDA-style candle granularity, for example M1, M5, H1, H4, D." },
                            interval: { type: "string", description: "Twelve-style interval or generic interval, for example 1min, 5min, 1h, 1day." },
                            count: { type: "number", description: "Maximum number of candles to return. Defaults to 100, capped at 5000." },
                            from: { type: "string", description: "Optional start time/date accepted by the selected provider." },
                            to: { type: "string", description: "Optional end time/date accepted by the selected provider." }
                        },
                        required: ["symbol"]
                    },
                    annotations: {
                        readOnlyHint: true,
                    },
                },
                {
                    name: MARKET_DATA_MCP_TOOL_NAMES[2],
                    description: "Use this when the user asks for a forex technical indicator such as SMA, EMA, RSI, MACD, Bollinger Bands, ATR, ADX, or stochastic. Uses the user's Twelve Data credentials and is for FX pairs only.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            symbol: { type: "string", description: "Forex pair, for example EUR/USD, EUR_USD, or EURUSD." },
                            indicator: { type: "string", enum: [...SUPPORTED_TWELVE_INDICATORS] },
                            interval: { type: "string", description: "Twelve Data interval, for example 1min, 5min, 1h, 1day." },
                            time_period: { type: "number", description: "Optional indicator period where supported, for example 14." },
                            series_type: { type: "string", description: "Optional price series type where supported, for example close." },
                            outputsize: { type: "number", description: "Optional number of values to return, capped at 5000." }
                        },
                        required: ["symbol", "indicator", "interval"]
                    },
                    annotations: {
                        readOnlyHint: true,
                    },
                },
                {
                    name: CRYPTO_ANALYSIS_MCP_TOOL_NAMES[0],
                    description: "Use this when the user asks for current crypto spot prices across one or more CoinGecko coin IDs. Uses the user's CoinGecko BYOK API key from Market Data Providers. For public CoinGecko MCP docs/search, use coingecko_public__ tools instead.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            ids: { type: "array", items: { type: "string" }, description: "CoinGecko coin IDs, for example bitcoin or ethereum. Do not pass exchange symbols like BTC/USDT." },
                            vs_currencies: { type: "array", items: { type: "string" }, description: "Quote currencies such as usd, eur, or btc. Defaults to usd." },
                            include_market_cap: { type: "boolean", description: "Include market capitalization fields when useful for ranking or valuation." },
                            include_24hr_vol: { type: "boolean", description: "Include 24 hour volume fields when user asks about liquidity or activity." },
                            include_24hr_change: { type: "boolean", description: "Include 24 hour percent change fields when user asks about recent performance." }
                        },
                        required: ["ids"]
                    },
                    annotations: { readOnlyHint: true },
                },
                {
                    name: CRYPTO_ANALYSIS_MCP_TOOL_NAMES[1],
                    description: "Use this when the user asks for crypto market rankings, top coins, market caps, volume, or category-level market snapshots. Uses the user's CoinGecko BYOK API key. Do not use for a single exchange order book.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            vs_currency: { type: "string", description: "Quote currency, defaults to usd." },
                            category: { type: "string" },
                            ids: { type: "string", description: "Optional comma-separated CoinGecko IDs." },
                            order: { type: "string" },
                            per_page: { type: "number" },
                            page: { type: "number" }
                        }
                    },
                    annotations: { readOnlyHint: true },
                },
                {
                    name: CRYPTO_ANALYSIS_MCP_TOOL_NAMES[2],
                    description: "Use this when the user asks for historical CoinGecko price, market cap, or volume chart data for a coin ID. Uses the user's CoinGecko BYOK API key. Do not use exchange symbols; pass CoinGecko IDs like bitcoin.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            id: { type: "string", description: "CoinGecko coin ID, for example bitcoin." },
                            vs_currency: { type: "string" },
                            days: { type: "number" },
                            interval: { type: "string" }
                        },
                        required: ["id"]
                    },
                    annotations: { readOnlyHint: true },
                },
                {
                    name: CRYPTO_ANALYSIS_MCP_TOOL_NAMES[3],
                    description: "Use this when the user asks what crypto assets are trending on CoinGecko right now. Uses the user's CoinGecko BYOK API key. Do not use for personalized portfolio holdings.",
                    inputSchema: { type: "object", properties: {} },
                    annotations: { readOnlyHint: true },
                },
                {
                    name: CRYPTO_ANALYSIS_MCP_TOOL_NAMES[4],
                    description: "Use this when the user asks for the current public Binance ticker or last price for an exchange symbol. Does not require user Binance keys. Prefer this over CoinGecko when the user specifically asks about Binance market data.",
                    inputSchema: {
                        type: "object",
                        properties: { symbol: { type: "string", description: "Binance exchange symbol, for example BTC/USDT. Use slash format." } },
                        required: ["symbol"]
                    },
                    annotations: { readOnlyHint: true },
                },
                {
                    name: CRYPTO_ANALYSIS_MCP_TOOL_NAMES[5],
                    description: "Use this when the user asks for Binance bid/ask depth, order book, spread, or liquidity at price levels. Public read-only data; no Binance API key required. Do not use for account open orders.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            symbol: { type: "string", description: "Binance exchange symbol, for example BTC/USDT." },
                            limit: { type: "number", description: "Requested depth limit. Keep small for summaries; capped at 5000." }
                        },
                        required: ["symbol"]
                    },
                    annotations: { readOnlyHint: true },
                },
                {
                    name: CRYPTO_ANALYSIS_MCP_TOOL_NAMES[6],
                    description: "Use this when the user asks for Binance historical candles, OHLCV, or chart data for a crypto pair. Public read-only data; no Binance API key required. Prefer this for exchange-specific technical analysis.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            symbol: { type: "string", description: "Binance exchange symbol, for example BTC/USDT." },
                            interval: { type: "string", description: "Binance timeframe, for example 1m, 5m, 1h, 1d." },
                            limit: { type: "number", description: "Candle count, capped at 1000." }
                        },
                        required: ["symbol"]
                    },
                    annotations: { readOnlyHint: true },
                },
                {
                    name: CRYPTO_ANALYSIS_MCP_TOOL_NAMES[7],
                    description: "Use this when the user asks for Binance 24h change, volume, high/low, or market activity for one symbol or all symbols. Public read-only data; no Binance API key required.",
                    inputSchema: {
                        type: "object",
                        properties: { symbol: { type: "string", description: "Optional exchange symbol, for example BTC/USDT." } }
                    },
                    annotations: { readOnlyHint: true },
                },
                {
                    name: CRYPTO_ANALYSIS_MCP_TOOL_NAMES[8],
                    description: "Use this when the user asks for recent crypto news, sentiment-filtered news, or headlines for specific currencies. Uses the user's CryptoPanic BYOK API key. Do not use for price data or Messari research reports.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            currencies: { type: "array", items: { type: "string" }, description: "Currency tickers such as BTC, ETH, SOL. Leave empty for broad crypto news." },
                            kind: { type: "string", description: "Content type to return.", enum: ["news", "media"] },
                            filter: { type: "string", description: "CryptoPanic filter such as hot, bullish, bearish, important, rising." },
                            regions: { type: "array", items: { type: "string" } },
                            num_pages: { type: "number" },
                            public: { type: "boolean" },
                            search: { type: "string" }
                        }
                    },
                    annotations: { readOnlyHint: true },
                },
                {
                    name: CRYPTO_ANALYSIS_MCP_TOOL_NAMES[9],
                    description: "Use this when the user asks an open-ended crypto research question that benefits from Messari analysis, fundamentals, protocols, sectors, or reports. Uses the user's Messari BYOK API key and may be limited by the user's Messari plan. Do not use for simple spot prices.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            question: { type: "string", description: "Clear natural-language research question. Include asset/protocol, timeframe, and the decision context when known." },
                            verbosity: { type: "string", description: "Optional response depth requested from Messari, for example brief or detailed." },
                            response_format: { type: "string", description: "Optional desired format, for example summary, bullets, or JSON if supported by the plan." }
                        },
                        required: ["question"]
                    },
                    annotations: { readOnlyHint: true },
                },
                {
                    name: CRYPTO_ANALYSIS_MCP_TOOL_NAMES[10],
                    description: "Use this to discover which Messari timeseries datasets are available before requesting a specific timeseries. Uses the user's Messari BYOK API key and access depends on the user's plan.",
                    inputSchema: { type: "object", properties: {} },
                    annotations: { readOnlyHint: true },
                },
                {
                    name: CRYPTO_ANALYSIS_MCP_TOOL_NAMES[11],
                    description: "Use this when the user asks for structured Messari historical metrics for an asset, market, exchange, or network and you already know the dataset slug. If unsure which dataset slug to use, call get_messari_timeseries_catalog first.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            entityType: { type: "string", enum: ["assets", "markets", "exchanges", "networks"] },
                            entityIdentifier: { type: "string", description: "Messari entity identifier, for example an asset slug or symbol supported by Messari." },
                            datasetSlug: { type: "string", description: "Exact dataset slug from get_messari_timeseries_catalog." },
                            start: { type: "string", description: "Optional ISO date/time start boundary." },
                            end: { type: "string", description: "Optional ISO date/time end boundary." },
                            granularity: { type: "string", description: "Optional candle/metric granularity supported by the dataset." }
                        },
                        required: ["entityType", "entityIdentifier", "datasetSlug"]
                    },
                    annotations: { readOnlyHint: true },
                }
            ];

        try {
            tools.push(...await listMarketplaceToolsForServerIds(await getEnabledMarketplaceServerIds(userId)));
        } catch (err) {
            logger.warn({ err, userId }, 'Failed to list enabled marketplace MCP tools');
        }

        return { tools };
    });

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
        const { name, arguments: args } = request.params;
        const marketplaceTool = parseMarketplaceToolName(name);

        if (marketplaceTool) {
            if (!await isMarketplaceServerEnabled(userId, marketplaceTool.serverId)) {
                return {
                    content: [{
                        type: "text",
                        text: `MCP marketplace server "${marketplaceTool.serverId}" is not connected. Enable it in the MCP Market panel first.`
                    }],
                    isError: true,
                };
            }

            try {
                const result = await callMarketplaceTool(
                    marketplaceTool.serverId,
                    marketplaceTool.upstreamToolName,
                    (args || {}) as Record<string, unknown>,
                );
                return trimMarketplaceToolResult(result, MAX_TOOL_RESPONSE_CHARS) as any;
            } catch (err) {
                return {
                    content: [{
                        type: "text",
                        text: marketplaceErrorMessage(err),
                    }],
                    isError: true,
                };
            }
        }

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

        if (name === MARKET_DATA_MCP_TOOL_NAMES[0]) {
            const result = await getFxQuote((args || {}) as any, await getMarketDataCredentials(userId));
            return {
                content: [{
                    type: "text",
                    text: trimToolText(safeJson(result))
                }]
            };
        }

        if (name === MARKET_DATA_MCP_TOOL_NAMES[1]) {
            const result = await getFxCandles((args || {}) as any, await getMarketDataCredentials(userId));
            return {
                content: [{
                    type: "text",
                    text: trimToolText(safeJson(result))
                }]
            };
        }

        if (name === MARKET_DATA_MCP_TOOL_NAMES[2]) {
            const result = await getTechnicalIndicator((args || {}) as any, await getMarketDataCredentials(userId));
            return {
                content: [{
                    type: "text",
                    text: trimToolText(safeJson(result))
                }]
            };
        }

        if (name === CRYPTO_ANALYSIS_MCP_TOOL_NAMES[0]) {
            const result = await getCoinGeckoPrices((args || {}) as any, await getCoinGeckoCredentials(userId));
            return {
                content: [{
                    type: "text",
                    text: trimToolText(safeJson(result))
                }]
            };
        }

        if (name === CRYPTO_ANALYSIS_MCP_TOOL_NAMES[1]) {
            const result = await getCoinGeckoMarkets((args || {}) as any, await getCoinGeckoCredentials(userId));
            return {
                content: [{
                    type: "text",
                    text: trimToolText(safeJson(result))
                }]
            };
        }

        if (name === CRYPTO_ANALYSIS_MCP_TOOL_NAMES[2]) {
            const result = await getCoinGeckoMarketChart((args || {}) as any, await getCoinGeckoCredentials(userId));
            return {
                content: [{
                    type: "text",
                    text: trimToolText(safeJson(result))
                }]
            };
        }

        if (name === CRYPTO_ANALYSIS_MCP_TOOL_NAMES[3]) {
            const result = await getCoinGeckoTrending(await getCoinGeckoCredentials(userId));
            return {
                content: [{
                    type: "text",
                    text: trimToolText(safeJson(result))
                }]
            };
        }

        if (name === CRYPTO_ANALYSIS_MCP_TOOL_NAMES[4]) {
            const exchange = await createExchange('binance', null);
            const result = await getBinanceTicker(exchange, (args || {}) as any);
            return {
                content: [{
                    type: "text",
                    text: trimToolText(safeJson(result))
                }]
            };
        }

        if (name === CRYPTO_ANALYSIS_MCP_TOOL_NAMES[5]) {
            const exchange = await createExchange('binance', null);
            const result = await getBinanceOrderBook(exchange, (args || {}) as any);
            return {
                content: [{
                    type: "text",
                    text: trimToolText(safeJson(result))
                }]
            };
        }

        if (name === CRYPTO_ANALYSIS_MCP_TOOL_NAMES[6]) {
            const exchange = await createExchange('binance', null);
            const result = await getBinanceKlines(exchange, (args || {}) as any);
            return {
                content: [{
                    type: "text",
                    text: trimToolText(safeJson(result))
                }]
            };
        }

        if (name === CRYPTO_ANALYSIS_MCP_TOOL_NAMES[7]) {
            const exchange = await createExchange('binance', null);
            const result = await getBinance24hStats(exchange, (args || {}) as any);
            return {
                content: [{
                    type: "text",
                    text: trimToolText(safeJson(result))
                }]
            };
        }

        if (name === CRYPTO_ANALYSIS_MCP_TOOL_NAMES[8]) {
            const result = await getCryptoPanicNews((args || {}) as any, await getCryptoPanicCredentials(userId));
            return {
                content: [{
                    type: "text",
                    text: trimToolText(safeJson(result))
                }]
            };
        }

        if (name === CRYPTO_ANALYSIS_MCP_TOOL_NAMES[9]) {
            const result = await askMessariResearch((args || {}) as any, await getMessariCredentials(userId));
            return {
                content: [{
                    type: "text",
                    text: trimToolText(safeJson(result))
                }]
            };
        }

        if (name === CRYPTO_ANALYSIS_MCP_TOOL_NAMES[10]) {
            const result = await getMessariTimeseriesCatalog(await getMessariCredentials(userId));
            return {
                content: [{
                    type: "text",
                    text: trimToolText(safeJson(result))
                }]
            };
        }

        if (name === CRYPTO_ANALYSIS_MCP_TOOL_NAMES[11]) {
            const result = await getMessariTimeseries((args || {}) as any, await getMessariCredentials(userId));
            return {
                content: [{
                    type: "text",
                    text: trimToolText(safeJson(result))
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

export const mcpWellKnownRouter = express.Router();

mcpWellKnownRouter.get('/.well-known/oauth-protected-resource', (_req, res) => {
    res.json(protectedResourceMetadata());
});

mcpWellKnownRouter.get('/.well-known/oauth-protected-resource/api/mcp', (_req, res) => {
    res.json(protectedResourceMetadata());
});

mcpWellKnownRouter.get('/.well-known/oauth-authorization-server', (_req, res) => {
    res.json(oauthMetadata());
});

mcpWellKnownRouter.get('/.well-known/oauth-authorization-server/api/mcp', (_req, res) => {
    res.json(oauthMetadata());
});

mcpWellKnownRouter.get('/.well-known/openid-configuration', (_req, res) => {
    res.json(oauthMetadata());
});

mcpWellKnownRouter.get('/.well-known/openid-configuration/api/mcp', (_req, res) => {
    res.json(oauthMetadata());
});

export const mcpRouter = express.Router();

mcpRouter.get('/.well-known/oauth-protected-resource', (_req, res) => {
    res.json(protectedResourceMetadata());
});

mcpRouter.get('/.well-known/oauth-authorization-server', (_req, res) => {
    res.json(oauthMetadata());
});

mcpRouter.get('/.well-known/openid-configuration', (_req, res) => {
    res.json(oauthMetadata());
});

mcpRouter.post('/register', async (req, res) => {
    try {
        const redirectUris = Array.isArray(req.body?.redirect_uris) ? req.body.redirect_uris : [];
        if (!redirectUris.every((uri: unknown) => typeof uri === 'string' && isAllowedOAuthRedirectUri(uri))) {
            res.status(400).json({
                error: 'invalid_client_metadata',
                error_description: 'Only supported MCP client OAuth redirect URIs are allowed',
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
        logger.error(err, 'OAuth authorize error:', err);
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
            const codeData = await oauthProvider.getAuthorizationCode(client, code);
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
        logger.error(err, 'OAuth token error:', err);
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
        logger.error(err, 'OAuth completion error:', err);
        res.status(400).json({ error: err.message || 'OAuth completion failed' });
    }
});

const oauthMiddleware = requireBearerAuth({
    verifier: oauthProvider,
    requiredScopes: [],
    resourceMetadataUrl,
});

// Middleware to verify Firebase ID Token
export async function verifyAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
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

mcpRouter.get('/mcp-servers/catalog', verifyAuth, async (_req, res) => {
    res.json({ servers: listMcpMarketplaceCatalog() });
});

mcpRouter.get('/mcp-servers', verifyAuth, async (req, res) => {
    const userId = (req as any).userId;
    try {
        const snap = await db.collection(`users/${userId}/mcp_server_connections`).get();
        const stored = new Map<string, StoredMcpServerConnection>();
        for (const doc of snap.docs) {
            if (isMcpMarketplaceServerId(doc.id)) {
                stored.set(doc.id, doc.data() as StoredMcpServerConnection);
            }
        }

        res.json({
            servers: listMcpMarketplaceCatalog().map((server) => (
                toPublicMcpServerConnection(server.id, stored.get(server.id))
            )),
        });
    } catch (err: any) {
        logger.error(err, 'Error listing MCP marketplace servers:', err);
        res.status(500).json({ error: err.message });
    }
});

mcpRouter.put('/mcp-servers/:serverId', verifyAuth, async (req, res) => {
    const serverId = req.params.serverId;
    const userId = (req as any).userId;
    if (!isMcpMarketplaceServerId(serverId)) {
        return res.status(400).json({ error: 'unsupported_mcp_server' });
    }

    try {
        const docRef = db.doc(`users/${userId}/mcp_server_connections/${serverId}`);
        const existingSnap = await docRef.get();
        const existing = existingSnap.exists ? existingSnap.data() as StoredMcpServerConnection : undefined;
        const now = admin.firestore.FieldValue.serverTimestamp();
        const isEnabled = typeof req.body?.isEnabled === 'boolean' ? req.body.isEnabled : true;
        await docRef.set(sanitizeFirestoreData({
            serverId,
            isEnabled,
            connectedAt: existing?.connectedAt || now,
            updatedAt: now,
            lastCheckedAt: existing?.lastCheckedAt,
            lastError: existing?.lastError ?? null,
            toolCount: existing?.toolCount,
        }), { merge: true });
        const saved = await docRef.get();
        res.json({ success: true, server: toPublicMcpServerConnection(serverId, saved.data() as StoredMcpServerConnection) });
    } catch (err: any) {
        logger.error(err, 'Error saving MCP marketplace server:', err);
        res.status(400).json({ error: err.message });
    }
});

mcpRouter.post('/mcp-servers/:serverId/test', verifyAuth, async (req, res) => {
    const serverId = req.params.serverId;
    const userId = (req as any).userId;
    if (!isMcpMarketplaceServerId(serverId)) {
        return res.status(400).json({ error: 'unsupported_mcp_server' });
    }

    const docRef = db.doc(`users/${userId}/mcp_server_connections/${serverId}`);
    const now = admin.firestore.FieldValue.serverTimestamp();
    try {
        const result = await listMarketplaceServerTools(serverId);
        const existingSnap = await docRef.get();
        const existing = existingSnap.exists ? existingSnap.data() as StoredMcpServerConnection : undefined;
        await docRef.set(sanitizeFirestoreData({
            serverId,
            isEnabled: existing?.isEnabled === true,
            connectedAt: existing?.connectedAt,
            updatedAt: existing?.updatedAt || now,
            lastCheckedAt: now,
            lastError: null,
            toolCount: result.tools.length,
        }), { merge: true });
        const saved = await docRef.get();
        res.json({
            valid: true,
            toolCount: result.tools.length,
            server: toPublicMcpServerConnection(serverId, saved.data() as StoredMcpServerConnection),
        });
    } catch (err: any) {
        const error = marketplaceErrorMessage(err);
        const existingSnap = await docRef.get();
        const existing = existingSnap.exists ? existingSnap.data() as StoredMcpServerConnection : undefined;
        await docRef.set(sanitizeFirestoreData({
            serverId,
            isEnabled: existing?.isEnabled === true,
            connectedAt: existing?.connectedAt,
            updatedAt: existing?.updatedAt || now,
            lastCheckedAt: now,
            lastError: error,
            toolCount: existing?.toolCount,
        }), { merge: true });
        res.status(400).json({ valid: false, error });
    }
});

mcpRouter.delete('/mcp-servers/:serverId', verifyAuth, async (req, res) => {
    const serverId = req.params.serverId;
    const userId = (req as any).userId;
    if (!isMcpMarketplaceServerId(serverId)) {
        return res.status(400).json({ error: 'unsupported_mcp_server' });
    }

    try {
        await db.doc(`users/${userId}/mcp_server_connections/${serverId}`).delete();
        res.json({ success: true });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

async function validateDataProviderInput(provider: DataProviderId, input: Record<string, unknown>, existing?: StoredDataProviderDocument) {
    const doc = buildDataProviderDocument(provider, { ...input, isActive: true }, encrypt, existing);
    const decrypted = decryptDataProviderDocument(doc, decrypt);
    if (getDataProviderValidationMode(provider) === 'key_only') {
        return {
            warning: 'Messari API permissions are plan-specific, so the key was accepted without calling Enterprise-gated endpoints.',
        };
    }

    if (provider === 'oanda') {
        await getFxQuote({ symbol: 'EUR/USD', provider: 'oanda' }, {
            oanda: {
                apiKey: decrypted.apiKey || '',
                accountId: decrypted.accountId || '',
                baseUrl: decrypted.baseUrl,
            },
        });
    } else if (provider === 'twelve_data') {
        await getFxQuote({ symbol: 'EUR/USD', provider: 'twelve' }, {
            twelve_data: {
                apiKey: decrypted.apiKey || '',
                baseUrl: decrypted.baseUrl,
            },
        });
    } else if (provider === 'coingecko') {
        await getCoinGeckoTrending({
            apiKey: decrypted.apiKey || '',
            tier: decrypted.tier === 'pro' ? 'pro' : 'demo',
        });
    } else if (provider === 'cryptopanic') {
        await getCryptoPanicNews({ num_pages: 1, public: true }, {
            apiKey: decrypted.apiKey || '',
            apiPlan: decrypted.apiPlan || 'free',
        });
    }
    return {};
}

mcpRouter.get('/data-providers', verifyAuth, async (req, res) => {
    const userId = (req as any).userId;
    try {
        const snap = await db.collection(`users/${userId}/data_provider_connections`).get();
        res.json({
            providers: snap.docs
                .filter((doc) => isDataProviderId(doc.id))
                .map((doc) => toPublicDataProvider(doc.id as DataProviderId, doc.data() as StoredDataProviderDocument)),
        });
    } catch (err: any) {
        logger.error(err, 'Error listing data providers:', err);
        res.status(500).json({ error: err.message });
    }
});

mcpRouter.put('/data-providers/:provider', verifyAuth, async (req, res) => {
    const provider = req.params.provider;
    const userId = (req as any).userId;
    if (!isDataProviderId(provider)) {
        return res.status(400).json({ error: 'unsupported_data_provider' });
    }

    try {
        const docRef = db.doc(`users/${userId}/data_provider_connections/${provider}`);
        const existingSnap = await docRef.get();
        const existing = existingSnap.exists ? existingSnap.data() as StoredDataProviderDocument : undefined;
        const doc = buildDataProviderDocument(provider, req.body || {}, encrypt, existing);
        const now = admin.firestore.FieldValue.serverTimestamp();
        await docRef.set(sanitizeFirestoreData({
            ...doc,
            createdAt: existing?.createdAt || now,
            updatedAt: now,
        }), { merge: true });
        const saved = await docRef.get();
        res.json({ success: true, provider: toPublicDataProvider(provider, saved.data() as StoredDataProviderDocument) });
    } catch (err: any) {
        logger.error(err, 'Error saving data provider:', err);
        res.status(400).json({ error: err.message });
    }
});

mcpRouter.post('/data-providers/:provider/validate', verifyAuth, async (req, res) => {
    const provider = req.params.provider;
    const userId = (req as any).userId;
    if (!isDataProviderId(provider)) {
        return res.status(400).json({ error: 'unsupported_data_provider' });
    }

    try {
        const docRef = db.doc(`users/${userId}/data_provider_connections/${provider}`);
        const existingSnap = await docRef.get();
        const existing = existingSnap.exists ? existingSnap.data() as StoredDataProviderDocument : undefined;
        const validationResult = await validateDataProviderInput(provider, req.body || {}, existing);
        if (existing) {
            await docRef.update({ lastValidatedAt: admin.firestore.FieldValue.serverTimestamp() });
        }
        res.json({ valid: true, ...validationResult });
    } catch (err: any) {
        res.status(400).json({ valid: false, error: err.message });
    }
});

mcpRouter.delete('/data-providers/:provider', verifyAuth, async (req, res) => {
    const provider = req.params.provider;
    const userId = (req as any).userId;
    if (!isDataProviderId(provider)) {
        return res.status(400).json({ error: 'unsupported_data_provider' });
    }

    try {
        await db.doc(`users/${userId}/data_provider_connections/${provider}`).delete();
        res.json({ success: true });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// Create connection
mcpRouter.post('/connections', verifyAuth, async (req, res) => {
    const { provider, apiKey, apiSecret } = req.body;
    const userId = (req as any).userId;

    if (!provider || !apiKey || !apiSecret) {
        return res.status(400).send('Missing required fields');
    }

    try {
        // Backend validation of exchange keys before saving
        const validationResult = await validateExchangeKeys(provider as 'binance' | 'bybit', apiKey, apiSecret);
        if (!validationResult.valid) {
            return res.status(400).json({ 
                error: 'invalid_exchange_keys', 
                message: validationResult.error || 'Failed to validate exchange keys' 
            });
        }

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
        logger.error(err, "Error creating connection:", err);
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
        logger.error(err, "MCP streamable HTTP error:", err);
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
        logger.error(err, "MCP auth error:", err);
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
                    logger.error(claimErr, "Failed to claim proposal, skipping:");
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
                    logger.error(err, "Execution error:", err);
                    await doc.ref.update({
                        status: 'failed',
                        executionResult: err.message,
                        executedAt: admin.firestore.FieldValue.serverTimestamp()
                    });
                }
            }
        }
    }, err => {
        logger.error(err, "Execution engine listener error", err);
    });
