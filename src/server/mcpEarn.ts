import ccxt from 'ccxt';
import crypto from 'crypto';
import { createExchange } from './mcpExchange.js';
import { recordProviderLatency } from './providerLatency.js';

const BYBIT_API_URL = 'https://api.bybit.com';

// Helper HTTP client for Bybit V5 supporting HMAC signatures and auto-retries
export async function callBybitV5Earn(
  path: string,
  isPrivate: boolean,
  params: Record<string, any>,
  userId: string | null
): Promise<any> {
  const url = new URL(path, BYBIT_API_URL);
  
  let headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  // Filter out undefined, null, and empty string values from params
  const cleanParams: Record<string, any> = {};
  for (const [key, val] of Object.entries(params)) {
    if (val !== undefined && val !== null && val !== '') {
      cleanParams[key] = val;
    }
  }

  if (isPrivate) {
    if (!userId) {
      throw new Error('Authentication required for private Bybit Earn positions. Please log in or provide an API key.');
    }
    // DRY: Extract credentials directly from the configured CCXT instance
    const exchange = await createExchange('bybit', userId);
    const apiKey = exchange.apiKey;
    const apiSecret = exchange.secret;

    if (!apiKey || !apiSecret) {
      throw new Error('Active Bybit API connection not found. Please connect your Bybit API keys in the dashboard.');
    }

    const timestamp = Date.now().toString();
    const recvWindow = '5000';

    // Prepare parameters for GET request (sorting by keys)
    const sortedKeys = Object.keys(cleanParams).sort();
    const queryParts = sortedKeys.map(key => `${key}=${cleanParams[key]}`);
    const queryString = queryParts.join('&');
    if (queryString) {
      url.search = queryString;
    }

    // Generate signature string according to Bybit V5 spec (GET requests)
    const preSignString = timestamp + apiKey + recvWindow + queryString;
    const signature = crypto
      .createHmac('sha256', apiSecret)
      .update(preSignString)
      .digest('hex');

    headers['X-BAPI-API-KEY'] = apiKey;
    headers['X-BAPI-TIMESTAMP'] = timestamp;
    headers['X-BAPI-SIGN'] = signature;
    headers['X-BAPI-RECV-WINDOW'] = recvWindow;
  } else {
    // For public requests, just append clean parameters to URL
    for (const [key, value] of Object.entries(cleanParams)) {
      url.searchParams.set(key, String(value));
    }
  }

  // Execute request with latency logging and retry mechanism for HTTP 429
  const latency = recordProviderLatency('bybit', path);
  let attempts = 0;
  const maxAttempts = 3;

  while (attempts < maxAttempts) {
    try {

      const response = await fetch(url.toString(), { method: 'GET', headers });
      
      if (response.status === 429) {
        attempts++;
        if (attempts >= maxAttempts) throw new Error('Bybit API rate limit exceeded (HTTP 429).');
        await new Promise(resolve => setTimeout(resolve, attempts * 1000 + Math.random() * 500));
        continue;
      }

      const text = await response.text();
      const payload = text ? JSON.parse(text) : {};

      if (!response.ok || payload.retCode !== 0) {
        throw new Error(`Bybit Earn API error (${payload.retCode || response.status}): ${payload.retMsg || response.statusText}`);
      }

      return payload.result;
    } catch (err) {
      if (attempts >= maxAttempts - 1) throw err;
      attempts++;
    } finally {
      if (attempts >= maxAttempts) latency?.stop();
    }
  }
}

// --- Tool Handlers ---

export async function getBybitEarnProducts(args: any) {
  const params: Record<string, any> = {};
  if (args.category) params.category = args.category;
  if (args.coin) params.coin = args.coin.toUpperCase();

  // Route FixedSaving queries to the dedicated fixed-term endpoint, and others to standard /v5/earn/product
  const path = args.category === 'FixedSaving'
    ? '/v5/earn/fixed-term/product'
    : '/v5/earn/product';

  if (args.category === 'FixedSaving') {
    delete params.category;
  }

  const data = await callBybitV5Earn(path, false, params, null);
  return { provider: 'bybit', data };
}

