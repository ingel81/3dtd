import { describe, it, expect, vi } from 'vitest';
import { iceDecal, iceExplosion } from './ice-effects';
import type { ThreeTilesEngine } from '../three-engine';

function makeEngine(groundMarks: boolean, terrainY: number | null) {
  return {
    effects: { spawnIceExplosionAtGeo: vi.fn(), spawnIceDecal: vi.fn(), groundMarksEnabled: groundMarks },
    sync: { getOrigin: () => ({ lat: 0, lon: 0, height: 20 }) },
    getTerrainHeightAtGeo: vi.fn(() => terrainY),
  };
}

describe('ice effects', () => {
  it('bursts and lays four decals on the tile ground under a ground unit', () => {
    const engine = makeEngine(true, 100);
    iceExplosion(engine as unknown as ThreeTilesEngine, 1, 2, 30, 110, false);
    expect(engine.effects.spawnIceExplosionAtGeo).toHaveBeenCalledWith(1, 2, 30, 35);
    expect(engine.effects.spawnIceDecal).toHaveBeenCalledTimes(4);
    expect(engine.effects.spawnIceDecal.mock.calls[0]).toEqual([1, 2, 120.15, 3.7]);
  });

  it('lays no decal for an air unit or with ground marks off, and none casts a ray', () => {
    const air = makeEngine(true, 100);
    iceExplosion(air as unknown as ThreeTilesEngine, 1, 2, 30, 110, true);
    const off = makeEngine(false, 100);
    iceExplosion(off as unknown as ThreeTilesEngine, 1, 2, 30, 110, false);
    iceDecal(off as unknown as ThreeTilesEngine, 1, 2, 110);
    for (const engine of [air, off]) {
      expect(engine.effects.spawnIceDecal).not.toHaveBeenCalled();
      expect(engine.getTerrainHeightAtGeo).not.toHaveBeenCalled();
    }
  });

  it('puts a splash decal on the given ground where no tile is hit', () => {
    const engine = makeEngine(true, null);
    iceDecal(engine as unknown as ThreeTilesEngine, 1, 2, 110);
    expect(engine.effects.spawnIceDecal.mock.calls[0][2]).toBeCloseTo(110.15);
  });
});
