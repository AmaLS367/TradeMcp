import { AxiosError, AxiosHeaders } from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('axios', async (importOriginal) => {
  const actual = await importOriginal<typeof import('axios')>();
  return {
    ...actual,
    default: { ...actual.default, get: vi.fn(), post: vi.fn(), isAxiosError: actual.default.isAxiosError },
  };
});

const axios = (await import('axios')).default as unknown as {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
};
const { StrategyEngineClient, StrategyEngineError } = await import('./strategyEngineClient.js');

const BACKTEST_RESPONSE = {
  run_hash: 'r'.repeat(64),
  strategy_hash: 's'.repeat(64),
  dataset_hash: 'd'.repeat(64),
  dataset: {
    exchange: 'Binance Perpetual Futures',
    symbol: 'BTC-USDT',
    timeframe: '1h',
    start_ms: 1672531200000,
    finish_ms: 1673740800000,
    warmup_rows: 12600,
    trading_rows: 20160,
  },
  metrics: {
    net_return_percent: 1.5,
    sharpe: null,
    sortino: null,
    calmar: null,
    omega: null,
    max_drawdown_percent: -0.4,
    win_rate: 0.5,
    profit_factor: null,
    payoff_ratio: null,
    expectancy: null,
    starting_balance: 10000,
    finishing_balance: 10150,
    total_trades: 14,
    winning_trades: 7,
    losing_trades: 7,
    longs_count: 14,
    shorts_count: 0,
  },
  equity_curve: [{ timestamp_ms: 1672531200000, equity: 10000 }],
};

function engineError(status: number, data: unknown): AxiosError {
  return new AxiosError('Request failed', 'ERR_BAD_RESPONSE', undefined, undefined, {
    status,
    statusText: '',
    headers: {},
    config: { headers: new AxiosHeaders() },
    data,
  });
}

describe('StrategyEngineClient', () => {
  beforeEach(() => {
    axios.get.mockReset();
    axios.post.mockReset();
  });

  it('sends the engine token and forwards parameters to validation', async () => {
    axios.post.mockResolvedValue({ data: { valid: true, strategy_hash: 'h'.repeat(64) } });
    const client = new StrategyEngineClient('http://engine/', 's3cret');

    await client.validateStrategy('code', { fast: 10 });

    const [url, body, config] = axios.post.mock.calls[0];
    expect(url).toBe('http://engine/api/v1/strategy/validate');
    expect(body).toEqual({ source_code: 'code', parameters: { fast: 10 } });
    expect(config.headers).toEqual({ 'X-Engine-Token': 's3cret' });
  });

  it('omits the token header when no token is configured', async () => {
    axios.post.mockResolvedValue({ data: BACKTEST_RESPONSE });
    const client = new StrategyEngineClient('http://engine', '');

    await client.runBacktest({ source_code: 'code', start_date: '2023-01-01', end_date: '2023-01-15' });

    expect(axios.post.mock.calls[0][2].headers).toEqual({});
  });

  it('keeps uncomputable metrics as null instead of zero', async () => {
    axios.post.mockResolvedValue({ data: BACKTEST_RESPONSE });
    const client = new StrategyEngineClient('http://engine', '');

    const result = await client.runBacktest({
      source_code: 'code',
      start_date: '2023-01-01',
      end_date: '2023-01-15',
    });

    expect(result.metrics.sharpe).toBeNull();
    expect(result.dataset_hash).toBe('d'.repeat(64));
    expect(result.dataset.trading_rows).toBe(20160);
  });

  it('surfaces the engine error type and detail', async () => {
    axios.post.mockRejectedValue(
      engineError(409, { error: 'DatasetUnavailable', detail: ['candles for NOSUCH-COIN are unavailable'] }),
    );
    const client = new StrategyEngineClient('http://engine', '');

    const failure = client.runBacktest({ source_code: 'code', start_date: '2023-01-01', end_date: '2023-01-15' });

    await expect(failure).rejects.toBeInstanceOf(StrategyEngineError);
    await expect(failure).rejects.toThrow(
      'Strategy engine DatasetUnavailable (409): candles for NOSUCH-COIN are unavailable',
    );
  });

  it('formats FastAPI request-validation errors', async () => {
    axios.post.mockRejectedValue(
      engineError(422, { detail: [{ loc: ['body', 'end_date'], msg: 'Field required', type: 'missing' }] }),
    );
    const client = new StrategyEngineClient('http://engine', '');

    await expect(
      client.runBacktest({ source_code: 'code', start_date: '2023-01-01', end_date: '' }),
    ).rejects.toThrow('Strategy engine HTTP 422 (422): body.end_date: Field required');
  });
});
