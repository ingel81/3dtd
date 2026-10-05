/**
 * The balance hash covers the rules that sit beside the tables (review 2026-10-05): a tower's default build
 * time, a camouflaged enemy's HP factor and the tower paths. Changed, a coop guest of another balance is
 * refused and a run log lands in another average.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

async function hashWith(mocks: () => void): Promise<string> {
  vi.resetModules();
  mocks();
  const { balanceConfigHash } = await import('./config-hash');
  return balanceConfigHash();
}

describe('balanceConfigHash', () => {
  afterEach(() => {
    vi.doUnmock('../configs/tower-types.config');
    vi.doUnmock('../configs/enemy-types.config');
    vi.doUnmock('../configs/tower-paths.config');
    vi.resetModules();
  });

  it('changes with the default build time, the camo HP factor and a tower path', async () => {
    const base = await hashWith(() => undefined);
    const buildTime = await hashWith(() => vi.doMock('../configs/tower-types.config', async (original) =>
      ({ ...(await original<object>()), DEFAULT_BUILD_TIME_MS: 6000 })));
    const camo = await hashWith(() => vi.doMock('../configs/enemy-types.config', async (original) =>
      ({ ...(await original<object>()), CAMO_HP_FACTOR: 0.8 })));
    const paths = await hashWith(() => vi.doMock('../configs/tower-paths.config', async (original) => {
      const actual = await original<typeof import('../configs/tower-paths.config')>();
      return { ...actual, TOWER_PATHS: { scout: { ...actual.TOWER_PATHS.scout, cost: 300 } } };
    }));
    expect(new Set([base, buildTime, camo, paths]).size).toBe(4);
  });
});
