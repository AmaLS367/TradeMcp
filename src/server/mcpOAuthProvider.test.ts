import { describe, it, expect } from 'vitest';
import { isRegisteredRedirectUri, isLoopbackCallbackUri } from './mcpOAuthProvider.js';
import type { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js';

describe('mcpOAuthProvider', () => {
  describe('isLoopbackCallbackUri', () => {
    it('returns true for localhost loopback URL', () => {
      expect(isLoopbackCallbackUri('http://localhost/callback')).toBe(true);
      expect(isLoopbackCallbackUri('http://localhost:3000/callback')).toBe(true);
    });

    it('returns true for 127.0.0.1 loopback URL', () => {
      expect(isLoopbackCallbackUri('http://127.0.0.1/callback')).toBe(true);
      expect(isLoopbackCallbackUri('http://127.0.0.1:8080/callback')).toBe(true);
    });

    it('returns false for non-loopback URLs', () => {
      expect(isLoopbackCallbackUri('https://example.com/callback')).toBe(false);
      expect(isLoopbackCallbackUri('http://example.com/callback')).toBe(false);
    });

    it('returns false for non-http protocols on loopback', () => {
      expect(isLoopbackCallbackUri('https://localhost/callback')).toBe(false);
      expect(isLoopbackCallbackUri('https://127.0.0.1/callback')).toBe(false);
    });

    it('returns false for loopback without /callback path', () => {
      expect(isLoopbackCallbackUri('http://localhost/other')).toBe(false);
      expect(isLoopbackCallbackUri('http://localhost/')).toBe(false);
      expect(isLoopbackCallbackUri('http://localhost')).toBe(false);
    });

    it('returns false for invalid URLs', () => {
      expect(isLoopbackCallbackUri('not-a-url')).toBe(false);
      expect(isLoopbackCallbackUri('')).toBe(false);
    });
  });

  describe('isRegisteredRedirectUri', () => {
    const createClient = (redirect_uris: string[]): OAuthClientInformationFull => ({
      client_id: 'test_client',
      client_name: 'Test Client',
      redirect_uris,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_secret_expires_at: 0,
    });

    it('returns true if the exact URL is registered', () => {
      const client = createClient(['https://example.com/cb', 'http://localhost/callback']);
      expect(isRegisteredRedirectUri(client, 'https://example.com/cb')).toBe(true);
    });

    it('returns true if another loopback URL is registered and a loopback URL is provided', () => {
      // Client registered with one loopback URL port
      const client = createClient(['http://127.0.0.1:8080/callback']);
      // But redirect is to another loopback URL port (allowed by RFC 8252 for native apps)
      expect(isRegisteredRedirectUri(client, 'http://localhost:3000/callback')).toBe(true);
      expect(isRegisteredRedirectUri(client, 'http://127.0.0.1:4567/callback')).toBe(true);
    });

    it('returns false if provided URL is not registered and not a loopback', () => {
      const client = createClient(['https://example.com/cb']);
      expect(isRegisteredRedirectUri(client, 'https://example.com/other')).toBe(false);
      expect(isRegisteredRedirectUri(client, 'https://malicious.com/cb')).toBe(false);
    });

    it('returns false if provided URL is loopback but client has no loopback registered', () => {
      const client = createClient(['https://example.com/cb']);
      expect(isRegisteredRedirectUri(client, 'http://localhost/callback')).toBe(false);
    });

    it('returns false if provided URL is not a loopback and client has loopback registered', () => {
      const client = createClient(['http://127.0.0.1/callback']);
      expect(isRegisteredRedirectUri(client, 'https://example.com/cb')).toBe(false);
    });
  });
});
