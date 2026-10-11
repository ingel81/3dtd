import { existsSync, readFileSync } from 'fs';
import { validateMapDocument } from '../custom-map/map-file';
import type { CustomMapDocument } from '../custom-map/map-document';
import { findTestMap } from '../../../test/w3x-fixtures';
import { buildSyntheticMap } from '../../../test/w3x-synthetic-map';
import { importW3x } from './import-w3x';

const TEST_MAP = findTestMap(existsSync);
const GREEN_TD = findTestMap(existsSync, 'Green TD.w3x');
const GREEN_CIRCLE = findTestMap(existsSync, 'Green Circle TD Mega 2025.w3x');
const NOW = new Date('2026-10-11T00:00:00Z');

function heightAt(doc: CustomMapDocument, x: number, y: number): number {
  const t = doc.terrain;
  const g = t.grid;
  const i = Math.round((x + t.width / 2) / g.cellSize);
  const j = Math.round((y + t.depth / 2) / g.cellSize);
  return g.heights[j * g.columns + i];
}

/** Every spawn reaches the HQ node over the directed edges */
function spawnsReachHq(doc: CustomMapDocument): boolean {
  const out = new Map<string, string[]>();
  for (const e of doc.paths.edges) (out.get(e.a) ?? out.set(e.a, []).get(e.a)!).push(e.b);
  const at = (p: { x: number; y: number }): string | undefined =>
    doc.paths.nodes.find((n) => Math.hypot(n.x - p.x, n.y - p.y) < 0.01)?.id;
  const hq = at(doc.hq);
  return doc.spawns.every((s) => {
    const seen = new Set<string>();
    const stack = [at(s)!];
    while (stack.length) {
      const n = stack.pop()!;
      if (n === hq) return true;
      if (seen.has(n)) continue;
      seen.add(n);
      stack.push(...(out.get(n) ?? []));
    }
    return false;
  });
}

