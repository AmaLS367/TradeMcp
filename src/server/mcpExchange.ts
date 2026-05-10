import ccxt from 'ccxt';
import { decrypt } from './mcpCrypto.js';
import { db } from './mcpFirebase.js';

export const SUPPORTED_PROVIDERS = ['binance', 'bybit'] as const;
export type SupportedProvider = typeof SUPPORTED_PROVIDERS[number];

export type TradeProposalOrderInput = {
  provider: SupportedProvider;
  symbol: string;
  side: 'buy' | 'sell';
  orderType: 'market' | 'limit';
  quantity: number;
  price?: number;
  stopLoss?: number;
  takeProfit?: number;
  params?: Record<string, unknown>;
};

export type CreateOrderRequest = {
  symbol: string;
  type: 'market' | 'limit';
  side: 'buy' | 'sell';
  amount: number;
  price: number | undefined;
  params: Record<string, unknown>;
};

export function isSupportedProvider(provider: unknown): provider is typeof SUPPORTED_PROVIDERS[number] {
  return typeof provider === 'string' && (SUPPORTED_PROVIDERS as readonly string[]).includes(provider);
}

export function safeJson(value: unknown) {
  return JSON.stringify(value, (_key, item) => {
    if (typeof item === 'bigint') return item.toString();
    return item;
  }, 2);
}

export function trimToolText(text: string, maxChars = 60_000) {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n\n... truncated at ${maxChars} characters`;
}

export function buildCreateOrderRequest(proposal: TradeProposalOrderInput): CreateOrderRequest {
  if (proposal.orderType !== 'market' && proposal.orderType !== 'limit') {
    throw new Error('Invalid order type or missing price');
  }

  if (proposal.orderType === 'limit' && typeof proposal.price !== 'number') {
    throw new Error('Invalid order type or missing price');
  }

  const params: Record<string, unknown> = (
    proposal.params &&
    typeof proposal.params === 'object' &&
    !Array.isArray(proposal.params)
  )
    ? { ...proposal.params }
    : {};
  if (proposal.provider === 'bybit') {
    if (typeof proposal.stopLoss === 'number') {
      params.stopLoss = proposal.stopLoss;
    }
    if (typeof proposal.takeProfit === 'number') {
      params.takeProfit = proposal.takeProfit;
    }
  }

  return {
    symbol: proposal.symbol,
    type: proposal.orderType,
    side: proposal.side,
    amount: proposal.quantity,
    price: proposal.orderType === 'limit' ? proposal.price : undefined,
    params,
  };
}

export function collectExchangeMethods(exchange: any) {
  const methods = new Set<string>();
  let current = exchange;
  while (current && current !== Object.prototype) {
    for (const name of Object.getOwnPropertyNames(current)) {
      if (name === 'constructor' || name.startsWith('_')) continue;
      if (typeof exchange[name] === 'function') {
        methods.add(name);
      }
    }
    current = Object.getPrototypeOf(current);
  }
  return Array.from(methods).sort();
}

export async function createExchange(provider: string, userId: string | null, options: Record<string, unknown> = {}) {
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

export function assertMethodCallable(exchange: any, method: unknown): asserts method is string {
  if (typeof method !== 'string' || !method.trim()) {
    throw new Error('method must be a non-empty string');
  }

  if (method.startsWith('_') || method === 'constructor' || typeof exchange[method] !== 'function') {
    throw new Error(`Unknown or unsupported exchange method: ${method}`);
  }
}
