# Trade MCP TODOs

## AI Client Connections

- Add a dedicated "Connect AI Clients" dashboard section for ChatGPT, Claude, Gemini CLI, Cursor, and other MCP clients.
- Provide copy-ready client configuration snippets for each supported AI client.
- Add client-specific setup checks so users can confirm OAuth and MCP discovery work before using an agent.
- Add optional tool profiles such as `safe_research`, `trading_review`, and `full_access`.
- Add `search` and `fetch` tools for better compatibility with AI clients that expect document-style connectors.

## MCP Market

- Add more public no-auth crypto MCP servers.
- Add BYOK-capable MCP servers for providers that require API keys.
- Cache upstream MCP tool lists to reduce latency and protect users from temporary upstream outages.
- Show upstream MCP health, last checked time, tool count, and last error in the dashboard.
- Add category filters such as market data, on-chain data, news, research, and risk.
- Add marketplace documentation links for each MCP server card.

## Crypto Data Providers

- Add more crypto data sources such as CoinMarketCap, DefiLlama, Etherscan, Alchemy, Moralis, and Glassnode.
- Add provider capability labels so users understand what each provider is best for.
- Add provider quota and rate-limit hints where APIs expose them.
- Add better validation modes for APIs with plan-specific permissions.
- Add a provider comparison table in the dashboard.

## Trading Safety

- Add read-only and trading-enabled permission modes per AI client.
- Split raw exchange access away from normal safe tools.
- Add per-user policy controls for allowed exchanges, symbols, order types, and max notional.
- Add real-time order monitoring with WebSockets so users are notified immediately when orders are filled, partially filled, rejected, canceled, or failed.
- Add a proposal risk summary before approve/reject actions.
- Add confirmation friction for high-risk proposals.
- Add audit log visibility in the dashboard.

## Agent Experience

- Improve tool descriptions continuously based on real agent mistakes.
- Add short examples for common tool calls.
- Add structured error messages that tell the agent exactly what the user needs to configure.
- Add canonical symbol normalization guidance for CoinGecko IDs, Binance symbols, and FX pairs.
- Add a "recommended tool" guide for common user intents.

## Dashboard UX

- Add status badges for OAuth connection health.
- Add empty states that explain the next action without long documentation text.
- Add loading and disabled states for proposal approve/reject actions.
- Add better mobile layout for dense provider and marketplace cards.
- Add a user-facing activity timeline.

## Observability

- Log MCP tool calls with user id, client type, tool name, latency, and result status.
- Detect client type from headers where possible.
- Add dashboard metrics for tool usage and failures.
- Track real-time order execution events and delivery status for user notifications.
- Add upstream provider latency tracking.
- Add alerts for repeated provider failures or auth problems.

## Testing And Quality

- Add integration tests for proposal approve/reject Firestore rule compatibility.
- Add tests for MCP tool list generation with enabled marketplace servers.
- Add UI tests for Data Providers, Exchanges, MCP Market, and proposal review.
- Add smoke tests against production MCP metadata endpoints after deploy.
- Add a lightweight deploy checklist script.

## Documentation

- Document each MCP tool group and when agents should use it.
- Add setup pages for ChatGPT, Claude, Gemini CLI, and Cursor.
- Document the difference between Data Providers, Exchange Connections, and MCP Market.
- Add troubleshooting docs for OAuth, Firebase rules, provider keys, and upstream MCP failures.
- Keep README concise and move detailed guides into separate docs.
