import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  decrypt,
  encrypt,
  getTradeMcpResearchGuide,
  OBSERVABILITY_MCP_TOOL_NAMES,
  RAW_EXCHANGE_MCP_TOOL_NAMES,
  sanitizeFirestoreData,
  shouldIncludeTool,
  TRADEMCP_DOCS_TOOL_NAME,
} from './mcp';
import { buildCreateOrderRequest } from './mcpExchange';

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
  it('exposes raw Binance/Bybit exchange methods in every profile', () => {
    for (const toolName of RAW_EXCHANGE_MCP_TOOL_NAMES) {
      expect(shouldIncludeTool(toolName, 'safe_research')).toBe(true);
      expect(shouldIncludeTool(toolName, 'trading_review')).toBe(true);
      expect(shouldIncludeTool(toolName, 'full_access')).toBe(true);
    }
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
});
