import { describe, expect, it } from 'vitest';
import { corridorFingerprint, fnv1a } from './corridor-fingerprint';
import type { CorridorState } from '../world/path-route.service';
import type { BandStation } from '../../utils/corridor-band';
import type { RouteCellDump } from '../../utils/route-grid-diagnostics';

/**
 * `__corridor.fingerprint()` tells whether two loads of a place gave the
 * same corridor (docs/ROUTE_CORRIDOR.md, Phase 0). It must give the same
 * hash for the same corridor, whatever order its maps were filled in, and
 * another one, in the part that changed, for a changed band, measurement,
 * height or tile.
 */
describe('corridorFingerprint', () => {
  const station = (k: number, over: Partial<BandStation> = {}): BandStation => ({
    segment: 0, k, n: 2, s: 2 * k + 1, x: k, z: 0, rx: 0, rz: 1,
    kind: 'band', backbone: { offset: 0.5, y: 12.25 }, left: -3.2, right: 4, centre: 0.4,
    ...over,
  });

  function state(): CorridorState {
    return {
      routes: [
        { key: 'r-b', band: [station(0), station(1, { kind: 'passage', backbone: null, left: -2, right: 2, centre: 0 })] },
        { key: 'r-a', band: [station(0, { left: -1, right: 1 })] },
      ],
      stations: [
        { key: 's-2', left: [5.2, NaN], right: [7, NaN], tileError: [2.5, 20], unmeasured: [null, 'coarse tile'] },
        { key: 's-1', left: [4], right: [4], tileError: [Infinity], unmeasured: ['no tile'] },
      ],
    };
  }

  function cell(x: number, z: number, terrainHeight: number, tileGeometricError = 2): RouteCellDump {
    return {
      key: x * 1000 + z, x, z, terrainHeight, surface: 'ground', routeAnchorY: 0, deltaFromAnchor: terrainHeight,
      state: 'stable', tileDepth: 21, tileGeometricError, heightSampled: true,
    };
  }

  const cells = () => [cell(1, 1, 10.02), cell(3, 1, 10.4), cell(1, 3, 11)];

  it('gives the same hash for the same corridor, and 8 hex digits', () => {
    const a = corridorFingerprint(state(), cells());
    const b = corridorFingerprint(structuredClone(state()), cells());
    expect(a.hash).toMatch(/^[0-9a-f]{8}$/);
    expect(b).toEqual(a);
    expect(a.parts.cells.entries).toBe(3);
    expect(a.parts.band.entries).toBe(3);
    expect(a.parts.stations.entries).toBe(3);
    // Three stations and three cells
    expect(a.parts.tiles.entries).toBe(6);
  });

  it('does not care in which order routes, segments and cells come', () => {
    const shuffled = state();
    shuffled.routes.reverse();
    shuffled.stations.reverse();
    expect(corridorFingerprint(shuffled, cells().reverse()).hash).toBe(corridorFingerprint(state(), cells()).hash);
  });

  /** The parts whose hash differs between two fingerprints. */
  function changedParts(a: ReturnType<typeof corridorFingerprint>, b: ReturnType<typeof corridorFingerprint>): string[] {
    return Object.keys(a.parts).filter((name) => a.parts[name as keyof typeof a.parts].hash !== b.parts[name as keyof typeof b.parts].hash);
  }

  it('changes with a band edge, a backbone and the enemies\' line, in its part only', () => {
    const base = corridorFingerprint(state(), cells());
    for (const change of [
      (s: CorridorState) => { s.routes[0].band[0].left = -3.3; },
      (s: CorridorState) => { s.routes[0].band[0].centre = 0.5; },
      (s: CorridorState) => { s.routes[0].band[0].backbone = { offset: -1.5, y: 12.25 }; },
      (s: CorridorState) => { s.routes[0].band[1].kind = 'climb'; },
    ]) {
      const moved = state();
      change(moved);
      const print = corridorFingerprint(moved, cells());
      expect(print.hash).not.toBe(base.hash);
      expect(changedParts(base, print)).toEqual(['band']);
    }

    const measured = state();
    measured.stations[0].right[0] = 6.9;
    expect(changedParts(base, corridorFingerprint(measured, cells()))).toEqual(['stations']);
  });

  it('changes with a cell height of 0.1 m or more, not with less than its rounding', () => {
    const base = corridorFingerprint(state(), cells());
    const raised = cells();
    raised[1].terrainHeight = 10.6;
    const print = corridorFingerprint(state(), raised);
    expect(print.hash).not.toBe(base.hash);
    expect(changedParts(base, print)).toEqual(['heights']);

    // 10.02 and 10.04 both round to 10.0
    const noise = cells();
    noise[0].terrainHeight = 10.04;
    expect(corridorFingerprint(state(), noise).hash).toBe(base.hash);
  });

  it('changes with a cell more or less and with a tile', () => {
    const base = corridorFingerprint(state(), cells());

    expect(changedParts(base, corridorFingerprint(state(), [...cells(), cell(5, 1, 10)]))).toEqual(['cells', 'heights', 'tiles']);

    const finer = state();
    finer.stations[0].tileError[1] = 5;
    expect(changedParts(base, corridorFingerprint(finer, cells()))).toEqual(['tiles']);

    const finerCell = cells();
    finerCell[2].tileGeometricError = 1.25;
    expect(changedParts(base, corridorFingerprint(state(), finerCell))).toEqual(['tiles']);
  });

  it('hashes with FNV-1a', () => {
    // Reference values of 32-bit FNV-1a
    expect(fnv1a('')).toBe('811c9dc5');
    expect(fnv1a('a')).toBe('e40c292c');
  });
});
