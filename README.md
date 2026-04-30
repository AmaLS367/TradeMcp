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
OANDA_API_KEY=...
OANDA_ACCOUNT_ID=...
OANDA_BASE_URL=https://api-fxpractice.oanda.com
TWELVE_DATA_API_KEY=...
TWELVE_DATA_BASE_URL=https://api.twelvedata.com
```

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
