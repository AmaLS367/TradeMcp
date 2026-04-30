import React, { useState, useEffect } from 'react';
import { onAuthStateChanged, User, signInWithPopup, GoogleAuthProvider, signOut } from 'firebase/auth';
import { auth, db } from './firebase';
import { Button } from '../components/ui/button';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '../components/ui/card';
import { collection, query, onSnapshot, doc, updateDoc } from 'firebase/firestore';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Badge } from '../components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Toaster, toast } from 'sonner';

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}
interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: any;
}

function handleUIError(error: any, context: string) {
    console.error(`[${context}]`, error);
    const message = error instanceof Error ? error.message : String(error);
    toast.error(message);
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  toast.error(`Database error during ${operationType} on ${path || 'unknown path'}`);
}

function AuthGuard() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    return onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
  }, []);

  if (loading) return <div className="p-8 text-center text-gray-500">Loading...</div>;

  if (!user) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle>Trade MCP Server</CardTitle>
            <CardDescription>Sign in to manage your crypto AI agent</CardDescription>
          </CardHeader>
          <CardContent>
            <Button className="w-full" onClick={() => signInWithPopup(auth, new GoogleAuthProvider())}>
              Sign in with Google
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="bg-white border-b px-6 py-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Trade MCP</h1>
        
        <div className="flex items-center gap-4">
             <span className="text-sm text-gray-500">{user.email}</span>
             <Button variant="outline" size="sm" onClick={() => signOut(auth)}>Sign out</Button>
        </div>
      </header>
      <main className="flex-1 p-6 max-w-5xl mx-auto w-full">
         <Tabs defaultValue="proposals">
          <TabsList className="mb-6">
            <TabsTrigger value="proposals">Proposals</TabsTrigger>
            <TabsTrigger value="connections">Exchanges</TabsTrigger>
            <TabsTrigger value="settings">Settings & MCP</TabsTrigger>
          </TabsList>
          
          <TabsContent value="proposals">
             <ProposalsList user={user} />
          </TabsContent>
          
          <TabsContent value="connections">
             <ExchangeConnections user={user} />
          </TabsContent>

          <TabsContent value="settings">
             <MCPSettings />
          </TabsContent>
        </Tabs>
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
        if (!cancelled) {
          window.location.href = data.redirectUrl;
        }
      } catch (err: any) {
        if (!cancelled) setError(err.message);
      }
    }

    completeOAuth();
    return () => {
      cancelled = true;
    };
  }, [user, requestId]);

  if (!requestId) {
    return <div className="p-8 text-center text-red-500">Missing OAuth request.</div>;
  }

  if (loading) {
    return <div className="p-8 text-center text-gray-500">Loading...</div>;
  }

  if (!user) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle>Connect Trade MCP</CardTitle>
            <CardDescription>Sign in to authorize this connector.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button className="w-full" onClick={() => signInWithPopup(auth, new GoogleAuthProvider())}>
              Sign in with Google
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex h-screen items-center justify-center bg-gray-50">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Connecting Trade MCP</CardTitle>
          <CardDescription>{user.email}</CardDescription>
        </CardHeader>
        <CardContent>
          {error ? <p className="text-sm text-red-500">{error}</p> : <p className="text-sm text-gray-500">Finishing authorization...</p>}
        </CardContent>
      </Card>
    </div>
  );
}

