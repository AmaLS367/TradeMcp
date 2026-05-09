export const DATA_PROVIDER_DEFINITIONS = {
  oanda: {
    label: 'OANDA',
    secretFields: ['apiKey'],
    configFields: ['accountId', 'baseUrl'],
    defaults: { baseUrl: 'https://api-fxpractice.oanda.com' },
  },
  twelve_data: {
    label: 'Twelve Data',
    secretFields: ['apiKey'],
    configFields: ['baseUrl'],
    defaults: { baseUrl: 'https://api.twelvedata.com' },
  },
  coingecko: {
    label: 'CoinGecko',
    secretFields: ['apiKey'],
    configFields: ['tier'],
    defaults: { tier: 'demo' },
  },
  cryptopanic: {
    label: 'CryptoPanic',
    secretFields: ['apiKey'],
    configFields: ['apiPlan'],
    defaults: { apiPlan: 'free' },
  },
  messari: {
    label: 'Messari',
    secretFields: ['apiKey'],
    configFields: [],
    defaults: {},
  },
} as const;

export type DataProviderId = keyof typeof DATA_PROVIDER_DEFINITIONS;

export type StoredDataProviderDocument = {
  provider: DataProviderId;
  encryptedFields: Record<string, string>;
  config: Record<string, string>;
  apiKeyPreview: string;
  isActive: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
  lastValidatedAt?: unknown;
};

export type DecryptedDataProvider = {
  provider: DataProviderId;
  isActive: boolean;
  apiKey?: string;
  accountId?: string;
  baseUrl?: string;
  tier?: 'demo' | 'pro';
  apiPlan?: string;
};

export type PublicDataProvider = {
  provider: DataProviderId;
  apiKeyPreview: string;
  config: Record<string, string>;
  isActive: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
  lastValidatedAt?: unknown;
};

export function isDataProviderId(provider: unknown): provider is DataProviderId {
  return typeof provider === 'string' && provider in DATA_PROVIDER_DEFINITIONS;
}

function getStringField(input: Record<string, unknown>, field: string) {
  const value = input[field];
  return typeof value === 'string' ? value.trim() : '';
}

export function maskSecret(value: string) {
  return value ? `${value.slice(0, 8)}...` : '';
}

export function buildDataProviderDocument(
  provider: DataProviderId,
  input: Record<string, unknown>,
  encrypt: (value: string) => string,
  existing?: StoredDataProviderDocument,
): StoredDataProviderDocument {
  const definition = DATA_PROVIDER_DEFINITIONS[provider];
  const encryptedFields: Record<string, string> = { ...(existing?.encryptedFields || {}) };
  const config: Record<string, string> = {
    ...(definition.defaults as Record<string, string>),
    ...(existing?.config || {}),
  };

  for (const field of definition.secretFields) {
    const value = getStringField(input, field);
    if (value) {
      encryptedFields[field] = encrypt(value);
    }
  }

  if (!encryptedFields.apiKey) {
    throw new Error(`${definition.label} API key is required`);
  }

  for (const field of definition.configFields) {
    const value = getStringField(input, field);
    if (value) {
      config[field] = value;
    }
  }

  if (provider === 'oanda' && !config.accountId) {
    throw new Error('OANDA account ID is required');
  }
  if (provider === 'coingecko' && config.tier !== 'demo' && config.tier !== 'pro') {
    throw new Error('CoinGecko tier must be demo or pro');
  }
  if (provider === 'cryptopanic' && !config.apiPlan) {
    throw new Error('CryptoPanic API plan is required');
  }

  const apiKey = getStringField(input, 'apiKey');
  return {
    provider,
    encryptedFields,
    config,
    apiKeyPreview: apiKey ? maskSecret(apiKey) : existing?.apiKeyPreview || '',
    isActive: typeof input.isActive === 'boolean' ? input.isActive : existing?.isActive ?? true,
    createdAt: existing?.createdAt,
    updatedAt: existing?.updatedAt,
    lastValidatedAt: existing?.lastValidatedAt,
  };
}

export function decryptDataProviderDocument(
  doc: StoredDataProviderDocument,
  decrypt: (value: string) => string,
): DecryptedDataProvider {
  const decrypted: DecryptedDataProvider = {
    provider: doc.provider,
    isActive: doc.isActive,
    ...(doc.config as Record<string, string>),
  };

  for (const [field, value] of Object.entries(doc.encryptedFields || {})) {
    (decrypted as Record<string, unknown>)[field] = decrypt(value);
  }

  return decrypted;
}

export function toPublicDataProvider(provider: DataProviderId, doc: StoredDataProviderDocument): PublicDataProvider {
  return {
    provider,
    apiKeyPreview: doc.apiKeyPreview,
    config: doc.config || {},
    isActive: doc.isActive,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    lastValidatedAt: doc.lastValidatedAt,
  };
}
