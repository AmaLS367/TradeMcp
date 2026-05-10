# Client Setup Guides

## Prerequisites

All clients use the same MCP endpoint:

```
MCP URL: https://vmi3245942.contaboserver.net/api/mcp/
Authentication: OAuth
```

During OAuth setup, you will be redirected to the Trade MCP dashboard to sign in with Google. Use the Google account that has your exchange connections and data provider keys configured.

---

## ChatGPT

1. Open ChatGPT and go to Settings → Connectors
2. Click "Add Connector" and select "Custom MCP"
3. Enter the MCP URL: `https://vmi3245942.contaboserver.net/api/mcp/`
4. Select OAuth as the authentication method
5. Follow the OAuth flow — ChatGPT will redirect you to the Trade MCP dashboard
6. Sign in with Google and authorize the connection
7. Return to ChatGPT — the connector is ready

**Tip:** ChatGPT uses the OAuth authorization code flow with PKCE. The connector type is detected automatically and shown in observability metrics.

---

## Claude (claude.ai)

1. Open Claude Settings → Integrations → MCP
2. Click "Add MCP Server"
3. Enter the MCP URL: `https://vmi3245942.contaboserver.net/api/mcp/`
4. Select OAuth as the authentication method
5. Claude redirects you to the Trade MCP dashboard for authorization
6. Sign in with Google and confirm
7. The connection is established

**Tip:** Claude uses the MCP Streamable HTTP transport and OAuth. After connecting, try asking "What tools do you have available?" to verify.

---

## Gemini CLI

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

3. Restart Gemini CLI
4. The first tool call will trigger the OAuth flow in your browser
5. Complete the Google sign-in and authorization

**Tip:** Gemini CLI uses the MCP Streamable HTTP transport. Detected via User-Agent headers in observability.

---

## Cursor

1. Open Cursor Settings → Features → MCP
2. Click "Add New MCP Server"
3. Set Name: `TradeMCP`
4. Set Type: `URL`
5. Enter the MCP URL: `https://vmi3245942.contaboserver.net/api/mcp/`
6. Leave authentication as OAuth (default for MCP URLs)
7. Click Save
8. Cursor redirects you to the Trade MCP dashboard for OAuth authorization
9. Sign in with Google and confirm

**Tip:** Cursor uses the MCP Streamable HTTP transport with OAuth PKCE flow. Detected via OAuth client metadata and User-Agent.

---

## Verification

After setup, run this in any client:

```
get_trademcp_research_guide({ topic: "overview" })
```

If it returns the research guide, OAuth, MCP discovery, and tool listing all work correctly.
