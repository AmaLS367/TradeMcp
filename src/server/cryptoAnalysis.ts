import { recordProviderLatency } from './providerLatency.js';

const COINGECKO_BASE_URLS = {
  demo: 'https://api.coingecko.com/api/v3',
  pro: 'https://pro-api.coingecko.com/api/v3',
} as const;

const BINANCE_KLINE_INTERVALS: Record<string, string> = {
  '1m': '1m',
  '3m': '3m',
  '5m': '5m',
  '15m': '15m',
  '30m': '30m',
  '1h': '1h',
  '1hour': '1h',
  '2h': '2h',
  '4h': '4h',
  '6h': '6h',
  '8h': '8h',
  '12h': '12h',
  '1d': '1d',
  '1day': '1d',
  '3d': '3d',
  '1w': '1w',
  '1week': '1w',
  '1M': '1M',
  '1month': '1M',
};

export const CRYPTO_ANALYSIS_MCP_TOOL_NAMES = [
  'get_crypto_prices',
  'get_crypto_markets',
  'get_crypto_market_chart',
  'get_crypto_trending',
  'get_binance_ticker',
  'get_binance_order_book',
  'get_binance_klines',
  'get_binance_24h_stats',
  'get_crypto_news',
  'ask_messari_research',
  'get_messari_timeseries_catalog',
  'get_messari_timeseries',
  'search_newsapi_articles',
  'get_newsapi_top_headlines',
  'get_newsapi_sources',
  'get_taapi_indicator',
  'get_taapi_bulk_indicators',
  'calculate_indicators',
] as const;

export type CoinGeckoCredentials = {
  apiKey: string;
  tier?: 'demo' | 'pro';
};

export type CryptoPanicCredentials = {
  apiKey: string;
  apiPlan?: string;
};

export type MessariCredentials = {
  apiKey: string;
};

export type NewsApiCredentials = {
  apiKey: string;
  baseUrl?: string;
};

export type TaapiCredentials = {
  apiKey: string;
  baseUrl?: string;
};

type PublicBinanceExchange = {
  fetchTicker(symbol: string): Promise<unknown>;
  fetchTickers(): Promise<unknown>;
  fetchOrderBook(symbol: string, limit?: number): Promise<unknown>;
  fetchOHLCV(symbol: string, timeframe?: string, since?: number, limit?: number): Promise<unknown>;
};

type LocalIndicatorName = 'rsi' | 'macd';

type NormalizedLocalIndicator = {
  id: string;
  indicator: LocalIndicatorName;
  period?: number;
  fastPeriod?: number;
  slowPeriod?: number;
  signalPeriod?: number;
};

type FetchInit = {
  headers?: Record<string, string>;
  method?: string;
  body?: string;
};

function requireString(value: unknown, name: string) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value.trim();
}

function setOptionalSearchParam(url: URL, name: string, value: unknown) {
  if (value === undefined || value === null || value === '') return;
  if (Array.isArray(value)) {
    const normalized = value.map((item) => String(item).trim()).filter(Boolean);
    if (normalized.length) url.searchParams.set(name, normalized.join(','));
    return;
  }
  const normalized = String(value).trim();
  if (normalized) url.searchParams.set(name, normalized);
}

function normalizeStringList(value: unknown, name: string, fallback?: string[]) {
  if (value === undefined || value === null || value === '') {
    if (fallback) return fallback;
    throw new Error(`${name} must be a non-empty string or string array`);
  }
  const list = Array.isArray(value)
    ? value
    : String(value).split(',');
  const normalized = list
    .map((item) => String(item).trim())
    .filter(Boolean);
  if (!normalized.length) {
    throw new Error(`${name} must be a non-empty string or string array`);
  }
  return normalized;
}

function normalizePositiveInteger(value: unknown, fallback: number, max: number) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const numberValue = Number(value);
  if (!Number.isInteger(numberValue) || numberValue < 1) {
    throw new Error('value must be a positive integer');
  }
  return Math.min(numberValue, max);
}

async function fetchJson(url: URL, init?: RequestInit, providerName?: string) {
  const latency = providerName ? recordProviderLatency(providerName, url.pathname) : null;
  try {
    const response = await fetch(url, init);
    const text = await response.text();
    let payload: unknown;
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = { raw: text };
    }

    if (!response.ok) {
      const details = typeof payload === 'object' && payload && 'error' in payload
        ? JSON.stringify((payload as { error: unknown }).error)
        : JSON.stringify(payload);
      throw new Error(`Provider request failed (${response.status}): ${details}`);
    }

    return payload;
  } finally {
    latency?.stop();
  }
}

