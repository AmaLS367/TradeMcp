# Trade MCP

Remote MCP server for crypto exchange balances and human-approved trade proposals.

## What URL to use

Use a public HTTPS URL. ChatGPT and Claude connect from their cloud infrastructure, so `localhost` and private LAN URLs will not work.

Preferred remote MCP endpoint:

```text
https://YOUR_DOMAIN/api/mcp/
```

Legacy SSE endpoint for older MCP clients:

```text
https://YOUR_DOMAIN/api/mcp/sse
```

## ChatGPT

1. Open the web dashboard.
2. Sign in with Google.
3. Go to `Settings & MCP`.
4. Generate an API key.
5. In ChatGPT connector setup, choose `No authentication`.
6. Paste the generated URL:

```text
https://YOUR_DOMAIN/api/mcp/?key=YOUR_KEY
```

Do not choose OAuth. This project does not implement an OAuth authorization server.

## Claude

For Claude remote MCP/API clients, use:

```text
https://YOUR_DOMAIN/api/mcp/
```

Pass the generated key as a bearer token:

```text
Authorization: Bearer YOUR_KEY
```

If the client only supports SSE, use:

```text
https://YOUR_DOMAIN/api/mcp/sse?key=YOUR_KEY
```

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
