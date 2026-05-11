import { recordProviderLatency } from './providerLatency.js';

const OANDA_INTERVALS: Record<string, string> = {
  '5s': 'S5',
  '10s': 'S10',
  '15s': 'S15',
  '30s': 'S30',
  '1m': 'M1',
  '1min': 'M1',
  '2m': 'M2',
  '2min': 'M2',
  '4m': 'M4',
  '4min': 'M4',
  '5m': 'M5',
  '5min': 'M5',
  '10m': 'M10',
  '10min': 'M10',
  '15m': 'M15',
  '15min': 'M15',
  '30m': 'M30',
  '30min': 'M30',
  '1h': 'H1',
  '1hour': 'H1',
  '2h': 'H2',
  '3h': 'H3',
  '4h': 'H4',
  '6h': 'H6',
  '8h': 'H8',
  '12h': 'H12',
  '1d': 'D',
  '1day': 'D',
  '1w': 'W',
  '1week': 'W',
};

const TWELVE_INTERVALS: Record<string, string> = {
  s5: '1min',
  s10: '1min',
  s15: '1min',
  s30: '1min',
  m1: '1min',
  m5: '5min',
  m15: '15min',
  m30: '30min',
  h1: '1h',
  h4: '4h',
  d: '1day',
  w: '1week',
};

export const SUPPORTED_TWELVE_INDICATORS = ['sma', 'ema', 'rsi', 'macd', 'bbands', 'atr', 'adx', 'stoch'] as const;

export type FxProvider = 'auto' | 'oanda' | 'twelve';
export type TechnicalIndicator = typeof SUPPORTED_TWELVE_INDICATORS[number];

export type OandaCredentials = {
  apiKey: string;
  accountId: string;
  baseUrl?: string;
};

export type TwelveDataCredentials = {
  apiKey: string;
  baseUrl?: string;
};

export type MarketDataCredentials = {
  oanda?: OandaCredentials;
  twelve_data?: TwelveDataCredentials;
};

export type FxQuoteArgs = {
  symbol: unknown;
  provider?: unknown;
};

export type FxCandlesArgs = {
  symbol: unknown;
  granularity?: unknown;
  interval?: unknown;
  count?: unknown;
  from?: unknown;
  to?: unknown;
  provider?: unknown;
};

export type TechnicalIndicatorArgs = {
  symbol: unknown;
  indicator: unknown;
  interval: unknown;
  time_period?: unknown;
  series_type?: unknown;
  outputsize?: unknown;
};

