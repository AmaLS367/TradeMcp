import { CRYPTO_ANALYSIS_MCP_TOOL_NAMES } from './cryptoAnalysis.js';
import { TRADEMCP_DOCS_TOOL_NAME } from './tradeMcpResearchGuide.js';

export const MARKET_DATA_MCP_TOOL_NAMES = ['get_fx_quote', 'get_fx_candles', 'get_technical_indicator', 'get_technical_indicator_catalog'] as const;
export const RAW_EXCHANGE_MCP_TOOL_NAMES = ['list_exchange_methods', 'call_exchange_method'] as const;
export const OBSERVABILITY_MCP_TOOL_NAMES = ['get_observability_metrics', 'get_observability_alerts'] as const;
export const EARN_PUBLIC_MCP_TOOL_NAMES = ['get_bybit_earn_products', 'get_binance_locked_earn_products'] as const;
export const EARN_PRIVATE_MCP_TOOL_NAMES = ['get_bybit_earn_position', 'get_binance_earn_positions'] as const;

const PUBLIC_RAW_EXCHANGE_METHOD_NAMES = new Set([
  'loadMarkets',
  'fetchMarkets',
  'fetchTicker',
  'fetchTickers',
  'fetchOrderBook',
  'fetchOHLCV',
  'fetchTrades',
  'fetchTime',
  'fetchStatus',
]);

const SAFE_RESEARCH_TOOL_NAMES = new Set([
  TRADEMCP_DOCS_TOOL_NAME,
  ...MARKET_DATA_MCP_TOOL_NAMES,
  ...CRYPTO_ANALYSIS_MCP_TOOL_NAMES,
  ...RAW_EXCHANGE_MCP_TOOL_NAMES,
  ...EARN_PUBLIC_MCP_TOOL_NAMES,
  'search',
  'fetch',
]);

const TRADING_REVIEW_TOOL_NAMES = new Set([
  ...SAFE_RESEARCH_TOOL_NAMES,
  ...OBSERVABILITY_MCP_TOOL_NAMES,
  ...EARN_PRIVATE_MCP_TOOL_NAMES,
  'get_account_summary',
  'create_trade_proposal',
]);

export function shouldIncludeTool(name: string, profile?: string): boolean {
  if ((RAW_EXCHANGE_MCP_TOOL_NAMES as readonly string[]).includes(name)) return true;
  if (!profile || profile === 'full_access') return true;
  if (profile === 'trading_review') return TRADING_REVIEW_TOOL_NAMES.has(name);
  if (profile === 'safe_research') return SAFE_RESEARCH_TOOL_NAMES.has(name);
  return true;
}

export function shouldAllowRawExchangeMethod(method: unknown, profile?: string): method is string {
  if (typeof method !== 'string' || !method.trim()) return false;
  if (!profile || profile === 'full_access') return true;
  if (method.startsWith('public')) return true;
  return PUBLIC_RAW_EXCHANGE_METHOD_NAMES.has(method);
}

export function filterRawExchangeMethodsForProfile(methods: readonly string[], profile?: string) {
  return methods.filter((method) => shouldAllowRawExchangeMethod(method, profile));
}

export function isMarketplaceToolAllowed(_toolName: string, profile?: string): boolean {
  if (!profile || profile === 'full_access') return true;
  if (profile === 'trading_review') return true;
  if (profile === 'safe_research') return false;
  return true;
}
