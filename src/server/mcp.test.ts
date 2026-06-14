import { describe, it, expect, vi, beforeEach } from 'vitest';
import ccxt from 'ccxt';
import {
  decrypt,
  encrypt,
  getTradeMcpResearchGuide,
  OBSERVABILITY_MCP_TOOL_NAMES,
  RAW_EXCHANGE_MCP_TOOL_NAMES,
  resolveEffectiveMcpProfile,
  sanitizeFirestoreData,
  shouldIncludeTool,
  shouldAllowRawExchangeMethod,
  filterRawExchangeMethodsForProfile,
  TRADEMCP_DOCS_TOOL_NAME,
} from './mcp';
import { buildCreateOrderRequest, collectExchangeMethods } from './mcpExchange';
import { resolveToolCallProvider } from './mcpServerFactory';
import { collapseRecentOrderEvents } from './observability';

// Mock process.env
const ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

describe('Encryption Helpers', () => {
  beforeEach(() => {
    vi.stubEnv('ENCRYPTION_KEY', ENCRYPTION_KEY);
  });

  it('should encrypt and decrypt text correctly', () => {
    const text = 'hello-world-123';
    const encrypted = encrypt(text);
    
    expect(encrypted).toBeDefined();
    expect(typeof encrypted).toBe('string');
    expect(encrypted).toContain(':');
    
    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(text);
  });

  it('should produce different ciphertexts for the same input (due to IV)', () => {
    const text = 'constant-text';
    const encrypted1 = encrypt(text);
    const encrypted2 = encrypt(text);
    
    expect(encrypted1).not.toBe(encrypted2);
  });

  it('should throw error if ENCRYPTION_KEY is missing or invalid', () => {
    vi.stubEnv('ENCRYPTION_KEY', 'short-key');
    expect(() => encrypt('test')).toThrow('ENCRYPTION_KEY must be a 64-character hex string');
    
    vi.stubEnv('ENCRYPTION_KEY', '');
    expect(() => decrypt('iv:tag:data')).toThrow('ENCRYPTION_KEY must be a 64-character hex string');
  });

  it('should throw error for invalid ciphertext format', () => {
    expect(() => decrypt('invalidformat')).toThrow('Invalid ciphertext format');
    expect(() => decrypt('iv:tag')).toThrow('Invalid ciphertext format');
  });
});

describe('Firestore sanitization', () => {
  it('removes undefined values recursively before writes', () => {
    expect(sanitizeFirestoreData({
      client: {
        client_id: 'client-1',
        client_secret: undefined,
        redirect_uris: ['https://chatgpt.com/callback', undefined],
      },
      params: {
        state: undefined,
        resource: 'https://example.com/api/mcp/',
      },
      untouched: null,
    })).toEqual({
      client: {
        client_id: 'client-1',
        redirect_uris: ['https://chatgpt.com/callback'],
      },
      params: {
        resource: 'https://example.com/api/mcp/',
      },
      untouched: null,
    });
  });
});

