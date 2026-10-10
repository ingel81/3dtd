import { existsSync, readFileSync } from 'fs';
import type { W3eTerrain } from '../formats/w3e';
import type { W3Region } from '../formats/w3r';
import { regionVariable } from '../formats/w3r';
import { buildLaneMask, laneWidth, type LaneMask } from './lane-mask';
import { playableBounds, readW3xFiles } from '../map-files';
import { extractRoutes } from './extract-routes';
import { buildRouteGraph, routeLengths } from './route-graph';
import { routesFromTerrain, thin } from './terrain-routes';

const CELL = 64;
const REAL_MAP = 'D:/Source/3dtd/tmp/wc3/Mafa-Td-Queen-v14.6.w3x';

function region(name: string, x: number, y: number): W3Region {
  return { name, variable: regionVariable(name), left: x - 96, bottom: y - 96, right: x + 96, top: y + 96, index: 0, weather: '' };
}

/**
 * 100 x 100 pixels (64 units each, origin 0): lane A runs east along y = 20
 * from x 5 to 80, lane B runs south along x = 40 from y 90 to the lane A,
 * and lane A turns north at x = 80 to the castle at y 60. Lanes are 5 pixels
 * wide.
 */
function laneGrid(): LaneMask {
  const w = 100;
  const data = new Uint8Array(w * w);
  const fill = (x0: number, y0: number, x1: number, y1: number): void => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) data[y * w + x] = 1;
  };
  fill(5, 18, 82, 22);
  fill(38, 18, 42, 90);
  fill(78, 18, 82, 60);
  return { width: w, height: w, cell: CELL, originX: 0, originY: 0, data, source: 'pathing' };
}

const at = (px: number): number => (px + 0.5) * CELL;

describe('terrain routes', () => {
  it('thins a filled bar to a one-pixel line', () => {
    const w = 20;
    const data = new Uint8Array(w * 7);
    for (let y = 1; y <= 5; y++) for (let x = 2; x <= 17; x++) data[y * w + x] = 1;
    thin(data, w, 7);
    for (let x = 5; x <= 13; x++) {
      let n = 0;
      for (let y = 0; y < 7; y++) n += data[y * w + x];
      expect(n).toBe(1);
    }
  });

  it('(c) connects spawn regions to the end region over the lane skeleton', () => {
    const regions = [region('Spawn West', at(6), at(20)), region('Spawn North', at(40), at(89)), region('Castle', at(80), at(59)), region('Shop', at(10), at(80))];
    const result = routesFromTerrain({ mask: laneGrid(), regions })!;
    const g = buildRouteGraph(result.raw, 'terrain')!;
    expect(g.end).toBe('gg_rct_Castle');
    expect(g.spawns.sort()).toEqual(['gg_rct_Spawn_North', 'gg_rct_Spawn_West']);
    // The ways merge where lane B meets lane A and share the rest
    const into = new Map<string, number>();
    for (const e of g.edges) into.set(e.to, (into.get(e.to) ?? 0) + 1);
    const merge = [...into].find(([, n]) => n === 2)![0];
    const node = g.nodes.find((n) => n.id === merge)!;
    expect(Math.abs(node.x - at(40))).toBeLessThan(3 * CELL);
    expect(Math.abs(node.y - at(20))).toBeLessThan(3 * CELL);
    const lengths = routeLengths(g);
    // West: 74 px east + 40 px north; North: 70 px south + 40 east + 40 north (pixels of 64 units)
    expect(lengths.get('gg_rct_Spawn_West')! / CELL).toBeCloseTo(114, -1);
    expect(lengths.get('gg_rct_Spawn_North')! / CELL).toBeCloseTo(150, -1);
    // Few corners, not one node per pixel
    expect(g.nodes.length).toBeLessThan(10);
  });

  it('(c) places spawns at far lane ends when no region is named like a spawn', () => {
    const regions = [region('Castle', at(80), at(59))];
    const result = routesFromTerrain({ mask: laneGrid(), regions })!;
    const g = buildRouteGraph(result.raw, 'terrain')!;
    expect(g.spawns.length).toBe(2);
    expect(result.warnings.join()).toMatch(/lane ends/);
  });

  it('gives up without an end region', () => {
    expect(routesFromTerrain({ mask: laneGrid(), regions: [region('Spawn West', at(6), at(20))] })).toBeNull();
  });

  it('measures lane widths across a segment', () => {
    const width = laneWidth(laneGrid(), { x: at(10), y: at(20) }, { x: at(30), y: at(20) }, 2000);
    expect(width).toBeGreaterThanOrEqual(5 * CELL - CELL / 2);
    expect(width).toBeLessThanOrEqual(5 * CELL + CELL);
  });

  it('builds the mask from walkable, unbuildable pathing cells', () => {
    // 8 x 8 tiles; pathing 32 x 32 cells: buildable land with a 2-tile lane across the middle
    const n = 9;
    const terrain = {
      width: n,
      height: n,
      offsetX: 0,
      offsetY: 0,
      layer: new Uint8Array(n * n).fill(2),
      texture: new Uint8Array(n * n),
      groundTiles: ['Ldrt'],
    } as unknown as W3eTerrain;
    const cells = new Uint8Array(32 * 32).fill(0x40);
    for (let y = 12; y < 20; y++) for (let x = 0; x < 32; x++) cells[y * 32 + x] = 0x48;
    const mask = buildLaneMask({ width: 32, height: 32, cells }, terrain, { minX: 0, minY: 0, maxX: 1024, maxY: 1024 })!;
    expect(mask.source).toBe('pathing');
    expect([mask.width, mask.cell]).toEqual([16, 64]);
    let count = 0;
    for (const v of mask.data) count += v;
    expect(count).toBe(16 * 4);
  });

  it.skipIf(!existsSync(REAL_MAP))('(c) finds the ten lanes of the test map without its script', () => {
    const m = readW3xFiles(new Uint8Array(readFileSync(REAL_MAP)));
    const r = extractRoutes(m, playableBounds(m), { only: 'terrain' });
    const g = r.graph!;
    expect(g.strategy).toBe('terrain');
    expect(g.end).toBe('gg_rct_The_Throne');
    expect(g.spawns.length).toBe(10);
    const script = extractRoutes(m, playableBounds(m)).graph!;
    expect(script.strategy).toBe('script-eval');
    const a = routeLengths(g);
    const b = routeLengths(script);
    // Skeleton ways run along lane middles, the script's between rect centres: within 5 %
    for (const s of g.spawns) expect(Math.abs(a.get(s)! - b.get(s)!) / b.get(s)!).toBeLessThan(0.05);
  });
});
