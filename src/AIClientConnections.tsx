/// <reference types="vite/client" />
import React, { useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { motion } from 'framer-motion';
import {
  Copy,
  Check,
  CheckCircle2,
  XCircle,
  Loader2,
  Info,
  Shield,
  Zap,
  Terminal,
  FileJson,
} from 'lucide-react';

type Profile = 'safe_research' | 'trading_review' | 'full_access';

interface CheckResult {
  label: string;
  url: string;
  status: 'pending' | 'ok' | 'error';
  httpCode?: number;
}

const PROFILES: { id: Profile; label: string; description: string; tools: string }[] = [
  {
    id: 'safe_research',
    label: 'Safe Research',
    description: 'Market data, prices, news, research, and public read-only Binance/Bybit API access.',
    tools: 'CoinGecko · Binance public · TAAPI.IO · CryptoPanic · NewsAPI · Messari · FX data · search · fetch · public list_exchange_methods · public call_exchange_method',
  },
  {
    id: 'trading_review',
    label: 'Trading Review',
    description: 'Research tools + public raw exchange reads + account balances + trade proposals.',
    tools: 'All safe_research tools · get_account_summary · create_trade_proposal',
  },
  {
    id: 'full_access',
    label: 'Full Access',
    description: 'Everything, with raw Binance/Bybit CCXT exchange methods enabled.',
    tools: 'All trading_review tools · every enabled MCP marketplace tool',
  },
];

function useCopy(timeout = 2000) {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), timeout);
  };
  return { copied, copy };
}

function CodeBlock({ code, copyKey, onCopy, isCopied }: { code: string; copyKey: string; onCopy: (text: string, key: string) => void; isCopied: boolean }) {
  return (
    <div className="relative group mt-3">
      <pre className="text-xs font-mono bg-muted/60 border border-border/40 rounded-xl p-4 overflow-x-auto leading-relaxed whitespace-pre-wrap break-all">
        {code}
      </pre>
      <Button
        size="sm"
        variant="secondary"
        className="absolute top-2 right-2 h-7 px-2 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg"
        onClick={() => onCopy(code, copyKey)}
      >
        {isCopied ? <Check size={12} /> : <Copy size={12} />}
      </Button>
    </div>
  );
}

interface ClientCard {
  id: string;
  name: string;
  platform: string;
  accentClass: string;
  oauthSupport: 'auto' | 'manual' | 'ui-only' | 'api-key';
  snippet: (mcpUrl: string) => string;
  snippetLabel: string;
  filePath?: string;
  note?: string;
}

export function buildMcpUrl(baseUrl: string, profile: Profile) {
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://example.local';
  const url = new URL(baseUrl, origin);
  if (profile === 'full_access') {
    url.searchParams.delete('profile');
  } else {
    url.searchParams.set('profile', profile);
  }
  return url.href;
}

