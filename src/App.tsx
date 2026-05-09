/// <reference types="vite/client" />
import React, { useState, useEffect } from 'react';
import { onAuthStateChanged, User, signInWithPopup, GoogleAuthProvider, signOut } from 'firebase/auth';
import { auth, db } from './firebase';
import { Button } from '../components/ui/button';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '../components/ui/card';
import { collection, query, onSnapshot, doc, updateDoc } from 'firebase/firestore';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Badge } from '../components/ui/badge';
import { Toaster, toast } from 'sonner';
import { ThemeProvider, useTheme } from './theme-provider';
import { ModeToggle } from '../components/mode-toggle';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  LayoutDashboard, 
  ArrowLeftRight, 
  Settings, 
  LogOut, 
  Plus, 
  Trash2, 
  Power, 
  CheckCircle2, 
  XCircle, 
  Clock, 
  ShieldCheck,
  Zap,
  Copy,
  Check,
  Smartphone,
  Info,
  ExternalLink,
  ChevronRight,
  Database,
  KeyRound,
  RefreshCw
} from 'lucide-react';

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

function handleUIError(error: any, context: string) {
    console.error(`[${context}]`, error);
    const message = error instanceof Error ? error.message : String(error);
    toast.error(message);
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  console.error('Firestore Error: ', error);
  toast.error(`Database error during ${operationType}`);
}

