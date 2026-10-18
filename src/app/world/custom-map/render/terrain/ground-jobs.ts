/**
 * The ground's shape of a map that holds still (the game, the map preview)
 * worked out from one copy of its heights and its lava (ground-shape.ts):
 * what GroundWorker asks its worker, and does here when there is none. The
 * editor's map changes as it is edited; its worker follows the edits
 * (editor-ground.ts).
 */
import type { MapTerrain, MapWater } from '../../map-document';
import { HeightField } from '../height-field';
import { farShadowData, lavaCloseness, lavaSamples, shapePatch, type FarShadowTexels, type SampleRect, type ShapePatch } from './ground-shape';

/** The part of a map the jobs read: its height grid and extent, the lava among its water */
export type GroundJobMap = Pick<MapTerrain, 'width' | 'depth' | 'grid' | 'water' | 'waterBodies' | 'rivers'>;

export type GroundJob =
  | { kind: 'shape'; rect: SampleRect | null }
  | { kind: 'lava' }
  | { kind: 'farShadow'; sunDir: { x: number; y: number; z: number } };

export interface GroundJobResults {
  shape: ShapePatch;
  lava: { closeness: Uint8Array; any: boolean };
  farShadow: FarShadowTexels;
}

export type GroundJobResult = GroundJobResults[GroundJob['kind']];

/**
 * The copy of `terrain` the jobs work on, as a worker gets it: the heights
 * copied, of the water only the lava (the rest is not read)
 */
export function groundJobMap(terrain: GroundJobMap): GroundJobMap {
  const lava = (w: MapWater): MapWater => ({ ...w, mask: w.mask.slice() });
  return {
    width: terrain.width,
    depth: terrain.depth,
    grid: { ...terrain.grid, heights: terrain.grid.heights.slice() },
    water: terrain.water?.kind === 'lava' ? lava(terrain.water) : null,
    waterBodies: (terrain.waterBodies ?? []).filter((w) => w.kind === 'lava').map(lava),
    rivers: (terrain.rivers ?? []).filter((r) => r.kind === 'lava'),
  };
}

/** The arrays of `map` a worker may take over */
export function groundJobTransfer(map: GroundJobMap): ArrayBuffer[] {
  return [map.grid.heights, ...[map.water, ...(map.waterBodies ?? [])].flatMap((w) => (w ? [w.mask] : []))].map((a) => a.buffer as ArrayBuffer);
}

/** Works a job out on `map` */
export function runGroundJob(map: GroundJobMap, job: GroundJob): GroundJobResult {
  const field = new HeightField(map.grid, map.width, map.depth);
  switch (job.kind) {
    case 'shape':
      return shapePatch(field, job.rect);
    case 'lava': {
      const lava = lavaSamples(map, field);
      return { closeness: lavaCloseness(lava, field), any: lava.includes(1) };
    }
    case 'farShadow':
      return farShadowData(field, job.sunDir, map.width, map.depth);
  }
}

/** The arrays of a result that go back transferred */
export function groundResultTransfer(result: GroundJobResult): ArrayBuffer[] {
  if ('terrain' in result) return [result.terrain, result.curvature, ...(result.drainage ? [result.drainage] : [])].map((a) => a.buffer as ArrayBuffer);
  if ('closeness' in result) return [result.closeness.buffer as ArrayBuffer];
  return [result.data.buffer as ArrayBuffer];
}