describe('importW3x', () => {
  it('turns a synthetic map into a valid document', async () => {
    const { doc, report } = await importW3x(buildSyntheticMap(), { fileName: 'lane-test.w3x', now: NOW });
    expect(validateMapDocument(doc)).toEqual([]);
    expect(doc.meta).toMatchObject({
      id: 'lane-test',
      name: 'Lane Test',
      author: 'Tester',
      source: { kind: 'w3x', file: 'lane-test.w3x', mapName: 'Lane Test', tileset: 'Lordaeron Summer' },
    });
    // 16 tiles minus 2 margin tiles each side, 4 m a tile, 4 samples a tile
    expect([doc.terrain.width, doc.terrain.depth]).toEqual([48, 48]);
    expect(doc.terrain.grid.cellSize).toBe(1);
    // The lane lies one cliff level (4 m) below the grass
    expect(heightAt(doc, 0, 0)).toBeCloseTo(-4);
    expect(heightAt(doc, 0, 15)).toBeCloseTo(0);
    expect(doc.terrain.layers.map((l) => l.material).sort()).toEqual(['cobblestone', 'grass']);
    // Water 100 units over 0x2000 minus Warcraft's 89.6 offset, in metres
    expect(doc.terrain.water?.level).toBeCloseTo((100 - 89.6) * (4 / 128), 3);
    expect(report.stats.waterSamples).toBeGreaterThan(0);

    expect(report.strategy).toBe('script-pattern');
    expect(doc.spawns).toEqual([{ id: 's1', name: 'Spawn West', x: -20, y: 0 }]);
    expect(doc.hq).toEqual({ x: 20, y: 0 });
    expect(doc.paths.edges.length).toBe(1);
    // Lane cells span 320 units (10 m); the mask's half-tile pixels measure within one pixel (2 m)
    expect(Math.abs(doc.paths.edges[0].width - 10)).toBeLessThanOrEqual(2);
    expect(spawnsReachHq(doc)).toBe(true);

    expect(report.stats.objects).toMatchObject({ doodads: 6, placed: 2, onLanes: 1, helpers: 2, outside: 1 });
    expect(doc.objects.map((o) => o.asset).sort()).toEqual([expect.stringMatching(/^rock/), expect.stringMatching(/^tree/)]);
    expect(doc.objects[0].scale).toBeCloseTo(1.2);
  });

  it('finds the same lane from the terrain when the map has no script', async () => {
    const { doc, report } = await importW3x(buildSyntheticMap({ script: false }), { now: NOW });
    expect(report.strategy).toBe('terrain');
    expect(doc.spawns.length).toBe(1);
    expect(Math.abs(doc.spawns[0].y)).toBeLessThan(2);
    expect(spawnsReachHq(doc)).toBe(true);
    expect(report.warnings.join()).toMatch(/no map script/);
  });

  it('follows the options: scale, density, no crop, catalogue', async () => {
    const { doc } = await importW3x(buildSyntheticMap(), {
      metresPerTile: 2,
      samplesPerTile: 2,
      cropToPlayable: false,
      now: NOW,
      catalog: {
        materials: [
          { id: 'meadow', category: 'grass' },
          { id: 'paving', category: 'road' },
          { id: 'cliff', category: 'rock' },
        ],
        objects: [
          { id: 'spruce', category: 'tree' },
          { id: 'boulder', category: 'rock' },
        ],
      },
    });
    expect([doc.terrain.width, doc.terrain.grid.cellSize]).toEqual([32, 1]);
    expect(doc.terrain.layers.map((l) => l.material).sort()).toEqual(['meadow', 'paving']);
    expect(doc.objects.map((o) => o.asset).sort()).toEqual(['boulder', 'spruce', 'spruce']);
  });

  it('rejects files that are not maps', async () => {
    await expect(importW3x(new Uint8Array(4096))).rejects.toThrow(/no MPQ header/);
  });

  it.skipIf(!TEST_MAP)('imports the test map', async () => {
    const { doc, report } = await importW3x(new Uint8Array(readFileSync(TEST_MAP!)), { fileName: 'Mafa-Td-Queen-v14.6.w3x', now: NOW });
    expect(validateMapDocument(doc)).toEqual([]);
    expect(doc.meta.name).toBe('Mafa TD Queen v14.6');
    expect(report.strategy).toBe('script-eval');
    expect(doc.spawns.length).toBe(10);
    expect(report.warnings.join()).not.toMatch(/spawns; the game shows portals/);
    // The Throne's centre (-16, -1280) around the playable area's centre (64, -448), 4 m a tile
    const s = 4 / 128;
    expect(doc.hq.x).toBeCloseTo((-16 - 64) * s, 1);
    expect(doc.hq.y).toBeCloseTo((-1280 + 448) * s, 1);
    expect(spawnsReachHq(doc)).toBe(true);
    expect(doc.paths.edges.length).toBe(29);
    expect([doc.terrain.width, doc.terrain.depth]).toEqual([388, 412]);
    // Lanes are 4 tiles of floor between the cliffs
    expect(report.stats.laneWidths!.median).toBe(16);
    const lengths = Object.values(report.stats.routeLengths).sort((a, b) => a - b);
    expect(lengths[0]).toBeGreaterThan(300);
    expect(lengths[lengths.length - 1]).toBeLessThan(700);
    expect(doc.objects.length).toBeGreaterThan(1400);
    expect(report.stats.objects.byCategory['tree']).toBeGreaterThan(700);
    expect(doc.terrain.water).not.toBeNull();
  });

  it.skipIf(!GREEN_TD)('imports Green TD (2005): nine lanes from GUI triggers, one spawn on another lane', async () => {
    const { doc, report } = await importW3x(new Uint8Array(readFileSync(GREEN_TD!)), { now: NOW });
    expect(validateMapDocument(doc)).toEqual([]);
    expect(report.strategy).toBe('script-pattern');
    expect(doc.spawns.map((s) => s.name)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9']);
    expect(spawnsReachHq(doc)).toBe(true);
  });

  it.skipIf(!GREEN_CIRCLE)('imports Green Circle TD (2025), a circuit without an end, over open ground from its corners', async () => {
    const { doc, report } = await importW3x(new Uint8Array(readFileSync(GREEN_CIRCLE!)), { now: NOW });
    expect(validateMapDocument(doc)).toEqual([]);
    expect(report.strategy).toBe('maze');
    expect(report.warnings.join(' ')).toMatch(/round in circles/);
    // The four corners; the four fields beside the middle would leak at once
    expect(doc.spawns.length).toBe(4);
    expect(report.warnings.join(' ')).toMatch(/4 spawn\(s\) right beside the end/);
    expect(spawnsReachHq(doc)).toBe(true);
    // The HQ in the middle of the map
    expect(Math.hypot(doc.hq.x, doc.hq.y)).toBeLessThan(10);
  });
});
