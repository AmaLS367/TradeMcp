# Troubleshooting

---

## OAuth Issues

**Symptom:** Client redirects but gets stuck in a "Sign in with Google" loop.

**Check:**
1. Verify `PUBLIC_BASE_URL` matches the actual deployment URL. Without it, OAuth issuer URLs are wrong and redirects fail. The server warns on startup if unset in production.
2. In Firebase Console → Authentication → Sign-in method, confirm Google sign-in is enabled.
3. OAuth clients are registered dynamically (no manual setup needed), but if registration fails, check that the Firebase project has Firestore initialized.

**Symptom:** "Missing auth" error when calling tools.

**Fix:** Provide authentication via one of these methods:
- Connect via OAuth (recommended for ChatGPT, Claude, Cursor)
- Generate an API key in Dashboard → Settings → API Keys, then pass it as a `Bearer` token in the `Authorization` header, or as `?key=` query parameter, or as `x-api-key` header

---

## Firebase Rules Errors

**Symptom:** "Missing or insufficient permissions" in the dashboard or API.

**Key rules in `firestore.rules`:**
- `users/{userId}` — Only the owning user (`request.auth.uid == userId`) can access their own data
- `exchange_connections` — Users can create, read, and delete. Only `isActive` can be updated from the client
- `trade_proposals` — Users can read and approve/reject. Creation uses the Admin SDK (server-side only)
- `data_provider_connections` — Require backend API routes, not direct client access

**Common mistake:** Writing to `data_provider_connections` directly from the browser. This must go through the backend API (`PUT /api/mcp/data-providers/:provider`).

---

## Provider Key Issues

**Symptom:** Tools return "API key not configured" or "provider error".

**Root cause:** The required API key was not entered in Dashboard → Market Data Providers.

**Tools and their required providers:**

| Tools | Required provider |
|-------|-------------------|
| `get_fx_quote`, `get_fx_candles` | OANDA or Twelve Data |
| `get_technical_indicator` | Twelve Data |
| `get_crypto_prices`, `get_crypto_markets`, `get_crypto_market_chart`, `get_crypto_trending` | CoinGecko |
| `get_crypto_news` | CryptoPanic |
| `ask_messari_research`, `get_messari_timeseries_catalog`, `get_messari_timeseries` | Messari |
| `dune__*` marketplace tools | Dune API key in Data Providers |

**Key storage:** Provider keys are stored at `users/{userId}/data_provider_connections/{provider}` and encrypted with AES-256-GCM. You manage them in the dashboard; they are never exposed to AI clients.

---

## Upstream MCP Failures

**Symptom:** Marketplace tools (`crypto_com__*`, `coingecko_public__*`) return errors.

**Possible causes:**
- The upstream MCP server is down (Crypto.com, CoinGecko, Chainlink, Dune outage)
- The server was disabled in Dashboard → MCP Market
- Connection timeout (the server waits 15 seconds before giving up)

**Fix:**
1. Check the dashboard MCP Market section — each server shows a health badge, last checked time, and last error
2. Try disabling and re-enabling the server to refresh the connection
3. If the error persists, the upstream server may be experiencing an outage

---

## Still Stuck?

Check the observability dashboard for:
- Recent alert history (failed providers, auth errors, execution failures)
- Tool usage metrics with error counts and latency
- Provider-level latency tracking
