# Trade MCP

Remote MCP server for crypto exchange balances and human-approved trade proposals.

## Quick Start

**MCP URL:** `https://vmi3245942.contaboserver.net/api/mcp/`

1. Open the web dashboard and sign in with Google
2. Go to **Settings & MCP**
3. Use the URL above with any MCP client — authentication is OAuth

## Run Locally

```bash
# Create .env from .env.example
# Required: ENCRYPTION_KEY, FIREBASE_SERVICE_ACCOUNT_KEY
# Generate ENCRYPTION_KEY:
#   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

npm install
npm run dev      # development
npm run build && npm start   # production
```

Docker:

```bash
docker compose up -d --build
```

## Documentation

| File | What it covers |
|------|----------------|
| [docs/agent-guide.md](docs/agent-guide.md) | All MCP tools by group, when to use each, examples |
| [docs/client-setup.md](docs/client-setup.md) | Setup guides for ChatGPT, Claude, Gemini CLI, Cursor |
| [docs/architecture.md](docs/architecture.md) | Exchange Connections vs Data Providers vs MCP Market |
| [docs/troubleshooting.md](docs/troubleshooting.md) | OAuth, Firebase rules, provider keys, upstream failures |

## Environment

Required: `ENCRYPTION_KEY`, `FIREBASE_SERVICE_ACCOUNT_KEY`

Optional: `PORT` (default 3000), `PUBLIC_BASE_URL`, `VITE_PUBLIC_BASE_URL`

Market data provider keys (OANDA, Twelve Data, CoinGecko, CryptoPanic, Messari) are configured in the dashboard under **Market Data Providers**. They are encrypted per user and are not read from server environment variables.