export function getTechnicalIndicatorCatalog() {
  const indicators = [
    { id: 'sma', label: 'Simple Moving Average', commonParams: ['time_period', 'series_type'] },
    { id: 'ema', label: 'Exponential Moving Average', commonParams: ['time_period', 'series_type'] },
    { id: 'rsi', label: 'Relative Strength Index', commonParams: ['time_period', 'series_type'] },
    { id: 'macd', label: 'Moving Average Convergence Divergence', commonParams: ['series_type'] },
    { id: 'bbands', label: 'Bollinger Bands', commonParams: ['time_period', 'series_type'] },
    { id: 'atr', label: 'Average True Range', commonParams: ['time_period'] },
    { id: 'adx', label: 'Average Directional Index', commonParams: ['time_period'] },
    { id: 'stoch', label: 'Stochastic Oscillator', commonParams: [] },
  ];

  return {
    tools: {
      get_technical_indicator: {
        provider: 'twelve',
        requiredDataProvider: 'twelve_data',
        assetClass: 'forex',
        symbolFormat: 'EUR/USD, EUR_USD, or EURUSD',
        requiredParams: ['symbol', 'indicator', 'interval'],
        optionalParams: ['time_period', 'series_type', 'outputsize'],
        intervals: ['1min', '5min', '15min', '30min', '1h', '4h', '1day', '1week'],
        indicators,
      },
      get_binance_klines: {
        provider: 'binance',
        assetClass: 'crypto',
        symbolFormat: 'BASE/QUOTE, for example BTC/USDT',
        note: 'Use this for raw crypto OHLCV candles when the user needs candle data directly.',
      },
      calculate_indicators: {
        provider: 'binance',
        source: 'local_calculation',
        assetClass: 'crypto',
        symbolFormat: 'BASE/QUOTE, for example AAVE/USDT or BTC/USDT',
        requiredParams: ['symbol', 'indicators'],
        optionalParams: ['interval', 'limit'],
        defaultInterval: '1h',
        intervals: ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '3d', '1w', '1M'],
        indicators: [
          { id: 'rsi', label: 'Relative Strength Index', commonParams: ['period'], defaults: { period: 14 } },
          { id: 'macd', label: 'Moving Average Convergence Divergence', commonParams: ['fastPeriod', 'slowPeriod', 'signalPeriod'], defaults: { fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 } },
        ],
        note: 'Preferred crypto indicator tool. Fetches Binance candles and calculates indicators inside TradeMCP, without TAAPI.IO or another paid provider.',
      },
      get_taapi_indicator: {
        provider: 'taapi',
        requiredDataProvider: 'taapi',
        assetClass: 'crypto',
        symbolFormat: 'BASE/QUOTE or compact BASEQUOTE, for example AAVE/USDT or AAVEUSDT',
        requiredParams: ['indicator', 'symbol'],
        optionalParams: ['exchange', 'interval', 'params'],
        defaultExchange: 'binance',
        defaultInterval: '1h',
        intervals: ['1m', '5m', '15m', '30m', '1h', '2h', '4h', '12h', '1d', '1w'],
        indicators,
        note: 'Generic TAAPI.IO direct endpoint. Pass any TAAPI indicator endpoint name and provider-specific params in params.',
      },
      get_taapi_bulk_indicators: {
        provider: 'taapi',
        requiredDataProvider: 'taapi',
        assetClass: 'crypto',
        symbolFormat: 'BASE/QUOTE or compact BASEQUOTE, for example AAVE/USDT or AAVEUSDT',
        requiredParams: ['symbol', 'indicators'],
        optionalParams: ['exchange', 'interval'],
        maxCalculations: 20,
        indicators,
        note: 'Use this when multiple indicators such as RSI and MACD are needed for the same pair/timeframe.',
      },
    },
    routing: [
      'For crypto RSI and MACD, prefer calculate_indicators. It is free and computes from Binance OHLCV inside TradeMCP.',
      'For crypto indicators that TradeMCP does not calculate locally yet, use get_binance_klines and compute from OHLCV or fall back to get_taapi_indicator/get_taapi_bulk_indicators only when the user has connected TAAPI.IO.',
      'For forex RSI, MACD, SMA, EMA, Bollinger Bands, ATR, ADX, or stochastic, call get_technical_indicator with a Twelve Data key.',
      'For current crypto price, liquidity, spread, or volume context, combine get_binance_ticker, get_binance_24h_stats, and get_binance_order_book.',
    ],
  };
}

export function normalizeFxSymbol(symbol: unknown) {
  if (typeof symbol !== 'string') {
    throw new Error('symbol must be a forex pair string');
  }

  const compact = symbol.trim().toUpperCase().replace(/[\s/_-]/g, '');
  if (!/^[A-Z]{6}$/.test(compact)) {
    throw new Error('symbol must be a 6-letter forex pair like EUR/USD, EUR_USD, or EURUSD');
  }

  const base = compact.slice(0, 3);
  const quote = compact.slice(3);
  return {
    base,
    quote,
    compact,
    slash: `${base}/${quote}`,
    oanda: `${base}_${quote}`,
    twelve: `${base}/${quote}`,
  };
}

export function normalizeProvider(provider: unknown, fallback: FxProvider): FxProvider {
  if (provider === undefined || provider === null || provider === '') {
    return fallback;
  }
  if (provider === 'auto' || provider === 'oanda' || provider === 'twelve') {
    return provider;
  }
  throw new Error('provider must be auto, oanda, or twelve');
}

export function normalizeOandaGranularity(interval: unknown) {
  if (typeof interval !== 'string' || !interval.trim()) {
    return 'M1';
  }

  const raw = interval.trim();
  const mapped = OANDA_INTERVALS[raw.toLowerCase()];
  return mapped || raw.toUpperCase();
}

export function normalizeTwelveInterval(interval: unknown) {
  if (typeof interval !== 'string' || !interval.trim()) {
    return '1min';
  }

  const raw = interval.trim();
  return TWELVE_INTERVALS[raw.toLowerCase()] || raw;
}

