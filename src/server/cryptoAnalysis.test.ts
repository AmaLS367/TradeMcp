import { describe, expect, it, vi } from 'vitest';
import {
  buildCoinGeckoMarketsRequest,
  buildCoinGeckoPriceRequest,
  buildCryptoPanicNewsRequest,
  buildMessariResearchRequest,
  buildMessariTimeseriesRequest,
  buildNewsApiEverythingRequest,
  buildNewsApiSourcesRequest,
  buildNewsApiTopHeadlinesRequest,
  calculateMacd,
  calculateRsi,
  calculateTechnicalIndicators,
  buildTaapiBulkIndicatorRequest,
  buildTaapiIndicatorRequest,
  normalizeTaapiSymbol,
  normalizeBinanceDepthLimit,
  normalizeBinanceKlineInterval,
} from './cryptoAnalysis';

describe('crypto analysis helpers', () => {
  it('builds CoinGecko demo price requests with demo auth header', () => {
    const request = buildCoinGeckoPriceRequest({
      ids: ['bitcoin', 'ethereum'],
      vs_currencies: ['usd', 'eur'],
    }, {
      apiKey: 'demo-key',
      tier: 'demo',
    });

    expect(request.url.href).toBe('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin%2Cethereum&vs_currencies=usd%2Ceur');
    expect(request.init.headers).toEqual({ 'x-cg-demo-api-key': 'demo-key' });
  });

  it('builds CoinGecko pro markets requests with pro auth header', () => {
    const request = buildCoinGeckoMarketsRequest({
      vs_currency: 'usd',
      category: 'layer-1',
      per_page: 50,
      page: 2,
    }, {
      apiKey: 'pro-key',
      tier: 'pro',
    });

    expect(request.url.href).toBe('https://pro-api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=50&page=2&category=layer-1');
    expect(request.init.headers).toEqual({ 'x-cg-pro-api-key': 'pro-key' });
  });

  it('normalizes Binance read-only market parameters', () => {
    expect(normalizeBinanceKlineInterval('1h')).toBe('1h');
    expect(normalizeBinanceKlineInterval('1hour')).toBe('1h');
    expect(normalizeBinanceDepthLimit(9999)).toBe(5000);
    expect(() => normalizeBinanceKlineInterval('13m')).toThrow('interval must be one of');
  });

  it('calculates RSI and MACD from close prices without an external indicator provider', () => {
    const closes = [
      100, 101, 102, 101, 103, 105, 104, 106, 108, 107,
      109, 111, 112, 110, 113, 115, 114, 116, 118, 117,
      119, 121, 120, 122, 124, 123, 125, 127, 126, 128,
      130, 129, 131, 133, 132,
    ];

    expect(calculateRsi(closes, 14)).toBeCloseTo(77.76, 2);
    expect(calculateMacd(closes)).toMatchObject({
      macd: expect.closeTo(6.00, 2),
      signal: expect.closeTo(5.62, 2),
      histogram: expect.closeTo(0.38, 2),
    });
  });

  it('fetches Binance klines and returns requested locally calculated indicators', async () => {
    const closes = [
      100, 101, 102, 101, 103, 105, 104, 106, 108, 107,
      109, 111, 112, 110, 113, 115, 114, 116, 118, 117,
      119, 121, 120, 122, 124, 123, 125, 127, 126, 128,
      130, 129, 131, 133, 132,
    ];
    const exchange = {
      fetchOHLCV: vi.fn(async () => closes.map((close, index) => [
        1710000000000 + index * 3600000,
        close - 1,
        close + 1,
        close - 2,
        close,
        1000 + index,
      ])),
    } as any;

    const result = await calculateTechnicalIndicators(exchange, {
      symbol: 'AAVE/USDT',
      interval: '1h',
      indicators: ['rsi', 'macd'],
    });

    expect(exchange.fetchOHLCV).toHaveBeenCalledWith('AAVE/USDT', '1h', undefined, 100);
    expect(result).toMatchObject({
      provider: 'binance',
      source: 'local_calculation',
      symbol: 'AAVE/USDT',
      interval: '1h',
      candleCount: closes.length,
      indicators: {
        rsi: {
          value: expect.closeTo(77.76, 2),
          signal: 'overbought',
        },
        macd: {
          macd: expect.closeTo(6.00, 2),
          signal: expect.closeTo(5.62, 2),
          histogram: expect.closeTo(0.38, 2),
        },
      },
    });
  });

  it('normalizes compact crypto symbols before local indicator calculation', async () => {
    const closes = Array.from({ length: 40 }, (_, index) => 100 + index);
    const exchange = {
      fetchOHLCV: vi.fn(async () => closes.map((close) => [1710000000000, close, close, close, close, 1000])),
    } as any;

    await calculateTechnicalIndicators(exchange, {
      symbol: 'AAVEUSDT',
      interval: '1h',
      indicators: ['rsi'],
    });

    expect(exchange.fetchOHLCV).toHaveBeenCalledWith('AAVE/USDT', '1h', undefined, 100);
  });

  it('builds CryptoPanic news requests with user token and filters', () => {
    const request = buildCryptoPanicNewsRequest({
      currencies: ['BTC', 'ETH'],
      kind: 'news',
      filter: 'bullish',
      regions: ['en'],
      num_pages: 3,
      public: true,
    }, {
      apiKey: 'panic-token',
      apiPlan: 'free',
    });

    expect(request.url.href).toBe('https://cryptopanic.com/api/free/v2/posts/?auth_token=panic-token&kind=news&currencies=BTC%2CETH&regions=en&filter=bullish&public=true&page=1');
    expect(request.pages).toHaveLength(3);
  });

  it('builds NewsAPI everything requests with X-Api-Key auth and search filters', () => {
    const request = buildNewsApiEverythingRequest({
      q: 'bitcoin ETF',
      searchIn: ['title', 'description'],
      language: 'en',
      sortBy: 'publishedAt',
      from: '2026-05-01',
      to: '2026-05-10',
      pageSize: 25,
      page: 2,
      domains: ['coindesk.com', 'cointelegraph.com'],
      excludeDomains: 'example.com',
    }, {
      apiKey: 'news-key',
      baseUrl: 'https://newsapi.org',
    });

    expect(request.url.href).toBe('https://newsapi.org/v2/everything?q=bitcoin+ETF&searchIn=title%2Cdescription&domains=coindesk.com%2Ccointelegraph.com&excludeDomains=example.com&from=2026-05-01&to=2026-05-10&language=en&sortBy=publishedAt&pageSize=25&page=2');
    expect(request.init.headers).toEqual({ 'X-Api-Key': 'news-key' });
  });

  it('builds NewsAPI top-headlines and sources requests', () => {
    const headlines = buildNewsApiTopHeadlinesRequest({
      q: 'ethereum',
      country: 'us',
      category: 'business',
      pageSize: 20,
    }, {
      apiKey: 'news-key',
      baseUrl: 'https://newsapi.org',
    });
    expect(headlines.url.href).toBe('https://newsapi.org/v2/top-headlines?country=us&category=business&q=ethereum&pageSize=20&page=1');
    expect(headlines.init.headers).toEqual({ 'X-Api-Key': 'news-key' });

    const sources = buildNewsApiSourcesRequest({
      language: 'en',
      category: 'business',
    }, {
      apiKey: 'news-key',
      baseUrl: 'https://newsapi.org',
    });
    expect(sources.url.href).toBe('https://newsapi.org/v2/top-headlines/sources?category=business&language=en');
    expect(sources.init.headers).toEqual({ 'X-Api-Key': 'news-key' });
  });

  it('builds Messari research and timeseries requests with x-messari-api-key', () => {
    const research = buildMessariResearchRequest({ question: 'Explain Solana fees' }, { apiKey: 'messari-key' });
    expect(research.url.href).toBe('https://api.messari.io/ai/v1/chat/completions');
    expect(research.init.headers).toMatchObject({ 'x-messari-api-key': 'messari-key' });

    const timeseries = buildMessariTimeseriesRequest({
      entityType: 'assets',
      entityIdentifier: 'bitcoin',
      datasetSlug: 'price',
      start: '2026-01-01',
      end: '2026-02-01',
    }, { apiKey: 'messari-key' });
    expect(timeseries.url.href).toBe('https://api.messari.io/metrics/v1/assets/bitcoin/metrics/price/time-series?start=2026-01-01&end=2026-02-01');
    expect(timeseries.init.headers).toMatchObject({ 'x-messari-api-key': 'messari-key' });
  });

  it('builds TAAPI direct indicator requests for slash or compact crypto symbols', () => {
    expect(normalizeTaapiSymbol('AAVEUSDT')).toBe('AAVE/USDT');

    const request = buildTaapiIndicatorRequest({
      indicator: 'rsi',
      exchange: 'bybit',
      symbol: 'AAVEUSDT',
      interval: '1h',
      params: {
        period: 14,
        backtrack: 1,
        addResultTimestamp: true,
      },
    }, {
      apiKey: 'taapi-secret',
      baseUrl: 'https://api.taapi.io',
    });

    expect(request.url.href).toBe('https://api.taapi.io/rsi?secret=taapi-secret&exchange=bybit&symbol=AAVE%2FUSDT&interval=1h&period=14&backtrack=1&addResultTimestamp=true');
  });

  it('builds TAAPI bulk requests for multiple indicators on one pair', () => {
    const request = buildTaapiBulkIndicatorRequest({
      exchange: 'binance',
      symbol: 'AAVE/USDT',
      interval: '4h',
      indicators: [
        { indicator: 'rsi', period: 14 },
        { id: 'macd-default', indicator: 'macd', backtrack: 1 },
      ],
    }, {
      apiKey: 'taapi-secret',
    });

    expect(request.url.href).toBe('https://api.taapi.io/bulk');
    expect(request.init).toEqual({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        secret: 'taapi-secret',
        construct: {
          exchange: 'binance',
          symbol: 'AAVE/USDT',
          interval: '4h',
          indicators: [
            { indicator: 'rsi', period: 14 },
            { id: 'macd-default', indicator: 'macd', backtrack: 1 },
          ],
        },
      }),
    });
  });
});
