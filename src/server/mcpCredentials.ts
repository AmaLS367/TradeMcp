import {
  getFxQuote,
  type MarketDataCredentials,
} from './marketData.js';
import {
  getCoinGeckoTrending,
  getCryptoPanicNews,
  getNewsApiSources,
  getTaapiIndicator,
  type CoinGeckoCredentials,
  type CryptoPanicCredentials,
  type MessariCredentials,
  type NewsApiCredentials,
  type TaapiCredentials,
} from './cryptoAnalysis.js';
import {
  buildDataProviderDocument,
  decryptDataProviderDocument,
  getDataProviderValidationMode,
  type DataProviderId,
  type DecryptedDataProvider,
  type StoredDataProviderDocument,
} from './dataProviders.js';
import {
  getMarketplaceServerRequiredDataProvider,
  type MarketplaceMcpCredentials,
  type McpMarketplaceServerId,
} from './mcpMarketplace.js';
import { decrypt, encrypt } from './mcpCrypto.js';
import { db } from './mcpFirebase.js';

export async function getDataProviderDocument(userId: string, provider: DataProviderId) {
  const doc = await db.doc(`users/${userId}/data_provider_connections/${provider}`).get();
  if (!doc.exists) {
    return null;
  }
  return doc.data() as StoredDataProviderDocument;
}

export async function getActiveDataProvider(userId: string | null, provider: DataProviderId): Promise<DecryptedDataProvider> {
  if (!userId) {
    throw new Error(`Connect ${provider} in the dashboard before using this tool`);
  }
  const doc = await getDataProviderDocument(userId, provider);
  if (!doc || !doc.isActive) {
    throw new Error(`Connect ${provider} in the dashboard before using this tool`);
  }
  return decryptDataProviderDocument(doc, decrypt);
}

export async function getMarketDataCredentials(userId: string | null): Promise<MarketDataCredentials> {
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

export async function getCoinGeckoCredentials(userId: string | null): Promise<CoinGeckoCredentials> {
  const provider = await getActiveDataProvider(userId, 'coingecko');
  return {
    apiKey: provider.apiKey || '',
    tier: provider.tier === 'pro' ? 'pro' : 'demo',
  };
}

export async function getCryptoPanicCredentials(userId: string | null): Promise<CryptoPanicCredentials> {
  const provider = await getActiveDataProvider(userId, 'cryptopanic');
  return {
    apiKey: provider.apiKey || '',
    apiPlan: provider.apiPlan || 'free',
  };
}

export async function getMessariCredentials(userId: string | null): Promise<MessariCredentials> {
  const provider = await getActiveDataProvider(userId, 'messari');
  return { apiKey: provider.apiKey || '' };
}

export async function getNewsApiCredentials(userId: string | null): Promise<NewsApiCredentials> {
  const provider = await getActiveDataProvider(userId, 'newsapi');
  return {
    apiKey: provider.apiKey || '',
    baseUrl: provider.baseUrl || 'https://newsapi.org',
  };
}

export async function getTaapiCredentials(userId: string | null): Promise<TaapiCredentials> {
  const provider = await getActiveDataProvider(userId, 'taapi');
  return {
    apiKey: provider.apiKey || '',
    baseUrl: provider.baseUrl || 'https://api.taapi.io',
  };
}

export async function getMarketplaceMcpCredentials(
  userId: string | null,
  serverId: McpMarketplaceServerId,
): Promise<MarketplaceMcpCredentials | undefined> {
  const providerId = getMarketplaceServerRequiredDataProvider(serverId);
  if (!providerId) {
    return undefined;
  }
  const provider = await getActiveDataProvider(userId, providerId as DataProviderId);
  return { apiKey: provider.apiKey || '' };
}

export async function validateDataProviderInput(
  provider: DataProviderId,
  input: Record<string, unknown>,
  existing?: StoredDataProviderDocument,
) {
  const doc = buildDataProviderDocument(provider, { ...input, isActive: true }, encrypt, existing);
  const decrypted = decryptDataProviderDocument(doc, decrypt);
  if (getDataProviderValidationMode(provider) === 'key_only') {
    return {
      warning: `${provider} API permissions are plan-specific, so the key was accepted without calling plan-gated endpoints.`,
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
  } else if (provider === 'newsapi') {
    await getNewsApiSources({}, {
      apiKey: decrypted.apiKey || '',
      baseUrl: decrypted.baseUrl || 'https://newsapi.org',
    });
  } else if (provider === 'taapi') {
    await getTaapiIndicator({
      indicator: 'rsi',
      exchange: 'binance',
      symbol: 'BTC/USDT',
      interval: '1h',
    }, {
      apiKey: decrypted.apiKey || '',
      baseUrl: decrypted.baseUrl || 'https://api.taapi.io',
    });
  }
  return {};
}
