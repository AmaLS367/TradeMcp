// Version bookkeeping for the strategy registry, kept free of Firestore so the
// rules that protect stored versions are unit-testable.

export interface VersionRef {
  versionId: string;
  strategyHash: string;
}

export type VersionPlan =
  | { kind: 'existing'; versionId: string }
  | { kind: 'new'; versionId: string };

/**
 * Versions are immutable. Source + parameters that already hash to a stored
 * version resolve to it; anything else gets the next free vN id.
 */
export function planStrategyVersion(existing: VersionRef[], strategyHash: string): VersionPlan {
  const match = existing.find((version) => version.strategyHash === strategyHash);
  if (match) return { kind: 'existing', versionId: match.versionId };

  const highest = existing.reduce((max, version) => {
    const numbered = /^v(\d+)$/.exec(version.versionId);
    return numbered ? Math.max(max, Number(numbered[1])) : max;
  }, 0);
  return { kind: 'new', versionId: `v${highest + 1}` };
}

export type RunVersionResolution =
  | { ok: true; versionId: string }
  | { ok: false; error: string };

/**
 * A run may only be filed under the version whose source and parameters it
 * actually executed, i.e. the version holding the same strategyHash.
 */
export function resolveRunVersion(
  existing: VersionRef[],
  strategyHash: string,
  requestedVersionId?: string,
): RunVersionResolution {
  if (!requestedVersionId) {
    const match = existing.find((version) => version.strategyHash === strategyHash);
    return match
      ? { ok: true, versionId: match.versionId }
      : {
          ok: false,
          error: `no registered version has strategyHash ${strategyHash}; register this sourceCode and parameters with trade_create_strategy first`,
        };
  }

  const requested = existing.find((version) => version.versionId === requestedVersionId);
  if (!requested) {
    return { ok: false, error: `version ${requestedVersionId} does not exist` };
  }
  if (requested.strategyHash !== strategyHash) {
    return {
      ok: false,
      error: `version ${requestedVersionId} has strategyHash ${requested.strategyHash}, but this sourceCode and parameters hash to ${strategyHash}`,
    };
  }
  return { ok: true, versionId: requested.versionId };
}