export async function getBybitEarnPosition(userId: string | null, args: any) {
  const coin = args.coin ? args.coin.toUpperCase() : undefined;
  const requestedCategory = args.category;

  // Bybit V5 splits Earn positions across two distinct endpoints:
  // 1. /v5/earn/fixed-term/position for Fixed Term (FixedSaving) positions.
  // 2. /v5/earn/position for FlexibleSaving and OnChain positions.
  const categoriesToFetch = requestedCategory && requestedCategory !== 'ALL'
    ? [requestedCategory]
    : ['FlexibleSaving', 'FixedSaving', 'OnChain'];

  const results: Record<string, any> = {};

  await Promise.all(
    categoriesToFetch.map(async (cat) => {
      try {
        const params: Record<string, any> = {};
        if (coin) params.coin = coin;

        if (cat === 'FixedSaving') {
          // FixedSaving products are stored in the dedicated fixed-term endpoint
          const res = await callBybitV5Earn('/v5/earn/fixed-term/position', true, params, userId);
          results[cat] = res?.list || [];
        } else {
          // FlexibleSaving and OnChain products are stored in the regular position endpoint
          params.category = cat;
          const res = await callBybitV5Earn('/v5/earn/position', true, params, userId);
          results[cat] = res?.list || [];
        }
      } catch (err: any) {
        // Swallow 180001 (Invalid Parameter) errors to provide a smooth, error-free unified experience
        if (err.message.includes('180001') || err.message.includes('Invalid parameter')) {
          results[cat] = [];
        } else {
          throw err;
        }
      }
    })
  );

  return {
    provider: 'bybit',
    category: requestedCategory || 'ALL',
    positions: results,
  };
}

export async function getBinanceLockedEarnProducts(userId: string | null, args: any) {
  const exchange = await createExchange('binance', userId);
  if (typeof exchange.sapiGetSimpleEarnLockedList !== 'function') {
    throw new Error('CCXT Binance Simple Earn Locked List method not available on this instance.');
  }

  const params: Record<string, any> = {
    size: args.size || 10,
  };
  if (args.asset) params.asset = args.asset.toUpperCase();

  const data = await exchange.sapiGetSimpleEarnLockedList(params);
  return { provider: 'binance', data };
}

export async function getBinanceEarnPositions(userId: string | null, args: any) {
  const exchange = await createExchange('binance', userId);
  const type = args.type || 'ALL';
  
  const promises: Promise<any>[] = [];
  
  if (type === 'ALL' || type === 'FLEXIBLE') {
    if (typeof exchange.sapiGetSimpleEarnFlexiblePosition === 'function') {
      promises.push(exchange.sapiGetSimpleEarnFlexiblePosition());
    } else {
      promises.push(Promise.resolve({ rows: [] }));
    }
  }
  if (type === 'ALL' || type === 'LOCKED') {
    if (typeof exchange.sapiGetSimpleEarnLockedPosition === 'function') {
      promises.push(exchange.sapiGetSimpleEarnLockedPosition());
    } else {
      promises.push(Promise.resolve({ rows: [] }));
    }
  }

  const results = await Promise.all(promises);
  
  // Merge Flexible and Locked positions into a unified response
  return {
    provider: 'binance',
    type,
    flexiblePositions: type === 'ALL' || type === 'FLEXIBLE' ? results[0]?.rows || [] : [],
    lockedPositions: type === 'ALL' ? results[1]?.rows || [] : type === 'LOCKED' ? results[0]?.rows || [] : [],
  };
}

export async function getBinanceFlexibleEarnProducts(userId: string | null, args: any) {
  const exchange = await createExchange('binance', userId);
  if (typeof exchange.sapiGetSimpleEarnFlexibleList !== 'function') {
    throw new Error('CCXT Binance Simple Earn Flexible List method not available on this instance.');
  }

  const params: Record<string, any> = {
    size: args.size || 10,
  };
  if (args.asset) params.asset = args.asset.toUpperCase();

  const data = await exchange.sapiGetSimpleEarnFlexibleList(params);
  return { provider: 'binance', data };
}