function MCPSettings() {
   const [copied, setCopied] = useState("");

   const baseUrl = import.meta.env.VITE_PUBLIC_BASE_URL || window.location.origin + '/api/mcp/';

   const handleCopy = (text: string, key: string) => {
       navigator.clipboard.writeText(text);
       setCopied(key);
       setTimeout(() => setCopied(""), 2000);
   };

   return (
       <Card>
           <CardHeader>
               <CardTitle>MCP Server</CardTitle>
               <CardDescription>Подключи любой LLM — ChatGPT, Claude, Cursor и другие</CardDescription>
           </CardHeader>
           <CardContent className="space-y-6">
               <div className="p-3 bg-slate-50 rounded space-y-2">
                   <p className="text-xs text-gray-500 font-medium uppercase">MCP Server URL</p>
                   <div className="flex items-center gap-2">
                       <code className="text-sm flex-1 break-all">{baseUrl}</code>
                       <Button variant="outline" size="sm" onClick={() => handleCopy(baseUrl, 'url')}>
                           {copied === 'url' ? 'Copied!' : 'Copy'}
                       </Button>
                   </div>
                   <p className="text-xs text-gray-500">
                       Один endpoint для всех клиентов. Authentication: OAuth.
                   </p>
               </div>
           </CardContent>
       </Card>
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
      
      // Сначала валидируем ключи
      setValidationStatus('validating');
      setValidationError('');
      
      try {
        const idToken = await user.getIdToken();
        const validateResponse = await fetch('/api/validate-keys', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${idToken}`
          },
          body: JSON.stringify({ 
            exchange: provider, 
            apiKey, 
            apiSecret 
          })
        });
        
        const validateResult = await validateResponse.json();
        
        if (!validateResult.valid) {
          setValidationStatus('invalid');
          setValidationError(validateResult.error || 'Неизвестная ошибка валидации');
          return;
        }
        
        setValidationStatus('valid');
        
        // Если валидация успешна, добавляем подключение
        const response = await fetch('/api/mcp/connections', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${idToken}`
            },
            body: JSON.stringify({ provider, apiKey, apiSecret })
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(errorText || 'Failed to add connection');
        }
        
        setApiKey('');
        setApiSecret('');
        setValidationStatus('idle');
        setValidationError('');
        toast.success('Ключи успешно проверены и подключение добавлено!');
      } catch (err: any) {
          setValidationStatus('invalid');
          setValidationError(err.message);
          handleUIError(err, 'Add Connection');
      }
  };

  const handleDeactivate = async (id: string, currentStatus: boolean) => {
       try {
           await updateDoc(doc(db, `users/${user.uid}/exchange_connections`, id), {
               isActive: !currentStatus
           });
           toast.success(`Connection ${currentStatus ? 'deactivated' : 'activated'}`);
       } catch (err) {
           handleFirestoreError(err, OperationType.UPDATE, 'exchange_connections');
       }
  };

  const handleDelete = async (id: string) => {
      if (!confirm('Are you sure you want to delete this connection?')) return;
      try {
          const idToken = await user.getIdToken();
          const response = await fetch(`/api/mcp/connections/${id}`, {
              method: 'DELETE',
              headers: {
                  'Authorization': `Bearer ${idToken}`
              }
          });
          if (!response.ok) {
              const errorText = await response.text();
              throw new Error(errorText || 'Failed to delete connection');
          }
          toast.success('Connection deleted successfully');
      } catch (err: any) {
          handleUIError(err, 'Delete Connection');
      }
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
            <CardHeader>
                <CardTitle>Add Connection</CardTitle>
                <CardDescription>Connect Binance or Bybit read/write API keys.</CardDescription>
            </CardHeader>
            <CardContent>
                <form onSubmit={handleAdd} className="space-y-4">
                    <div className="space-y-2">
                        <Label>Exchange Provider</Label>
                        <select className="w-full flex h-10 rounded-md border border-input bg-background px-3 py-2 text-sm" value={provider} onChange={e => setProvider(e.target.value)}>
                             <option value="binance">Binance</option>
                             <option value="bybit">Bybit</option>
                        </select>
                    </div>
                    <div className="space-y-2">
                         <Label>API Key</Label>
                         <Input value={apiKey} onChange={e => setApiKey(e.target.value)} required />
                    </div>
                    <div className="space-y-2">
                         <Label>API Secret</Label>
                         <Input type="password" value={apiSecret} onChange={e => setApiSecret(e.target.value)} required />
                    </div>
                    {validationStatus === 'validating' && (
                      <div className="text-sm text-blue-600">Проверка ключей...</div>
                    )}
                    {validationStatus === 'valid' && (
                      <div className="text-sm text-green-600">✓ Ключи успешно проверены</div>
                    )}
                    {validationStatus === 'invalid' && validationError && (
                      <div className="text-sm text-red-600">✗ {validationError}</div>
                    )}
                    <Button 
                      type="submit" 
                      className="w-full" 
                      disabled={validationStatus === 'validating'}
                    >
                      {validationStatus === 'validating' ? 'Проверка...' : 'Save Connection'}
                    </Button>
                </form>
            </CardContent>
        </Card>

        <Card>
             <CardHeader>
                 <CardTitle>Your Connections</CardTitle>
             </CardHeader>
             <CardContent>
                 {loading ? <p>Loading...</p> : connections.length === 0 ? <p className="text-gray-500 text-sm">No connections added yet.</p> : (
                     <div className="space-y-4">
                         {connections.map(c => (
                             <div key={c.id} className="flex items-center justify-between p-4 border rounded">
                                 <div>
                                     <p className="font-semibold capitalize">{c.provider}</p>
                                     <p className="text-sm text-gray-500 font-mono">{c.apiKeyPreview || '...'}</p>
                                 </div>
                                 <div className="flex items-center gap-2">
                                     <Badge variant={c.isActive ? 'default' : 'secondary'}>{c.isActive ? 'Active' : 'Inactive'}</Badge>
                                     <Button variant="outline" size="sm" onClick={() => handleDeactivate(c.id, c.isActive)}>Toggle</Button>
                                     <Button variant="destructive" size="sm" onClick={() => handleDelete(c.id)}>Delete</Button>
                                 </div>
                             </div>
                         ))}
                     </div>
                 )}
             </CardContent>
        </Card>
    </div>
  );
}