export function normalizePositiveInteger(value: unknown, fallback: number, max: number) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const numberValue = Number(value);
  if (!Number.isInteger(numberValue) || numberValue < 1) {
    throw new Error('count/outputsize must be a positive integer');
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
      throw new Error(`Provider request failed (${response.status}): ${JSON.stringify(payload)}`);
    }

    if (payload && typeof payload === 'object' && 'status' in payload && (payload as any).status === 'error') {
      throw new Error(`Provider request failed: ${JSON.stringify(payload)}`);
    }

    return payload;
  } finally {
    latency?.stop();
  }
}

function requireOandaCredentials(credentials?: OandaCredentials) {
  if (!credentials?.apiKey?.trim() || !credentials.accountId?.trim()) {
    throw new Error('Connect OANDA in the dashboard before using this tool');
  }
  return credentials;
}

function requireTwelveCredentials(credentials?: TwelveDataCredentials) {
  if (!credentials?.apiKey?.trim()) {
    throw new Error('Connect Twelve Data in the dashboard before using this tool');
  }
  return credentials;
}

export function buildOandaQuoteRequest(symbol: unknown, credentials?: OandaCredentials) {
  const resolved = requireOandaCredentials(credentials);
  const normalized = normalizeFxSymbol(symbol);
  const baseUrl = resolved.baseUrl?.trim() || 'https://api-fxpractice.oanda.com';
  const url = new URL(`/v3/accounts/${encodeURIComponent(resolved.accountId)}/pricing`, baseUrl);
  url.searchParams.set('instruments', normalized.oanda);

  return {
    url,
    init: ({
      headers: {
        Authorization: `Bearer ${resolved.apiKey}`,
        'Content-Type': 'application/json',
      },
    } satisfies RequestInit),
    normalized,
  };
}

export function buildOandaCandlesRequest(args: FxCandlesArgs, credentials?: OandaCredentials) {
  const resolved = requireOandaCredentials(credentials);
  const normalized = normalizeFxSymbol(args.symbol);
  const baseUrl = resolved.baseUrl?.trim() || 'https://api-fxpractice.oanda.com';
  const url = new URL(`/v3/instruments/${encodeURIComponent(normalized.oanda)}/candles`, baseUrl);
  url.searchParams.set('price', 'M');
  url.searchParams.set('granularity', normalizeOandaGranularity(args.granularity || args.interval));
  url.searchParams.set('count', String(normalizePositiveInteger(args.count, 100, 5000)));

  if (typeof args.from === 'string' && args.from.trim()) {
    url.searchParams.set('from', args.from.trim());
  }
  if (typeof args.to === 'string' && args.to.trim()) {
    url.searchParams.set('to', args.to.trim());
  }

  return {
    url,
    init: ({
      headers: {
        Authorization: `Bearer ${resolved.apiKey}`,
        'Content-Type': 'application/json',
      },
    } satisfies RequestInit),
    normalized,
  };
}

export function buildTwelveQuoteRequest(symbol: unknown, credentials?: TwelveDataCredentials) {
  const resolved = requireTwelveCredentials(credentials);
  const normalized = normalizeFxSymbol(symbol);
  const baseUrl = resolved.baseUrl?.trim() || 'https://api.twelvedata.com';
  const url = new URL('/quote', baseUrl);
  url.searchParams.set('symbol', normalized.twelve);
  url.searchParams.set('apikey', resolved.apiKey);

  return { url, normalized };
}

export function buildTwelveCandlesRequest(args: FxCandlesArgs, credentials?: TwelveDataCredentials) {
  const resolved = requireTwelveCredentials(credentials);
  const normalized = normalizeFxSymbol(args.symbol);
  const baseUrl = resolved.baseUrl?.trim() || 'https://api.twelvedata.com';
  const url = new URL('/time_series', baseUrl);
  url.searchParams.set('symbol', normalized.twelve);
  url.searchParams.set('interval', normalizeTwelveInterval(args.interval || args.granularity));
  url.searchParams.set('outputsize', String(normalizePositiveInteger(args.count, 100, 5000)));
  url.searchParams.set('apikey', resolved.apiKey);

  if (typeof args.from === 'string' && args.from.trim()) {
    url.searchParams.set('start_date', args.from.trim());
  }
  if (typeof args.to === 'string' && args.to.trim()) {
    url.searchParams.set('end_date', args.to.trim());
  }

  return { url, normalized };
}

