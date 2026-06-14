import { describe, it, expect } from 'vitest';
import { resolveToolCallProvider } from './mcpServerFactory';

describe('resolveToolCallProvider', () => {
    it('should correctly attribute exchange tools with supported providers', () => {
        expect(resolveToolCallProvider('call_exchange_method', { provider: 'binance' })).toBe('binance');
        expect(resolveToolCallProvider('list_exchange_methods', { provider: 'bybit' })).toBe('bybit');
        expect(resolveToolCallProvider('create_trade_proposal', { provider: 'binance' })).toBe('binance');
    });

    it('should fall back to extractProviderFromToolName when provider is not provided or unsupported', () => {
        expect(resolveToolCallProvider('call_exchange_method')).toBe('native');
        expect(resolveToolCallProvider('list_exchange_methods', { provider: 'unsupported' })).toBe('native');
        expect(resolveToolCallProvider('create_trade_proposal', { something: 'else' })).toBe('native');
    });

    it('should correctly attribute marketplace tools', () => {
        expect(resolveToolCallProvider('crypto_com__get_something')).toBe('crypto_com');
    });

    it('should correctly attribute coingecko tools', () => {
        expect(resolveToolCallProvider('get_crypto_prices')).toBe('coingecko');
        expect(resolveToolCallProvider('get_crypto_markets')).toBe('coingecko');
    });

    it('should correctly attribute binance tools', () => {
        expect(resolveToolCallProvider('get_binance_ticker')).toBe('binance');
        expect(resolveToolCallProvider('calculate_indicators')).toBe('binance');
    });

    it('should correctly attribute cryptopanic tools', () => {
        expect(resolveToolCallProvider('get_crypto_news')).toBe('cryptopanic');
    });

    it('should correctly attribute messari tools', () => {
        expect(resolveToolCallProvider('ask_messari_research')).toBe('messari');
    });

    it('should correctly attribute newsapi tools', () => {
        expect(resolveToolCallProvider('search_newsapi_articles')).toBe('newsapi');
    });

    it('should correctly attribute taapi tools', () => {
        expect(resolveToolCallProvider('get_taapi_indicator')).toBe('taapi');
    });

    it('should correctly attribute marketdata tools', () => {
        expect(resolveToolCallProvider('get_fx_quote')).toBe('marketdata');
    });

    it('should correctly attribute observability tools', () => {
        expect(resolveToolCallProvider('get_observability_metrics')).toBe('observability');
    });

    it('should correctly attribute native tools', () => {
        expect(resolveToolCallProvider('search')).toBe('native');
        expect(resolveToolCallProvider('fetch')).toBe('native');
        expect(resolveToolCallProvider('get_account_summary')).toBe('native');
        expect(resolveToolCallProvider('get_trademcp_research_guide')).toBe('native');
    });

    it('should fallback to unknown for unrecognized tools', () => {
        expect(resolveToolCallProvider('unknown_tool')).toBe('unknown');
    });
});