function coingeckoAuth(credentials: CoinGeckoCredentials) {
  const tier = credentials.tier === 'pro' ? 'pro' : 'demo';
  return {
    baseUrl: COINGECKO_BASE_URLS[tier],
    headers: {
      [tier === 'pro' ? 'x-cg-pro-api-key' : 'x-cg-demo-api-key']: credentials.apiKey,
    },
  };
}

export function buildCoinGeckoPriceRequest(args: Record<string, unknown>, credentials: CoinGeckoCredentials) {
  const { baseUrl, headers } = coingeckoAuth(credentials);
  const url = new URL('/api/v3/simple/price', baseUrl);
  url.searchParams.set('ids', normalizeStringList(args.ids, 'ids').join(','));
  url.searchParams.set('vs_currencies', normalizeStringList(args.vs_currencies, 'vs_currencies', ['usd']).join(','));
  if (args.include_market_cap !== undefined) url.searchParams.set('include_market_cap', String(Boolean(args.include_market_cap)));
  if (args.include_24hr_vol !== undefined) url.searchParams.set('include_24hr_vol', String(Boolean(args.include_24hr_vol)));
  if (args.include_24hr_change !== undefined) url.searchParams.set('include_24hr_change', String(Boolean(args.include_24hr_change)));
  return { url, init: { headers } satisfies FetchInit };
}

export function buildCoinGeckoMarketsRequest(args: Record<string, unknown>, credentials: CoinGeckoCredentials) {
  const { baseUrl, headers } = coingeckoAuth(credentials);
  const url = new URL('/api/v3/coins/markets', baseUrl);
  url.searchParams.set('vs_currency', typeof args.vs_currency === 'string' && args.vs_currency.trim() ? args.vs_currency.trim() : 'usd');
  url.searchParams.set('order', typeof args.order === 'string' && args.order.trim() ? args.order.trim() : 'market_cap_desc');
  url.searchParams.set('per_page', String(normalizePositiveInteger(args.per_page, 100, 250)));
  url.searchParams.set('page', String(normalizePositiveInteger(args.page, 1, 1000)));
  if (typeof args.category === 'string' && args.category.trim()) url.searchParams.set('category', args.category.trim());
  if (typeof args.ids === 'string' && args.ids.trim()) url.searchParams.set('ids', args.ids.trim());
  return { url, init: { headers } satisfies FetchInit };
}

export function buildCoinGeckoMarketChartRequest(args: Record<string, unknown>, credentials: CoinGeckoCredentials) {
  const { baseUrl, headers } = coingeckoAuth(credentials);
  const id = requireString(args.id, 'id');
  const url = new URL(`/api/v3/coins/${encodeURIComponent(id)}/market_chart`, baseUrl);
  url.searchParams.set('vs_currency', typeof args.vs_currency === 'string' && args.vs_currency.trim() ? args.vs_currency.trim() : 'usd');
  url.searchParams.set('days', String(normalizePositiveInteger(args.days, 30, 3650)));
  if (typeof args.interval === 'string' && args.interval.trim()) url.searchParams.set('interval', args.interval.trim());
  return { url, init: { headers } satisfies FetchInit };
}

export function buildCoinGeckoTrendingRequest(credentials: CoinGeckoCredentials) {
  const { baseUrl, headers } = coingeckoAuth(credentials);
  return {
    url: new URL('/api/v3/search/trending', baseUrl),
    init: { headers } satisfies FetchInit,
  };
}

export async function getCoinGeckoPrices(args: Record<string, unknown>, credentials: CoinGeckoCredentials) {
  const request = buildCoinGeckoPriceRequest(args, credentials);
  return { provider: 'coingecko', data: await fetchJson(request.url, request.init, 'coingecko') };
}

export async function getCoinGeckoMarkets(args: Record<string, unknown>, credentials: CoinGeckoCredentials) {
  const request = buildCoinGeckoMarketsRequest(args, credentials);
  return { provider: 'coingecko', data: await fetchJson(request.url, request.init, 'coingecko') };
}

