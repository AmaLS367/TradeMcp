import { describe, expect, it, vi } from 'vitest';
import {
  MCP_MARKETPLACE_SERVERS,
  callMarketplaceTool,
  getMarketplaceServerRequiredDataProvider,
  isMcpMarketplaceServerId,
  listMarketplaceToolsForServerIds,
  parseMarketplaceToolName,
  prefixMarketplaceToolName,
  toPublicMcpServerConnection,
  trimMarketplaceToolResult,
  type MarketplaceMcpClientFactory,
} from './mcpMarketplace';

describe('MCP marketplace registry', () => {
  it('defines crypto research MCP servers', () => {
    expect(Object.keys(MCP_MARKETPLACE_SERVERS)).toEqual(['crypto_com', 'coingecko_public', 'chainlink', 'dune']);
    expect(MCP_MARKETPLACE_SERVERS.crypto_com).toMatchObject({
      auth: 'none',
      transport: 'streamable_http',
      endpoint: 'https://mcp.crypto.com/market-data/mcp',
    });
    expect(MCP_MARKETPLACE_SERVERS.coingecko_public).toMatchObject({
      auth: 'none',
      transport: 'streamable_http',
      endpoint: 'https://mcp.api.coingecko.com/mcp',
    });
    expect(MCP_MARKETPLACE_SERVERS.chainlink).toMatchObject({
      auth: 'none',
      transport: 'streamable_http',
      endpoint: 'https://chainlink.mcp.junct.dev/mcp',
    });
    expect(MCP_MARKETPLACE_SERVERS.dune).toMatchObject({
      auth: 'api_key',
      dataProviderId: 'dune',
      apiKeyHeaderName: 'x-dune-api-key',
      transport: 'streamable_http',
      endpoint: 'https://api.dune.com/mcp/v1',
    });
    expect(getMarketplaceServerRequiredDataProvider('dune')).toBe('dune');
    expect(getMarketplaceServerRequiredDataProvider('chainlink')).toBeUndefined();
  });

  it('accepts only known marketplace server ids', () => {
    expect(isMcpMarketplaceServerId('crypto_com')).toBe(true);
    expect(isMcpMarketplaceServerId('coingecko')).toBe(false);
  });

  it('maps stored user connection state onto public catalog metadata', () => {
    expect(toPublicMcpServerConnection('crypto_com', {
      serverId: 'crypto_com',
      isEnabled: true,
      toolCount: 7,
      lastError: null,
    })).toMatchObject({
      id: 'crypto_com',
      name: 'Crypto.com',
      isEnabled: true,
      toolCount: 7,
      lastError: null,
    });
  });
});

describe('MCP marketplace tool names', () => {
  it('prefixes and parses upstream tool names', () => {
    const prefixed = prefixMarketplaceToolName('crypto_com', 'get-tickers');
    expect(prefixed).toBe('crypto_com__get-tickers');
    expect(parseMarketplaceToolName(prefixed)).toEqual({
      serverId: 'crypto_com',
      upstreamToolName: 'get-tickers',
    });
  });

  it('rejects non-marketplace tool names', () => {
    expect(parseMarketplaceToolName('get_crypto_prices')).toBeNull();
    expect(parseMarketplaceToolName('unknown__tool')).toBeNull();
    expect(() => prefixMarketplaceToolName('crypto_com', '')).toThrow('upstream tool name is required');
  });
});

describe('MCP marketplace proxy helpers', () => {
  it('lists only requested enabled server tools with collision-safe prefixes', async () => {
    const factory: MarketplaceMcpClientFactory = (server) => ({
      connect: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
      callTool: vi.fn(async () => ({ content: [] })),
      listTools: vi.fn(async () => ({
        tools: [{
          name: 'ticker',
          description: `${server.name} ticker`,
          inputSchema: { type: 'object' as const, properties: {} },
        }],
      })),
    });

    await expect(listMarketplaceToolsForServerIds([], factory)).resolves.toEqual([]);
    await expect(listMarketplaceToolsForServerIds(['crypto_com'], factory)).resolves.toMatchObject([
      {
        name: 'crypto_com__ticker',
        description: expect.stringContaining('read-only proxied MCP Market tool'),
        annotations: { readOnlyHint: true },
        _meta: {
          tradeMcpMarketplaceServerId: 'crypto_com',
          tradeMcpUpstreamToolName: 'ticker',
        },
      },
    ]);
  });

  it('proxies calls to the original upstream tool name', async () => {
    const callTool = vi.fn(async () => ({
      content: [{ type: 'text' as const, text: 'ok' }],
    }));
    const factory: MarketplaceMcpClientFactory = () => ({
      connect: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
      listTools: vi.fn(async () => ({ tools: [] })),
      callTool,
    });

    await expect(callMarketplaceTool('coingecko_public', 'search', { query: 'btc' }, factory)).resolves.toEqual({
      content: [{ type: 'text', text: 'ok' }],
    });
    expect(callTool).toHaveBeenCalledWith({
      name: 'search',
      arguments: { query: 'btc' },
    }, undefined, { timeout: 15000 });
  });

  it('passes marketplace credentials into authenticated server clients', async () => {
    const factory = vi.fn<MarketplaceMcpClientFactory>((_server, credentials) => ({
      connect: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
      callTool: vi.fn(async () => ({ content: [] })),
      listTools: vi.fn(async () => ({
        tools: [{
          name: `auth-${credentials?.apiKey}`,
          inputSchema: { type: 'object' as const, properties: {} },
        }],
      })),
    }));

    await expect(listMarketplaceToolsForServerIds(['dune'], factory, async () => ({ apiKey: 'dune-key' }))).resolves.toMatchObject([
      { name: 'dune__auth-dune-key' },
    ]);
    expect(factory).toHaveBeenCalledWith(MCP_MARKETPLACE_SERVERS.dune, { apiKey: 'dune-key' });
  });

  it('keeps listing other enabled servers when one upstream server fails', async () => {
    const factory: MarketplaceMcpClientFactory = (server) => ({
      connect: vi.fn(async () => {
        if (server.id === 'crypto_com') throw new Error('down');
      }),
      close: vi.fn(async () => undefined),
      callTool: vi.fn(async () => ({ content: [] })),
      listTools: vi.fn(async () => ({
        tools: [{
          name: 'coins',
          inputSchema: { type: 'object' as const, properties: {} },
        }],
      })),
    });

    await expect(listMarketplaceToolsForServerIds(['crypto_com', 'coingecko_public'], factory)).resolves.toMatchObject([
      { name: 'coingecko_public__coins' },
    ]);
  });

  it('trims oversized text content from proxied tool results', () => {
    expect(trimMarketplaceToolResult({
      content: [{ type: 'text', text: 'abcdef' }],
    }, 3)).toEqual({
      content: [{ type: 'text', text: 'abc\n\n... truncated at 3 characters' }],
    });
  });
});
