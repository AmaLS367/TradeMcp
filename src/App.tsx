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
             <MCPSettings user={user} />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

function MCPSettings({ user }: { user: User }) {
   const [apiKeys, setApiKeys] = useState<any[]>([]);
   const [newKeyLabel, setNewKeyLabel] = useState("");
   const [copied, setCopied] = useState("");
   const [error, setError] = useState("");

   const baseUrl = `${window.location.origin}/api/mcp/`;

   useEffect(() => {
       const unsub = onSnapshot(
           collection(db, `users/${user.uid}/api_keys`),
           snap => setApiKeys(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
       );
       return unsub;
   }, [user.uid]);

   const handleGenerate = async () => {
       try {
           const idToken = await user.getIdToken();
           const res = await fetch('/api/mcp/keys', {
               method: 'POST',
               headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
               body: JSON.stringify({ label: newKeyLabel || 'Default' }),
           });
           if (!res.ok) throw new Error(await res.text());
           setNewKeyLabel("");
       } catch (err: any) {
           setError(err.message);
       }
   };

   const handleRevoke = async (id: string) => {
       if (!confirm('Revoke this key?')) return;
       const idToken = await user.getIdToken();
       await fetch(`/api/mcp/keys/${id}`, {
           method: 'DELETE',
           headers: { 'Authorization': `Bearer ${idToken}` },
       });
   };

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
                       Один endpoint для всех клиентов. OAuth тут не используется.
                   </p>
               </div>

               <div className="space-y-3">
                   <Label className="font-semibold">API Keys</Label>
                   <div className="flex gap-2">
                       <Input
                           placeholder="Label (e.g. ChatGPT)"
                           value={newKeyLabel}
                           onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewKeyLabel(e.target.value)}
                       />
                       <Button onClick={handleGenerate}>Generate</Button>
                   </div>
                   {error && <p className="text-red-500 text-sm">{error}</p>}

                   {apiKeys.length === 0 && (
                       <p className="text-sm text-gray-400">Нет ключей. Создай первый.</p>
                   )}

                   <div className="space-y-2">
                       {apiKeys.map(k => {
                           return (
                               <div key={k.id} className="border rounded p-3 space-y-2">
                                   <div className="flex items-center justify-between">
                                       <span className="font-medium text-sm">{k.label}</span>
                                       <Button variant="outline" size="sm" className="text-red-600 border-red-200" onClick={() => handleRevoke(k.id)}>Revoke</Button>
                                   </div>
                                   <div className="flex items-center gap-2">
                                       <input readOnly className="flex-1 text-xs font-mono bg-slate-50 border rounded px-2 py-1" value={k.key} />
                                       <Button variant="outline" size="sm" onClick={() => handleCopy(k.key, k.id)}>
                                           {copied === k.id ? 'Copied!' : 'Copy Key'}
                                       </Button>
                                   </div>
                               </div>
                           );
                       })}
                   </div>
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
      try {
          const idToken = await user.getIdToken();
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
      } catch (err: any) {
          console.error('Error adding connection:', err);
          alert(err.message);
      }
  };

  const handleDeactivate = async (id: string, currentStatus: boolean) => {
       try {
           await updateDoc(doc(db, `users/${user.uid}/exchange_connections`, id), {
               isActive: !currentStatus
           });
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
      } catch (err: any) {
          console.error('Error deleting connection:', err);
          alert(err.message);
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
                    <Button type="submit" className="w-full">Save Connection</Button>
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
      } catch (err) {
          handleFirestoreError(err, OperationType.UPDATE, 'trade_proposals');
          alert('Failed to update proposal');
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
  return <AuthGuard />;
}