export async function getCoinGeckoMarketChart(args: Record<string, unknown>, credentials: CoinGeckoCredentials) {
  const request = buildCoinGeckoMarketChartRequest(args, credentials);
  return { provider: 'coingecko', data: await fetchJson(request.url, request.init, 'coingecko') };
}

export async function getCoinGeckoTrending(credentials: CoinGeckoCredentials) {
  const request = buildCoinGeckoTrendingRequest(credentials);
  return { provider: 'coingecko', data: await fetchJson(request.url, request.init, 'coingecko') };
}

export function normalizeBinanceKlineInterval(interval: unknown) {
  const raw = typeof interval === 'string' && interval.trim() ? interval.trim() : '1h';
  const normalized = BINANCE_KLINE_INTERVALS[raw];
  if (!normalized) {
    throw new Error(`interval must be one of: ${Object.keys(BINANCE_KLINE_INTERVALS).join(', ')}`);
  }
  return normalized;
}

export function normalizeBinanceDepthLimit(limit: unknown) {
  return normalizePositiveInteger(limit, 100, 5000);
}

export function normalizeCryptoPairSymbol(symbol: unknown) {
  const raw = requireString(symbol, 'symbol').toUpperCase().replace(/[\s_-]/g, '/');
  if (raw.includes('/')) {
    const [base, quote, ...rest] = raw.split('/').filter(Boolean);
    if (!base || !quote || rest.length) {
      throw new Error('symbol must be a crypto pair like AAVE/USDT or AAVEUSDT');
    }
    return `${base}/${quote}`;
  }

  const quote = ['USDT', 'USDC', 'USD', 'BTC', 'ETH', 'EUR'].find((item) => raw.endsWith(item));
  if (!quote || raw.length <= quote.length) {
    throw new Error('symbol must be a crypto pair like AAVE/USDT or AAVEUSDT');
  }
  return `${raw.slice(0, -quote.length)}/${quote}`;
}

function normalizeLocalIndicatorName(value: unknown): LocalIndicatorName {
  const indicator = requireString(value, 'indicator').toLowerCase();
  if (indicator !== 'rsi' && indicator !== 'macd') {
    throw new Error('indicator must be one of: rsi, macd');
  }
  return indicator;
}

function normalizeLocalIndicator(value: unknown): NormalizedLocalIndicator {
  if (typeof value === 'string') {
    const indicator = normalizeLocalIndicatorName(value);
    return { id: indicator, indicator };
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('indicators must contain strings or objects with an indicator field');
  }

  const input = value as Record<string, unknown>;
  const indicator = normalizeLocalIndicatorName(input.indicator);
  return {
    id: typeof input.id === 'string' && input.id.trim() ? input.id.trim() : indicator,
    indicator,
    period: input.period === undefined ? undefined : normalizePositiveInteger(input.period, 14, 5000),
    fastPeriod: input.fastPeriod === undefined ? undefined : normalizePositiveInteger(input.fastPeriod, 12, 5000),
    slowPeriod: input.slowPeriod === undefined ? undefined : normalizePositiveInteger(input.slowPeriod, 26, 5000),
    signalPeriod: input.signalPeriod === undefined ? undefined : normalizePositiveInteger(input.signalPeriod, 9, 5000),
  };
}

function normalizeLocalIndicators(value: unknown): NormalizedLocalIndicator[] {
  if (!Array.isArray(value) || !value.length) {
    throw new Error('indicators must be a non-empty array');
  }
  return value.map(normalizeLocalIndicator);
}

function normalizeClosePrices(candles: unknown): number[] {
  if (!Array.isArray(candles)) {
    throw new Error('Binance klines response must be an array');
  }

  return candles.map((candle, index) => {
    const close = Array.isArray(candle)
      ? candle[4]
      : candle && typeof candle === 'object'
        ? (candle as Record<string, unknown>).close
        : undefined;
    const value = Number(close);
    if (!Number.isFinite(value)) {
      throw new Error(`kline at index ${index} does not contain a numeric close price`);
    }
    return value;
  });
}