describe('MCP profile tool visibility', () => {
  it('caps requested profiles by the API key access profile', () => {
    expect(resolveEffectiveMcpProfile(undefined, 'safe_research')).toBe('safe_research');
    expect(resolveEffectiveMcpProfile('full_access', 'trading_review')).toBe('trading_review');
    expect(resolveEffectiveMcpProfile('safe_research', 'trading_review')).toBe('safe_research');
    expect(resolveEffectiveMcpProfile('full_access', undefined)).toBe('full_access');
    expect(resolveEffectiveMcpProfile('unknown', 'safe_research')).toBe('safe_research');
  });

  it('exposes raw Binance/Bybit exchange methods in every profile', () => {
    for (const toolName of RAW_EXCHANGE_MCP_TOOL_NAMES) {
      expect(shouldIncludeTool(toolName, 'safe_research')).toBe(true);
      expect(shouldIncludeTool(toolName, 'trading_review')).toBe(true);
      expect(shouldIncludeTool(toolName, 'full_access')).toBe(true);
    }
  });

  it('limits raw exchange method calls to public read methods outside full access', () => {
    for (const profile of ['safe_research', 'trading_review'] as const) {
      expect(shouldAllowRawExchangeMethod('fetchTicker', profile)).toBe(true);
      expect(shouldAllowRawExchangeMethod('fetchOrderBook', profile)).toBe(true);
      expect(shouldAllowRawExchangeMethod('loadMarkets', profile)).toBe(true);
      expect(shouldAllowRawExchangeMethod('publicGetTicker24hr', profile)).toBe(true);
      expect(shouldAllowRawExchangeMethod('createOrder', profile)).toBe(false);
      expect(shouldAllowRawExchangeMethod('withdraw', profile)).toBe(false);
      expect(shouldAllowRawExchangeMethod('privatePostOrder', profile)).toBe(false);
      expect(shouldAllowRawExchangeMethod('privateGetAccount', profile)).toBe(false);
    }
  });

  it('keeps raw exchange method calls unrestricted for full access', () => {
    expect(shouldAllowRawExchangeMethod('createOrder', 'full_access')).toBe(true);
    expect(shouldAllowRawExchangeMethod('withdraw', 'full_access')).toBe(true);
    expect(shouldAllowRawExchangeMethod('privatePostOrder', 'full_access')).toBe(true);
  });

  it('filters listed raw exchange methods to callable methods for the active profile', () => {
    const methods = [
      'fetchTicker',
      'fetchOrderBook',
      'loadMarkets',
      'publicGetTicker24hr',
      'createOrder',
      'withdraw',
      'privatePostOrder',
    ];

    expect(filterRawExchangeMethodsForProfile(methods, 'safe_research')).toEqual([
      'fetchTicker',
      'fetchOrderBook',
      'loadMarkets',
      'publicGetTicker24hr',
    ]);
    expect(filterRawExchangeMethodsForProfile(methods, 'full_access')).toEqual(methods);
  });

  it('filters dangerous real CCXT methods out of safe research method lists', () => {
    const exchange = new ccxt.binance();
    const safeMethods = filterRawExchangeMethodsForProfile(collectExchangeMethods(exchange), 'safe_research');

    expect(safeMethods).toContain('fetchTicker');
    expect(safeMethods).not.toContain('createOrder');
    expect(safeMethods).not.toContain('withdraw');
    expect(safeMethods).not.toContain('privatePostOrder');
  });

  it('exposes TradeMCP research guide in safe research profiles', () => {
    expect(shouldIncludeTool(TRADEMCP_DOCS_TOOL_NAME, 'safe_research')).toBe(true);
    expect(shouldIncludeTool(TRADEMCP_DOCS_TOOL_NAME, 'trading_review')).toBe(true);
  });

  it('exposes observability tools to trading review and full access profiles only', () => {
    for (const toolName of OBSERVABILITY_MCP_TOOL_NAMES) {
      expect(shouldIncludeTool(toolName, 'safe_research')).toBe(false);
      expect(shouldIncludeTool(toolName, 'trading_review')).toBe(true);
      expect(shouldIncludeTool(toolName, 'full_access')).toBe(true);
    }
  });
});

describe('exchange order request builder', () => {
  it('passes Bybit stop-loss and take-profit proposal fields as createOrder params', () => {
    expect(buildCreateOrderRequest({
      provider: 'bybit',
      symbol: 'BTC/USDT',
      side: 'buy',
      orderType: 'limit',
      quantity: 0.01,
      price: 95000,
      stopLoss: 92500,
      takeProfit: 99000,
    })).toEqual({
      symbol: 'BTC/USDT',
      type: 'limit',
      side: 'buy',
      amount: 0.01,
      price: 95000,
      params: {
        stopLoss: 92500,
        takeProfit: 99000,
      },
    });
  });

  it('passes raw proposal params through to createOrder', () => {
    expect(buildCreateOrderRequest({
      provider: 'bybit',
      symbol: 'ETH/USDT',
      side: 'sell',
      orderType: 'market',
      quantity: 0.5,
      params: {
        category: 'linear',
        timeInForce: 'IOC',
        reduceOnly: true,
      },
    } as any).params).toEqual({
      category: 'linear',
      timeInForce: 'IOC',
      reduceOnly: true,
    });
  });
});

