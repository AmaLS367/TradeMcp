import { describe, it, expect } from 'vitest';
import { collapseRecentOrderEvents } from './observability';

describe('collapseRecentOrderEvents', () => {
  it('should return empty array when input is empty', () => {
    expect(collapseRecentOrderEvents([])).toEqual([]);
  });

  it('should return passthrough events (no proposalId)', () => {
    const events = [
      {
        id: '1',
        symbol: 'BTC/USDT',
        side: 'buy',
        eventType: 'submitted',
        status: 'open',
        quantity: 1,
        timestamp: '2023-01-01T00:00:00.000Z',
      },
      {
        id: '2',
        symbol: 'ETH/USDT',
        side: 'sell',
        eventType: 'filled',
        status: 'executed',
        quantity: 10,
        timestamp: '2023-01-02T00:00:00.000Z',
      },
    ];

    expect(collapseRecentOrderEvents(events)).toEqual([events[1], events[0]]);
  });

  it('should collapse events with same proposalId to latest event based on timestamp', () => {
    const events = [
      {
        id: '1',
        proposalId: 'prop1',
        symbol: 'BTC/USDT',
        side: 'buy',
        eventType: 'submitted',
        status: 'open',
        quantity: 1,
        timestamp: '2023-01-01T00:00:00.000Z',
      },
      {
        id: '2',
        proposalId: 'prop1',
        symbol: 'BTC/USDT',
        side: 'buy',
        eventType: 'filled',
        status: 'executed',
        quantity: 1,
        timestamp: '2023-01-02T00:00:00.000Z', // Latest
      },
      {
        id: '3',
        proposalId: 'prop2',
        symbol: 'ETH/USDT',
        side: 'sell',
        eventType: 'submitted',
        status: 'open',
        quantity: 10,
        timestamp: '2023-01-01T12:00:00.000Z', // Latest for prop2
      },
    ];

    const result = collapseRecentOrderEvents(events);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('2'); // Latest overall (prop1 filled)
    expect(result[1].id).toBe('3'); // Latest for prop2
  });

  it('should handle a mix of passthrough events and collapsable events, ordered by timestamp descending', () => {
    const events = [
      {
        id: '1', // Passthrough
        symbol: 'SOL/USDT',
        side: 'buy',
        eventType: 'submitted',
        status: 'open',
        quantity: 100,
        timestamp: '2023-01-03T00:00:00.000Z',
      },
      {
        id: '2',
        proposalId: 'prop1',
        symbol: 'BTC/USDT',
        side: 'buy',
        eventType: 'submitted',
        status: 'open',
        quantity: 1,
        timestamp: '2023-01-01T00:00:00.000Z',
      },
      {
        id: '3',
        proposalId: 'prop1',
        symbol: 'BTC/USDT',
        side: 'buy',
        eventType: 'filled',
        status: 'executed',
        quantity: 1,
        timestamp: '2023-01-05T00:00:00.000Z', // Latest prop1
      },
      {
        id: '4', // Passthrough
        symbol: 'DOT/USDT',
        side: 'sell',
        eventType: 'filled',
        status: 'executed',
        quantity: 50,
        timestamp: '2023-01-02T00:00:00.000Z',
      },
    ];

    const result = collapseRecentOrderEvents(events);
    expect(result).toHaveLength(3);
    expect(result[0].id).toBe('3'); // 2023-01-05
    expect(result[1].id).toBe('1'); // 2023-01-03
    expect(result[2].id).toBe('4'); // 2023-01-02
  });
});
