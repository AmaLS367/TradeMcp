import { describe, expect, it } from 'vitest';
import { buildClients, buildMcpUrl } from './AIClientConnections';

describe('AI client connection snippets', () => {
  it('adds profile query parameters without breaking existing query params', () => {
    expect(buildMcpUrl('https://trade.example/api/mcp/', 'safe_research')).toBe(
      'https://trade.example/api/mcp/?profile=safe_research'
    );
    expect(buildMcpUrl('https://trade.example/api/mcp/?key=abc', 'trading_review')).toBe(
      'https://trade.example/api/mcp/?key=abc&profile=trading_review'
    );
  });

  it('documents API-key bearer authentication for CLI clients', () => {
    const clients = buildClients('https://trade.example/api/mcp/?profile=safe_research');
    const gemini = clients.find((client) => client.id === 'gemini-cli');
    const claudeCode = clients.find((client) => client.id === 'claude-code');

    expect(gemini?.snippet('https://trade.example/api/mcp/?profile=safe_research')).toContain(
      'Authorization: Bearer ${TRADEMCP_API_KEY}'
    );
    expect(claudeCode?.snippet('https://trade.example/api/mcp/?profile=safe_research')).toContain(
      'TRADEMCP_API_KEY'
    );
  });
});
