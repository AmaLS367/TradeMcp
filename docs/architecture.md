# 🏗️ Architecture: Three Data Sources

> Trade MCP aggregates three separate categories of external data and execution. Each is managed differently in the dashboard and stored separately in Firestore.

---

## 1. 🔐 Exchange Connections

![Purpose](https://img.shields.io/badge/Purpose-Exchange_API_Keys-blue) ![Encryption](https://img.shields.io/badge/Encryption-AES--256--GCM-green)

**What they are:** Your Binance and Bybit API keys for reading balances and executing trades.

**Storage:** Firestore `users/{userId}/exchange_connections/{connectionId}`

**Fields:**
| Field | Description |
|-------|-------------|
| `provider` | `binance` or `bybit` |
| `apiKeyEncrypted` | 🔒 AES-256-GCM encrypted API key |
| `apiSecretEncrypted` | 🔒 AES-256-GCM encrypted API secret |
| `isActive` | ✅ Connection enabled |
| `createdAt` | 📅 When it was added |

**Uses:**
- 💰 `get_account_summary` — Read balances
- 📝 `create_trade_proposal` — Stage trades
- 🔌 `list_exchange_methods` / `call_exchange_method` — Raw API access

**Validation:** Keys are tested against the exchange before saving. Binance uses `GET /api/v3/account`, Bybit uses `GET /v5/account/wallet-balance`.

**🔐 Security:** Only the service account can decrypt keys. Users can create/read/delete their own connections, but only `isActive` can be updated from the client.

> 🎯 **Manage in:** Dashboard → **Exchanges** → **Add Connection**

---

## 2. 🗄️ Data Providers

![Purpose](https://img.shields.io/badge/Purpose-Market_Data_API_Keys-orange) ![Encryption](https://img.shields.io/badge/Encryption-AES--256--GCM-green)

**What they are:** API keys for market data sources that **you bring yourself** (BYOK).

**Storage:** Firestore `users/{userId}/data_provider_connections/{provider}`

**Supported providers:**

| Provider | 🎯 Gives you | 🔑 Key fields |
|----------|-------------|---------------|
| **OANDA** | 💱 Real-time forex quotes & candles | `apiKey`, `accountId`, `baseUrl` |
| **Twelve Data** | 📊 Forex technical indicators & candles | `apiKey`, `baseUrl` |
| **CoinGecko** | 📈 Crypto prices, markets, charts, trending | `apiKey`, `tier` (demo/pro) |
| **CryptoPanic** | 📰 Crypto news with sentiment | `apiKey`, `apiPlan` |
| **Messari** | 🔬 Fundamental research, timeseries data | `apiKey` |
| **Dune** | ⛓️ On-chain analytics | `apiKey` |

**🔐 Security:** Keys are encrypted with AES-256-GCM before storage and decrypted server-side only when making API calls.

> 🎯 **Manage in:** Dashboard → **Market Data Providers**

---

## 3. 🌐 MCP Market

![Purpose](https://img.shields.io/badge/Purpose-Upstream_MCP_Servers-purple) ![Encryption](https://img.shields.io/badge/Encryption-None_(no--auth)-grey)

**What it is:** Upstream public MCP servers proxied through Trade MCP's OAuth-protected endpoint.

**Available servers:**

| Server | 🛠️ Tools | 🔑 Auth |
|--------|----------|---------|
| **Crypto.com** | Market data (order book, trades, candles) | ![Auth](https://img.shields.io/badge/Auth-None-brightgreen) |
| **CoinGecko Public** | Public crypto data (no BYOK needed) | ![Auth](https://img.shields.io/badge/Auth-None-brightgreen) |

**How it works:**
1. You enable a server in the dashboard
2. Trade MCP connects to its upstream MCP endpoint
3. Lists its tools and proxies them through the same OAuth endpoint
4. Tool names get a prefix: `crypto_com__get_book`, `coingecko_public__simple_price`

**Health monitoring:** Each server shows ✅ last checked time, 📊 tool count, and ❌ last error in the dashboard.

> 🎯 **Manage in:** Dashboard → **MCP Market** → Toggle servers on/off

---

## 📊 Comparison Table

| Aspect | 🔐 Exchange Connections | 🗄️ Data Providers | 🌐 MCP Market |
|--------|-----------------------|-------------------|---------------|
| **What it stores** | Exchange API keys | Market data API keys | Enabled server flags |
| **Storage path** | `exchange_connections` | `data_provider_connections` | `mcp_server_connections` |
| **Encryption** | 🔒 AES-256-GCM | 🔒 AES-256-GCM | ❌ None (no-auth) |
| **Required?** | ❌ Optional | ❌ Optional | ❌ Optional |
| **User-managed?** | ✅ Dashboard | ✅ Dashboard | ✅ Dashboard |
| **Data returned** | 💰 Balances, trades | 💱 FX, 📈 crypto, 📰 news | 🛠️ Upstream MCP tools |

---

## ⚙️ Environment Variables

### 🔴 Required

| Variable | Description | How to generate |
|----------|-------------|-----------------|
| `ENCRYPTION_KEY` | 64-char hex key for AES-256-GCM | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `FIREBASE_SERVICE_ACCOUNT_KEY` | Firebase Admin SDK service account JSON | Download from Firebase Console |

### 🟡 Optional

| Variable | Default | What it does |
|----------|---------|--------------|
| `PORT` | `3000` | Server port |
| `PUBLIC_BASE_URL` | `http://localhost:3000` | Public URL — **required in production** for correct OAuth redirects |
| `VITE_PUBLIC_BASE_URL` | — | Public MCP endpoint URL for the frontend |
