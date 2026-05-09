import ccxt from 'ccxt';
import { decrypt } from './mcpCrypto.js';
import { db } from './mcpFirebase.js';

export const SUPPORTED_PROVIDERS = ['binance', 'bybit'] as const;

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
