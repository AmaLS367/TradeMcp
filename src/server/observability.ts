import { Request } from 'express';
import crypto from 'crypto';
import admin from 'firebase-admin';
import { db } from './mcpFirebase';
import { logger } from './logger';

/* ------------------------------------------------------------------ */
/*  Client Type Detection                                              */
/* ------------------------------------------------------------------ */

export type ClientType = 'claude' | 'chatgpt' | 'gemini' | 'cursor' | 'continue' | 'unknown';

const CLIENT_PATTERNS: [RegExp, ClientType][] = [
  [/anthropic|claude/i, 'claude'],
  [/chatgpt|openai/i, 'chatgpt'],
  [/gemini/i, 'gemini'],
  [/cursor/i, 'cursor'],
  [/continue/i, 'continue'],
];

export function detectClientType(req: Request): ClientType {
  // 1. Explicit header
  const header = req.headers['x-client-type'] as string | undefined;
  if (header) {
    const lower = header.toLowerCase().trim();
    if (CLIENT_PATTERNS.some(([re]) => re.test(lower))) {
      return CLIENT_PATTERNS.find(([re]) => re.test(lower))![1];
    }
  }

  // 2. OAuth token extra params (client_id)
  const clientId = (req as any).oauthClientId as string | undefined;
  if (clientId) {
    const lower = clientId.toLowerCase();
    if (CLIENT_PATTERNS.some(([re]) => re.test(lower))) {
      return CLIENT_PATTERNS.find(([re]) => re.test(lower))![1];
    }
  }

  // 3. User-Agent
  const ua = (req.headers['user-agent'] || '') as string;
  if (ua) {
    for (const [re, type] of CLIENT_PATTERNS) {
      if (re.test(ua)) return type;
    }
  }

  // 4. Referer
  const referer = (req.headers['referer'] || '') as string;
  if (referer) {
    for (const [re, type] of CLIENT_PATTERNS) {
      if (re.test(referer)) return type;
    }
  }

  return 'unknown';
}

/* ------------------------------------------------------------------ */
/*  Tool Call Logging                                                  */
/* ------------------------------------------------------------------ */

export type LogToolCallParams = {
  userId: string;
  clientType: ClientType;
  toolName: string;
  provider?: string;
  latencyMs: number;
  status: 'success' | 'error';
  errorMessage?: string;
  profile: string;
};

export function logToolCall(params: LogToolCallParams) {
  const doc = {
    userId: params.userId,
    clientType: params.clientType,
    toolName: params.toolName,
    provider: params.provider || null,
    latencyMs: params.latencyMs,
    status: params.status,
    errorMessage: params.errorMessage || null,
    profile: params.profile,
    timestamp: new Date().toISOString(),
  };

  db.collection('tool_calls')
    .add(doc)
    .catch((err) => {
      logger.error({ err, toolName: params.toolName }, 'Failed to log tool call');
    });
}

/* ------------------------------------------------------------------ */
/*  Tool Metrics (aggregation)                                         */
/* ------------------------------------------------------------------ */

export type ToolMetrics = {
  totalCalls: number;
  successCount: number;
  errorCount: number;
  avgLatencyMs: number;
  topTools: { toolName: string; count: number }[];
  topProviders: { provider: string; count: number }[];
  dailyBreakdown: { date: string; count: number }[];
  clientDistribution: { clientType: string; count: number }[];
};

