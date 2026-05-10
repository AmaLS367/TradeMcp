# 🚀 Trade MCP

> 🌐 Remote MCP server for crypto exchange balances and human-approved trade proposals.

![Status](https://img.shields.io/badge/Status-Active-brightgreen) ![Version](https://img.shields.io/badge/Version-1.1.0-blue)

---

## ⚡ Quick Start

**🌍 MCP URL:** `https://vmi3245942.contaboserver.net/api/mcp/`

| Step | Action                                                |
| ---- | ----------------------------------------------------- |
| 1    | Open the web dashboard and sign in with Google        |
| 2    | Go to **Settings & MCP**                       |
| 3    | Use the URL above — authentication is**OAuth** |

---

## 💻 Run Locally

```bash
# 📦 Install
npm install

# 🔧 Development
npm run dev

# 🏭 Production
npm run build && npm start

# 🐳 Docker
docker compose up -d --build
```

### ⚙️ Environment

| Variable                         | Required | Description                                                                                               |
| -------------------------------- | -------- | --------------------------------------------------------------------------------------------------------- |
| `ENCRYPTION_KEY`               | ✅ Yes   | 64-char hex — generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `FIREBASE_SERVICE_ACCOUNT_KEY` | ✅ Yes   | Firebase Admin SDK service account JSON                                                                   |
| `PORT`                         | ❌ No    | Server port (default `3000`)                                                                            |
| `PUBLIC_BASE_URL`              | ❌ No    | Public URL — required in production for OAuth                                                            |

> 📌 Market data provider keys (OANDA, Twelve Data, CoinGecko, CryptoPanic, Messari) are configured in the dashboard under **Market Data Providers**. They are encrypted per user.

---

## 📚 Documentation

| 📄 File                                    | 🎯 What it covers                                       |
| ------------------------------------------ | ------------------------------------------------------- |
| [📖 Agent Guide](docs/agent-guide.md)         | All MCP tools by group, when to use each, examples      |
| [🚀 Client Setup](docs/client-setup.md)       | Setup guides for ChatGPT, Claude, Gemini CLI, Cursor    |
| [🏗️ Architecture](docs/architecture.md)     | Exchange Connections vs Data Providers vs MCP Market    |
| [🔧 Troubleshooting](docs/troubleshooting.md) | OAuth, Firebase rules, provider keys, upstream failures |