describe('observability normalization', () => {
  it('collapses order lifecycle events to the latest event per proposal', () => {
    expect(collapseRecentOrderEvents([
      {
        id: 'ondo-filled',
        proposalId: 'ondo-proposal',
        symbol: 'ONDO/USDT',
        side: 'buy',
        eventType: 'filled',
        status: 'executed',
        quantity: 72.9,
        price: 0.4113,
        timestamp: '2026-05-10T10:36:59.908Z',
      },
      {
        id: 'ondo-submitted',
        proposalId: 'ondo-proposal',
        symbol: 'ONDO/USDT',
        side: 'buy',
        eventType: 'submitted',
        status: 'executing',
        quantity: 72.9,
        price: 0.4113,
        timestamp: '2026-05-10T10:36:55.270Z',
      },
      {
        id: 'uni-filled',
        proposalId: 'uni-proposal',
        symbol: 'UNI/USDT',
        side: 'buy',
        eventType: 'filled',
        status: 'executed',
        quantity: 7.47,
        price: 4.018,
        timestamp: '2026-05-10T09:31:11.131Z',
      },
      {
        id: 'uni-submitted',
        proposalId: 'uni-proposal',
        symbol: 'UNI/USDT',
        side: 'buy',
        eventType: 'submitted',
        status: 'executing',
        quantity: 7.47,
        price: 4.018,
        timestamp: '2026-05-10T09:31:04.292Z',
      },
    ])).toEqual([
      expect.objectContaining({ id: 'ondo-filled', status: 'executed' }),
      expect.objectContaining({ id: 'uni-filled', status: 'executed' }),
    ]);
  });

  it('attributes raw exchange tools to the requested exchange provider', () => {
    expect(resolveToolCallProvider('call_exchange_method', { provider: 'bybit' })).toBe('bybit');
    expect(resolveToolCallProvider('list_exchange_methods', { provider: 'binance' })).toBe('binance');
  });

  it('attributes TAAPI indicator tools to the TAAPI provider', () => {
    expect(resolveToolCallProvider('get_taapi_indicator')).toBe('taapi');
    expect(resolveToolCallProvider('get_taapi_bulk_indicators')).toBe('taapi');
  });

  it('attributes locally calculated indicator tools to Binance', () => {
    expect(resolveToolCallProvider('calculate_indicators')).toBe('binance');
  });
});

describe('TradeMCP research guide', () => {
  it('documents fundamental-analysis source priority and data-gap rules', () => {
    expect(getTradeMcpResearchGuide('fundamental_crypto')).toMatchObject({
      role: expect.stringContaining('fundamental analyst'),
      recommendedToolsInOrder: expect.arrayContaining([
        expect.stringContaining('get_crypto_markets'),
        expect.stringContaining('ask_messari_research'),
      ]),
      outputFormat: {
        thesis: expect.any(String),
        bullCase: expect.any(String),
        bearCase: expect.any(String),
        scores: expect.any(Array),
        verdict: expect.any(String),
        dataGaps: expect.any(String),
      },
      rules: expect.arrayContaining([
        expect.stringContaining('Do not hallucinate unavailable metrics'),
        expect.stringContaining('Never analyze a cryptoasset in isolation'),
      ]),
    });
  });

  it('routes crypto technical analysis to local indicator calculation first', () => {
    expect(getTradeMcpResearchGuide('technical_crypto')).toMatchObject({
      workflow: expect.arrayContaining([
        expect.stringContaining('calculate_indicators'),
      ]),
      recommendedToolsInOrder: expect.arrayContaining([
        'calculate_indicators',
      ]),
    });
  });
});
