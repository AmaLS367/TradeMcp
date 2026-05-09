import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";

export const MCP_MARKETPLACE_SERVERS = {
  crypto_com: {
    id: 'crypto_com',
    name: 'Crypto.com',
    description: 'Public crypto market data and analysis MCP server.',
    category: 'crypto_market_data',
    auth: 'none',
    transport: 'streamable_http',
    endpoint: 'https://mcp.crypto.com/market-data/mcp',
  },
  coingecko_public: {
    id: 'coingecko_public',
    name: 'CoinGecko Public MCP',
    description: 'Public CoinGecko MCP tools without a user API key.',
    category: 'crypto_market_data',
    auth: 'none',
    transport: 'streamable_http',
    endpoint: 'https://mcp.api.coingecko.com/mcp',
  },
} as const;

export type McpMarketplaceServerId = keyof typeof MCP_MARKETPLACE_SERVERS;
export type McpMarketplaceServerDefinition = typeof MCP_MARKETPLACE_SERVERS[McpMarketplaceServerId];

export type StoredMcpServerConnection = {
  serverId: McpMarketplaceServerId;
  isEnabled: boolean;
  connectedAt?: unknown;
  updatedAt?: unknown;
  lastCheckedAt?: unknown;
  lastError?: string | null;
  toolCount?: number;
};

export type PublicMcpServerConnection = McpMarketplaceServerDefinition & {
  isEnabled: boolean;
  connectedAt?: unknown;
  updatedAt?: unknown;
  lastCheckedAt?: unknown;
  lastError?: string | null;
  toolCount?: number;
};

export type MarketplaceMcpClient = {
  connect(options?: { timeout?: number }): Promise<void>;
  listTools(params?: unknown, options?: { timeout?: number }): Promise<{ tools: Tool[] }>;
  callTool(params: { name: string; arguments?: Record<string, unknown> }, resultSchema?: unknown, options?: { timeout?: number }): Promise<CallToolResult | { toolResult: unknown }>;
  close(): Promise<void> | void;
};

export type MarketplaceMcpClientFactory = (server: McpMarketplaceServerDefinition) => MarketplaceMcpClient;

const DEFAULT_TIMEOUT_MS = 15_000;
const TOOL_NAME_SEPARATOR = '__';

export function isMcpMarketplaceServerId(value: unknown): value is McpMarketplaceServerId {
  return typeof value === 'string' && value in MCP_MARKETPLACE_SERVERS;
}

export function listMcpMarketplaceCatalog() {
  return Object.values(MCP_MARKETPLACE_SERVERS);
}

export function toPublicMcpServerConnection(
  serverId: McpMarketplaceServerId,
  stored?: Partial<StoredMcpServerConnection>,
): PublicMcpServerConnection {
  return {
    ...MCP_MARKETPLACE_SERVERS[serverId],
    isEnabled: stored?.isEnabled === true,
    connectedAt: stored?.connectedAt,
    updatedAt: stored?.updatedAt,
    lastCheckedAt: stored?.lastCheckedAt,
    lastError: stored?.lastError ?? null,
    toolCount: typeof stored?.toolCount === 'number' ? stored.toolCount : undefined,
  };
}

export function prefixMarketplaceToolName(serverId: McpMarketplaceServerId, upstreamToolName: string) {
  if (!upstreamToolName.trim()) {
    throw new Error('upstream tool name is required');
  }
  return `${serverId}${TOOL_NAME_SEPARATOR}${upstreamToolName}`;
}

export function parseMarketplaceToolName(toolName: string): { serverId: McpMarketplaceServerId; upstreamToolName: string } | null {
  const separatorIndex = toolName.indexOf(TOOL_NAME_SEPARATOR);
  if (separatorIndex <= 0) {
    return null;
  }

  const serverId = toolName.slice(0, separatorIndex);
  const upstreamToolName = toolName.slice(separatorIndex + TOOL_NAME_SEPARATOR.length);
  if (!isMcpMarketplaceServerId(serverId) || !upstreamToolName.trim()) {
    return null;
  }

  return { serverId, upstreamToolName };
}

