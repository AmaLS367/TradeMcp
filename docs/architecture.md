# Architecture: Three Data Sources

Trade MCP aggregates three separate categories of external data and execution. Each is managed differently in the dashboard and stored separately in Firestore.

---

## 1. Exchange Connections

**What:** Your Binance and Bybit API keys for reading balances and executing trades.

**Storage:** Firestore `users/{userId}/exchange_connections/{connectionId}`

**Fields:** `provider`, `apiKeyEncrypted`, `apiSecretEncrypted`, `isActive`, `createdAt`

**Security:** API keys are encrypted with AES-256-GCM before writing to Firestore. Only the service account can decrypt them.

**Management:** Dashboard → Exchanges → Add Connection

**Used by:** `get_account_summary`, `create_trade_proposal`, `list_exchange_methods`, `call_exchange_method`

**Validation:** Keys are tested against the exchange API before saving. Binance keys are checked via `GET /api/v3/account`, Bybit keys via `GET /v5/account/wallet-balance`.

**Firebase rules:** Users can create, read, and delete their own connections. Only the `isActive` field can be updated client-side (no key rotation from the browser).

---

## 2. Data Providers

**What:** API keys for market data sources that you bring yourself (BYOK).

**Storage:** Firestore `users/{userId}/data_provider_connections/{provider}`

**Supported providers:**

| Provider | What you get | Key fields |
|----------|-------------|------------|
| OANDA | Real-time forex quotes and candles | `apiKey`, `accountId`, `baseUrl` |
| Twelve Data | Forex technical indicators and candles | `apiKey`, `baseUrl` |
| CoinGecko | Crypto prices, markets, charts, trending | `apiKey`, `tier` (demo/pro) |
| CryptoPanic | Crypto news headlines with sentiment | `apiKey`, `apiPlan` |
| Messari | Fundamental research, timeseries data | `apiKey` |
| Dune | On-chain analytics via MCP Market | API key in marketplace connection |

**Security:** Keys are encrypted with AES-256-GCM before storage. They are decrypted server-side only when making API calls.

**Management:** Dashboard → Market Data Providers

**Used by:** All crypto analysis tools, forex tools, news, and research tools.

---

## 3. MCP Market

**What:** Upstream public MCP servers proxied through Trade MCP's OAuth-protected endpoint. These are pre-configured, no-auth servers that you enable in the dashboard.

**Available servers:**

| Server | Tools | Auth required |
|--------|-------|---------------|
| Crypto.com | Market data (order book, trades, candles) | None |
| CoinGecko Public | Public crypto data (no BYOK needed) | None |
| Chainlink | Chainlink feed and protocol data | None |
| Dune | On-chain analytics, custom queries | Dune API key via Data Providers |

**How it works:** When you enable a marketplace server, Trade MCP connects to its upstream MCP endpoint, lists its tools, and proxies them through the same OAuth-protected endpoint. Tool names get a prefix (`crypto_com__get_book`, `coingecko_public__simple_price`) to avoid collisions.

**Management:** Dashboard → MCP Market → Toggle servers on/off

**Health monitoring:** Each server shows last checked time, tool count, and last error in the dashboard.

---

## Comparison Table

| Aspect | Exchange Connections | Data Providers | MCP Market |
|--------|---------------------|----------------|------------|
| What it stores | Exchange API keys | Market data API keys | Enabled server flags |
| Storage path | `exchange_connections` | `data_provider_connections` | `mcp_server_connections` |
| Encryption | AES-256-GCM | AES-256-GCM | None (no-auth) |
| Required? | Optional | Optional | Optional |
| User-managed? | Dashboard | Dashboard | Dashboard |
| Data returned | Balances, trades | FX, crypto, news | Upstream MCP tools |

---

## Environment Variables

**Required:**
- `ENCRYPTION_KEY` — 64-character hex key for AES-256-GCM. Generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
- `FIREBASE_SERVICE_ACCOUNT_KEY` — Firebase Admin SDK service account JSON

**Optional:**
- `PORT` — Server port (default 3000)
- `PUBLIC_BASE_URL` — Public URL of the server (required in production for correct OAuth redirects and MCP endpoint URLs)
- `VITE_PUBLIC_BASE_URL` — Public MCP endpoint URL for the frontend