const NavItem = ({ active, icon: Icon, label, onClick }: any) => (
  <button
    onClick={onClick}
    className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-300 ${
      active 
        ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/20 scale-[1.02]' 
        : 'text-muted-foreground hover:bg-muted hover:text-foreground'
    }`}
  >
    <Icon size={20} />
    <span className="font-medium">{label}</span>
    {active && (
      <motion.div 
        layoutId="activeNav"
        className="ml-auto w-1.5 h-1.5 rounded-full bg-primary-foreground"
      />
    )}
  </button>
);

function AuthGuard() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('proposals');

  useEffect(() => {
    return onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
  }, []);

  if (loading) return (
    <div className="h-screen flex items-center justify-center bg-background">
      <motion.div 
        animate={{ scale: [1, 1.1, 1], opacity: [0.5, 1, 0.5] }}
        transition={{ repeat: Infinity, duration: 2 }}
        className="flex flex-col items-center gap-4"
      >
        <Zap className="text-primary w-12 h-12 fill-primary" />
        <p className="text-muted-foreground animate-pulse">Initializing magic...</p>
      </motion.div>
    </div>
  );

  if (!user) {
    return (
      <div className="flex h-screen items-center justify-center p-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <Card className="w-full max-w-sm glass-card border-none">
            <CardHeader className="text-center">
              <div className="mx-auto w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center mb-4">
                <Zap className="text-primary w-8 h-8 fill-primary" />
              </div>
              <CardTitle className="text-2xl font-bold tracking-tight">Trade MCP</CardTitle>
              <CardDescription>Your AI trading intelligence hub</CardDescription>
            </CardHeader>
            <CardContent>
              <Button 
                className="w-full h-12 rounded-xl text-md font-semibold bg-primary hover:shadow-xl hover:shadow-primary/20 transition-all" 
                onClick={() => signInWithPopup(auth, new GoogleAuthProvider())}
              >
                Sign in with Google
              </Button>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex">
      {/* Sidebar */}
      <aside className="w-72 glass-header border-r border-border/40 hidden lg:flex flex-col p-6 h-screen sticky top-0">
        <div className="flex items-center gap-3 mb-12 px-2">
          <div className="w-10 h-10 bg-primary rounded-xl flex items-center justify-center shadow-lg shadow-primary/20">
            <Zap className="text-primary-foreground w-6 h-6 fill-primary-foreground" />
          </div>
          <h1 className="text-xl font-bold tracking-tight">Trade MCP</h1>
        </div>

        <nav className="flex-1 space-y-2">
          <NavItem 
            active={activeTab === 'proposals'} 
            icon={LayoutDashboard} 
            label="Proposals" 
            onClick={() => setActiveTab('proposals')} 
          />
          <NavItem 
            active={activeTab === 'connections'} 
            icon={ArrowLeftRight} 
            label="Exchanges" 
            onClick={() => setActiveTab('connections')} 
          />
          <NavItem
            active={activeTab === 'data-providers'}
            icon={Database}
            label="Data Providers"
            onClick={() => setActiveTab('data-providers')}
          />
          <NavItem 
            active={activeTab === 'settings'} 
            icon={Settings} 
            label="Settings" 
            onClick={() => setActiveTab('settings')} 
          />
        </nav>

        <div className="pt-6 border-t border-border/40 mt-auto">
          <div className="flex items-center gap-3 px-2 mb-6">
            <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center overflow-hidden border border-border">
              {user.photoURL ? <img src={user.photoURL} alt="" /> : <ShieldCheck size={20} />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold truncate">{user.displayName || 'Trader'}</p>
              <p className="text-xs text-muted-foreground truncate">{user.email}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ModeToggle />
            <Button 
              variant="ghost" 
              className="flex-1 justify-start gap-2 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-xl transition-colors" 
              onClick={() => signOut(auth)}
            >
              <LogOut size={18} />
              <span className="font-medium">Sign out</span>
            </Button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col">
        {/* Mobile Header */}
        <header className="lg:hidden glass-header px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Zap className="text-primary w-6 h-6 fill-primary" />
            <h1 className="text-lg font-bold">Trade MCP</h1>
          </div>
          <div className="flex items-center gap-2">
            <ModeToggle />
            <Button variant="ghost" size="icon" onClick={() => signOut(auth)} className="rounded-full">
              <LogOut size={20} />
            </Button>
          </div>
        </header>

        {/* Mobile Nav */}
        <div className="lg:hidden px-6 py-2 border-b border-border/40 bg-muted/30">
           <div className="flex gap-2 overflow-x-auto no-scrollbar py-2">
              {['proposals', 'connections', 'data-providers', 'settings'].map(tab => (
                <Button 
                  key={tab}
                  variant={activeTab === tab ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => setActiveTab(tab)}
                  className="rounded-full whitespace-nowrap px-4"
                >
                  {tab.replace('-', ' ')}
                </Button>
              ))}
           </div>
        </div>

        <div className="p-6 lg:p-10 max-w-6xl w-full mx-auto flex-1">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.3 }}
            >
              {activeTab === 'proposals' && <ProposalsList user={user} />}
              {activeTab === 'connections' && <ExchangeConnections user={user} />}
              {activeTab === 'data-providers' && <MarketDataProviders user={user} />}
              {activeTab === 'settings' && <MCPSettings />}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}

function OAuthAuthorize() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const requestId = new URLSearchParams(window.location.search).get('oauth_request') || "";

  useEffect(() => {
    return onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (!user || !requestId) return;
    let cancelled = false;
    async function completeOAuth() {
      try {
        const idToken = await user.getIdToken();
        const res = await fetch('/api/mcp/oauth/complete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ requestId, idToken }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'OAuth authorization failed');
        if (!cancelled) window.location.href = data.redirectUrl;
      } catch (err: any) {
        if (!cancelled) setError(err.message);
      }
    }
    completeOAuth();
    return () => { cancelled = true; };
  }, [user, requestId]);

  if (!requestId) return <div className="p-8 text-center text-destructive">Missing OAuth request.</div>;
  if (loading) return (
    <div className="h-screen flex items-center justify-center">
       <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
    </div>
  );

  return (
    <div className="flex h-screen items-center justify-center p-6">
      <Card className="w-full max-w-sm glass-card border-none text-center">
        <CardHeader>
          <div className="mx-auto w-12 h-12 bg-primary/10 rounded-xl flex items-center justify-center mb-4">
             <Smartphone className="text-primary w-6 h-6" />
          </div>
          <CardTitle>Finish Connecting</CardTitle>
          <CardDescription>Confirming authorization for {user?.email}</CardDescription>
        </CardHeader>
        <CardContent>
          {error ? (
            <div className="p-3 bg-destructive/10 rounded-lg text-destructive text-sm flex gap-2 items-center">
               <XCircle size={16} /> {error}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3">
               <div className="animate-pulse flex items-center gap-2 text-primary font-medium">
                  <div className="w-2 h-2 bg-primary rounded-full animate-ping" />
                  Synchronizing...
               </div>
               <p className="text-xs text-muted-foreground italic">You will be redirected automatically</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function MCPSettings() {
   const [copied, setCopied] = useState(false);
   const baseUrl = import.meta.env.VITE_PUBLIC_BASE_URL || window.location.origin + '/api/mcp/';

   const handleCopy = () => {
       navigator.clipboard.writeText(baseUrl);
       setCopied(true);
       setTimeout(() => setCopied(false), 2000);
   };

   return (
      <div className="space-y-6">
        <div>
           <h2 className="text-3xl font-bold tracking-tight mb-2">Settings & Integration</h2>
           <p className="text-muted-foreground">Configure your AI agent connectivity</p>
        </div>

        <Card className="glass-card border-none">
           <CardHeader>
               <div className="flex items-center gap-3 mb-2">
                  <div className="p-2 bg-primary/10 rounded-lg">
                     <Zap className="text-primary w-5 h-5" />
                  </div>
                  <CardTitle>MCP Server Connection</CardTitle>
               </div>
               <CardDescription>Connect any LLM client (ChatGPT, Claude, Cursor) to your trading server.</CardDescription>
           </CardHeader>
           <CardContent className="space-y-6">
               <div className="p-4 bg-muted/50 rounded-2xl border border-border/40 space-y-3">
                   <div className="flex items-center justify-between">
                      <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">MCP Server URL</p>
                      <Badge variant="outline" className="bg-background/50 backdrop-blur-sm border-primary/20 text-primary">OAuth Secured</Badge>
                   </div>
                   <div className="flex items-center gap-3 bg-background/80 p-3 rounded-xl border border-border/40 group shadow-inner">
                       <code className="text-sm flex-1 break-all font-mono opacity-80">{baseUrl}</code>
                       <Button 
                         variant="secondary" 
                         size="sm" 
                         className="rounded-lg h-9 w-24 transition-all" 
                         onClick={handleCopy}
                       >
                           {copied ? (
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
                   <div className="flex items-start gap-2 pt-1">
                      <Info size={14} className="text-primary mt-0.5" />
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        Use this single endpoint for all your AI connectors. Ensure your client supports OAuth 2.0.
                      </p>
                   </div>
               </div>
               
               <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                  <div className="p-4 rounded-2xl border border-border/40 hover:bg-muted/30 transition-colors cursor-pointer group">
                     <div className="flex items-center justify-between mb-2">
                        <Badge variant="secondary" className="bg-blue-500/10 text-blue-500 border-none">Cursor</Badge>
                        <ExternalLink size={14} className="text-muted-foreground group-hover:text-primary transition-colors" />
                     </div>
                     <p className="text-sm font-medium">Add to Cursor</p>
                     <p className="text-xs text-muted-foreground">Settings &gt; Models &gt; MCP</p>
                  </div>
                  <div className="p-4 rounded-2xl border border-border/40 hover:bg-muted/30 transition-colors cursor-pointer group">
                     <div className="flex items-center justify-between mb-2">
                        <Badge variant="secondary" className="bg-orange-500/10 text-orange-500 border-none">ChatGPT</Badge>
                        <ExternalLink size={14} className="text-muted-foreground group-hover:text-primary transition-colors" />
                     </div>
                     <p className="text-sm font-medium">ChatGPT Connectors</p>
                     <p className="text-xs text-muted-foreground">Personal &gt; My connectors</p>
                  </div>
               </div>
           </CardContent>
        </Card>
      </div>
   );
}

const DATA_PROVIDER_CONFIGS = [
  { id: 'oanda', label: 'OANDA', accent: 'bg-blue-500/10 text-blue-500', defaults: { baseUrl: 'https://api-fxpractice.oanda.com', accountId: '', apiKey: '', isActive: true } },
  { id: 'twelve_data', label: 'Twelve Data', accent: 'bg-violet-500/10 text-violet-500', defaults: { baseUrl: 'https://api.twelvedata.com', apiKey: '', isActive: true } },
  { id: 'coingecko', label: 'CoinGecko', accent: 'bg-green-500/10 text-green-500', defaults: { tier: 'demo', apiKey: '', isActive: true } },
  { id: 'cryptopanic', label: 'CryptoPanic', accent: 'bg-red-500/10 text-red-500', defaults: { apiPlan: 'free', apiKey: '', isActive: true } },
  { id: 'messari', label: 'Messari', accent: 'bg-cyan-500/10 text-cyan-500', defaults: { apiKey: '', isActive: true } },
] as const;

type DataProviderConfig = typeof DATA_PROVIDER_CONFIGS[number];
type ProviderFormState = Record<string, any>;

function MarketDataProviders({ user }: { user: User }) {
  const [providers, setProviders] = useState<Record<string, any>>({});
  const [forms, setForms] = useState<Record<string, ProviderFormState>>(
    Object.fromEntries(DATA_PROVIDER_CONFIGS.map((provider) => [provider.id, { ...provider.defaults }]))
  );
  const [loading, setLoading] = useState(true);
  const [busyProvider, setBusyProvider] = useState<string | null>(null);

  const loadProviders = async () => {
    try {
      const idToken = await user.getIdToken();
      const response = await fetch('/api/mcp/data-providers', {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to load data providers');
      const nextProviders = Object.fromEntries((data.providers || []).map((provider: any) => [provider.provider, provider]));
      setProviders(nextProviders);
      setForms((current) => {
        const next = { ...current };
        for (const config of DATA_PROVIDER_CONFIGS) {
          const saved = nextProviders[config.id] as any;
          next[config.id] = {
            ...config.defaults,
            ...(saved?.config || {}),
            apiKey: '',
            isActive: saved?.isActive ?? current[config.id]?.isActive ?? true,
          };
        }
        return next;
      });
    } catch (err: any) {
      handleUIError(err, 'Load Data Providers');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProviders();
  }, [user.uid]);

  const updateForm = (provider: string, field: string, value: string | boolean) => {
    setForms((current) => ({
      ...current,
      [provider]: {
        ...current[provider],
        [field]: value,
      },
    }));
  };

  const providerRequest = async (provider: string, method: 'PUT' | 'POST' | 'DELETE') => {
    const idToken = await user.getIdToken();
    const url = method === 'POST'
      ? `/api/mcp/data-providers/${provider}/validate`
      : `/api/mcp/data-providers/${provider}`;
    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: method === 'DELETE' ? undefined : JSON.stringify(forms[provider]),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || data.message || 'Provider request failed');
    return data;
  };

  const saveProvider = async (provider: string) => {
    setBusyProvider(provider);
    try {
      await providerRequest(provider, 'PUT');
      await loadProviders();
      toast.success('Provider saved');
    } catch (err: any) {
      handleUIError(err, 'Save Data Provider');
    } finally {
      setBusyProvider(null);
    }
  };

  const testProvider = async (provider: string) => {
    setBusyProvider(provider);
    try {
      await providerRequest(provider, 'POST');
      toast.success('Provider key verified');
    } catch (err: any) {
      handleUIError(err, 'Validate Data Provider');
    } finally {
      setBusyProvider(null);
    }
  };

  const deleteProvider = async (provider: string) => {
    if (!confirm('Delete this provider key?')) return;
    setBusyProvider(provider);
    try {
      await providerRequest(provider, 'DELETE');
      await loadProviders();
      toast.success('Provider deleted');
    } catch (err: any) {
      handleUIError(err, 'Delete Data Provider');
    } finally {
      setBusyProvider(null);
    }
  };

  const toggleProvider = async (provider: string) => {
    const nextForm = { ...forms[provider], isActive: !forms[provider]?.isActive };
    setForms((current) => ({ ...current, [provider]: nextForm }));
    setBusyProvider(provider);
    try {
      const idToken = await user.getIdToken();
      const response = await fetch(`/api/mcp/data-providers/${provider}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify(nextForm),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Provider request failed');
      await loadProviders();
      toast.success(`Provider ${nextForm.isActive ? 'activated' : 'deactivated'}`);
    } catch (err: any) {
      handleUIError(err, 'Toggle Data Provider');
    } finally {
      setBusyProvider(null);
    }
  };

  const renderProviderFields = (config: DataProviderConfig) => {
    const form = forms[config.id] || {};

    return (
      <>
        <div className="space-y-2">
          <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">API Key</Label>
          <Input
            className="h-10 bg-background/50 border-border/40"
            type="password"
            value={form.apiKey || ''}
            placeholder={providers[config.id]?.apiKeyPreview || 'Paste key'}
            onChange={(e) => updateForm(config.id, 'apiKey', e.target.value)}
          />
        </div>
        {config.id === 'oanda' && (
          <>
            <div className="space-y-2">
              <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Account ID</Label>
              <Input
                className="h-10 bg-background/50 border-border/40"
                value={form.accountId || ''}
                onChange={(e) => updateForm(config.id, 'accountId', e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Base URL</Label>
              <Input
                className="h-10 bg-background/50 border-border/40"
                value={form.baseUrl || ''}
                onChange={(e) => updateForm(config.id, 'baseUrl', e.target.value)}
              />
            </div>
          </>
        )}
        {config.id === 'twelve_data' && (
          <div className="space-y-2">
            <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Base URL</Label>
            <Input
              className="h-10 bg-background/50 border-border/40"
              value={form.baseUrl || ''}
              onChange={(e) => updateForm(config.id, 'baseUrl', e.target.value)}
            />
          </div>
        )}
        {config.id === 'coingecko' && (
          <div className="space-y-2">
            <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Tier</Label>
            <select
              className="w-full h-10 rounded-xl border border-border/40 bg-background/50 px-3 py-2 text-sm outline-none"
              value={form.tier || 'demo'}
              onChange={(e) => updateForm(config.id, 'tier', e.target.value)}
            >
              <option value="demo">Demo</option>
              <option value="pro">Pro</option>
            </select>
          </div>
        )}
        {config.id === 'cryptopanic' && (
          <div className="space-y-2">
            <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">API Plan</Label>
            <Input
              className="h-10 bg-background/50 border-border/40"
              value={form.apiPlan || 'free'}
              onChange={(e) => updateForm(config.id, 'apiPlan', e.target.value)}
            />
          </div>
        )}
      </>
    );
  };

  return (
    <div className="space-y-8">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight mb-2">Market Data Providers</h2>
          <p className="text-muted-foreground">User-owned keys for analytics tools</p>
        </div>
        <Button variant="secondary" className="rounded-xl gap-2" onClick={loadProviders} disabled={loading}>
          <RefreshCw size={16} /> Refresh
        </Button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        {DATA_PROVIDER_CONFIGS.map((config) => {
          const saved = providers[config.id];
          const busy = busyProvider === config.id;
          return (
            <Card key={config.id} className={`glass-card border-none ${saved && !forms[config.id]?.isActive ? 'opacity-70' : ''}`}>
              <CardHeader>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${config.accent}`}>
                      <KeyRound size={20} />
                    </div>
                    <div>
                      <CardTitle className="text-lg">{config.label}</CardTitle>
                      <CardDescription className="font-mono">{saved?.apiKeyPreview || 'not connected'}</CardDescription>
                    </div>
                  </div>
                  <Badge variant="outline" className={forms[config.id]?.isActive ? 'text-green-500 border-green-500/30' : 'text-muted-foreground'}>
                    {forms[config.id]?.isActive ? 'Active' : 'Inactive'}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {renderProviderFields(config)}
                <div className="flex flex-wrap gap-2 pt-2">
                  <Button className="rounded-xl gap-2" onClick={() => saveProvider(config.id)} disabled={busy}>
                    <Check size={16} /> Save
                  </Button>
                  <Button variant="secondary" className="rounded-xl gap-2" onClick={() => testProvider(config.id)} disabled={busy}>
                    <CheckCircle2 size={16} /> Test
                  </Button>
                  {saved && (
                    <>
                      <Button variant="secondary" size="icon" className="rounded-xl" onClick={() => toggleProvider(config.id)} disabled={busy} title={forms[config.id]?.isActive ? 'Deactivate' : 'Activate'}>
                        <Power size={16} />
                      </Button>
                      <Button variant="secondary" size="icon" className="rounded-xl hover:bg-destructive hover:text-destructive-foreground" onClick={() => deleteProvider(config.id)} disabled={busy}>
                        <Trash2 size={16} />
                      </Button>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function ExchangeConnections({ user }: { user: User }) {
  const [connections, setConnections] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [provider, setProvider] = useState('binance');
  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [validationStatus, setValidationStatus] = useState<'idle' | 'validating' | 'valid' | 'invalid'>('idle');
  const [validationError, setValidationError] = useState<string>('');

  useEffect(() => {
    const q = query(collection(db, `users/${user.uid}/exchange_connections`));
    const unsub = onSnapshot(q, (snap) => {
      setConnections(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoading(false);
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'exchange_connections'));
    return unsub;
  }, [user.uid]);

  const handleAdd = async (e: React.FormEvent) => {
      e.preventDefault();
      setValidationStatus('validating');
      setValidationError('');
      try {
        const idToken = await user.getIdToken();
        const validateResponse = await fetch('/api/validate-keys', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
          body: JSON.stringify({ exchange: provider, apiKey, apiSecret })
        });
        const validateResult = await validateResponse.json();
        if (!validateResult.valid) {
          setValidationStatus('invalid');
          setValidationError(validateResult.error || 'Validation failed');
          return;
        }
        setValidationStatus('valid');
        const response = await fetch('/api/mcp/connections', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
            body: JSON.stringify({ provider, apiKey, apiSecret })
        });
        if (!response.ok) throw new Error(await response.text() || 'Failed to add connection');
        setApiKey(''); setApiSecret(''); setValidationStatus('idle');
        toast.success('Exchange connected successfully!');
      } catch (err: any) {
          setValidationStatus('invalid');
          setValidationError(err.message);
          handleUIError(err, 'Add Connection');
      }
  };

  const handleDeactivate = async (id: string, currentStatus: boolean) => {
       try {
           await updateDoc(doc(db, `users/${user.uid}/exchange_connections`, id), { isActive: !currentStatus });
           toast.success(`Connection ${currentStatus ? 'deactivated' : 'activated'}`);
       } catch (err) { handleFirestoreError(err, OperationType.UPDATE, 'exchange_connections'); }
  };

  const handleDelete = async (id: string) => {
      if (!confirm('Are you sure you want to delete this connection?')) return;
      try {
          const idToken = await user.getIdToken();
          const response = await fetch(`/api/mcp/connections/${id}`, {
              method: 'DELETE',
              headers: { 'Authorization': `Bearer ${idToken}` }
          });
          if (!response.ok) throw new Error(await response.text() || 'Failed to delete connection');
          toast.success('Connection deleted');
      } catch (err: any) { handleUIError(err, 'Delete Connection'); }
  };

  return (
    <div className="space-y-8">
      <div>
         <h2 className="text-3xl font-bold tracking-tight mb-2">Exchange Connections</h2>
         <p className="text-muted-foreground">Manage your trading accounts</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
          <Card className="glass-card border-none lg:col-span-1 h-fit sticky top-10">
              <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Plus size={20} className="text-primary" />
                    New Connection
                  </CardTitle>
                  <CardDescription>Securely link your API keys.</CardDescription>
              </CardHeader>
              <CardContent>
                  <form onSubmit={handleAdd} className="space-y-5">
                      <div className="space-y-2">
                          <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Provider</Label>
                          <select className="w-full h-11 rounded-xl border border-border/40 bg-background/50 px-4 py-2 text-sm focus:ring-2 focus:ring-primary/20 outline-none transition-all" value={provider} onChange={e => setProvider(e.target.value)}>
                               <option value="binance">Binance</option>
                               <option value="bybit">Bybit</option>
                          </select>
                      </div>
                      <div className="space-y-2">
                           <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">API Key</Label>
                           <Input className="h-11 rounded-xl bg-background/50 border-border/40 focus:bg-background transition-all" value={apiKey} onChange={e => setApiKey(e.target.value)} required />
                      </div>
                      <div className="space-y-2">
                           <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">API Secret</Label>
                           <Input className="h-11 rounded-xl bg-background/50 border-border/40 focus:bg-background transition-all" type="password" value={apiSecret} onChange={e => setApiSecret(e.target.value)} required />
                      </div>
                      
                      <AnimatePresence>
                        {validationStatus !== 'idle' && (
                          <motion.div 
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            className={`p-3 rounded-xl text-xs font-medium flex items-center gap-2 border ${
                              validationStatus === 'validating' ? 'bg-blue-500/10 text-blue-500 border-blue-500/20' :
                              validationStatus === 'valid' ? 'bg-green-500/10 text-green-500 border-green-500/20' :
                              'bg-destructive/10 text-destructive border-destructive/20'
                            }`}
                          >
                             {validationStatus === 'validating' ? <div className="animate-spin w-3 h-3 border-2 border-current border-t-transparent rounded-full" /> : 
                              validationStatus === 'valid' ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
                             {validationStatus === 'validating' ? 'Checking keys...' : 
                              validationStatus === 'valid' ? 'Verified successfully' : validationError}
                          </motion.div>
                        )}
                      </AnimatePresence>

                      <Button 
                        type="submit" 
                        className="w-full h-11 rounded-xl font-bold shadow-lg shadow-primary/20" 
                        disabled={validationStatus === 'validating'}
                      >
                        {validationStatus === 'validating' ? 'Processing...' : 'Link Exchange'}
                      </Button>
                  </form>
              </CardContent>
          </Card>

          <div className="lg:col-span-2 space-y-4">
              {loading ? (
                <div className="space-y-4">
                   {[1, 2].map(i => <div key={i} className="h-32 bg-muted/40 animate-pulse rounded-2xl" />)}
                </div>
              ) : connections.length === 0 ? (
                <div className="p-12 text-center border-2 border-dashed border-border/40 rounded-3xl flex flex-col items-center gap-4">
                   <div className="p-4 bg-muted rounded-full">
                      <ArrowLeftRight className="text-muted-foreground" size={32} />
                   </div>
                   <p className="text-muted-foreground font-medium">No active connections. Start by linking your first exchange.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4">
                    {connections.map(c => (
                        <motion.div
                          key={c.id}
                          layout
                          initial={{ opacity: 0, scale: 0.95 }}
                          animate={{ opacity: 1, scale: 1 }}
                          className={`p-5 glass-card rounded-2xl border-none group hover:shadow-2xl transition-all duration-500 ${!c.isActive ? 'grayscale opacity-70' : ''}`}
                        >
                            <div className="flex items-center justify-between gap-4">
                                <div className="flex items-center gap-4">
                                   <div className={`w-14 h-14 rounded-2xl flex items-center justify-center text-xl font-bold ${
                                      c.provider === 'binance' ? 'bg-[#F3BA2F]/10 text-[#F3BA2F]' : 'bg-orange-500/10 text-orange-500'
                                   }`}>
                                      {c.provider.charAt(0).toUpperCase()}
                                   </div>
                                   <div>
                                       <div className="flex items-center gap-2">
                                          <p className="text-lg font-bold capitalize">{c.provider}</p>
                                          {c.isActive && <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse shadow-[0_0_8px_rgba(34,197,94,0.6)]" />}
                                       </div>
                                       <p className="text-sm font-mono text-muted-foreground tracking-widest">{c.apiKeyPreview || '••••••••'}</p>
                                   </div>
                                </div>
                                <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <Button 
                                      variant="secondary" 
                                      size="icon" 
                                      className="rounded-xl h-10 w-10 hover:bg-primary hover:text-primary-foreground transition-all"
                                      onClick={() => handleDeactivate(c.id, c.isActive)}
                                      title={c.isActive ? 'Deactivate' : 'Activate'}
                                    >
                                        <Power size={18} />
                                    </Button>
                                    <Button 
                                      variant="secondary" 
                                      size="icon" 
                                      className="rounded-xl h-10 w-10 hover:bg-destructive hover:text-destructive-foreground transition-all"
                                      onClick={() => handleDelete(c.id)}
                                    >
                                        <Trash2 size={18} />
                                    </Button>
                                </div>
                            </div>
                        </motion.div>
                    ))}
                </div>
              )}
          </div>
      </div>
    </div>
  );
}

function ProposalsList({ user }: { user: User }) {
   const [proposals, setProposals] = useState<any[]>([]);
   const [loading, setLoading] = useState(true);
   
   useEffect(() => {
    const q = query(collection(db, `users/${user.uid}/trade_proposals`));
    const unsub = onSnapshot(q, (snap) => {
      setProposals(snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a: any, b: any) => 
        (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0)
      ));
      setLoading(false);
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'trade_proposals'));
    return unsub;
  }, [user.uid]);

  const handleReview = async (id: string, status: 'approved' | 'rejected') => {
      try {
          await updateDoc(doc(db, `users/${user.uid}/trade_proposals`, id), {
              status,
              approvedAt: new Date().toISOString()
          });
          toast.success(`Proposal ${status === 'approved' ? 'sent to execution' : 'cancelled'}`);
      } catch (err) { handleFirestoreError(err, OperationType.UPDATE, 'trade_proposals'); }
  };

  const getStatusStyle = (status: string) => {
    switch(status) {
      case 'approved': return 'bg-green-500/10 text-green-500 border-green-500/20';
      case 'rejected': return 'bg-destructive/10 text-destructive border-destructive/20';
      case 'executed': return 'bg-primary/10 text-primary border-primary/20';
      case 'executing': return 'bg-blue-500/10 text-blue-500 border-blue-500/20 animate-pulse';
      case 'pending_approval': return 'bg-orange-500/10 text-orange-500 border-orange-500/20 animate-pulse-subtle';
      default: return 'bg-muted text-muted-foreground';
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
         <div>
            <h2 className="text-4xl font-black tracking-tight mb-2">Intelligence Hub</h2>
            <p className="text-muted-foreground font-medium">Verify and execute AI-generated trading strategies</p>
         </div>
         <Badge variant="outline" className="h-8 px-4 border-primary/20 text-primary bg-primary/5 rounded-full font-bold">
            {proposals.length} Proposals Syncing
         </Badge>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
           {[1, 2, 3, 4].map(i => <div key={i} className="h-56 bg-muted/40 animate-pulse rounded-3xl" />)}
        </div>
      ) : proposals.length === 0 ? (
        <div className="p-20 text-center glass rounded-[3rem] border-dashed border-2 border-border/40">
           <div className="w-20 h-20 bg-muted/50 rounded-full flex items-center justify-center mx-auto mb-6">
              <Clock size={40} className="text-muted-foreground/50" />
           </div>
           <h3 className="text-xl font-bold mb-2">All Quiet...</h3>
           <p className="text-muted-foreground max-w-sm mx-auto">Your AI agent is currently monitoring markets. New trade proposals will appear here as soon as they are ready.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <AnimatePresence>
                {proposals.map(p => (
                    <motion.div
                      key={p.id}
                      layout
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.9 }}
                      className="glass-card rounded-[2rem] border-none overflow-hidden group hover:shadow-2xl hover:-translate-y-1 transition-all duration-500"
                    >
                        <div className="p-6 pb-4">
                            <div className="flex items-start justify-between mb-6">
                               <div className="flex items-center gap-3">
                                  <div className={`p-3 rounded-2xl ${p.side === 'buy' ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-500'}`}>
                                     {p.side === 'buy' ? <Zap size={24} fill="currentColor" /> : <ArrowLeftRight size={24} className="rotate-90" />}
                                  </div>
                                  <div>
                                     <h3 className="text-2xl font-black">{p.symbol}</h3>
                                     <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">{p.provider} • {p.orderType}</p>
                                  </div>
                               </div>
                               <Badge className={`rounded-full px-4 py-1 font-bold border ${getStatusStyle(p.status)}`}>
                                  {p.status.replace('_', ' ')}
                               </Badge>
                            </div>

                            <div className="grid grid-cols-2 gap-4 mb-6">
                               <div className="p-4 bg-muted/30 rounded-2xl border border-border/10">
                                  <p className="text-[10px] font-bold text-muted-foreground uppercase mb-1">Quantity</p>
                                  <p className="text-lg font-bold">{p.quantity}</p>
                                </div>
                                <div className="p-4 bg-muted/30 rounded-2xl border border-border/10">
                                  <p className="text-[10px] font-bold text-muted-foreground uppercase mb-1">Created</p>
                                  <p className="text-sm font-medium">
                                    {p.createdAt?.toDate ? p.createdAt.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '...'}
                                  </p>
                                </div>
                            </div>

                            <div className="space-y-2">
                               <p className="text-[10px] font-bold text-muted-foreground uppercase px-1">AI Rationale</p>
                               <p className="text-sm italic text-muted-foreground bg-muted/20 p-4 rounded-2xl border border-border/5 line-clamp-3 group-hover:line-clamp-none transition-all">
                                  "{p.rationale}"
                               </p>
                            </div>
                        </div>

                        {p.status === 'pending_approval' && (
                          <div className="p-3 bg-background/40 flex gap-2 border-t border-border/10">
                             <Button 
                                variant="ghost" 
                                className="flex-1 rounded-2xl h-12 text-destructive hover:bg-destructive/10 font-bold" 
                                onClick={() => handleReview(p.id, 'rejected')}
                              >
                               <XCircle size={18} className="mr-2" /> Reject
                             </Button>
                             <Button 
                                className="flex-1 rounded-2xl h-12 bg-primary hover:bg-primary shadow-lg shadow-primary/20 font-bold"
                                onClick={() => handleReview(p.id, 'approved')}
                              >
                               <CheckCircle2 size={18} className="mr-2" /> Approve
                             </Button>
                          </div>
                        )}
                        
                        {(p.status === 'executed' || p.status === 'executing') && (
                          <div className="p-4 bg-primary/5 flex items-center justify-center gap-2 border-t border-primary/10">
                             <ShieldCheck size={16} className="text-primary" />
                             <span className="text-xs font-bold text-primary uppercase tracking-widest">Signed & Verified</span>
                          </div>
                        )}
                    </motion.div>
                ))}
            </AnimatePresence>
        </div>
      )}
    </div>
  )
}

export default function App() {
  const isOAuth = new URLSearchParams(window.location.search).has('oauth_request');
  return (
    <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
      <Toaster position="top-right" richColors theme="system" />
      {isOAuth ? <OAuthAuthorize /> : <AuthGuard />}
    </ThemeProvider>
  );
}
