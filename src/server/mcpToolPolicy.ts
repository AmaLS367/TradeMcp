import { CRYPTO_ANALYSIS_MCP_TOOL_NAMES } from './cryptoAnalysis.js';
import { TRADEMCP_DOCS_TOOL_NAME } from './tradeMcpResearchGuide.js';

export const MARKET_DATA_MCP_TOOL_NAMES = ['get_fx_quote', 'get_fx_candles', 'get_technical_indicator'] as const;
export const RAW_EXCHANGE_MCP_TOOL_NAMES = ['list_exchange_methods', 'call_exchange_method'] as const;
export const OBSERVABILITY_MCP_TOOL_NAMES = ['get_observability_metrics', 'get_observability_alerts'] as const;

const SAFE_RESEARCH_TOOL_NAMES = new Set([
  TRADEMCP_DOCS_TOOL_NAME,
  ...MARKET_DATA_MCP_TOOL_NAMES,
  ...CRYPTO_ANALYSIS_MCP_TOOL_NAMES,
  ...RAW_EXCHANGE_MCP_TOOL_NAMES,
  'search',
  'fetch',
]);

const TRADING_REVIEW_TOOL_NAMES = new Set([
  ...SAFE_RESEARCH_TOOL_NAMES,
  ...OBSERVABILITY_MCP_TOOL_NAMES,
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

export function isMarketplaceToolAllowed(_toolName: string, profile?: string): boolean {
  if (!profile || profile === 'full_access') return true;
  if (profile === 'trading_review') return true;
  if (profile === 'safe_research') return false;
  return true;
}
