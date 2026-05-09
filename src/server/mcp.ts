import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { OAuthClientMetadata } from "@modelcontextprotocol/sdk/shared/auth.js";
import express from "express";
import admin from 'firebase-admin';
import ccxt from 'ccxt';
import crypto from 'crypto';
import { logger } from './logger.js';
import { validateExchangeKeys } from './exchangeValidator.js';
import {
    buildDataProviderDocument,
    isDataProviderId,
    toPublicDataProvider,
    type DataProviderId,
    type StoredDataProviderDocument,
} from './dataProviders.js';
import {
    callMarketplaceTool,
    isMcpMarketplaceServerId,
    listMcpMarketplaceCatalog,
    listMarketplaceServerTools,
    marketplaceErrorMessage,
    toPublicMcpServerConnection,
    type StoredMcpServerConnection,
} from './mcpMarketplace.js';
import { decrypt, encrypt } from './mcpCrypto.js';
import { db } from './mcpFirebase.js';
import { sanitizeFirestoreData } from './firestoreUtils.js';
import {
    getDataProviderDocument,
    getMarketplaceMcpCredentials,
    validateDataProviderInput,
} from './mcpCredentials.js';
import { FirebaseOAuthProvider } from './mcpOAuthProvider.js';
import { createMcpServer } from './mcpServerFactory.js';

export { ALGORITHM, decrypt, encrypt, getEncryptionKey } from './mcpCrypto.js';
export { sanitizeFirestoreData } from './firestoreUtils.js';
export { TRADEMCP_DOCS_TOOL_NAME, getTradeMcpResearchGuide } from './tradeMcpResearchGuide.js';
export { MARKET_DATA_MCP_TOOL_NAMES, RAW_EXCHANGE_MCP_TOOL_NAMES, shouldIncludeTool } from './mcpToolPolicy.js';
export { db } from './mcpFirebase.js';

const publicBaseUrl = process.env.PUBLIC_BASE_URL || (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:3000');
if (!publicBaseUrl && process.env.NODE_ENV === 'production') {
    console.warn('WARNING: PUBLIC_BASE_URL is not set in production. OAuth and MCP endpoints may not work correctly.');
}
const mcpServerUrl = new URL('/api/mcp/', publicBaseUrl || 'http://localhost:3000');
const oauthProvider = new FirebaseOAuthProvider(publicBaseUrl || 'http://localhost:3000', db);
const resourceMetadataUrl = new URL('/api/mcp/.well-known/oauth-protected-resource', publicBaseUrl || 'http://localhost:3000').href;

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
        const result = await listMarketplaceServerTools(
            serverId,
            undefined,
            await getMarketplaceMcpCredentials(userId, serverId),
        );
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
        const profile = typeof req.query.profile === 'string' ? req.query.profile : undefined;
        server = createMcpServer(userId, profile);
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
        const profile = typeof req.query.profile === 'string' ? req.query.profile : undefined;
        const transport = new SSEServerTransport("/api/mcp/messages", res);
        const server = createMcpServer(userId, profile);
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
