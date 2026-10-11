import { Raycaster, Vector3 } from 'three';
import { EllipsoidSync } from '../three-engine/ellipsoid-sync';
import { METERS_PER_DEGREE_LAT } from '../utils/geo-utils';
import type { DevTerrainProvider } from './dev-terrain.provider';
import { DevWorldSurface } from './dev-world-surface';

/** Ein DevTerrainProvider mit fester Höhe 7 lokal, 11 per Geo und einem Dach in 20 m. */
function fakeTerrain() {
  return {
    getHeightAtGeo: vi.fn(() => 11),
    getHeightAtLocal: vi.fn((_x: number, _z: number): number | null => 7),
    hasLineOfSightBlocked: vi.fn(() => true),
    pickRay: vi.fn(() => new Vector3(1, 2, 3)),
    raycastDown: vi.fn((): Vector3 | null => new Vector3(0, 20, 0)),
    clearHeightCache: vi.fn(),
  };
}

function setup() {
  const terrain = fakeTerrain();
  const surface = new DevWorldSurface(terrain as unknown as DevTerrainProvider, new EllipsoidSync(0, 0, 0));
  return { terrain, surface };
}

describe('DevWorldSurface', () => {
  it('nimmt Säulen vom Gelände: kein Streaming-LOD, nichts über dem Boden', () => {
    const { terrain, surface } = setup();
    expect(surface.sampleColumn(4, 5)).toEqual({ groundY: 7, topY: 7, tileDepth: 99, tileGeometricError: 0 });
    expect(terrain.getHeightAtLocal).toHaveBeenCalledWith(4, 5);
    expect(surface.raycastTerrainHeight(4, 5)).toBe(7);
    terrain.getHeightAtLocal.mockReturnValue(null);
    expect(surface.sampleColumn(600, 0)).toBeNull();
  });

  it('meldet eine synthetische Top-LOD und lodVersion 0', () => {
    const { surface } = setup();
    expect(surface.peekBestTileLODAtLocal()).toEqual({ depth: 99, geometricError: 0 });
    surface.markTileSetChanged();
    expect(surface.lodVersion).toBe(0);
  });

  it('fragt die Geo-Höhe beim Gelände und nimmt sie als Bodenschätzung', () => {
    const { terrain, surface } = setup();
    expect(surface.getTerrainHeightAtGeo(1, 2)).toBe(11);
    expect(terrain.getHeightAtGeo).toHaveBeenCalledWith(1, 2);
    expect(surface.getGroundHeightEstimate(1, 2)).toBe(11);
    expect(surface.getStreetHeightEstimate(1, 2, 0, 0, 3, 3, null)).toBe(11);
  });

  it('nimmt auf einer Brücke die Säule am Punkt', () => {
    const { terrain, surface } = setup();
    const lat = 10 / METERS_PER_DEGREE_LAT;
    expect(surface.getStreetHeightEstimate(lat, 0, 0, 0, 0, 0, 'bridge')).toBe(7);
    const [x, z] = terrain.getHeightAtLocal.mock.calls[0];
    expect(x).toBeCloseTo(0, 9);
    expect(z).toBeCloseTo(10, 6);
  });

  it('misst keine Straßen und zeigt keine Treffer einer Säule', () => {
    const { surface } = setup();
    expect(surface.measureStreetClearance()).toBeNull();
    expect(surface.inspectColumn()).toBeNull();
  });

  it('gibt Sichtlinie und Bildschirm-Strahl ans Gelände', () => {
    const { terrain, surface } = setup();
    expect(surface.raycastLineOfSight(1, 2, 3, 4, 5, 6)).toBe(true);
    expect(terrain.hasLineOfSightBlocked).toHaveBeenCalledWith(1, 2, 3, 4, 5, 6);
    const ray = new Raycaster();
    expect(surface.pickRay(ray)?.toArray()).toEqual([1, 2, 3]);
    expect(terrain.pickRay).toHaveBeenCalledWith(ray);
  });

  it('stellt Tower aufs Dach: Oberkante per raycastDown, Boden vom Gelände', () => {
    const { terrain, surface } = setup();
    expect(surface.roofAt(3, 4)).toBe(20);
    expect(terrain.raycastDown).toHaveBeenCalledWith(3, 4, 10000);
    expect(surface.footprintColumn(3, 4)).toEqual({ groundY: 7, topY: 20 });

    terrain.raycastDown.mockReturnValue(null);
    expect(surface.roofAt(3, 4)).toBeNull();
    expect(surface.footprintColumn(3, 4)).toBeNull();
  });
});
