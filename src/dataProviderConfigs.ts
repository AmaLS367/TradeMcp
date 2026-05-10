export const DATA_PROVIDER_CONFIGS = [
  { id: 'oanda', label: 'OANDA', accent: 'bg-blue-500/10 text-blue-500', defaults: { baseUrl: 'https://api-fxpractice.oanda.com', accountId: '', apiKey: '', isActive: true } },
  { id: 'twelve_data', label: 'Twelve Data', accent: 'bg-violet-500/10 text-violet-500', defaults: { baseUrl: 'https://api.twelvedata.com', apiKey: '', isActive: true } },
  { id: 'coingecko', label: 'CoinGecko', accent: 'bg-green-500/10 text-green-500', defaults: { tier: 'demo', apiKey: '', isActive: true } },
  { id: 'cryptopanic', label: 'CryptoPanic', accent: 'bg-red-500/10 text-red-500', defaults: { apiPlan: 'free', apiKey: '', isActive: true } },
  { id: 'messari', label: 'Messari', accent: 'bg-cyan-500/10 text-cyan-500', defaults: { apiKey: '', isActive: true } },
  { id: 'dune', label: 'Dune', accent: 'bg-purple-500/10 text-purple-500', defaults: { apiKey: '', isActive: true } },
  { id: 'newsapi', label: 'NewsAPI', accent: 'bg-amber-500/10 text-amber-500', defaults: { baseUrl: 'https://newsapi.org', apiKey: '', isActive: true } },
  { id: 'taapi', label: 'TAAPI.IO', accent: 'bg-rose-500/10 text-rose-500', defaults: { baseUrl: 'https://api.taapi.io', apiKey: '', isActive: true } },
] as const;