export async function compareEarnOpportunities(userId: string | null, args: any) {
  const coin = args.coin ? args.coin.toUpperCase() : undefined;
  const limit = args.limit !== undefined ? Number(args.limit) : 5;

  let bybitFlexible: any[] = [];
  let bybitFixed: any[] = [];
  let binanceFlexible: any[] = [];
  let binanceLocked: any[] = [];

  // Concurrently fetch earn opportunities across both exchanges and swallow errors individually
  // to avoid breaking the tool if one of the providers is unauthenticated or temporarily fails
  await Promise.all([
    // 1. Bybit Flexible Products (Public endpoint, no auth required)
    (async () => {
      try {
        const res = await getBybitEarnProducts({ category: 'FlexibleSaving' });
        bybitFlexible = res?.data?.list || [];
      } catch (err) {
        console.error('Failed to fetch Bybit Flexible products:', err);
      }
    })(),

    // 2. Bybit Fixed Products (Public endpoint, no auth required)
    (async () => {
      try {
        const res = await getBybitEarnProducts({ category: 'FixedSaving' });
        bybitFixed = res?.data?.list || [];
      } catch (err) {
        console.error('Failed to fetch Bybit Fixed products:', err);
      }
    })(),

    // 3. Binance Flexible Products (Requires active connection)
    (async () => {
      try {
        const res = await getBinanceFlexibleEarnProducts(userId, { size: 100 });
        binanceFlexible = res?.data?.rows || [];
      } catch (err) {
        console.error('Failed to fetch Binance Flexible products:', err);
      }
    })(),

    // 4. Binance Locked Products (Requires active connection)
    (async () => {
      try {
        const res = await getBinanceLockedEarnProducts(userId, { size: 100 });
        binanceLocked = res?.data?.rows || [];
      } catch (err) {
        console.error('Failed to fetch Binance Locked products:', err);
      }
    })()
  ]);

  const normalized: any[] = [];

  // Normalize Bybit Flexible Savings
  for (const item of bybitFlexible) {
    if (!item.coin) continue;
    const apyStr = item.interestCoinApyList?.[0]?.apy || '0';
    normalized.push({
      exchange: 'bybit',
      coin: item.coin.toUpperCase(),
      apr: parseFloat(apyStr.replace('%', '')),
      category: 'FlexibleSaving',
      lockDays: 0,
      minAmount: parseFloat(item.minStakeAmount || '0'),
    });
  }

  // Normalize Bybit Fixed Term Savings (FixedSaving)
  for (const item of bybitFixed) {
    if (!item.coin) continue;
    const apyStr = item.interestCoinApyList?.[0]?.apy || '0';
    normalized.push({
      exchange: 'bybit',
      coin: item.coin.toUpperCase(),
      apr: parseFloat(apyStr.replace('%', '')),
      category: 'FixedSaving',
      lockDays: parseInt(item.duration) || 0,
      minAmount: parseFloat(item.minStakeAmount || '0'),
    });
  }

  // Normalize Binance Flexible Simple Earn products (latestAnnualPercentageRate is in decimal, e.g. 0.05 for 5%)
  for (const item of binanceFlexible) {
    const coinSymbol = item.asset;
    if (!coinSymbol) continue;
    normalized.push({
      exchange: 'binance',
      coin: coinSymbol.toUpperCase(),
      apr: parseFloat(item.latestAnnualPercentageRate || '0') * 100,
      category: 'FlexibleSaving',
      lockDays: 0,
      minAmount: parseFloat(item.minPurchaseAmount || '0'),
    });
  }

  // Normalize Binance Locked Simple Earn products (apr is in decimal, e.g. 1.2069 for 120.69%)
  for (const item of binanceLocked) {
    const coinSymbol = item.detail?.asset || item.asset;
    if (!coinSymbol) continue;
    normalized.push({
      exchange: 'binance',
      coin: coinSymbol.toUpperCase(),
      apr: parseFloat(item.detail?.apr || '0') * 100,
      category: 'FixedSaving',
      lockDays: parseInt(item.detail?.duration) || 0,
      minAmount: parseFloat(item.quota?.minimum || '0'),
    });
  }

  // Perform case-insensitive coin filtering locally to prevent Bybit V5 API 180001 validation failures
  let filtered = normalized;
  if (coin) {
    filtered = normalized.filter(item => item.coin === coin);
  }

  // Sort by APR descending
  filtered.sort((a, b) => b.apr - a.apr);

  // Take top limit results
  const result = filtered.slice(0, limit);

  return {
    coin: coin || 'ALL',
    limit,
    totalCount: filtered.length,
    opportunities: result,
  };
}
