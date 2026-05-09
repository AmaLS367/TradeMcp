# Trade MCP

Remote MCP server for crypto exchange balances and human-approved trade proposals.

## MCP URL

Use a public HTTPS URL. ChatGPT and Claude connect from their cloud infrastructure, so `localhost` and private LAN URLs will not work.

Use this endpoint everywhere:

```text
https://vmi3245942.contaboserver.net/api/mcp/
```

## Connect

1. Open the web dashboard.
2. Sign in with Google.
3. Go to `Settings & MCP`.
4. Use this MCP server URL:

```text
https://vmi3245942.contaboserver.net/api/mcp/
```

Authentication: OAuth.

During connector setup, ChatGPT redirects you to the Trade MCP dashboard. Sign in with the Google account whose exchange connections should be used.

## Environment

Create `.env` from `.env.example`.

Required:

```text
ENCRYPTION_KEY=64_character_hex_key
FIREBASE_SERVICE_ACCOUNT_KEY='{"type":"service_account","project_id":"..."}'
```

Generate `ENCRYPTION_KEY`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Optional:

```text
PORT=3000
PUBLIC_BASE_URL=https://vmi3245942.contaboserver.net
VITE_PUBLIC_BASE_URL=https://vmi3245942.contaboserver.net/api/mcp/
```

Market data keys are BYOK credentials. Add OANDA, Twelve Data, CoinGecko, CryptoPanic, and Messari keys in the dashboard under `Market Data Providers`; they are encrypted per user and are not read from server environment variables.

Public MCP servers are managed separately in the dashboard under `MCP Market`. These no-auth servers are enabled per user and proxied through the same OAuth-protected Trade MCP endpoint.

## Run

```bash
npm install
npm run dev
```

Production:

```bash
npm run build
npm start
```

Docker:

```bash
docker compose up -d --build
```

## MCP tools

`get_account_summary`

Returns balances from active Binance/Bybit connections. Read-only.

`create_trade_proposal`

Creates a pending trade proposal in the dashboard. The proposal must be approved by the user before execution.

`list_exchange_methods`

Lists callable CCXT methods for `binance` or `bybit`, including unified and raw exchange-specific methods.

`call_exchange_method`

Calls any callable CCXT method on the authenticated user's Binance or Bybit connection. Pass method arguments exactly as CCXT expects.

`get_fx_quote`

Returns a real-time forex quote for pairs like `EUR/USD`, `EUR_USD`, or `EURUSD`. Uses OANDA by default with Twelve Data fallback when provider is `auto`.

`get_fx_candles`

Returns forex candles from OANDA by default. Twelve Data can be selected with `provider: "twelve"`.

`get_technical_indicator`

Returns Twelve Data technical indicators for forex pairs. Supported indicators: `sma`, `ema`, `rsi`, `macd`, `bbands`, `atr`, `adx`, `stoch`.

`get_crypto_prices`

Returns current crypto prices from CoinGecko using the authenticated user's CoinGecko key.

`get_crypto_markets`

Returns CoinGecko market rankings, market caps, prices, and volume.

`get_crypto_market_chart`

Returns CoinGecko historical market chart data for a coin ID.

`get_crypto_trending`

Returns trending crypto assets from CoinGecko.

`get_binance_ticker`

Returns public Binance ticker data through CCXT. This does not require a Binance API key.

`get_binance_order_book`

Returns public Binance order book data through CCXT. This does not require a Binance API key.

`get_binance_klines`

Returns public Binance OHLCV candles through CCXT. This does not require a Binance API key.

`get_binance_24h_stats`

Returns public Binance 24h ticker stats through CCXT.

`get_crypto_news`

Returns CryptoPanic news using the authenticated user's CryptoPanic key.

`ask_messari_research`

Sends a natural-language crypto research question to Messari using the authenticated user's Messari key.

`get_messari_timeseries_catalog`

Returns the Messari timeseries dataset catalog for the authenticated user's Messari plan.

`get_messari_timeseries`

Returns Messari timeseries data for an asset, market, exchange, or network when the user's Messari plan allows it.

Marketplace MCP tools

Tools from enabled MCP Market servers are listed dynamically with collision-safe prefixes:

- `crypto_com__<tool>` from Crypto.com MCP
- `coingecko_public__<tool>` from CoinGecko Public MCP

Enable these servers in the dashboard under `MCP Market`; no API key is required for the initial Crypto.com and CoinGecko public MCP servers.

## Market Data Providers

Dashboard provider keys are stored at `users/{userId}/data_provider_connections/{provider}` and accessed only through backend API routes under `/api/mcp/data-providers/*`.

Supported providers:

- OANDA: `apiKey`, `accountId`, `baseUrl`
- Twelve Data: `apiKey`, `baseUrl`
- CoinGecko: `apiKey`, `tier` (`demo` or `pro`)
- CryptoPanic: `apiKey`, `apiPlan`
- Messari: `apiKey`

CoinGecko and Messari hosted MCP options were reviewed, but Trade MCP uses dashboard-owned BYOK credentials so all analytics tools share one OAuth-protected MCP endpoint.

## MCP Market

Dashboard MCP server connections are stored at `users/{userId}/mcp_server_connections/{serverId}` and accessed only through backend API routes under `/api/mcp/mcp-servers/*`.

Supported public no-auth MCP servers:

- Crypto.com: `https://mcp.crypto.com/market-data/mcp`
- CoinGecko Public MCP: `https://mcp.api.coingecko.com/mcp`

Marketplace tools are proxied through the existing `/api/mcp/` endpoint only after the user connects the server in the dashboard.
