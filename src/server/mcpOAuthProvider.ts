import crypto from 'crypto';
import type { OAuthClientInformationFull, OAuthClientMetadata, OAuthTokens, OAuthTokenRevocationRequest } from '@modelcontextprotocol/sdk/shared/auth.js';
import type { AuthorizationParams, OAuthServerProvider } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type express from 'express';
import { db } from './mcpFirebase.js';
import { sanitizeFirestoreData } from './firestoreUtils.js';

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
  resource?: string;
};

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

export class FirebaseOAuthProvider implements OAuthServerProvider {
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

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    _codeVerifier?: string,
    redirectUri?: string,
    resource?: URL,
  ): Promise<OAuthTokens> {
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

    await this.tokensCollection.doc(`access_${accessToken}`).set(sanitizeFirestoreData(stored));
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
