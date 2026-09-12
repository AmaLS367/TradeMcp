import type { QuerySnapshot } from 'firebase-admin/firestore';
import { db } from './mcpFirebase.js';
import { planStrategyVersion, type VersionRef } from './strategyVersioning.js';

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

// Metrics the engine cannot compute (e.g. Sharpe with no variance) are null,
// never 0: a fake zero is indistinguishable from a real result.
export interface StrategyRunMetrics {
  netProfitPercent: number | null;
  sharpeRatio: number | null;
  sortinoRatio: number | null;
  calmarRatio: number | null;
  maxDrawdownPercent: number | null;
  winRate: number | null;
  profitFactor: number | null;
  payoffRatio?: number | null;
  totalTrades: number;
  significancePValue?: number;
  monteCarloMedianSharpe?: number;
  monteCarloP5Drawdown?: number;
  riskOfRuinPercent?: number;
}

// Hashes come from the Python engine and are not computed here: two
// independent canonical-JSON implementations drifted apart (Python adds spaces
// after separators, JSON.stringify does not), so one input produced two hashes.
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
    datasetHash: string;
    warmupRows: number;
    tradingRows: number;
  };
  metrics: StrategyRunMetrics;
  equityCurve?: { timestamp_ms: number; equity: number }[];
  status: 'pending' | 'running' | 'completed' | 'failed';
  completedAt: number;
}

export interface RegisteredStrategyVersion {
  versionId: string;
  created: boolean;
}

function toVersionRefs(snap: QuerySnapshot): VersionRef[] {
  return snap.docs.map((doc) => ({
    versionId: doc.id,
    strategyHash: String(doc.get('strategyHash') ?? ''),
  }));
}

/**
 * Stores the strategy and one immutable version in a single transaction.
 * An identical strategyHash resolves to the version that already holds it;
 * anything else is created as the next vN and never overwrites another one.
 */
export async function registerStrategyVersion(
  userId: string,
  strategy: Pick<StrategyDoc, 'id' | 'name' | 'description' | 'tags'>,
  version: Pick<StrategyVersionDoc, 'strategyHash' | 'sourceCode' | 'parameters'>,
): Promise<RegisteredStrategyVersion> {
  const strategyRef = db.collection('users').doc(userId).collection('strategies').doc(strategy.id);
  const versionsRef = strategyRef.collection('versions');

  return db.runTransaction(async (tx) => {
    const strategySnap = await tx.get(strategyRef);
    const plan = planStrategyVersion(toVersionRefs(await tx.get(versionsRef)), version.strategyHash);
    const now = Date.now();

    if (strategySnap.exists) {
      tx.update(strategyRef, {
        name: strategy.name,
        description: strategy.description,
        tags: strategy.tags,
        updatedAt: now,
      });
    } else {
      const doc: StrategyDoc = { ...strategy, authorId: userId, createdAt: now, updatedAt: now };
      tx.create(strategyRef, doc);
    }

    if (plan.kind === 'existing') return { versionId: plan.versionId, created: false };

    const doc: StrategyVersionDoc = {
      ...version,
      versionId: plan.versionId,
      strategyId: strategy.id,
      status: 'draft',
      createdAt: now,
    };
    tx.create(versionsRef.doc(plan.versionId), doc);
    return { versionId: plan.versionId, created: true };
  });
}

export async function listStrategyVersions(userId: string, strategyId: string): Promise<VersionRef[]> {
  const snap = await db
    .collection('users')
    .doc(userId)
    .collection('strategies')
    .doc(strategyId)
    .collection('versions')
    .get();
  return toVersionRefs(snap);
}

export async function getStrategyDoc(userId: string, strategyId: string): Promise<StrategyDoc | null> {
  const snap = await db.collection('users').doc(userId).collection('strategies').doc(strategyId).get();
  if (!snap.exists) return null;
  return snap.data() as StrategyDoc;
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
