import crypto from 'crypto';
import { db } from './mcpFirebase.js';

export interface TakeProfitTarget {
  price: number;
  percentage: number; // 0.0 to 1.0 (portion of position)
}

export interface StrategyOrderIntent {
  strategyId: string;
  strategyVersion: string;
  strategyHash: string;
  runHash: string;
  sessionId: string;

  exchange: 'binance' | 'bybit';
  symbol: string;

  side: 'buy' | 'sell';
  type: 'market' | 'limit' | 'stop';

  quantity: number;
  price?: number;

  reduceOnly?: boolean;
  postOnly?: boolean;

  stopLoss?: number;
  takeProfits?: TakeProfitTarget[];

  generatedAt: number;        // Epoch timestamp (ms)
  candleTimestamp: number;    // Timestamp of the candle that generated the signal

  reason: {
    signal: string;           // Name of rule/method
    indicators: Record<string, number>;
  };
}

export interface StrategyDoc {
  id: string;
  name: string;
  description: string;
  authorId: string;
  currentLiveVersion?: string;
  currentPaperVersion?: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

export interface StrategyVersionDoc {
  versionId: string;
  strategyId: string;
  strategyHash: string;
  sourceCode: string;
  parameters: Record<string, unknown>;
  status: 'draft' | 'backtested' | 'validated' | 'paper' | 'live' | 'archived';
  createdAt: number;
}

export interface StrategyRunMetrics {
  netProfitPercent: number;
  sharpeRatio: number;
  sortinoRatio: number;
  calmarRatio: number;
  maxDrawdownPercent: number;
  winRate: number;
  profitFactor: number;
  totalTrades: number;
  significancePValue?: number;
  monteCarloMedianSharpe?: number;
  monteCarloP5Drawdown?: number;
  riskOfRuinPercent?: number;
}

export interface StrategyRunDoc {
  runId: string;
  strategyId: string;
  versionId: string;
  strategyHash: string;
  runHash: string;
  runType: 'train_backtest' | 'validation_backtest' | 'oos_backtest' | 'significance' | 'monte_carlo' | 'paper' | 'live';
  environment: {
    symbol: string;
    timeframe: string;
    startDate: string;
    endDate: string;
    feeRate: number;
    candlesCount: number;
  };
  metrics: StrategyRunMetrics;
  equityCurve?: { timestamp: number; equity: number }[];
  status: 'pending' | 'running' | 'completed' | 'failed';
  completedAt: number;
}

export function calculateStrategyHash(sourceCode: string, parameters: Record<string, unknown> = {}): string {
  const normalizedSource = sourceCode
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .join('\n');

  const sortedParams = JSON.stringify(parameters, Object.keys(parameters).sort());
  const payload = `${normalizedSource}::${sortedParams}`;
  return crypto.createHash('sha256').update(payload).digest('hex');
}

export interface RunHashParams {
  strategyHash: string;
  symbol: string;
  timeframe: string;
  startDate: string;
  endDate: string;
  feeRate: number;
  candlesCount: number;
}

export function calculateRunHash(params: RunHashParams): string {
  const payload = [
    params.strategyHash,
    params.symbol,
    params.timeframe,
    params.startDate,
    params.endDate,
    params.feeRate.toString(),
    params.candlesCount.toString(),
  ].join('::');

  return crypto.createHash('sha256').update(payload).digest('hex');
}

export async function saveStrategyDoc(userId: string, strategy: StrategyDoc): Promise<void> {
  await db.collection('users').doc(userId).collection('strategies').doc(strategy.id).set(strategy, { merge: true });
}

export async function getStrategyDoc(userId: string, strategyId: string): Promise<StrategyDoc | null> {
  const snap = await db.collection('users').doc(userId).collection('strategies').doc(strategyId).get();
  if (!snap.exists) return null;
  return snap.data() as StrategyDoc;
}

export async function saveStrategyVersion(
  userId: string,
  strategyId: string,
  version: StrategyVersionDoc
): Promise<void> {
  await db
    .collection('users')
    .doc(userId)
    .collection('strategies')
    .doc(strategyId)
    .collection('versions')
    .doc(version.versionId)
    .set(version);
}

export async function getStrategyVersion(
  userId: string,
  strategyId: string,
  versionId: string
): Promise<StrategyVersionDoc | null> {
  const snap = await db
    .collection('users')
    .doc(userId)
    .collection('strategies')
    .doc(strategyId)
    .collection('versions')
    .doc(versionId)
    .get();

  if (!snap.exists) return null;
  return snap.data() as StrategyVersionDoc;
}

export async function saveStrategyRun(
  userId: string,
  strategyId: string,
  versionId: string,
  run: StrategyRunDoc
): Promise<void> {
  await db
    .collection('users')
    .doc(userId)
    .collection('strategies')
    .doc(strategyId)
    .collection('versions')
    .doc(versionId)
    .collection('runs')
    .doc(run.runId)
    .set(run);
}

export async function getStrategyRun(
  userId: string,
  strategyId: string,
  versionId: string,
  runId: string
): Promise<StrategyRunDoc | null> {
  const snap = await db
    .collection('users')
    .doc(userId)
    .collection('strategies')
    .doc(strategyId)
    .collection('versions')
    .doc(versionId)
    .collection('runs')
    .doc(runId)
    .get();

  if (!snap.exists) return null;
  return snap.data() as StrategyRunDoc;
}