export function calculateRsi(closes: number[], period = 14) {
  if (closes.length < period + 1) {
    throw new Error(`RSI requires at least ${period + 1} close prices`);
  }

  const deltas = closes.slice(1).map((close, index) => close - closes[index]);
  const gains = deltas.map((delta) => (delta > 0 ? delta : 0));
  const losses = deltas.map((delta) => (delta < 0 ? -delta : 0));

  let avgGain = gains.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  let avgLoss = losses.slice(0, period).reduce((sum, value) => sum + value, 0) / period;

  for (let index = period; index < gains.length; index += 1) {
    avgGain = (avgGain * (period - 1) + gains[index]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[index]) / period;
  }

  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function calculateEmaSeries(values: number[], period: number) {
  if (!values.length) {
    throw new Error('EMA requires at least one value');
  }
  const smoothing = 2 / (period + 1);
  const result: number[] = [values[0]];
  for (const value of values.slice(1)) {
    result.push(value * smoothing + result[result.length - 1] * (1 - smoothing));
  }
  return result;
}

export function calculateMacd(closes: number[], fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
  if (fastPeriod >= slowPeriod) {
    throw new Error('MACD fastPeriod must be less than slowPeriod');
  }
  if (closes.length < slowPeriod + signalPeriod) {
    throw new Error(`MACD requires at least ${slowPeriod + signalPeriod} close prices`);
  }

  const fastEma = calculateEmaSeries(closes, fastPeriod);
  const slowEma = calculateEmaSeries(closes, slowPeriod);
  const macdSeries = fastEma.map((value, index) => value - slowEma[index]);
  const signalSeries = calculateEmaSeries(macdSeries, signalPeriod);
  const macd = macdSeries[macdSeries.length - 1];
  const signal = signalSeries[signalSeries.length - 1];

  return {
    macd,
    signal,
    histogram: macd - signal,
    fastPeriod,
    slowPeriod,
    signalPeriod,
  };
}

export async function getBinanceTicker(exchange: PublicBinanceExchange, args: Record<string, unknown>) {
  const symbol = requireString(args.symbol, 'symbol');
  return { provider: 'binance', symbol, data: await exchange.fetchTicker(symbol) };
}

export async function getBinanceOrderBook(exchange: PublicBinanceExchange, args: Record<string, unknown>) {
  const symbol = requireString(args.symbol, 'symbol');
  const limit = normalizeBinanceDepthLimit(args.limit);
  return { provider: 'binance', symbol, limit, data: await exchange.fetchOrderBook(symbol, limit) };
}

export async function getBinanceKlines(exchange: PublicBinanceExchange, args: Record<string, unknown>) {
  const symbol = requireString(args.symbol, 'symbol');
  const timeframe = normalizeBinanceKlineInterval(args.interval || args.timeframe);
  const limit = normalizePositiveInteger(args.limit, 100, 1000);
  return { provider: 'binance', symbol, interval: timeframe, data: await exchange.fetchOHLCV(symbol, timeframe, undefined, limit) };
}

export async function calculateTechnicalIndicators(exchange: PublicBinanceExchange, args: Record<string, unknown>) {
  const symbol = normalizeCryptoPairSymbol(args.symbol);
  const interval = normalizeBinanceKlineInterval(args.interval || args.timeframe);
  const indicators = normalizeLocalIndicators(args.indicators);
  const limit = normalizePositiveInteger(args.limit, 100, 1000);
  const candles = await exchange.fetchOHLCV(symbol, interval, undefined, limit);
  const closes = normalizeClosePrices(candles);
  const results: Record<string, unknown> = {};

  for (const item of indicators) {
    if (item.indicator === 'rsi') {
      const period = item.period ?? 14;
      const value = calculateRsi(closes, period);
      results[item.id] = {
        indicator: 'rsi',
        value,
        period,
        signal: value < 30 ? 'oversold' : value > 70 ? 'overbought' : 'neutral',
      };
      continue;
    }

    results[item.id] = {
      indicator: 'macd',
      ...calculateMacd(closes, item.fastPeriod ?? 12, item.slowPeriod ?? 26, item.signalPeriod ?? 9),
    };
  }

  return {
    provider: 'binance',
    source: 'local_calculation',
    symbol,
    interval,
    candleCount: closes.length,
    latestClose: closes[closes.length - 1],
    indicators: results,
  };
}

export async function getBinance24hStats(exchange: PublicBinanceExchange, args: Record<string, unknown>) {
  const symbol = typeof args.symbol === 'string' && args.symbol.trim() ? args.symbol.trim() : undefined;
  const data = symbol ? await exchange.fetchTicker(symbol) : await exchange.fetchTickers();
  return { provider: 'binance', symbol, data };
}

export function buildCryptoPanicNewsRequest(args: Record<string, unknown>, credentials: CryptoPanicCredentials) {
  const apiPlan = credentials.apiPlan?.trim() || 'free';
  const base = new URL(`/api/${encodeURIComponent(apiPlan)}/v2/posts/`, 'https://cryptopanic.com');
  base.searchParams.set('auth_token', credentials.apiKey);
  base.searchParams.set('kind', typeof args.kind === 'string' && args.kind.trim() ? args.kind.trim() : 'news');
  if (args.currencies !== undefined) base.searchParams.set('currencies', normalizeStringList(args.currencies, 'currencies').map((item) => item.toUpperCase()).join(','));
  if (args.regions !== undefined) base.searchParams.set('regions', normalizeStringList(args.regions, 'regions').join(','));
  if (typeof args.filter === 'string' && args.filter.trim()) base.searchParams.set('filter', args.filter.trim());
  if (typeof args.search === 'string' && args.search.trim()) base.searchParams.set('search', args.search.trim());
  if (args.public === true) base.searchParams.set('public', 'true');

  const pageCount = normalizePositiveInteger(args.num_pages, 1, 10);
  const pages = Array.from({ length: pageCount }, (_, index) => {
    const url = new URL(base.href);
    url.searchParams.set('page', String(index + 1));
    return url;
  });
  return { url: pages[0], pages, init: {} satisfies FetchInit };
}

export async function getCryptoPanicNews(args: Record<string, unknown>, credentials: CryptoPanicCredentials) {
  const request = buildCryptoPanicNewsRequest(args, credentials);
  const pages = await Promise.all(request.pages.map((url) => fetchJson(url, undefined, 'cryptopanic')));
  return { provider: 'cryptopanic', pages };
}

function newsApiAuth(credentials: NewsApiCredentials) {
  return {
    baseUrl: credentials.baseUrl?.trim() || 'https://newsapi.org',
    headers: { 'X-Api-Key': credentials.apiKey },
  };
}

function setOptionalNewsApiParam(url: URL, name: string, value: unknown) {
  if (value === undefined || value === null || value === '') return;
  if (Array.isArray(value)) {
    const normalized = value.map((item) => String(item).trim()).filter(Boolean);
    if (normalized.length) url.searchParams.set(name, normalized.join(','));
    return;
  }
  const normalized = String(value).trim();
  if (normalized) url.searchParams.set(name, normalized);
}

export function buildNewsApiEverythingRequest(args: Record<string, unknown>, credentials: NewsApiCredentials) {
  const { baseUrl, headers } = newsApiAuth(credentials);
  const url = new URL('/v2/everything', baseUrl);
  setOptionalNewsApiParam(url, 'q', args.q || args.query);
  setOptionalNewsApiParam(url, 'searchIn', args.searchIn);
  setOptionalNewsApiParam(url, 'sources', args.sources);
  setOptionalNewsApiParam(url, 'domains', args.domains);
  setOptionalNewsApiParam(url, 'excludeDomains', args.excludeDomains);
  setOptionalNewsApiParam(url, 'from', args.from);
  setOptionalNewsApiParam(url, 'to', args.to);
  setOptionalNewsApiParam(url, 'language', args.language);
  setOptionalNewsApiParam(url, 'sortBy', args.sortBy);
  url.searchParams.set('pageSize', String(normalizePositiveInteger(args.pageSize ?? args.page_size, 100, 100)));
  url.searchParams.set('page', String(normalizePositiveInteger(args.page, 1, 1000)));
  return { url, init: { headers } satisfies FetchInit };
}

export function buildNewsApiTopHeadlinesRequest(args: Record<string, unknown>, credentials: NewsApiCredentials) {
  const { baseUrl, headers } = newsApiAuth(credentials);
  const url = new URL('/v2/top-headlines', baseUrl);
  setOptionalNewsApiParam(url, 'country', args.country);
  setOptionalNewsApiParam(url, 'category', args.category);
  setOptionalNewsApiParam(url, 'sources', args.sources);
  setOptionalNewsApiParam(url, 'q', args.q || args.query);
  url.searchParams.set('pageSize', String(normalizePositiveInteger(args.pageSize ?? args.page_size, 20, 100)));
  url.searchParams.set('page', String(normalizePositiveInteger(args.page, 1, 1000)));
  return { url, init: { headers } satisfies FetchInit };
}

export function buildNewsApiSourcesRequest(args: Record<string, unknown>, credentials: NewsApiCredentials) {
  const { baseUrl, headers } = newsApiAuth(credentials);
  const url = new URL('/v2/top-headlines/sources', baseUrl);
  setOptionalNewsApiParam(url, 'category', args.category);
  setOptionalNewsApiParam(url, 'language', args.language);
  setOptionalNewsApiParam(url, 'country', args.country);
  return { url, init: { headers } satisfies FetchInit };
}

export async function searchNewsApiArticles(args: Record<string, unknown>, credentials: NewsApiCredentials) {
  const request = buildNewsApiEverythingRequest(args, credentials);
  return { provider: 'newsapi', data: await fetchJson(request.url, request.init, 'newsapi') };
}

export async function getNewsApiTopHeadlines(args: Record<string, unknown>, credentials: NewsApiCredentials) {
  const request = buildNewsApiTopHeadlinesRequest(args, credentials);
  return { provider: 'newsapi', data: await fetchJson(request.url, request.init, 'newsapi') };
}

export async function getNewsApiSources(args: Record<string, unknown>, credentials: NewsApiCredentials) {
  const request = buildNewsApiSourcesRequest(args, credentials);
  return { provider: 'newsapi', data: await fetchJson(request.url, request.init, 'newsapi') };
}

function taapiAuth(credentials: TaapiCredentials) {
  if (!credentials.apiKey?.trim()) {
    throw new Error('Connect TAAPI.IO in the dashboard before using this tool');
  }
  return {
    apiKey: credentials.apiKey.trim(),
    baseUrl: credentials.baseUrl?.trim() || 'https://api.taapi.io',
  };
}

export function normalizeTaapiSymbol(symbol: unknown) {
  return normalizeCryptoPairSymbol(symbol);
}

function normalizeTaapiExchange(exchange: unknown) {
  return typeof exchange === 'string' && exchange.trim() ? exchange.trim().toLowerCase() : 'binance';
}

function normalizeTaapiInterval(interval: unknown) {
  return typeof interval === 'string' && interval.trim() ? interval.trim() : '1h';
}

function normalizeTaapiIndicator(value: unknown) {
  const indicator = requireString(value, 'indicator').toLowerCase();
  if (!/^[a-z0-9_-]+$/.test(indicator)) {
    throw new Error('indicator must be a TAAPI endpoint name such as rsi, macd, ema, or supertrend');
  }
  return indicator;
}

function setTaapiParam(url: URL, name: string, value: unknown) {
  if (name === 'secret' || name === 'exchange' || name === 'symbol' || name === 'interval') return;
  setOptionalSearchParam(url, name, value);
}

export function buildTaapiIndicatorRequest(args: Record<string, unknown>, credentials: TaapiCredentials) {
  const { apiKey, baseUrl } = taapiAuth(credentials);
  const indicator = normalizeTaapiIndicator(args.indicator);
  const url = new URL(`/${indicator}`, baseUrl);
  url.searchParams.set('secret', apiKey);
  url.searchParams.set('exchange', normalizeTaapiExchange(args.exchange));
  url.searchParams.set('symbol', normalizeTaapiSymbol(args.symbol));
  url.searchParams.set('interval', normalizeTaapiInterval(args.interval));

  if (args.params && typeof args.params === 'object' && !Array.isArray(args.params)) {
    for (const [key, value] of Object.entries(args.params as Record<string, unknown>)) {
      setTaapiParam(url, key, value);
    }
  }

  for (const [key, value] of Object.entries(args)) {
    if (['indicator', 'exchange', 'symbol', 'interval', 'params'].includes(key)) continue;
    setTaapiParam(url, key, value);
  }

  return { url, indicator };
}

function normalizeTaapiIndicatorObject(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('indicators must contain objects with at least an indicator field');
  }
  const input = value as Record<string, unknown>;
  const indicator = normalizeTaapiIndicator(input.indicator);
  const output: Record<string, unknown> = {};
  for (const [key, fieldValue] of Object.entries(input)) {
    if (key === 'secret' || key === 'construct') continue;
    if (key === 'indicator') {
      output.indicator = indicator;
      continue;
    }
    if (fieldValue !== undefined && fieldValue !== null && fieldValue !== '') {
      output[key] = fieldValue;
    }
  }
  if (!('indicator' in output)) output.indicator = indicator;
  return output;
}