export function buildTwelveIndicatorRequest(args: TechnicalIndicatorArgs, credentials?: TwelveDataCredentials) {
  const resolved = requireTwelveCredentials(credentials);
  const indicator = typeof args.indicator === 'string' ? args.indicator.trim().toLowerCase() : '';
  if (!SUPPORTED_TWELVE_INDICATORS.includes(indicator as TechnicalIndicator)) {
    throw new Error(`indicator must be one of: ${SUPPORTED_TWELVE_INDICATORS.join(', ')}`);
  }

  const normalized = normalizeFxSymbol(args.symbol);
  const baseUrl = resolved.baseUrl?.trim() || 'https://api.twelvedata.com';
  const url = new URL(`/${indicator}`, baseUrl);
  url.searchParams.set('symbol', normalized.twelve);
  url.searchParams.set('interval', normalizeTwelveInterval(args.interval));
  url.searchParams.set('apikey', resolved.apiKey);

  if (args.time_period !== undefined && args.time_period !== null && args.time_period !== '') {
    url.searchParams.set('time_period', String(normalizePositiveInteger(args.time_period, 14, 5000)));
  }
  if (typeof args.series_type === 'string' && args.series_type.trim()) {
    url.searchParams.set('series_type', args.series_type.trim());
  }
  if (args.outputsize !== undefined && args.outputsize !== null && args.outputsize !== '') {
    url.searchParams.set('outputsize', String(normalizePositiveInteger(args.outputsize, 30, 5000)));
  }

  return { url, indicator, normalized };
}

export async function getFxQuote(args: FxQuoteArgs, credentials: MarketDataCredentials) {
  const provider = normalizeProvider(args.provider, 'auto');

  if (provider === 'twelve') {
    const request = buildTwelveQuoteRequest(args.symbol, credentials.twelve_data);
    return { provider: 'twelve', symbol: request.normalized.slash, data: await fetchJson(request.url, undefined, 'twelve') };
  }

  try {
    const request = buildOandaQuoteRequest(args.symbol, credentials.oanda);
    return { provider: 'oanda', symbol: request.normalized.slash, data: await fetchJson(request.url, request.init, 'oanda') };
  } catch (error) {
    if (provider === 'oanda') {
      throw error;
    }
    const request = buildTwelveQuoteRequest(args.symbol, credentials.twelve_data);
    return {
      provider: 'twelve',
      symbol: request.normalized.slash,
      fallbackFrom: 'oanda',
      fallbackReason: error instanceof Error ? error.message : String(error),
      data: await fetchJson(request.url, undefined, 'twelve'),
    };
  }
}

export async function getFxCandles(args: FxCandlesArgs, credentials: MarketDataCredentials) {
  const provider = normalizeProvider(args.provider, 'oanda');

  if (provider === 'twelve') {
    const request = buildTwelveCandlesRequest(args, credentials.twelve_data);
    return { provider: 'twelve', symbol: request.normalized.slash, data: await fetchJson(request.url, undefined, 'twelve') };
  }

  try {
    const request = buildOandaCandlesRequest(args, credentials.oanda);
    return { provider: 'oanda', symbol: request.normalized.slash, data: await fetchJson(request.url, request.init, 'oanda') };
  } catch (error) {
    if (provider === 'oanda') {
      throw error;
    }
    const request = buildTwelveCandlesRequest(args, credentials.twelve_data);
    return {
      provider: 'twelve',
      symbol: request.normalized.slash,
      fallbackFrom: 'oanda',
      fallbackReason: error instanceof Error ? error.message : String(error),
      data: await fetchJson(request.url, undefined, 'twelve'),
    };
  }
}

export async function getTechnicalIndicator(args: TechnicalIndicatorArgs, credentials: MarketDataCredentials) {
  const request = buildTwelveIndicatorRequest(args, credentials.twelve_data);
  return {
    provider: 'twelve',
    indicator: request.indicator,
    symbol: request.normalized.slash,
    data: await fetchJson(request.url, undefined, 'twelve'),
  };
}
