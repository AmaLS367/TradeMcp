import { describe, it, expect } from 'vitest';
import { calculateStrategyHash, calculateRunHash } from './strategyRegistry.js';

describe('strategyRegistry deterministic hashing', () => {
  it('generates consistent strategy hashes regardless of trailing spaces', () => {
    const codeA = 'class MyStrategy(Strategy):\n    pass  \n';
    const codeB = 'class MyStrategy(Strategy):\n    pass\n\n';

    const hashA = calculateStrategyHash(codeA, { param: 10 });
    const hashB = calculateStrategyHash(codeB, { param: 10 });

    expect(hashA).toBe(hashB);
    expect(hashA).toMatch(/^[a-f0-9]{64}$/);
  });

  it('generates different strategy hashes when parameters change', () => {
    const code = 'class MyStrategy(Strategy):\n    pass\n';

    const hash1 = calculateStrategyHash(code, { param: 10 });
    const hash2 = calculateStrategyHash(code, { param: 20 });

    expect(hash1).not.toBe(hash2);
  });

  it('generates deterministic run hash', () => {
    const runHash1 = calculateRunHash({
      strategyHash: 'abc',
      symbol: 'BTC/USDT',
      timeframe: '1h',
      startDate: '2023-01-01',
      endDate: '2024-01-01',
      feeRate: 0.0006,
      candlesCount: 1000,
    });

    const runHash2 = calculateRunHash({
      strategyHash: 'abc',
      symbol: 'BTC/USDT',
      timeframe: '1h',
      startDate: '2023-01-01',
      endDate: '2024-01-01',
      feeRate: 0.0006,
      candlesCount: 1000,
    });

    expect(runHash1).toBe(runHash2);
    expect(runHash1).toMatch(/^[a-f0-9]{64}$/);
  });
});