export function buildTaapiBulkIndicatorRequest(args: Record<string, unknown>, credentials: TaapiCredentials) {
  const { apiKey, baseUrl } = taapiAuth(credentials);
  if (!Array.isArray(args.indicators) || !args.indicators.length) {
    throw new Error('indicators must be a non-empty array');
  }
  if (args.indicators.length > 20) {
    throw new Error('TAAPI bulk requests support up to 20 indicator calculations');
  }

  const body = {
    secret: apiKey,
    construct: {
      exchange: normalizeTaapiExchange(args.exchange),
      symbol: normalizeTaapiSymbol(args.symbol),
      interval: normalizeTaapiInterval(args.interval),
      indicators: args.indicators.map(normalizeTaapiIndicatorObject),
    },
  };

  return {
    url: new URL('/bulk', baseUrl),
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    } satisfies FetchInit,
  };
}

export async function getTaapiIndicator(args: Record<string, unknown>, credentials: TaapiCredentials) {
  const request = buildTaapiIndicatorRequest(args, credentials);
  return { provider: 'taapi', indicator: request.indicator, data: await fetchJson(request.url, undefined, 'taapi') };
}

export async function getTaapiBulkIndicators(args: Record<string, unknown>, credentials: TaapiCredentials) {
  const request = buildTaapiBulkIndicatorRequest(args, credentials);
  return { provider: 'taapi', data: await fetchJson(request.url, request.init, 'taapi') };
}

