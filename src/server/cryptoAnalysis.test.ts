import { describe, expect, it } from 'vitest';
import {
  buildCoinGeckoMarketsRequest,
  buildCoinGeckoPriceRequest,
  buildCryptoPanicNewsRequest,
  buildMessariResearchRequest,
  buildMessariTimeseriesRequest,
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
});
