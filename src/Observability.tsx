import { useState, useEffect, useCallback } from 'react';
import { User } from 'firebase/auth';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '../components/ui/table';
import {
  BarChart3,
  Activity,
  AlertTriangle,
  Clock,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Zap,
  Wifi,
  UserCheck,
  Server,
  Globe,
  Wallet,
  ExternalLink,
} from 'lucide-react';

type MetricsData = {
  totalCalls: number;
  successCount: number;
  errorCount: number;
  averageLatency: number;
  topTools: Array<{ toolName: string; calls: number; avgLatency: number; errorRate: number; lastCalled: string }>;
  topProviders: Array<{ provider: string; avgLatency: number; totalCalls: number }>;
  dailyBreakdown: Array<{ date: string; calls: number; errors: number }>;
  clientDistribution: Array<{ clientType: string; calls: number }>;
  recentOrderEvents: Array<{
    id: string;
    symbol: string;
    side: string;
    eventType: string;
    status: string;
    quantity: number;
    price?: number;
    timestamp: string;
  }>;
};

type AlertData = {
  id: string;
  type: string;
  provider?: string;
  toolName?: string;
  message: string;
  severity: string;
  count: number;
  lastOccurred: string;
  resolved: boolean;
};

const emptyMetrics: MetricsData = {
  totalCalls: 0,
  successCount: 0,
  errorCount: 0,
  averageLatency: 0,
  topTools: [],
  topProviders: [],
  dailyBreakdown: [],
  clientDistribution: [],
  recentOrderEvents: [],
};

function numberOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function stringOrEmpty(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function normalizeMetrics(input: unknown): MetricsData {
  const data = input && typeof input === 'object' ? input as Record<string, any> : {};
  return {
    totalCalls: numberOrZero(data.totalCalls),
    successCount: numberOrZero(data.successCount),
    errorCount: numberOrZero(data.errorCount),
    averageLatency: numberOrZero(data.averageLatency ?? data.avgLatencyMs),
    topTools: Array.isArray(data.topTools)
      ? data.topTools.map((tool: Record<string, unknown>) => ({
        toolName: stringOrEmpty(tool.toolName) || 'unknown',
        calls: numberOrZero(tool.calls ?? tool.count),
        avgLatency: numberOrZero(tool.avgLatency),
        errorRate: numberOrZero(tool.errorRate),
        lastCalled: stringOrEmpty(tool.lastCalled),
      }))
      : [],
    topProviders: Array.isArray(data.topProviders)
      ? data.topProviders.map((provider: Record<string, unknown>) => ({
        provider: stringOrEmpty(provider.provider) || 'native',
        avgLatency: numberOrZero(provider.avgLatency),
        totalCalls: numberOrZero(provider.totalCalls ?? provider.count),
      }))
      : [],
    dailyBreakdown: Array.isArray(data.dailyBreakdown)
      ? data.dailyBreakdown.map((day: Record<string, unknown>) => ({
        date: stringOrEmpty(day.date),
        calls: numberOrZero(day.calls ?? day.count),
        errors: numberOrZero(day.errors),
      }))
      : [],
    clientDistribution: Array.isArray(data.clientDistribution)
      ? data.clientDistribution.map((client: Record<string, unknown>) => ({
        clientType: stringOrEmpty(client.clientType) || 'unknown',
        calls: numberOrZero(client.calls ?? client.count),
      }))
      : [],
    recentOrderEvents: Array.isArray(data.recentOrderEvents)
      ? data.recentOrderEvents.map((event: Record<string, unknown>) => ({
        id: stringOrEmpty(event.id),
        symbol: stringOrEmpty(event.symbol) || 'unknown',
        side: stringOrEmpty(event.side) || 'unknown',
        eventType: stringOrEmpty(event.eventType) || 'unknown',
        status: stringOrEmpty(event.status) || 'unknown',
        quantity: numberOrZero(event.quantity),
        price: typeof event.price === 'number' && Number.isFinite(event.price) ? event.price : undefined,
        timestamp: stringOrEmpty(event.timestamp),
      }))
      : [],
  };
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  subtext,
  color = 'text-primary',
  bgColor = 'bg-primary/10',
}: {
  icon: any;
  label: string;
  value: string | number;
  subtext?: string;
  color?: string;
  bgColor?: string;
}) {
  return (
    <Card className="glass-card border-none">
      <CardContent className="p-6">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
            <p className={`text-3xl font-black tracking-tight ${color}`}>{value}</p>
            {subtext && <p className="text-xs text-muted-foreground">{subtext}</p>}
          </div>
          <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${bgColor} ${color}`}>
            <Icon size={22} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { label: string; className: string }> = {
    filled: { label: 'Filled', className: 'bg-green-500/10 text-green-500 border-green-500/20' },
    executed: { label: 'Executed', className: 'bg-green-500/10 text-green-500 border-green-500/20' },
    rejected: { label: 'Rejected', className: 'bg-destructive/10 text-destructive border-destructive/20' },
    failed: { label: 'Failed', className: 'bg-destructive/10 text-destructive border-destructive/20' },
    submitted: { label: 'Submitted', className: 'bg-blue-500/10 text-blue-500 border-blue-500/20' },
    executing: { label: 'Executing', className: 'bg-blue-500/10 text-blue-500 border-blue-500/20 animate-pulse' },
    canceled: { label: 'Canceled', className: 'bg-orange-500/10 text-orange-500 border-orange-500/20' },
    cancelled: { label: 'Canceled', className: 'bg-orange-500/10 text-orange-500 border-orange-500/20' },
  };
  const c = config[status] || { label: status, className: 'bg-muted text-muted-foreground' };
  return <Badge variant="outline" className={c.className}>{c.label}</Badge>;
}

function SeverityBadge({ severity }: { severity: string }) {
  const config: Record<string, { className: string }> = {
    critical: { className: 'bg-destructive/10 text-destructive border-destructive/20' },
    warning: { className: 'bg-orange-500/10 text-orange-500 border-orange-500/20' },
  };
  const c = config[severity] || { className: 'bg-muted text-muted-foreground' };
  return <Badge variant="outline" className={c.className}>{severity}</Badge>;
}

function ProviderIcon({ provider }: { provider: string }) {
  const icons: Record<string, any> = {
    coingecko: Globe,
    binance: Wallet,
    cryptopanic: ExternalLink,
    messari: Server,
    oanda: Activity,
    twelve: Activity,
    marketdata: Activity,
    native: Zap,
  };
  const Icon = icons[provider] || Wifi;
  return <Icon size={14} className="text-muted-foreground" />;
}

export default function Observability({ user }: { user: User }) {
  const [metrics, setMetrics] = useState<MetricsData>(emptyMetrics);
  const [alerts, setAlerts] = useState<AlertData[]>([]);
  const [loading, setLoading] = useState(true);
  const [alertLoading, setAlertLoading] = useState(true);
  const [resolvingAlerts, setResolvingAlerts] = useState<Set<string>>(new Set());

  const loadMetrics = useCallback(async () => {
    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/mcp/observability/metrics', {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      if (!res.ok) throw new Error('Failed to load metrics');
      const data = await res.json();
      setMetrics(normalizeMetrics(data));
    } catch (err) {
      console.error('[Observability] Failed to load metrics:', err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  const loadAlerts = useCallback(async () => {
    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/mcp/observability/alerts', {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      if (!res.ok) throw new Error('Failed to load alerts');
      const data = await res.json();
      setAlerts(data.alerts || []);
    } catch (err) {
      console.error('[Observability] Failed to load alerts:', err);
    } finally {
      setAlertLoading(false);
    }
  }, [user]);

  const resolveAlert = async (alertId: string) => {
    setResolvingAlerts((prev) => new Set(prev).add(alertId));
    try {
      const idToken = await user.getIdToken();
      const res = await fetch(`/api/mcp/observability/alerts/${alertId}/resolve`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}` },
      });
      if (!res.ok) throw new Error('Failed to resolve alert');
      setAlerts((prev) => prev.filter((a) => a.id !== alertId));
    } catch (err) {
      console.error('[Observability] Failed to resolve alert:', err);
    } finally {
      setResolvingAlerts((prev) => {
        const next = new Set(prev);
        next.delete(alertId);
        return next;
      });
    }
  };

  useEffect(() => {
    loadMetrics();
    loadAlerts();
  }, [loadMetrics, loadAlerts]);

  const errorRate = metrics.totalCalls > 0
    ? ((metrics.errorCount / metrics.totalCalls) * 100).toFixed(1)
    : '0.0';

  const errorRateColor = Number(errorRate) < 5
    ? 'text-green-500'
    : Number(errorRate) < 15
    ? 'text-yellow-500'
    : 'text-destructive';

  return (
    <div className="space-y-8">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight mb-2">Observability</h2>
          <p className="text-muted-foreground">Real-time monitoring for MCP tool usage, provider latency, and system health</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" className="rounded-xl gap-2" onClick={() => { loadMetrics(); loadAlerts(); }} disabled={loading}>
            <RefreshCw size={16} /> Refresh
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <SummaryCard
          icon={BarChart3}
          label="Total Tool Calls (24h)"
          value={metrics.totalCalls.toLocaleString()}
          color="text-primary"
          bgColor="bg-primary/10"
        />
        <SummaryCard
          icon={AlertTriangle}
          label="Error Rate (24h)"
          value={`${errorRate}%`}
          subtext={`${metrics.errorCount} errors out of ${metrics.totalCalls} calls`}
          color={errorRateColor}
          bgColor="bg-destructive/10"
        />
        <SummaryCard
          icon={Clock}
          label="Avg Latency (24h)"
          value={`${metrics.averageLatency.toFixed(0)}ms`}
          color="text-blue-500"
          bgColor="bg-blue-500/10"
        />
        <SummaryCard
          icon={Activity}
          label="Active Alerts"
          value={alerts.length}
          color={alerts.length > 0 ? 'text-yellow-500' : 'text-green-500'}
          bgColor={alerts.length > 0 ? 'bg-yellow-500/10' : 'bg-green-500/10'}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Tool Usage Table */}
        <Card className="glass-card border-none lg:col-span-2">
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="p-2 bg-primary/10 rounded-lg">
                <BarChart3 size={18} className="text-primary" />
              </div>
              <CardTitle>Tool Usage</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            {metrics.topTools.length === 0 ? (
              <div className="py-8 text-center text-muted-foreground">
                <p>No tool calls recorded in the last 24 hours</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tool Name</TableHead>
                    <TableHead className="text-right">Calls</TableHead>
                    <TableHead className="text-right">Avg Latency</TableHead>
                    <TableHead className="text-right">Error Rate</TableHead>
                    <TableHead className="text-right">Last Called</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {metrics.topTools.map((tool) => (
                    <TableRow key={tool.toolName}>
                      <TableCell className="font-mono text-xs">{tool.toolName}</TableCell>
                      <TableCell className="text-right font-semibold">{tool.calls}</TableCell>
                      <TableCell className="text-right font-mono text-xs">{tool.avgLatency.toFixed(0)}ms</TableCell>
                      <TableCell className="text-right">
                        <span className={tool.errorRate > 15 ? 'text-destructive font-semibold' : tool.errorRate > 5 ? 'text-yellow-500' : 'text-green-500'}>
                          {tool.errorRate.toFixed(1)}%
                        </span>
                      </TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">{tool.lastCalled}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Client Distribution */}
        <Card className="glass-card border-none">
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="p-2 bg-violet-500/10 rounded-lg">
                <UserCheck size={18} className="text-violet-500" />
              </div>
              <CardTitle>Client Distribution</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            {metrics.clientDistribution.length === 0 ? (
              <div className="py-8 text-center text-muted-foreground">
                <p>No client data recorded</p>
              </div>
            ) : (
              <div className="space-y-4">
                {metrics.clientDistribution.map((client) => {
                  const maxCalls = Math.max(...metrics.clientDistribution.map((c) => c.calls));
                  const pct = maxCalls > 0 ? (client.calls / maxCalls) * 100 : 0;
                  return (
                    <div key={client.clientType}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium capitalize">{client.clientType.replace('_', ' ')}</span>
                        <span className="text-sm font-bold">{client.calls}</span>
                      </div>
                      <div className="h-2 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full bg-violet-500 rounded-full transition-all duration-500"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Provider Latency */}
      <Card className="glass-card border-none">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-500/10 rounded-lg">
              <Wifi size={18} className="text-blue-500" />
            </div>
            <CardTitle>Provider Latency</CardTitle>
            <CardDescription>Average response time by upstream provider</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {metrics.topProviders.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">
              <p>No provider latency data recorded</p>
            </div>
          ) : (
            <div className="space-y-4">
              {metrics.topProviders.map((provider) => {
                const maxLatency = Math.max(...metrics.topProviders.map((p) => p.avgLatency));
                const pct = maxLatency > 0 ? (provider.avgLatency / maxLatency) * 100 : 0;
                return (
                  <div key={provider.provider}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <ProviderIcon provider={provider.provider} />
                        <span className="text-sm font-medium capitalize">{provider.provider}</span>
                        <span className="text-xs text-muted-foreground">({provider.totalCalls} calls)</span>
                      </div>
                      <span className="text-sm font-mono font-bold">{provider.avgLatency.toFixed(0)}ms</span>
                    </div>
                    <div className="h-3 bg-muted rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${
                          provider.avgLatency > 5000 ? 'bg-destructive' : provider.avgLatency > 2000 ? 'bg-yellow-500' : 'bg-blue-500'
                        }`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Order Events Timeline */}
      <Card className="glass-card border-none">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-500/10 rounded-lg">
              <Activity size={18} className="text-emerald-500" />
            </div>
            <CardTitle>Order Events Timeline</CardTitle>
            <CardDescription>Real-time order lifecycle events</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {metrics.recentOrderEvents.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">
              <p>No order events recorded yet</p>
            </div>
          ) : (
            <div className="space-y-3">
              {metrics.recentOrderEvents.slice(0, 20).map((event) => (
                <div
                  key={event.id}
                  className="flex items-center gap-4 p-3 rounded-xl bg-muted/30 border border-border/40"
                >
                  <div className={`w-2 h-2 rounded-full shrink-0 ${
                    event.status === 'executed' || event.status === 'filled'
                      ? 'bg-green-500'
                      : event.status === 'rejected' || event.status === 'failed'
                      ? 'bg-destructive'
                      : 'bg-blue-500'
                  }`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm">{event.symbol}</span>
                      <span className={`text-xs font-semibold uppercase ${event.side === 'buy' ? 'text-green-500' : 'text-red-500'}`}>
                        {event.side}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {event.quantity}
                        {event.price ? ` @ ${event.price}` : ''}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {event.eventType}
                    </p>
                  </div>
                  <StatusBadge status={event.status} />
                  <span className="text-xs text-muted-foreground shrink-0">{event.timestamp}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Alerts Panel */}
      <Card className="glass-card border-none">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="p-2 bg-yellow-500/10 rounded-lg">
              <AlertTriangle size={18} className="text-yellow-500" />
            </div>
            <CardTitle>Active Alerts</CardTitle>
            <CardDescription>System health notifications requiring attention</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {alertLoading ? (
            <div className="py-8 text-center">
              <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full mx-auto" />
            </div>
          ) : alerts.length === 0 ? (
            <div className="py-12 text-center flex flex-col items-center gap-3">
              <div className="w-14 h-14 bg-green-500/10 rounded-full flex items-center justify-center">
                <CheckCircle2 size={28} className="text-green-500" />
              </div>
              <p className="text-muted-foreground font-medium">No active alerts</p>
              <p className="text-xs text-muted-foreground">All providers and systems are operating normally</p>
            </div>
          ) : (
            <div className="space-y-3">
              {alerts.map((alert) => (
                <div
                  key={alert.id}
                  className="flex items-start gap-4 p-4 rounded-xl bg-muted/30 border border-border/40"
                >
                  <div className={`mt-0.5 ${
                    alert.severity === 'critical' ? 'text-destructive' : 'text-orange-500'
                  }`}>
                    <AlertTriangle size={18} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <SeverityBadge severity={alert.severity} />
                      {alert.provider && (
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <ProviderIcon provider={alert.provider} />
                          <span className="capitalize">{alert.provider}</span>
                        </div>
                      )}
                      {alert.toolName && (
                        <span className="text-xs font-mono text-muted-foreground">{alert.toolName}</span>
                      )}
                    </div>
                    <p className="text-sm font-medium mt-1">{alert.message}</p>
                    <div className="flex items-center gap-3 mt-1">
                      <span className="text-xs text-muted-foreground">
                        Occurred {alert.count} time{alert.count !== 1 ? 's' : ''}
                      </span>
                      <span className="text-xs text-muted-foreground">{alert.lastOccurred}</span>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="rounded-xl shrink-0"
                    onClick={() => resolveAlert(alert.id)}
                    disabled={resolvingAlerts.has(alert.id)}
                  >
                    {resolvingAlerts.has(alert.id) ? (
                      <div className="animate-spin w-4 h-4 border-2 border-current border-t-transparent rounded-full" />
                    ) : (
                      <CheckCircle2 size={16} />
                    )}
                    <span className="ml-1.5">Resolve</span>
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