export function createMarketplaceMcpClient(server: McpMarketplaceServerDefinition): MarketplaceMcpClient {
  const client = new Client({
    name: 'TradeMCPMarketplaceClient',
    version: '1.0.0',
  }, {
    capabilities: {},
  });
  const transport = new StreamableHTTPClientTransport(new URL(server.endpoint));

  return {
    connect: (options?: { timeout?: number }) => client.connect(transport, options),
    listTools: (params?: unknown, options?: { timeout?: number }) => client.listTools(params as any, options),
    callTool: (params, resultSchema?: unknown, options?: { timeout?: number }) => client.callTool(params, resultSchema as any, options),
    close: () => client.close(),
  };
}

export async function listMarketplaceServerTools(
  serverId: McpMarketplaceServerId,
  clientFactory: MarketplaceMcpClientFactory = createMarketplaceMcpClient,
) {
  const server = MCP_MARKETPLACE_SERVERS[serverId];
  const client = clientFactory(server);
  try {
    await client.connect({ timeout: DEFAULT_TIMEOUT_MS });
    return await client.listTools(undefined, { timeout: DEFAULT_TIMEOUT_MS });
  } finally {
    await client.close();
  }
}

export async function listMarketplaceToolsForServerIds(
  serverIds: McpMarketplaceServerId[],
  clientFactory: MarketplaceMcpClientFactory = createMarketplaceMcpClient,
): Promise<Tool[]> {
  const tools: Tool[] = [];
  const seen = new Set<string>();

  for (const serverId of serverIds) {
    let result: { tools: Tool[] };
    try {
      result = await listMarketplaceServerTools(serverId, clientFactory);
    } catch {
      continue;
    }
    for (const tool of result.tools || []) {
      const name = prefixMarketplaceToolName(serverId, tool.name);
      if (seen.has(name)) {
        continue;
      }
      seen.add(name);
      tools.push({
        ...tool,
        name,
        description: `[${MCP_MARKETPLACE_SERVERS[serverId].name}] Use this when the user specifically asks for data or capabilities from ${MCP_MARKETPLACE_SERVERS[serverId].name}. This is a read-only proxied MCP Market tool exposed through Trade MCP as ${name}; the upstream tool name is ${tool.name}. ${tool.description || tool.name}`,
        annotations: {
          ...tool.annotations,
          readOnlyHint: true,
        },
        _meta: {
          ...(tool._meta || {}),
          tradeMcpMarketplaceServerId: serverId,
          tradeMcpUpstreamToolName: tool.name,
        },
      });
    }
  }

  return tools;
}

export async function callMarketplaceTool(
  serverId: McpMarketplaceServerId,
  upstreamToolName: string,
  args: Record<string, unknown> | undefined,
  clientFactory: MarketplaceMcpClientFactory = createMarketplaceMcpClient,
) {
  const server = MCP_MARKETPLACE_SERVERS[serverId];
  const client = clientFactory(server);
  try {
    await client.connect({ timeout: DEFAULT_TIMEOUT_MS });
    return await client.callTool({
      name: upstreamToolName,
      arguments: args || {},
    }, undefined, { timeout: DEFAULT_TIMEOUT_MS });
  } finally {
    await client.close();
  }
}

export function trimMarketplaceToolResult(result: CallToolResult | { toolResult: unknown }, maxChars: number) {
  if (!('content' in result) || !Array.isArray(result.content)) {
    return result;
  }

  return {
    ...result,
    content: result.content.map((item) => {
      if (item.type !== 'text' || item.text.length <= maxChars) {
        return item;
      }
      return {
        ...item,
        text: `${item.text.slice(0, maxChars)}\n\n... truncated at ${maxChars} characters`,
      };
    }),
  };
}

export function marketplaceErrorMessage(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  if (/timeout|timed out|aborted/i.test(message)) {
    return 'Upstream MCP server timed out.';
  }
  if (/unauthorized|forbidden|401|403/i.test(message)) {
    return 'Upstream MCP server rejected the request.';
  }
  return `Upstream MCP server failed: ${message}`;
}
