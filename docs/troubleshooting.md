# 🔧 Troubleshooting

> Common issues and how to fix them.

---

## 🔑 OAuth Issues

### 🔄 "Sign in with Google" loop

**Symptom:** Client redirects but keeps going back to the Google login screen.

**✅ Fixes:**

1. **Check `PUBLIC_BASE_URL`** — Must match your actual deployment URL. Without it, OAuth redirect URLs are wrong.
   ```bash
   # Server warns on startup if unset in production:
   WARNING: PUBLIC_BASE_URL is not set in production.
   ```

2. **Enable Google sign-in** — Firebase Console → **Authentication** → **Sign-in method** → **Google** → Enable

3. **Check Firestore initialization** — OAuth clients register dynamically, but this needs Firestore to be set up

### 🚫 "Missing auth" error

**Symptom:** Tools return "Missing auth" or "Invalid API key".

**✅ Fix:** Provide authentication via one of these methods:

| Method | How |
|--------|-----|
| 🔗 **OAuth** | Recommended for ChatGPT, Claude web, Cursor, and clients with browser OAuth |
| 🔑 **API Key Bearer** | Recommended for CLI clients. Dashboard → **Settings** → **API Keys** → Generate → Pass as `Authorization: Bearer <key>` |
| 🔗 **API Key URL fallback** | Use `?key=<key>` only when the client cannot send headers |
| 🏷️ **x-api-key header** | Set `x-api-key: <your-key>` on requests |

API keys can be scoped to `safe_research`, `trading_review`, or `full_access`. The server caps tool access to the key profile, so `?profile=full_access` cannot escalate a `safe_research` key.

---

## 🔥 Firebase Rules Errors

### 🚫 "Missing or insufficient permissions"

**Symptom:** Dashboard or API calls fail with permission errors.

**✅ Key rules (from `firestore.rules`):**

| Collection | Who can access |
|------------|----------------|
| `users/{userId}` | 👤 Only the owning user (`request.auth.uid == userId`) |
| `exchange_connections` | 👤 Create, read, delete own. Update only `isActive` |
| `trade_proposals` | 👤 Read and approve/reject. Creation via Admin SDK only |
| `data_provider_connections` | 🚫 **Not from client** — use backend API routes |

> ⚠️ **Common mistake:** Writing to `data_provider_connections` from the browser. Use `PUT /api/mcp/data-providers/:provider` instead.

---

## 🔌 Provider Key Issues

### ❌ "API key not configured" or "provider error"

**Symptom:** Some tools work, others return errors.

**✅ Fix:** Enter the required key in Dashboard → **Market Data Providers**.

**Tools and their required providers:**

| 🛠️ Tools | 🔑 Required provider |
|-----------|---------------------|
| `get_fx_quote`, `get_fx_candles` | OANDA or Twelve Data |
| `get_technical_indicator` | Twelve Data |
| `get_technical_indicator_catalog` | No key required |
| `get_crypto_prices`, `get_crypto_markets`, `get_crypto_market_chart`, `get_crypto_trending` | CoinGecko |
| `get_taapi_indicator`, `get_taapi_bulk_indicators` | TAAPI.IO |
| `get_crypto_news` | CryptoPanic |
| `search_newsapi_articles`, `get_newsapi_top_headlines`, `get_newsapi_sources` | NewsAPI |
| `ask_messari_research`, `get_messari_timeseries_catalog`, `get_messari_timeseries` | Messari |
| `dune__*` marketplace tools | Dune API key in Data Providers + enabled in MCP Market |

> 🔒 Keys are stored encrypted with AES-256-GCM.

---

## 🌐 Upstream MCP Failures

### ❌ Marketplace tools returning errors

**Symptom:** `crypto_com__*` or `coingecko_public__*` tools fail.

**Possible causes:**

| Cause | 🔍 What to check |
|-------|------------------|
| 📡 Upstream server down | Crypto.com or CoinGecko outage |
| ⚙️ Server disabled | Dashboard → **MCP Market** → Is it toggled on? |
| ⏱️ Connection timeout | Server waits 15 seconds before giving up |

**✅ Fix:**
1. Check the dashboard **MCP Market** section — each server shows ✅ health badge, 🕐 last checked time, ❌ last error
2. 🔄 Try disabling and re-enabling the server to refresh the connection
3. If it persists, the upstream server may be down

---

## 📋 Still Stuck?

Check the **Observability dashboard** for:

- 🚨 Recent alert history (failed providers, auth errors, execution failures)
- 📊 Tool usage metrics with error counts and latency
- ⏱️ Provider-level latency tracking

> 💡 **Need more help?** Open an issue or check the dashboard for real-time status.
