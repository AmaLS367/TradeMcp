# Agent Guide: Trade MCP Tools

All MCP tools grouped by category, with guidance on when to use each group.

---

## 1. Documentation & Research Guide

**`get_trademcp_research_guide`** — Always call first when the user asks for fundamental analysis, technical analysis, investment memos, or protocol research. Returns playbooks, source-priority rules, and recommended tool sequences. Documentation only, does not fetch market data.

---

## 2. Account & Portfolio

**`get_account_summary`** — Read-only exchange balances from Binance/Bybit. Requires an active exchange connection in the dashboard. Do not use for public market prices.

---

## 3. Trade Proposals

**`create_trade_proposal`** — Stages a trade for human approval in the dashboard. Never executes directly. Requires: `provider`, `symbol`, `side`, `orderType`, `quantity`, `rationale`. The user must approve in the dashboard before execution.

---

## 4. Exchange Methods (Raw CCXT)

**`list_exchange_methods`** — Discover callable CCXT methods for Binance or Bybit before making a raw API call.

**`call_exchange_method`** — Call any CCXT method (public, private, trading, transfer, raw endpoint) on the user's exchange connection.

Use these only when built-in tools cannot answer the question.

---

## 5. Observability

**`get_observability_metrics`** — Tool usage stats, provider latency, error rates, recent order events.

**`get_observability_alerts`** — Active unresolved failures in providers, auth flows, or execution paths.

Requires authentication.

---

## 6. Forex Market Data

**`get_fx_quote`** — Real-time FX spot rate for pairs like `EUR/USD`. Uses OANDA or Twelve Data.

**`get_fx_candles`** — Historical FX OHLCV candles.

**`get_technical_indicator`** — Technical indicators: SMA, EMA, RSI, MACD, Bollinger Bands, ATR, ADX, Stoch.

Requires OANDA or Twelve Data API keys in dashboard Data Providers.

---

## 7. Crypto Analysis

### CoinGecko (requires CoinGecko BYOK API key)

| Tool | Use for |
|------|---------|
| `get_crypto_prices` | Current spot prices by CoinGecko ID (e.g. `bitcoin`) |
| `get_crypto_markets` | Market rankings, market caps, volume, category filters |
| `get_crypto_market_chart` | Historical price/market cap/volume over time |
| `get_crypto_trending` | Trending assets on CoinGecko |

### Binance (public, no API key needed)

| Tool | Use for |
|------|---------|
| `get_binance_ticker` | Current last price for a symbol (e.g. `BTC/USDT`) |
| `get_binance_order_book` | Bid/ask depth, spread, liquidity walls |
| `get_binance_klines` | OHLCV candles for charting and TA |
| `get_binance_24h_stats` | 24h change, volume, high/low |

### CryptoPanic (requires API key)

**`get_crypto_news`** — News headlines with sentiment filters (hot, bullish, bearish, important).

### Messari (requires API key)

**`ask_messari_research`** — Natural-language research questions about fundamentals, tokenomics, sectors.

**`get_messari_timeseries_catalog`** — Discover available structured datasets.

**`get_messari_timeseries`** — Historical metrics for assets, markets, exchanges, networks.

---

## 8. Multi-Provider Search & Utility

**`search`** — Unified search across CoinGecko (assets), CryptoPanic (news), and Messari (research). Good for discovery when the user doesn't specify a provider.

**`fetch`** — Fetch content from a public HTTPS URL. Returns first 8000 characters. Useful for reading docs, API responses, or articles.

---

## 9. MCP Marketplace Tools

Tools proxied from upstream public MCP servers. Names are prefixed to avoid collisions:

- `crypto_com__*` — Crypto.com exchange market data
- `coingecko_public__*` — CoinGecko public MCP (no BYOK key needed)
- `chainlink__*` — Chainlink feed and protocol data
- `dune__*` — Dune on-chain analytics (requires Dune API key in Data Providers)

Enable these in the dashboard under MCP Market.

---

## Tool Profiles

Three profiles control which tools are available:

| Profile | Includes |
|---------|----------|
| `safe_research` | Research guide + forex + crypto analysis + raw exchange + search/fetch |
| `trading_review` | safe_research + observability + account summary + trade proposals |
| `full_access` | Everything (default when no profile is set) |

Set profile via `?profile=safe_research` query parameter when connecting.