function ProposalsList({ user }: { user: User }) {
   const [proposals, setProposals] = useState<any[]>([]);
   
   useEffect(() => {
    const q = query(collection(db, `users/${user.uid}/trade_proposals`));
    const unsub = onSnapshot(q, (snap) => {
      setProposals(snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a: any, b: any) => new Date(b.createdAt?.toDate?.() || 0).getTime() - new Date(a.createdAt?.toDate?.() || 0).getTime()));
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'trade_proposals'));
    return unsub;
  }, [user.uid]);

  const handleReview = async (id: string, status: 'approved' | 'rejected') => {
      try {
          await updateDoc(doc(db, `users/${user.uid}/trade_proposals`, id), {
              status,
              approvedAt: new Date().toISOString()
          });
          toast.success(`Proposal ${status}`);
      } catch (err) {
          handleFirestoreError(err, OperationType.UPDATE, 'trade_proposals');
      }
  };

  return (
      <Card>
          <CardHeader>
              <CardTitle>Trade Proposals</CardTitle>
              <CardDescription>Review and approve trades proposed by your LLM.</CardDescription>
          </CardHeader>
          <CardContent>
              {proposals.length === 0 ? <p className="text-gray-500 text-sm">No proposals matching criteria.</p> : (
                  <Table>
                      <TableHeader>
                          <TableRow>
                              <TableHead>Time</TableHead>
                              <TableHead>Symbol</TableHead>
                              <TableHead>Action</TableHead>
                              <TableHead>Quantity</TableHead>
                              <TableHead>Rationale</TableHead>
                              <TableHead>Status</TableHead>
                              <TableHead className="text-right">Actions</TableHead>
                          </TableRow>
                      </TableHeader>
                      <TableBody>
                          {proposals.map(p => (
                              <TableRow key={p.id}>
                                  <TableCell>{p.createdAt?.toDate ? p.createdAt.toDate().toLocaleString() : '...'}</TableCell>
                                  <TableCell className="font-bold">{p.symbol}</TableCell>
                                  <TableCell className={`font-semibold ${p.side === 'buy' ? 'text-green-600' : 'text-red-500'} capitalize`}>{p.side}</TableCell>
                                  <TableCell>{p.quantity}</TableCell>
                                  <TableCell className="max-w-[200px] truncate" title={p.rationale}>{p.rationale}</TableCell>
                                  <TableCell>
                                      <Badge variant={
                                          p.status === 'approved' ? 'default' :
                                          p.status === 'rejected' ? 'destructive' :
                                          p.status === 'executed' ? 'default' : 
                                          p.status === 'executing' ? 'secondary' : 'secondary'
                                      }>{p.status.replace('_', ' ')}</Badge>
                                  </TableCell>
                                  <TableCell className="text-right">
                                      {p.status === 'pending_approval' && (
                                          <div className="flex justify-end gap-2">
                                              <Button size="sm" variant="outline" className="text-red-600 border-red-200 hover:bg-red-50" onClick={() => handleReview(p.id, 'rejected')}>Reject</Button>
                                              <Button size="sm" className="bg-green-600 hover:bg-green-700" onClick={() => handleReview(p.id, 'approved')}>Approve</Button>
                                          </div>
                                      )}
                                  </TableCell>
                              </TableRow>
                          ))}
                      </TableBody>
                  </Table>
              )}
          </CardContent>
      </Card>
  )
}

export default function App() {
  const isOAuth = new URLSearchParams(window.location.search).has('oauth_request');
  
  return (
    <>
      <Toaster position="top-right" richColors />
      {isOAuth ? <OAuthAuthorize /> : <AuthGuard />}
    </>
  );
}
