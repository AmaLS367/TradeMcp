import axios from 'axios';
import { z } from 'zod';

const STRATEGY_ENGINE_URL = process.env.STRATEGY_ENGINE_URL || 'http://127.0.0.1:8000';
const STRATEGY_ENGINE_TOKEN = process.env.STRATEGY_ENGINE_TOKEN || '';
const HEALTH_TIMEOUT_MS = 5_000;
const VALIDATE_TIMEOUT_MS = 10_000;
const BACKTEST_TIMEOUT_MS = 300_000; // candle imports and long ranges take minutes

export const ValidateStrategyResponseSchema = z.object({
  valid: z.boolean(),
  strategy_hash: z.string().nullable().optional(),
  strategy_class_name: z.string().nullable().optional(),
  errors: z.array(z.string()).default([]),
  detected_methods: z.array(z.string()).default([]),
});

export type ValidateStrategyResponse = z.infer<typeof ValidateStrategyResponseSchema>;

// Metrics the engine cannot compute arrive as null, never as a fake 0.
export const BacktestMetricsSchema = z.object({
  net_return_percent: z.number().nullable(),
  sharpe: z.number().nullable(),
  sortino: z.number().nullable(),
  calmar: z.number().nullable(),
  omega: z.number().nullable(),
  max_drawdown_percent: z.number().nullable(),
  win_rate: z.number().nullable(),
  profit_factor: z.number().nullable(),
  payoff_ratio: z.number().nullable(),
  expectancy: z.number().nullable(),
  starting_balance: z.number().nullable(),
  finishing_balance: z.number().nullable(),
  total_trades: z.number(),
  winning_trades: z.number(),
  losing_trades: z.number(),
  longs_count: z.number(),
  shorts_count: z.number(),
});

export const DatasetSchema = z.object({
  exchange: z.string(),
  symbol: z.string(),
  timeframe: z.string(),
  start_ms: z.number(),
  finish_ms: z.number(),
  warmup_rows: z.number(),
  trading_rows: z.number(),
});

export const EquityPointSchema = z.object({
  timestamp_ms: z.number(),
  equity: z.number(),
});

export const BacktestResponseSchema = z.object({
  run_hash: z.string(),
  strategy_hash: z.string(),
  dataset_hash: z.string(),
  dataset: DatasetSchema,
  metrics: BacktestMetricsSchema,
  equity_curve: z.array(EquityPointSchema).default([]),
});

export type BacktestResponse = z.infer<typeof BacktestResponseSchema>;

export interface BacktestRequestPayload {
  source_code: string;
  parameters?: Record<string, unknown>;
  symbol?: string;
  timeframe?: string;
  exchange?: string;
  start_date: string;
  end_date: string;
  initial_balance?: number;
  fee_rate?: number;
  warmup_candles_num?: number;
}

export class StrategyEngineError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly errorType: string,
  ) {
    super(message);
    this.name = 'StrategyEngineError';
  }
}

function describeDetail(detail: unknown): string {
  if (typeof detail === 'string') return detail;
  if (!Array.isArray(detail)) return '';
  return detail
    .map((item) => {
      if (typeof item === 'string') return item;
      // FastAPI request-validation errors: { loc, msg, type }
      if (item && typeof item === 'object' && 'msg' in item) {
        const loc = Array.isArray((item as { loc?: unknown }).loc)
          ? `${(item as { loc: unknown[] }).loc.join('.')}: `
          : '';
        return `${loc}${String((item as { msg: unknown }).msg)}`;
      }
      return JSON.stringify(item);
    })
    .join('; ');
}

// Turns "Request failed with status code 409" into the engine's own reason,
// e.g. "Strategy engine DatasetUnavailable (409): candles for ... are unavailable".
function toEngineError(error: unknown): unknown {
  if (!axios.isAxiosError(error) || !error.response) return error;
  const { status, data } = error.response;
  const body = (data && typeof data === 'object' ? data : {}) as {
    error?: unknown;
    detail?: unknown;
    request_id?: unknown;
  };
  const errorType = typeof body.error === 'string' ? body.error : `HTTP ${status}`;
  const detail =
    describeDetail(body.detail) || (body.request_id ? `request_id=${String(body.request_id)}` : '');
  return new StrategyEngineError(
    `Strategy engine ${errorType} (${status})${detail ? `: ${detail}` : ''}`,
    status,
    errorType,
  );
}

export class StrategyEngineClient {
  private baseUrl: string;
  private token: string;

  constructor(baseUrl: string = STRATEGY_ENGINE_URL, token: string = STRATEGY_ENGINE_TOKEN) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.token = token;
  }

  private authHeaders(): Record<string, string> {
    return this.token ? { 'X-Engine-Token': this.token } : {};
  }

  async healthCheck(): Promise<{ status: string; service: string }> {
    try {
      const res = await axios.get(`${this.baseUrl}/health`, { timeout: HEALTH_TIMEOUT_MS });
      return res.data;
    } catch (error) {
      throw toEngineError(error);
    }
  }

  async validateStrategy(
    sourceCode: string,
    parameters: Record<string, unknown> = {},
  ): Promise<ValidateStrategyResponse> {
    try {
      const res = await axios.post(
        `${this.baseUrl}/api/v1/strategy/validate`,
        { source_code: sourceCode, parameters },
        { timeout: VALIDATE_TIMEOUT_MS, headers: this.authHeaders() },
      );
      return ValidateStrategyResponseSchema.parse(res.data);
    } catch (error) {
      throw toEngineError(error);
    }
  }

  async runBacktest(payload: BacktestRequestPayload): Promise<BacktestResponse> {
    try {
      const res = await axios.post(
        `${this.baseUrl}/api/v1/backtest`,
        {
          source_code: payload.source_code,
          parameters: payload.parameters || {},
          symbol: payload.symbol || 'BTC-USDT',
          timeframe: payload.timeframe || '1h',
          exchange: payload.exchange || 'Binance Perpetual Futures',
          start_date: payload.start_date,
          end_date: payload.end_date,
          initial_balance: payload.initial_balance ?? 10000.0,
          fee_rate: payload.fee_rate ?? 0.0006,
          warmup_candles_num: payload.warmup_candles_num ?? 210,
        },
        { timeout: BACKTEST_TIMEOUT_MS, headers: this.authHeaders() },
      );
      return BacktestResponseSchema.parse(res.data);
    } catch (error) {
      throw toEngineError(error);
    }
  }
}

export const strategyEngineClient = new StrategyEngineClient();
