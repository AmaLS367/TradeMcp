import axios from 'axios';
import { z } from 'zod';

const STRATEGY_ENGINE_URL = process.env.STRATEGY_ENGINE_URL || 'http://127.0.0.1:8000';

export const ValidateStrategyResponseSchema = z.object({
  valid: z.boolean(),
  strategy_hash: z.string().nullable().optional(),
  strategy_class_name: z.string().nullable().optional(),
  errors: z.array(z.string()).default([]),
  detected_methods: z.array(z.string()).default([]),
  detected_hyperparameters: z.record(z.string(), z.any()).default({}),
});

export type ValidateStrategyResponse = z.infer<typeof ValidateStrategyResponseSchema>;

export const BacktestMetricsSchema = z.object({
  net_return: z.number(),
  sharpe: z.number(),
  sortino: z.number(),
  calmar: z.number(),
  max_drawdown: z.number(),
  win_rate: z.number(),
  profit_factor: z.number(),
  total_trades: z.number(),
  trades: z.array(z.record(z.string(), z.any())).default([]),
});

export const EquityPointSchema = z.object({
  timestamp: z.number(),
  equity: z.number(),
});

export const BacktestResponseSchema = z.object({
  run_hash: z.string(),
  strategy_hash: z.string(),
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
  start_date?: string;
  end_date?: string;
  initial_balance?: number;
  fee_rate?: number;
  candles?: number[][];
}

export class StrategyEngineClient {
  private baseUrl: string;

  constructor(baseUrl: string = STRATEGY_ENGINE_URL) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  async healthCheck(): Promise<{ status: string; service: string }> {
    const res = await axios.get(`${this.baseUrl}/health`, { timeout: 5000 });
    return res.data;
  }

  async validateStrategy(sourceCode: string): Promise<ValidateStrategyResponse> {
    const res = await axios.post(`${this.baseUrl}/api/v1/strategy/validate`, {
      source_code: sourceCode,
    }, { timeout: 10000 });

    return ValidateStrategyResponseSchema.parse(res.data);
  }

  async runBacktest(payload: BacktestRequestPayload): Promise<BacktestResponse> {
    const res = await axios.post(`${this.baseUrl}/api/v1/backtest`, {
      source_code: payload.source_code,
      parameters: payload.parameters || {},
      symbol: payload.symbol || 'BTC/USDT',
      timeframe: payload.timeframe || '1h',
      exchange: payload.exchange || 'Binance',
      start_date: payload.start_date || '2023-01-01',
      end_date: payload.end_date || '2024-01-01',
      initial_balance: payload.initial_balance ?? 10000.0,
      fee_rate: payload.fee_rate ?? 0.0006,
      candles: payload.candles,
    }, { timeout: 60000 });

    return BacktestResponseSchema.parse(res.data);
  }
}

export const strategyEngineClient = new StrategyEngineClient();
