import { AsyncLocalStorage } from 'async_hooks';

type LatencyEntry = {
  provider: string;
  label: string;
  startMs: number;
};

type CompletedMeasurement = {
  provider: string;
  label: string;
  durationMs: number;
};

const latencyStore = new AsyncLocalStorage<Map<string, LatencyEntry>>();

let entryCounter = 0;

export function recordProviderLatency(provider: string, label: string) {
  const id = String(++entryCounter);
  const store = latencyStore.getStore();
  if (store) {
    store.set(id, { provider, label, startMs: Date.now() });
  }
  return {
    stop: () => {
      if (!store) return null;
      const entry = store.get(id);
      if (!entry) return null;
      store.delete(id);
      return {
        provider: entry.provider,
        label: entry.label,
        durationMs: Date.now() - entry.startMs,
      } satisfies CompletedMeasurement;
    },
  };
}

export function getAccumulatedProviderLatency(): CompletedMeasurement[] {
  const store = latencyStore.getStore();
  if (!store) return [];
  const result: CompletedMeasurement[] = [];
  const now = Date.now();
  for (const [, entry] of store) {
    result.push({
      provider: entry.provider,
      label: entry.label,
      durationMs: now - entry.startMs,
    });
  }
  return result;
}

export function withLatencyContext<T>(fn: () => Promise<T>): Promise<T> {
  return latencyStore.run(new Map(), fn);
}

export type { CompletedMeasurement };
