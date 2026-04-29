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
4. Generate an API key.
5. Use this MCP server URL:

```text
https://vmi3245942.contaboserver.net/api/mcp/
```

6. Use the generated key as the MCP API key or bearer token when the client supports it:

```text
Authorization: Bearer YOUR_KEY
```

OAuth is not implemented in this project.

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