export function buildClients(mcpUrl: string): ClientCard[] {
  return [
    {
      id: 'claude-desktop',
      name: 'Claude Desktop',
      platform: 'Desktop App',
      accentClass: 'bg-orange-500/10 text-orange-500',
      oauthSupport: 'ui-only',
      snippetLabel: 'Steps',
      snippet: () =>
        `1. Open Claude Desktop
2. Go to Settings → Custom Connectors
3. Click "Add" and paste the MCP URL:
   ${mcpUrl}
4. Complete the OAuth sign-in flow

Note: Custom Connectors require a Team or Enterprise plan.
OAuth callbacks must be allowed for: https://claude.ai/api/mcp/auth_callback`,
      note: 'Team/Enterprise plan required for remote connectors.',
    },
    {
      id: 'claude-ai',
      name: 'Claude.ai (Web)',
      platform: 'Web',
      accentClass: 'bg-orange-400/10 text-orange-400',
      oauthSupport: 'ui-only',
      snippetLabel: 'Steps',
      snippet: () =>
        `1. Open claude.ai and go to Organization Settings
2. Navigate to Connectors → Add
3. Paste MCP Server URL:
   ${mcpUrl}
4. Optional — click "Advanced settings" to add OAuth credentials
5. Complete the sign-in flow`,
      note: 'Owner or Primary Owner role required.',
    },
    {
      id: 'claude-code',
      name: 'Claude Code (CLI)',
      platform: 'CLI',
      accentClass: 'bg-amber-500/10 text-amber-500',
      oauthSupport: 'api-key',
      snippetLabel: 'Terminal command',
      snippet: (url) => `claude mcp add trade-mcp --env TRADEMCP_API_KEY=YOUR_DASHBOARD_API_KEY -- npx -y mcp-remote "${url}" --header "Authorization: Bearer \${TRADEMCP_API_KEY}"`,
      note: 'Generate the API key in Dashboard → Settings → API Keys. The key is used as a Bearer token for CLI access.',
    },
    {
      id: 'chatgpt',
      name: 'ChatGPT',
      platform: 'Web',
      accentClass: 'bg-green-500/10 text-green-500',
      oauthSupport: 'ui-only',
      snippetLabel: 'Steps',
      snippet: (url) =>
        `1. Open ChatGPT → Settings → Advanced → Enable Developer Mode
2. Go to the Connectors tab → Add connector
3. Enter MCP Server URL:
   ${url}
4. ChatGPT uses Dynamic Client Registration — no manual client ID needed.

OAuth callback URL: https://chatgpt.com/connector/oauth/callback`,
    },
    {
      id: 'gemini-cli',
      name: 'Gemini CLI',
      platform: 'CLI',
      accentClass: 'bg-blue-500/10 text-blue-500',
      oauthSupport: 'api-key',
      snippetLabel: '~/.gemini/settings.json',
      filePath: '~/.gemini/settings.json',
      snippet: (url) =>
        JSON.stringify(
          {
            mcpServers: {
              'trade-mcp': {
                command: 'npx',
                args: [
                  '-y',
                  'mcp-remote',
                  url,
                  '--header',
                  'Authorization: Bearer ${TRADEMCP_API_KEY}',
                ],
                env: {
                  TRADEMCP_API_KEY: 'paste-your-dashboard-api-key',
                },
              },
            },
          },
          null,
          2
        ),
      note: 'Use API-key Bearer auth for CLI clients that cannot complete browser OAuth reliably.',
    },
    {
      id: 'gemini-antigravity',
      name: 'Gemini Antigravity',
      platform: 'CLI',
      accentClass: 'bg-indigo-500/10 text-indigo-500',
      oauthSupport: 'api-key',
      snippetLabel: '~/.gemini/antigravity/mcp_config.json',
      filePath: '~/.gemini/antigravity/mcp_config.json',
      snippet: (url) =>
        JSON.stringify(
          {
            mcpServers: {
              'trade-mcp': {
                command: 'npx',
                args: [
                  '-y',
                  'mcp-remote',
                  url,
                  '--header',
                  'Authorization: Bearer ${TRADEMCP_API_KEY}',
                ],
                env: {
                  TRADEMCP_API_KEY: 'paste-your-dashboard-api-key',
                },
              },
            },
          },
          null,
          2
        ),
      note: 'If your Antigravity build only supports serverURL, pass the API key via the x-api-key header using mcp-remote with --header.',
    },
    {
      id: 'cursor',
      name: 'Cursor',
      platform: 'IDE',
      accentClass: 'bg-violet-500/10 text-violet-500',
      oauthSupport: 'auto',
      snippetLabel: '.cursor/mcp.json',
      filePath: '~/.cursor/mcp.json  (global)  or  .cursor/mcp.json  (project)',
      snippet: (url) =>
        JSON.stringify(
          {
            mcpServers: {
              'trade-mcp': {
                url: url,
              },
            },
          },
          null,
          2
        ),
      note: 'OAuth v1.0+: a browser window opens automatically for sign-in.',
    },
    {
      id: 'windsurf',
      name: 'Windsurf',
      platform: 'IDE',
      accentClass: 'bg-cyan-500/10 text-cyan-500',
      oauthSupport: 'auto',
      snippetLabel: '~/.codeium/windsurf/mcp_config.json',
      filePath: '~/.codeium/windsurf/mcp_config.json',
      snippet: (url) =>
        JSON.stringify(
          {
            mcpServers: {
              'trade-mcp': {
                serverUrl: url,
              },
            },
          },
          null,
          2
        ),
    },
    {
      id: 'vscode',
      name: 'VS Code',
      platform: 'IDE',
      accentClass: 'bg-blue-400/10 text-blue-400',
      oauthSupport: 'auto',
      snippetLabel: '.vscode/mcp.json',
      filePath: '.vscode/mcp.json  (note: root key is "servers", not "mcpServers")',
      snippet: (url) =>
        JSON.stringify(
          {
            servers: {
              'trade-mcp': {
                type: 'http',
                url: url,
              },
            },
          },
          null,
          2
        ),
    },
    {
      id: 'cline',
      name: 'Cline',
      platform: 'IDE Extension',
      accentClass: 'bg-pink-500/10 text-pink-500',
      oauthSupport: 'auto',
      snippetLabel: 'cline_mcp_settings.json',
      filePath: '~/.cline/data/settings/cline_mcp_settings.json',
      snippet: (url) =>
        JSON.stringify(
          {
            mcpServers: {
              'trade-mcp': {
                url: url,
                alwaysAllow: [],
                disabled: false,
              },
            },
          },
          null,
          2
        ),
    },
  ];
}

