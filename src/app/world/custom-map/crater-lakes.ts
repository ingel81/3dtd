/**
 * Which craters cut which rivers, as the renderer's CraterWaterLayer takes
 * them (map-ops/crater-water.ts, docs/WATER_NETWORK_PLAN.md): one reckoning
 * for the game (craters an impact dug, and those the map brought from the
 * editor) and the editor (the craters its landscape brush dug). Each crater
 * is worked out once per signature (its middle, radius and depth) and kept
 * until it is gone or `forget` says the ground or the rivers changed under
 * it. Without three.
 */
import { craterCuts, type CraterAt, type CraterCut, type GroundGrid } from '../../map-ops/crater-water';
import { heightAt } from '../../map-ops/grid';
import type { MapCrater, MapTerrain } from './map-document';
import type { CraterWaterEntry } from './render/water/crater-water';
import { waterLevelAt } from './water-level';

/** A crater to reckon with: `key` names it for good (its signature), `start` the clock's seconds it was dug at, null for long ago (full) */
export interface CraterLakeSource {
  key: string;
  crater: CraterAt;
  start: number | null;
}

/** The craters of a map's own list (MapTerrain.craters): dug before the map was opened, their lakes full */
export function mapCraterSources(craters: readonly MapCrater[] | undefined): CraterLakeSource[] {
  return (craters ?? []).map((c) => ({ key: `map:${c.x}:${c.y}:${c.radius}`, crater: c, start: null }));
}

export class CraterLakes {
  private readonly cuts = new Map<string, CraterCut[]>();

  /** The rivers `sources` cut on the ground as it stands now, with what their water does */
  entries(terrain: MapTerrain, sources: Iterable<CraterLakeSource>): CraterWaterEntry[] {
    const rivers = terrain.rivers ?? [];
    const out: CraterWaterEntry[] = [];
    const seen = new Set<string>();
    if (!rivers.length) {
      this.cuts.clear();
      return out;
    }
    const grid: GroundGrid = { columns: terrain.grid.columns, rows: terrain.grid.rows, cellSize: terrain.grid.cellSize, originX: -terrain.width / 2, originY: -terrain.depth / 2, heights: terrain.grid.heights };
    for (const { key, crater, start } of sources) {
      seen.add(key);
      let cuts = this.cuts.get(key);
      if (!cuts) {
        cuts = craterCuts(grid, rivers, crater, (x, y) => waterKindAt(terrain, x, y));
        this.cuts.set(key, cuts);
      }
      for (const cut of cuts) out.push({ crater, cut, kind: rivers[cut.river].kind, start });
    }
    for (const key of this.cuts.keys()) if (!seen.has(key)) this.cuts.delete(key);
    return out;
  }

  /** The ground or the rivers changed (the editor): every crater is worked out again */
  forget(): void {
    this.cuts.clear();
  }
}

/** Water, lava or nothing at map metres (x, y) on the ground as it stands */
export function waterKindAt(t: MapTerrain, x: number, y: number): 'water' | 'lava' | null {
  const ground = heightAt(t, x, y);
  if (waterLevelAt(t, x, y, ground, 'lava') !== null) return 'lava';
  return waterLevelAt(t, x, y, ground) !== null ? 'water' : null;
}