export function buildMessariResearchRequest(args: Record<string, unknown>, credentials: MessariCredentials) {
  const question = requireString(args.question || args.query, 'question');
  return {
    url: new URL('/ai/v1/chat/completions', 'https://api.messari.io'),
    init: {
      method: 'POST',
      headers: {
        'x-messari-api-key': credentials.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: question }],
        verbosity: typeof args.verbosity === 'string' ? args.verbosity : 'succinct',
        response_format: typeof args.response_format === 'string' ? args.response_format : 'markdown',
      }),
    } satisfies FetchInit,
  };
}

export function buildMessariTimeseriesCatalogRequest(credentials: MessariCredentials) {
  return {
    url: new URL('/bulk/v1/datasets', 'https://api.messari.io'),
    init: {
      headers: { 'x-messari-api-key': credentials.apiKey },
    } satisfies FetchInit,
  };
}

export function buildMessariTimeseriesRequest(args: Record<string, unknown>, credentials: MessariCredentials) {
  const entityType = requireString(args.entityType, 'entityType');
  if (!['assets', 'markets', 'exchanges', 'networks'].includes(entityType)) {
    throw new Error('entityType must be assets, markets, exchanges, or networks');
  }
  const entityIdentifier = requireString(args.entityIdentifier, 'entityIdentifier');
  const datasetSlug = requireString(args.datasetSlug, 'datasetSlug');
  const url = new URL(`/metrics/v1/${entityType}/${encodeURIComponent(entityIdentifier)}/metrics/${encodeURIComponent(datasetSlug)}/time-series`, 'https://api.messari.io');
  if (typeof args.start === 'string' && args.start.trim()) url.searchParams.set('start', args.start.trim());
  if (typeof args.end === 'string' && args.end.trim()) url.searchParams.set('end', args.end.trim());
  if (typeof args.granularity === 'string' && args.granularity.trim()) url.searchParams.set('granularity', args.granularity.trim());
  return {
    url,
    init: {
      headers: { 'x-messari-api-key': credentials.apiKey },
    } satisfies FetchInit,
  };
}

export async function askMessariResearch(args: Record<string, unknown>, credentials: MessariCredentials) {
  const request = buildMessariResearchRequest(args, credentials);
  return { provider: 'messari', data: await fetchJson(request.url, request.init, 'messari') };
}

export async function getMessariTimeseriesCatalog(credentials: MessariCredentials) {
  const request = buildMessariTimeseriesCatalogRequest(credentials);
  return { provider: 'messari', data: await fetchJson(request.url, request.init, 'messari') };
}

export async function getMessariTimeseries(args: Record<string, unknown>, credentials: MessariCredentials) {
  const request = buildMessariTimeseriesRequest(args, credentials);
  return { provider: 'messari', data: await fetchJson(request.url, request.init, 'messari') };
}
