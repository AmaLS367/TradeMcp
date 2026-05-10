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

type PublicBinanceExchange = {
  fetchTicker(symbol: string): Promise<unknown>;
  fetchTickers(): Promise<unknown>;
  fetchOrderBook(symbol: string, limit?: number): Promise<unknown>;
  fetchOHLCV(symbol: string, timeframe?: string, since?: number, limit?: number): Promise<unknown>;
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
