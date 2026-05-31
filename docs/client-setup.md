# 🚀 Client Setup Guides

> 🔗 Setup instructions for connecting AI clients to Trade MCP.

---

## 📋 Prerequisites

All clients use the same MCP endpoint:

```text
MCP URL: https://your-domain.example/api/mcp/
Web authentication: OAuth
CLI authentication: Dashboard API key as Authorization: Bearer <key>
```

During OAuth setup, web clients redirect to the Trade MCP dashboard to sign in with Google. CLI clients should generate an API key in **Dashboard → Settings → API Keys** and pass it as a Bearer token.

API keys have an access profile. A key cannot access tools above its profile even if the URL requests a higher `?profile=`.

---

## 🤖 ChatGPT

![Status](https://img.shields.io/badge/Status-Supported-brightgreen) ![Transport](https://img.shields.io/badge/Transport-Streamable_HTTP-blue) ![Auth](https://img.shields.io/badge/Auth-OAuth-purple)

1. Open ChatGPT → **Settings** → **Connectors**
2. Click **Add Connector** → **Custom MCP**
3. Enter the MCP URL: `https://your-domain.example/api/mcp/`
4. Select **OAuth** as the authentication method
5. Follow the OAuth flow — ChatGPT redirects to Trade MCP dashboard
6. Sign in with Google and authorize the connection
7. ✅ Done! The connector is ready

> 💡 **Tip:** ChatGPT uses OAuth authorization code flow with PKCE. Trade MCP detects this in observability metrics.

---

## 🟣 Claude (claude.ai)

![Status](https://img.shields.io/badge/Status-Supported-brightgreen) ![Transport](https://img.shields.io/badge/Transport-Streamable_HTTP-blue) ![Auth](https://img.shields.io/badge/Auth-OAuth-purple)

1. Open Claude → **Settings** → **Integrations** → **MCP**
2. Click **Add MCP Server**
3. Enter the URL: `https://your-domain.example/api/mcp/`
4. Select **OAuth** as the authentication method
5. Claude redirects you to Trade MCP dashboard for authorization
6. Sign in with Google and confirm
7. ✅ Connection established!

> 💡 **Tip:** After setup, ask "What tools do you have available?" to verify discovery.

---

## ⚡ Gemini CLI

![Status](https://img.shields.io/badge/Status-Supported-brightgreen) ![Transport](https://img.shields.io/badge/Transport-mcp--remote-blue) ![Auth](https://img.shields.io/badge/Auth-API_Key-orange)

1. Install and configure Gemini CLI on your machine
2. Generate an API key in Trade MCP → **Settings** → **API Keys**
3. Add the MCP server to your Gemini CLI configuration:

```json
{
  "mcpServers": {
    "trade-mcp": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "https://your-domain.example/api/mcp/?profile=trading_review",
        "--header",
        "Authorization: Bearer ${TRADEMCP_API_KEY}"
      ],
      "env": {
        "TRADEMCP_API_KEY": "paste-your-dashboard-api-key"
      }
    }
  }
}
```

4. 🔄 Restart Gemini CLI
5. ✅ Ready to go!

> 💡 **Tip:** Use `?profile=safe_research` for read-mostly research workflows.

### 🧪 Gemini Antigravity

Use the same API-key Bearer pattern in `~/.gemini/antigravity/mcp_config.json`.

If your Antigravity build only supports `serverURL`, use this fallback:

```text
https://your-domain.example/api/mcp/?profile=trading_review&key=YOUR_DASHBOARD_API_KEY
```

---

## 🖥️ Cursor

![Status](https://img.shields.io/badge/Status-Supported-brightgreen) ![Transport](https://img.shields.io/badge/Transport-Streamable_HTTP-blue) ![Auth](https://img.shields.io/badge/Auth-OAuth-purple)

1. Open Cursor → **Settings** → **Features** → **MCP**
2. Click **Add New MCP Server**
3. Set:
   - **Name:** `TradeMCP`
   - **Type:** `URL`
   - **URL:** `https://your-domain.example/api/mcp/`
4. Leave authentication as **OAuth** when available
5. Click **Save**
6. Cursor redirects you to Trade MCP dashboard for OAuth
7. Sign in with Google and confirm
8. ✅ All set!

> 💡 **Tip:** Cursor clients show up in observability through OAuth metadata and User-Agent detection.

---

## ✅ Verification

After setup, run this in any client:

```json
{
  "topic": "overview"
}
```

with the tool:

```text
get_trademcp_research_guide
```

If it returns the research guide — 🎉 **OAuth, MCP discovery, and tool listing all work correctly!**
