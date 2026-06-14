import { describe, it, expect } from 'vitest';
import { resolveToolCallProvider } from './mcpServerFactory.js';
import { MARKET_DATA_MCP_TOOL_NAMES, OBSERVABILITY_MCP_TOOL_NAMES } from './mcpToolPolicy.js';

describe('resolveToolCallProvider', () => {
  describe('native exchange tools with provider arguments', () => {
    it('returns the provider when tool is call_exchange_method and provider is supported', () => {
      expect(resolveToolCallProvider('call_exchange_method', { provider: 'binance' })).toBe('binance');
      expect(resolveToolCallProvider('call_exchange_method', { provider: 'bybit' })).toBe('bybit');
    });

    it('returns the provider when tool is list_exchange_methods and provider is supported', () => {
      expect(resolveToolCallProvider('list_exchange_methods', { provider: 'binance' })).toBe('binance');
    });

    it('returns the provider when tool is create_trade_proposal and provider is supported', () => {
      expect(resolveToolCallProvider('create_trade_proposal', { provider: 'bybit' })).toBe('bybit');
    });
  });

  describe('native exchange tools with missing or unsupported provider arguments', () => {
    it('falls back to extracting provider from tool name if provider is missing', () => {
      expect(resolveToolCallProvider('call_exchange_method')).toBe('native');
      expect(resolveToolCallProvider('call_exchange_method', {})).toBe('native');
    });

    it('falls back to extracting provider from tool name if provider is unsupported', () => {
      expect(resolveToolCallProvider('call_exchange_method', { provider: 'kraken' })).toBe('native');
      expect(resolveToolCallProvider('list_exchange_methods', { provider: 'unsupported' })).toBe('native');
    });
  });

  describe('known static tool sets', () => {
    it('resolves Coingecko tools', () => {
      expect(resolveToolCallProvider('get_crypto_prices')).toBe('coingecko');
      expect(resolveToolCallProvider('get_crypto_trending')).toBe('coingecko');
    });

    it('resolves Binance tools', () => {
      expect(resolveToolCallProvider('get_binance_ticker')).toBe('binance');
      expect(resolveToolCallProvider('calculate_indicators')).toBe('binance');
    });

    it('resolves Cryptopanic tools', () => {
      expect(resolveToolCallProvider('get_crypto_news')).toBe('cryptopanic');
    });

    it('resolves Messari tools', () => {
      expect(resolveToolCallProvider('ask_messari_research')).toBe('messari');
    });

    it('resolves NewsAPI tools', () => {
      expect(resolveToolCallProvider('search_newsapi_articles')).toBe('newsapi');
    });

    it('resolves Taapi tools', () => {
      expect(resolveToolCallProvider('get_taapi_indicator')).toBe('taapi');
    });

    it('resolves MarketData tools', () => {
      // Pick the first tool from the set as an example if it's available, otherwise skip if empty, but we know it has elements
      const toolName = Array.from(MARKET_DATA_MCP_TOOL_NAMES)[0] || 'get_market_data';
      expect(resolveToolCallProvider(toolName)).toBe('marketdata');
    });

    it('resolves Observability tools', () => {
      const toolName = Array.from(OBSERVABILITY_MCP_TOOL_NAMES)[0] || 'get_observability_data';
      expect(resolveToolCallProvider(toolName)).toBe('observability');
    });

    it('resolves native standalone tools', () => {
      expect(resolveToolCallProvider('search')).toBe('native');
      expect(resolveToolCallProvider('fetch')).toBe('native');
      expect(resolveToolCallProvider('get_trademcp_research_guide')).toBe('native');
      expect(resolveToolCallProvider('get_account_summary')).toBe('native');
    });
  });

  describe('marketplace tools', () => {
    it('extracts server ID from marketplace tool names using TOOL_NAME_SEPARATOR (__)', () => {
      // Need to make sure the prefix is a valid McpMarketplaceServerId if the logic strictly checks for it.
      // E.g. 'brave' -> valid marketplace server id, let's look for valid ones or use a known one.
      // Usually "brave__local_search" works. Let's see if the isMcpMarketplaceServerId validates it strictly.
      expect(resolveToolCallProvider('crypto_com__some_tool')).toBe('crypto_com');
      expect(resolveToolCallProvider('coingecko_public__search')).toBe('coingecko_public');
    });
  });

  describe('unknown tools', () => {
    it('returns unknown for unrecognizable tool names', () => {
      expect(resolveToolCallProvider('some_made_up_tool')).toBe('unknown');
    });
  });
});
