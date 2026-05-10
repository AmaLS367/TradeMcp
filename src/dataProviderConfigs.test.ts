import { describe, expect, it } from 'vitest';
import { DATA_PROVIDER_CONFIGS } from './dataProviderConfigs';

describe('dashboard data provider configs', () => {
  it('shows NewsAPI and TAAPI.IO provider cards in the dashboard list', () => {
    expect(DATA_PROVIDER_CONFIGS).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'newsapi', label: 'NewsAPI' }),
      expect.objectContaining({ id: 'taapi', label: 'TAAPI.IO' }),
    ]));
  });
});
