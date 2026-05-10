# 🚀 Client Setup Guides

> 🔗 Setup instructions for connecting AI clients to Trade MCP.

---

## 📋 Prerequisites

All clients use the same MCP endpoint:

```
MCP URL: https://vmi3245942.contaboserver.net/api/mcp/
Authentication: OAuth
```

During OAuth setup, you will be redirected to the Trade MCP dashboard to sign in with Google. Use the Google account that has your exchange connections and data provider keys configured.

---

## 🤖 ChatGPT

![Status](https://img.shields.io/badge/Status-Supported-brightgreen) ![Transport](https://img.shields.io/badge/Transport-Streamable_HTTP-blue)

1. Open ChatGPT → **Settings** → **Connectors**
2. Click **Add Connector** → **Custom MCP**
3. Enter the MCP URL: `https://vmi3245942.contaboserver.net/api/mcp/`
4. Select **OAuth** as the authentication method
5. Follow the OAuth flow — ChatGPT redirects to Trade MCP dashboard
6. Sign in with Google and authorize the connection
7. ✅ Done! The connector is ready

> 💡 **Tip:** ChatGPT uses OAuth authorization code flow with PKCE. Detected automatically in observability metrics.

---

## 🟣 Claude (claude.ai)

![Status](https://img.shields.io/badge/Status-Supported-brightgreen) ![Transport](https://img.shields.io/badge/Transport-Streamable_HTTP-blue)

1. Open Claude → **Settings** → **Integrations** → **MCP**
2. Click **Add MCP Server**
3. Enter the URL: `https://vmi3245942.contaboserver.net/api/mcp/`
4. Select **OAuth** as the authentication method
5. Claude redirects you to Trade MCP dashboard for authorization
6. Sign in with Google and confirm
7. ✅ Connection established!

> 💡 **Tip:** After setup, try asking "What tools do you have available?" to verify.

---

## ⚡ Gemini CLI

![Status](https://img.shields.io/badge/Status-Supported-brightgreen) ![Transport](https://img.shields.io/badge/Transport-Streamable_HTTP-blue)

1. Install and configure Gemini CLI on your machine
2. Add the MCP server to your Gemini CLI configuration:

```json
{
  "mcpServers": {
    "trademcp": {
      "url": "https://vmi3245942.contaboserver.net/api/mcp/",
      "auth": {
        "type": "oauth"
      }
    }
  }
}
```

3. 🔄 Restart Gemini CLI
4. The first tool call triggers the OAuth flow in your browser
5. Complete the Google sign-in and authorization
6. ✅ Ready to go!

> 💡 **Tip:** Detected via User-Agent headers in observability.

---

## 🖥️ Cursor

![Status](https://img.shields.io/badge/Status-Supported-brightgreen) ![Transport](https://img.shields.io/badge/Transport-Streamable_HTTP-blue)

1. Open Cursor → **Settings** → **Features** → **MCP**
2. Click **Add New MCP Server**
3. Set:
   - **Name:** `TradeMCP`
   - **Type:** `URL`
   - **URL:** `https://vmi3245942.contaboserver.net/api/mcp/`
4. Leave authentication as **OAuth** (default for MCP URLs)
5. Click **Save**
6. Cursor redirects you to Trade MCP dashboard for OAuth
7. Sign in with Google and confirm
8. ✅ All set!

> 💡 **Tip:** Detected via OAuth client metadata and User-Agent.

---

## ✅ Verification

After setup, run this in any client:

```
get_trademcp_research_guide({ topic: "overview" })
```

If it returns the research guide — 🎉 **OAuth, MCP discovery, and tool listing all work correctly!**
