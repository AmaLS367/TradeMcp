import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildOandaCandlesRequest,
  buildOandaQuoteRequest,
  buildTwelveIndicatorRequest,
  getFxQuote,
  getTechnicalIndicatorCatalog,
  normalizeFxSymbol,
} from './marketData';
import { MARKET_DATA_MCP_TOOL_NAMES } from './mcp';

describe('market data helpers', () => {
  beforeEach(() => {
    vi.stubEnv('OANDA_API_KEY', 'oanda-token');
    vi.stubEnv('OANDA_ACCOUNT_ID', 'oanda-account');
    vi.stubEnv('OANDA_BASE_URL', 'https://api-fxpractice.oanda.com');
    vi.stubEnv('TWELVE_DATA_API_KEY', 'twelve-token');
    vi.stubEnv('TWELVE_DATA_BASE_URL', 'https://api.twelvedata.com');
  });

  it.each([
    ['EUR/USD'],
    ['EUR_USD'],
    ['EURUSD'],
  ])('normalizes %s to provider formats', (symbol) => {
    expect(normalizeFxSymbol(symbol)).toEqual({
      base: 'EUR',
      quote: 'USD',
      compact: 'EURUSD',
      slash: 'EUR/USD',
      oanda: 'EUR_USD',
      twelve: 'EUR/USD',
    });
  });

  it('rejects invalid symbols', () => {
    expect(() => normalizeFxSymbol('')).toThrow('symbol must be a 6-letter forex pair');
    expect(() => normalizeFxSymbol('EUR')).toThrow('symbol must be a 6-letter forex pair');
    expect(() => normalizeFxSymbol(null)).toThrow('symbol must be a forex pair string');
  });

  it('builds OANDA quote request with account path and bearer auth', () => {
    const request = buildOandaQuoteRequest('EUR/USD', {
      apiKey: 'user-oanda-token',
      accountId: 'user-oanda-account',
      baseUrl: 'https://api-fxpractice.oanda.com',
    });

    expect(request.url.href).toBe('https://api-fxpractice.oanda.com/v3/accounts/user-oanda-account/pricing?instruments=EUR_USD');
    expect((request.init.headers as Record<string, string>).Authorization).toBe('Bearer user-oanda-token');
  });

  it('builds OANDA candle request with normalized granularity', () => {
    const request = buildOandaCandlesRequest({ symbol: 'EURUSD', interval: '1min', count: 50 }, {
      apiKey: 'user-oanda-token',
      accountId: 'user-oanda-account',
      baseUrl: 'https://api-fxpractice.oanda.com',
    });

    expect(request.url.href).toBe('https://api-fxpractice.oanda.com/v3/instruments/EUR_USD/candles?price=M&granularity=M1&count=50');
    expect((request.init.headers as Record<string, string>).Authorization).toBe('Bearer user-oanda-token');
  });

  it('builds Twelve Data indicator request with apikey query param', () => {
    const request = buildTwelveIndicatorRequest({
      symbol: 'EUR_USD',
      indicator: 'rsi',
      interval: '1h',
      time_period: 14,
      series_type: 'close',
      outputsize: 30,
    }, {
      apiKey: 'user-twelve-token',
      baseUrl: 'https://api.twelvedata.com',
    });

    expect(request.url.href).toBe('https://api.twelvedata.com/rsi?symbol=EUR%2FUSD&interval=1h&apikey=user-twelve-token&time_period=14&series_type=close&outputsize=30');
  });

  it('does not fall back to system Twelve Data credentials when user credentials are missing', async () => {
    vi.stubEnv('TWELVE_DATA_API_KEY', 'system-twelve-token');

    await expect(getFxQuote({ symbol: 'EUR/USD', provider: 'twelve' }, {})).rejects.toThrow(
      'Connect Twelve Data in the dashboard before using this tool'
    );
  });

  it('exports market data MCP tool names', () => {
    expect(MARKET_DATA_MCP_TOOL_NAMES).toEqual([
      'get_fx_quote',
      'get_fx_candles',
      'get_technical_indicator',
      'get_technical_indicator_catalog',
    ]);
  });

  it('exposes a technical indicator catalog for MCP clients', () => {
    expect(getTechnicalIndicatorCatalog()).toMatchObject({
      tools: {
        get_technical_indicator: {
          provider: 'twelve',
          assetClass: 'forex',
          indicators: expect.arrayContaining([
            expect.objectContaining({ id: 'rsi', label: 'Relative Strength Index' }),
            expect.objectContaining({ id: 'macd', label: 'Moving Average Convergence Divergence' }),
          ]),
        },
        get_taapi_indicator: {
          provider: 'taapi',
          requiredDataProvider: 'taapi',
          assetClass: 'crypto',
          symbolFormat: 'BASE/QUOTE or compact BASEQUOTE, for example AAVE/USDT or AAVEUSDT',
        },
        calculate_indicators: {
          provider: 'binance',
          source: 'local_calculation',
          assetClass: 'crypto',
          indicators: expect.arrayContaining([
            expect.objectContaining({ id: 'rsi' }),
            expect.objectContaining({ id: 'macd' }),
          ]),
        },
        get_taapi_bulk_indicators: {
          provider: 'taapi',
          indicators: expect.arrayContaining([
            expect.objectContaining({ id: 'rsi' }),
            expect.objectContaining({ id: 'macd' }),
          ]),
        },
      },
      routing: expect.arrayContaining([
        expect.stringContaining('calculate_indicators'),
      ]),
    });
  });
});
