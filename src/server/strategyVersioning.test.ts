import { describe, expect, it } from 'vitest';
import { planStrategyVersion, resolveRunVersion } from './strategyVersioning.js';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const C = 'c'.repeat(64);

describe('planStrategyVersion', () => {
  it('starts a new strategy at v1', () => {
    expect(planStrategyVersion([], A)).toEqual({ kind: 'new', versionId: 'v1' });
  });

  it('reuses the version that already holds the hash instead of overwriting', () => {
    const existing = [{ versionId: 'v1', strategyHash: A }, { versionId: 'v2', strategyHash: B }];
    expect(planStrategyVersion(existing, A)).toEqual({ kind: 'existing', versionId: 'v1' });
  });

  it('gives changed source the next free number, skipping gaps and foreign ids', () => {
    const existing = [
      { versionId: 'v1', strategyHash: A },
      { versionId: 'v3', strategyHash: B },
      { versionId: 'legacy', strategyHash: C },
    ];
    expect(planStrategyVersion(existing, 'd'.repeat(64))).toEqual({ kind: 'new', versionId: 'v4' });
  });
});

describe('resolveRunVersion', () => {
  const existing = [{ versionId: 'v1', strategyHash: A }, { versionId: 'v2', strategyHash: B }];

  it('finds the version by hash when no versionId is given', () => {
    expect(resolveRunVersion(existing, B)).toEqual({ ok: true, versionId: 'v2' });
  });

  it('accepts a requested version whose hash matches', () => {
    expect(resolveRunVersion(existing, A, 'v1')).toEqual({ ok: true, versionId: 'v1' });
  });

  it('refuses to file a run under a version with a different hash', () => {
    const result = resolveRunVersion(existing, B, 'v1');
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain('hash to');
  });

  it('refuses unknown versions and unregistered source', () => {
    expect(resolveRunVersion(existing, A, 'v9').ok).toBe(false);
    expect(resolveRunVersion(existing, C).ok).toBe(false);
  });
});