export async function getToolMetrics(userId: string, since?: Date): Promise<ToolMetrics> {
  let query: FirebaseFirestore.Query = db.collection('tool_calls')
    .where('userId', '==', userId)
    .orderBy('timestamp', 'desc');

  if (since) {
    query = query.where('timestamp', '>=', since.toISOString());
  }

  const snapshot = await query.get();

  const calls = snapshot.docs.map((d) => d.data());

  const totalCalls = calls.length;
  const successCount = calls.filter((c) => c.status === 'success').length;
  const errorCount = totalCalls - successCount;
  const totalLatency = calls.reduce((sum, c) => sum + (typeof c.latencyMs === 'number' ? c.latencyMs : 0), 0);
  const avgLatencyMs = totalCalls > 0 ? Math.round(totalLatency / totalCalls) : 0;

  // Top tools
  const toolCounts = new Map<string, number>();
  const providerCounts = new Map<string, number>();
  const dailyCounts = new Map<string, number>();
  const clientCounts = new Map<string, number>();

  for (const c of calls) {
    const toolName: string = c.toolName || 'unknown';
    toolCounts.set(toolName, (toolCounts.get(toolName) || 0) + 1);

    const provider: string = c.provider || 'native';
    providerCounts.set(provider, (providerCounts.get(provider) || 0) + 1);

    const date = (c.timestamp as string || '').slice(0, 10);
    if (date) {
      dailyCounts.set(date, (dailyCounts.get(date) || 0) + 1);
    }

    const clientType: string = c.clientType || 'unknown';
    clientCounts.set(clientType, (clientCounts.get(clientType) || 0) + 1);
  }

  const topTools = [...toolCounts.entries()]
    .map(([toolName, count]) => ({ toolName, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const topProviders = [...providerCounts.entries()]
    .map(([provider, count]) => ({ provider, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const dailyBreakdown = [...dailyCounts.entries()]
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const clientDistribution = [...clientCounts.entries()]
    .map(([clientType, count]) => ({ clientType, count }))
    .sort((a, b) => b.count - a.count);

  return {
    totalCalls,
    successCount,
    errorCount,
    avgLatencyMs,
    topTools,
    topProviders,
    dailyBreakdown,
    clientDistribution,
  };
}

/* ------------------------------------------------------------------ */
/*  Alerts                                                             */
/* ------------------------------------------------------------------ */

export type AlertType = 'provider_failure' | 'auth_error' | 'high_error_rate';
export type AlertSeverity = 'warning' | 'critical';

export type RecordAlertParams = {
  userId: string;
  type: AlertType;
  provider: string;
  toolName: string;
  message: string;
  severity: AlertSeverity;
};

function alertId(type: string, provider: string, date: string): string {
  return crypto.createHash('sha256').update(`${type}:${provider}:${date}`).digest('hex');
}

export async function recordAlert(params: RecordAlertParams) {
  const date = new Date().toISOString().slice(0, 10);
  const id = alertId(params.type, params.provider, date);

  try {
    await db.collection('alerts').doc(id).set(
      {
        userId: params.userId,
        type: params.type,
        provider: params.provider,
        toolName: params.toolName,
        message: params.message,
        severity: params.severity,
        count: admin.firestore.FieldValue.increment(1),
        lastOccurred: new Date().toISOString(),
        resolved: false,
        createdAt: new Date().toISOString(),
      },
      { merge: true }
    );
  } catch (err) {
    logger.error({ err, alertType: params.type, provider: params.provider }, 'Failed to record alert');
  }
}

/* ------------------------------------------------------------------ */
/*  Alert Condition Checking                                           */
/* ------------------------------------------------------------------ */

const consecutiveFailures = new Map<string, { count: number; firstFailureAt: number }>();

function checkConsecutiveFailures(
  userId: string,
  provider: string,
  toolName: string,
  status: 'success' | 'error'
) {
  const key = `${userId}:${provider}`;

  if (status === 'error') {
    const entry = consecutiveFailures.get(key) || { count: 0, firstFailureAt: Date.now() };
    entry.count++;
    entry.firstFailureAt ??= Date.now();
    consecutiveFailures.set(key, entry);

    if (entry.count > 3) {
      recordAlert({
        userId,
        type: 'provider_failure',
        provider,
        toolName,
        message: `Provider ${provider} has failed ${entry.count} consecutive times`,
        severity: 'critical',
      });
    }
  } else {
    consecutiveFailures.delete(key);
  }
}

/* Simple in-memory auth error counter with time window */
const authErrorCounts = new Map<string, { count: number; windowStart: number }>();

function checkAuthErrors(userId: string, toolName: string, status: 'success' | 'error', errorMessage?: string) {
  if (status !== 'error' || !errorMessage) return;

  const isAuthError =
    errorMessage.toLowerCase().includes('auth') ||
    errorMessage.toLowerCase().includes('unauthorized') ||
    errorMessage.toLowerCase().includes('forbidden') ||
    errorMessage.toLowerCase().includes('api key') ||
    errorMessage.toLowerCase().includes('401') ||
    errorMessage.toLowerCase().includes('403');

  if (!isAuthError) return;

  const key = `${userId}:auth`;
  const now = Date.now();
  const entry = authErrorCounts.get(key) || { count: 0, windowStart: now };

  // Reset window every 5 minutes
  if (now - entry.windowStart > 5 * 60 * 1000) {
    entry.count = 0;
    entry.windowStart = now;
  }

  entry.count++;
  authErrorCounts.set(key, entry);

  if (entry.count > 2) {
    recordAlert({
      userId,
      type: 'auth_error',
      provider: 'unknown',
      toolName,
      message: `Authentication errors: ${entry.count} in the last 5 minutes`,
      severity: 'critical',
    });
  }
}

/* In-memory high-latency counter with time window */
const highLatencyCounts = new Map<string, { count: number; windowStart: number }>();

function checkHighLatency(userId: string, provider: string, toolName: string, latencyMs: number) {
  if (latencyMs <= 10_000) return;

  const key = `${userId}:${provider}:latency`;
  const now = Date.now();
  const entry = highLatencyCounts.get(key) || { count: 0, windowStart: now };

  if (now - entry.windowStart > 5 * 60 * 1000) {
    entry.count = 0;
    entry.windowStart = now;
  }

  entry.count++;
  highLatencyCounts.set(key, entry);

  if (entry.count > 3) {
    recordAlert({
      userId,
      type: 'high_error_rate',
      provider,
      toolName,
      message: `High latency (>10s) for provider ${provider}: ${entry.count} occurrences in 5 minutes`,
      severity: 'warning',
    });
  }
}

export function checkAlertConditions(
  userId: string,
  toolName: string,
  provider: string | undefined,
  latencyMs: number,
  status: 'success' | 'error',
  errorMessage?: string
) {
  const p = provider || 'native';

  checkConsecutiveFailures(userId, p, toolName, status);
  checkAuthErrors(userId, toolName, status, errorMessage);
  checkHighLatency(userId, p, toolName, latencyMs);
}

/* ------------------------------------------------------------------ */
/*  Order Event Tracking                                               */
/* ------------------------------------------------------------------ */

export type OrderEventParams = {
  userId: string;
  proposalId: string;
  exchange: string;
  symbol: string;
  side: string;
  orderType: string;
  quantity: number;
  price?: number;
  eventType: 'submitted' | 'approved' | 'filled' | 'rejected' | 'canceled' | 'partially_filled' | 'expired';
  status: string;
};

export function recordOrderEvent(params: OrderEventParams) {
  const doc = {
    userId: params.userId,
    proposalId: params.proposalId,
    exchange: params.exchange,
    symbol: params.symbol,
    side: params.side,
    orderType: params.orderType,
    quantity: params.quantity,
    price: params.price || null,
    eventType: params.eventType,
    status: params.status,
    timestamp: new Date().toISOString(),
  };

  db.collection('order_events')
    .add(doc)
    .catch((err) => {
      logger.error(
        { err, proposalId: params.proposalId, eventType: params.eventType },
        'Failed to record order event'
      );
    });
}

