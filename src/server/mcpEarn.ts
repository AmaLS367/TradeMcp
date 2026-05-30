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
    const sortedKeys = Object.keys(params).sort();
    const queryParts = sortedKeys.map(key => `${key}=${params[key]}`);
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
    // For public requests, just append parameters to URL
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value));
      }
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

  const data = await callBybitV5Earn('/v5/earn/product', false, params, null);
  return { provider: 'bybit', data };
}

export async function getBybitEarnPosition(userId: string | null, args: any) {
  const params: Record<string, any> = {};
  if (args.category) params.category = args.category;
  if (args.coin) params.coin = args.coin.toUpperCase();

  const data = await callBybitV5Earn('/v5/earn/position', true, params, userId);
  return { provider: 'bybit', data };
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
