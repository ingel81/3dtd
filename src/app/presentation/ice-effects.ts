import type { ThreeTilesEngine } from '../three-engine';

type IceEngine = Pick<ThreeTilesEngine, 'effects' | 'sync' | 'getTerrainHeightAtGeo'>;

/** Particles of an ice shard's burst */
const ICE_BURST_PARTICLES = 35;

/**
 * An ice shard's burst where it hit (op `main.iceExplosion`): the frost
 * explosion at `explosionHeight`, and for a ground unit with ground marks on
 * a frost decal under it and three smaller ones scattered around. Sizes are
 * diameters of round decals; until 2026-09-12 they were 3.5, 1.5-3 and 2-3
 * and gave ovals of 2*size by 2 m, the diameters keep that area (2 * sqrt).
 * The decals lie on the tile ground (a raycast each), `groundHeight` where
 * none is hit. The scatter is Math.random: looks only.
 */
export function iceExplosion(
  engine: IceEngine,
  lat: number,
  lon: number,
  explosionHeight: number,
  groundHeight: number,
  air: boolean,
): void {
  engine.effects.spawnIceExplosionAtGeo(lat, lon, explosionHeight, ICE_BURST_PARTICLES);
  // None while ground marks are off, which also spares the four raycasts
  if (air || !engine.effects.groundMarksEnabled) return;
  engine.effects.spawnIceDecal(lat, lon, decalHeight(engine, lat, lon, groundHeight), 3.7);
  for (let i = 0; i < 3; i++) {
    const decalLat = lat + (Math.random() - 0.5) * 0.00008;
    const decalLon = lon + (Math.random() - 0.5) * 0.00008;
    engine.effects.spawnIceDecal(decalLat, decalLon, decalHeight(engine, decalLat, decalLon, groundHeight), 2.4 + Math.random() * 1.1);
  }
}

/** One frost decal under a splash target of the ice shard (op `main.iceDecal`), none while ground marks are off. */
export function iceDecal(engine: IceEngine, lat: number, lon: number, groundHeight: number): void {
  if (!engine.effects.groundMarksEnabled) return;
  // Diameter, was 2-3 as an oval (see iceExplosion)
  engine.effects.spawnIceDecal(lat, lon, decalHeight(engine, lat, lon, groundHeight), 2.8 + Math.random() * 0.7);
}

/** Geo height of the tile ground at a point (a raycast), a hand over it; `fallback` where no tile is hit. */
function decalHeight(engine: IceEngine, lat: number, lon: number, fallback: number): number {
  const terrainY = engine.getTerrainHeightAtGeo(lat, lon);
  if (terrainY === null) return fallback + 0.15;
  return terrainY + engine.sync.getOrigin().height + 0.15;
}
