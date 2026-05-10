# 🤖 Agent Guide: Trade MCP Tools

> 🛠️ All MCP tools grouped by category with guidance on when to use each group.

---

## 1. 📖 Documentation & Research Guide

![Auth](https://img.shields.io/badge/Auth-None-brightgreen) ![Read-only](https://img.shields.io/badge/Read--Only-blue)

**`get_trademcp_research_guide`** — Always call **first** when the user asks for fundamental analysis, technical analysis, investment memos, or protocol research. Returns playbooks, source-priority rules, and recommended tool sequences. Documentation only, does not fetch market data.

---

## 2. 💰 Account & Portfolio

![Auth](https://img.shields.io/badge/Auth-OAuth_|_API_Key-orange) ![Read-only](https://img.shields.io/badge/Read--Only-blue)

**`get_account_summary`** — Read-only exchange balances from Binance/Bybit. Requires an active exchange connection in the dashboard. Do not use for public market prices.

---

## 3. 📝 Trade Proposals

![Auth](https://img.shields.io/badge/Auth-OAuth_|_API_Key-orange) ![Danger](https://img.shields.io/badge/Danger-Human_Approval_Required-red)

**`create_trade_proposal`** — Stages a trade for human approval in the dashboard. Never executes directly. Requires: `provider`, `symbol`, `side`, `orderType`, `quantity`, `rationale`. Optional Bybit/CCXT order fields such as `stopLoss`, `takeProfit`, and raw `params` are forwarded to `createOrder` after approval.

---

## 4. 🔌 Exchange Methods (Raw CCXT)

![Auth](https://img.shields.io/badge/Auth-OAuth_|_API_Key-orange) ![Danger](https://img.shields.io/badge/Danger-Raw_Exchange_Access-red)

**`list_exchange_methods`** — Discover callable CCXT methods for Binance or Bybit before making a raw API call.

**`call_exchange_method`** — Call any CCXT method (public, private, trading, transfer, raw endpoint) on the user's exchange connection.

> ⚠️ Use these only when built-in tools cannot answer the question.

---

## 5. 📊 Observability

![Auth](https://img.shields.io/badge/Auth-OAuth_|_API_Key-orange) ![Read-only](https://img.shields.io/badge/Read--Only-blue)

**`get_observability_metrics`** — Tool usage stats, provider latency, error rates, recent order events.

**`get_observability_alerts`** — Active unresolved failures in providers, auth flows, or execution paths.

---

## 6. 💱 Forex Market Data

![Auth](https://img.shields.io/badge/Auth-OANDA_|_Twelve_Data_Key-yellow) ![Read-only](https://img.shields.io/badge/Read--Only-blue)

| Tool | Description |
|------|-------------|
| **`get_fx_quote`** | Real-time FX spot rate for pairs like `EUR/USD` |
| **`get_fx_candles`** | Historical FX OHLCV candles |
| **`get_technical_indicator`** | SMA, EMA, RSI, MACD, Bollinger Bands, ATR, ADX, Stoch |

> 🔑 Requires OANDA or Twelve Data API keys in dashboard **Data Providers**.

---

## 7. 📈 Crypto Analysis

### 🟢 CoinGecko

![Auth](https://img.shields.io/badge/Auth-CoinGecko_BYOK_Key-green) ![Read-only](https://img.shields.io/badge/Read--Only-blue)

| Tool | Use for |
|------|---------|
| `get_crypto_prices` | Current spot prices by CoinGecko ID (e.g. `bitcoin`) |
| `get_crypto_markets` | Market rankings, market caps, volume, category filters |
| `get_crypto_market_chart` | Historical price/market cap/volume over time |
| `get_crypto_trending` | Trending assets on CoinGecko |

### 🟡 Binance

![Auth](https://img.shields.io/badge/Auth-None_(Public)-brightgreen) ![Read-only](https://img.shields.io/badge/Read--Only-blue)

| Tool | Use for |
|------|---------|
| `get_binance_ticker` | Current last price for a symbol (e.g. `BTC/USDT`) |
| `get_binance_order_book` | Bid/ask depth, spread, liquidity walls |
| `get_binance_klines` | OHLCV candles for charting and TA |
| `get_binance_24h_stats` | 24h change, volume, high/low |

### 🟠 CryptoPanic

![Auth](https://img.shields.io/badge/Auth-CryptoPanic_Key-orange) ![Read-only](https://img.shields.io/badge/Read--Only-blue)

**`get_crypto_news`** — News headlines with sentiment filters (hot, bullish, bearish, important).

### 🟡 NewsAPI

![Auth](https://img.shields.io/badge/Auth-NewsAPI_Key-yellow) ![Read-only](https://img.shields.io/badge/Read--Only-blue)

| Tool | Use for |
|------|---------|
| `search_newsapi_articles` | Article discovery via NewsAPI `/v2/everything` |
| `get_newsapi_top_headlines` | Live top headlines by country/category/source/query |
| `get_newsapi_sources` | Discover NewsAPI source IDs |

### 🔵 Messari

![Auth](https://img.shields.io/badge/Auth-Messari_Key-blue) ![Read-only](https://img.shields.io/badge/Read--Only-blue)

| Tool | Use for |
|------|---------|
| `ask_messari_research` | Natural-language research questions |
| `get_messari_timeseries_catalog` | Discover available structured datasets |
| `get_messari_timeseries` | Historical metrics for assets, markets, exchanges |

---

## 8. 🔍 Multi-Provider Search & Utility

![Auth](https://img.shields.io/badge/Auth-None_(Public)-brightgreen) ![Read-only](https://img.shields.io/badge/Read--Only-blue)

**`search`** — Unified search across CoinGecko (assets), CryptoPanic (news), and Messari (research). Great for discovery when the user doesn't specify a provider.

**`fetch`** — Fetch content from a public HTTPS URL (first 8000 characters). Useful for reading docs, API responses, or articles.

---

## 9. 🌐 MCP Marketplace Tools

Tools proxied from upstream public MCP servers. Names are prefixed to avoid collisions:

| Prefix | Source | Auth |
|--------|--------|------|
| `crypto_com__*` | Crypto.com market data | ![Auth](https://img.shields.io/badge/Auth-None-brightgreen) |
| `coingecko_public__*` | CoinGecko public MCP | ![Auth](https://img.shields.io/badge/Auth-None-brightgreen) |
| `dune__*` | Dune on-chain analytics | ![Auth](https://img.shields.io/badge/Auth-Dune_Key-blue) |

> ⚙️ Enable these in the dashboard under **MCP Market**.

---

## 🎭 Tool Profiles

Three profiles control which tools are available:

| Profile | 🎯 Includes |
|---------|-------------|
| `safe_research` | 📖 Research guide + 💱 Forex + 📈 Crypto + 🔌 Raw exchange + 🔍 Search |
| `trading_review` | Everything above + 📊 Observability + 💰 Account + 📝 Proposals |
| `full_access` | 🌟 Everything (default) |

> 📌 Set profile via `?profile=safe_research` query parameter when connecting.
