import { describe, expect, it } from 'vitest';
import {
  DATA_PROVIDER_DEFINITIONS,
  buildDataProviderDocument,
  decryptDataProviderDocument,
  toPublicDataProvider,
} from './dataProviders';

describe('data provider credential helpers', () => {
  const encrypt = (value: string) => `enc:${value}`;
  const decrypt = (value: string) => value.replace(/^enc:/, '');

  it('defines the planned provider set', () => {
    expect(Object.keys(DATA_PROVIDER_DEFINITIONS)).toEqual([
      'oanda',
      'twelve_data',
      'coingecko',
      'cryptopanic',
      'messari',
    ]);
  });

  it('encrypts secret fields and keeps provider config non-secret', () => {
    const doc = buildDataProviderDocument('coingecko', {
      apiKey: 'cg-key-123456',
      tier: 'pro',
      isActive: true,
    }, encrypt);

    expect(doc).toMatchObject({
      provider: 'coingecko',
      encryptedFields: { apiKey: 'enc:cg-key-123456' },
      config: { tier: 'pro' },
      apiKeyPreview: 'cg-key-1...',
      isActive: true,
    });
  });

  it('decrypts stored provider credentials without exposing them in public shape', () => {
    const doc = buildDataProviderDocument('oanda', {
      apiKey: 'oanda-key',
      accountId: 'account-1',
      baseUrl: 'https://api-fxpractice.oanda.com',
      isActive: false,
    }, encrypt);

    expect(decryptDataProviderDocument(doc, decrypt)).toEqual({
      provider: 'oanda',
      isActive: false,
      apiKey: 'oanda-key',
      accountId: 'account-1',
      baseUrl: 'https://api-fxpractice.oanda.com',
    });
    expect(toPublicDataProvider('oanda', doc)).toEqual({
      provider: 'oanda',
      apiKeyPreview: 'oanda-ke...',
      config: {
        accountId: 'account-1',
        baseUrl: 'https://api-fxpractice.oanda.com',
      },
      isActive: false,
      createdAt: undefined,
      updatedAt: undefined,
      lastValidatedAt: undefined,
    });
  });
});