const oauthBadge: Record<string, { label: string; className: string }> = {
  auto: { label: 'OAuth auto (DCR)', className: 'bg-green-500/10 text-green-500 border-none' },
  manual: { label: 'OAuth manual', className: 'bg-yellow-500/10 text-yellow-600 border-none' },
  'ui-only': { label: 'OAuth via UI', className: 'bg-blue-500/10 text-blue-500 border-none' },
  'api-key': { label: 'API key OAuth', className: 'bg-emerald-500/10 text-emerald-500 border-none' },
};

export function AIClientConnections() {
  const [selectedProfile, setSelectedProfile] = useState<Profile>('full_access');
  const { copied, copy } = useCopy();
  const [checkResults, setCheckResults] = useState<CheckResult[]>([]);
  const [checking, setChecking] = useState(false);

  const baseUrl: string =
    (import.meta.env.VITE_PUBLIC_BASE_URL as string | undefined) ||
    `${window.location.origin}/api/mcp/`;

  const mcpUrl = buildMcpUrl(baseUrl, selectedProfile);

  const clients = buildClients(mcpUrl);

  async function runChecks() {
    setChecking(true);
    const checks: CheckResult[] = [
      { label: 'Server health', url: '/api/health', status: 'pending' },
      { label: 'OAuth metadata', url: '/api/mcp/.well-known/oauth-authorization-server', status: 'pending' },
      { label: 'Protected resource', url: '/api/mcp/.well-known/oauth-protected-resource', status: 'pending' },
    ];
    setCheckResults(checks.map((c) => ({ ...c })));

    for (let i = 0; i < checks.length; i++) {
      try {
        const res = await fetch(checks[i].url);
        checks[i] = { ...checks[i], status: res.ok ? 'ok' : 'error', httpCode: res.status };
      } catch {
        checks[i] = { ...checks[i], status: 'error', httpCode: 0 };
      }
      setCheckResults([...checks]);
    }
    setChecking(false);
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-3xl font-bold tracking-tight mb-2">Connect AI Clients</h2>
        <p className="text-muted-foreground">
          Copy-ready configuration for every major MCP client. Choose a tool profile, then copy the snippet for your client.
        </p>
      </div>

      {/* Profile selector */}
      <Card className="glass-card border-none">
        <CardHeader>
          <div className="flex items-center gap-3 mb-1">
            <div className="p-2 bg-primary/10 rounded-lg">
              <Shield className="text-primary w-5 h-5" />
            </div>
            <CardTitle>Tool Profile</CardTitle>
          </div>
          <CardDescription>
            Controls which MCP tools are exposed via a <code className="text-xs font-mono bg-muted px-1 py-0.5 rounded">?profile=</code> URL parameter.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {PROFILES.map((p) => (
              <button
                key={p.id}
                onClick={() => setSelectedProfile(p.id)}
                className={`text-left p-4 rounded-2xl border transition-all ${
                  selectedProfile === p.id
                    ? 'border-primary bg-primary/5 shadow-sm'
                    : 'border-border/40 hover:bg-muted/30'
                }`}
              >
                <p className="font-semibold text-sm mb-1">{p.label}</p>
                <p className="text-xs text-muted-foreground leading-relaxed">{p.description}</p>
              </button>
            ))}
          </div>

          <div className="p-3 bg-muted/40 rounded-xl border border-border/30 space-y-2">
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
              Included tools
            </p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {PROFILES.find((p) => p.id === selectedProfile)?.tools}
            </p>
          </div>

          {/* Dynamic MCP URL */}
          <div className="p-4 bg-muted/50 rounded-2xl border border-border/40 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">MCP Server URL</p>
              <Badge variant="outline" className="bg-background/50 text-primary border-primary/20">OAuth Secured</Badge>
            </div>
            <div className="flex items-center gap-3 bg-background/80 p-3 rounded-xl border border-border/40 group shadow-inner">
              <code className="text-sm flex-1 break-all font-mono opacity-80">{mcpUrl}</code>
              <Button
                variant="secondary"
                size="sm"
                className="rounded-lg h-9 w-24 transition-all"
                onClick={() => copy(mcpUrl, 'server-url')}
              >
                {copied === 'server-url' ? (
                  <motion.div initial={{ scale: 0.5 }} animate={{ scale: 1 }} className="flex items-center gap-1">
                    <Check size={14} /> Copied
                  </motion.div>
                ) : (
                  <div className="flex items-center gap-1">
                    <Copy size={14} /> Copy
                  </div>
                )}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Setup checks */}
      <Card className="glass-card border-none">
        <CardHeader>
          <div className="flex items-center gap-3 mb-1">
            <div className="p-2 bg-primary/10 rounded-lg">
              <Zap className="text-primary w-5 h-5" />
            </div>
            <CardTitle>Setup Check</CardTitle>
          </div>
          <CardDescription>Verify that OAuth and MCP endpoints are reachable before connecting a client.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <Button
            className="rounded-xl gap-2"
            onClick={runChecks}
            disabled={checking}
          >
            {checking ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
            Check Connection
          </Button>

          {checkResults.length > 0 && (
            <div className="space-y-2">
              {checkResults.map((r) => (
                <div
                  key={r.url}
                  className="flex items-center gap-3 p-3 rounded-xl border border-border/30 bg-muted/30 text-sm"
                >
                  {r.status === 'pending' && <Loader2 size={16} className="animate-spin text-muted-foreground shrink-0" />}
                  {r.status === 'ok' && <CheckCircle2 size={16} className="text-green-500 shrink-0" />}
                  {r.status === 'error' && <XCircle size={16} className="text-destructive shrink-0" />}
                  <span className="flex-1 font-medium">{r.label}</span>
                  <span className="font-mono text-xs text-muted-foreground">{r.url}</span>
                  {r.httpCode !== undefined && (
                    <Badge
                      variant="outline"
                      className={`text-xs ${r.status === 'ok' ? 'text-green-500 border-green-500/30' : 'text-destructive border-destructive/30'}`}
                    >
                      {r.httpCode || 'ERR'}
                    </Badge>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="space-y-3 pt-2">
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Manual checklist</p>
            {[
              'Copied the MCP URL (with profile suffix if applicable)',
              'For CLI clients, generated an API key in Settings → API Keys and pasted it into the config/env value',
              'Saved the config to the correct file or UI field for your client',
              'Completed OAuth sign-in for web clients, or configured Bearer API-key auth for CLI clients',
              'Tested by asking: "What is the current price of Bitcoin?"',
            ].map((item) => (
              <div key={item} className="flex items-start gap-3 text-sm text-muted-foreground">
                <div className="w-5 h-5 mt-0.5 rounded border border-border/50 bg-muted/30 shrink-0" />
                <span>{item}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Client cards */}
      <div>
        <h3 className="text-xl font-bold mb-4">Client Configuration</h3>
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
          {clients.map((client) => {
            const badge = oauthBadge[client.oauthSupport];
            const snippet = client.snippet(mcpUrl);
            const snippetKey = `snippet-${client.id}`;
            const isUiOnly = client.oauthSupport === 'ui-only';

            return (
              <Card key={client.id} className="glass-card border-none">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${client.accentClass}`}>
                        {isUiOnly ? <Zap size={20} /> : client.snippetLabel.includes('json') ? <FileJson size={20} /> : <Terminal size={20} />}
                      </div>
                      <div>
                        <CardTitle className="text-base">{client.name}</CardTitle>
                        <CardDescription>{client.platform}</CardDescription>
                      </div>
                    </div>
                    <Badge variant="secondary" className={badge.className}>
                      {badge.label}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {client.filePath && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <FileJson size={12} className="shrink-0" />
                      <code className="font-mono break-all">{client.filePath}</code>
                    </div>
                  )}

                  <div>
                    <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1">
                      {client.snippetLabel}
                    </p>
                    <CodeBlock
                      code={snippet}
                      copyKey={snippetKey}
                      onCopy={copy}
                      isCopied={copied === snippetKey}
                    />
                  </div>

                  {client.note && (
                    <div className="flex items-start gap-2 text-xs text-muted-foreground">
                      <Info size={12} className="shrink-0 mt-0.5" />
                      <span>{client.note}</span>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}
