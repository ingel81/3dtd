import type { W3Region } from '../formats/w3r';
import { regionVariable } from '../formats/w3r';
import type { LaneMask } from './lane-mask';
import { routesFromMaze } from './maze-routes';
import { buildRouteGraph, routeLengths } from './route-graph';

const CELL = 64;
const at = (px: number): number => (px + 0.5) * CELL;

function region(name: string, px: number, py: number): W3Region {
  return { name, variable: regionVariable(name), left: at(px) - 96, bottom: at(py) - 96, right: at(px) + 96, top: at(py) + 96, index: 0, weather: '' };
}

/** 60 x 40 open walkable field with a wall at x = 30 from y 0 to 30 (a gap above it); `lane` marks a band along y = 35 */
function field(withLane: boolean): LaneMask & { lane: Uint8Array } {
  const w = 60;
  const h = 40;
  const data = new Uint8Array(w * h).fill(1);
  const lane = new Uint8Array(w * h);
  for (let y = 0; y <= 30; y++) data[y * w + 30] = 0;
  if (withLane) for (let x = 0; x < w; x++) for (let y = 33; y <= 37; y++) lane[y * w + x] = 1;
  return { width: w, height: h, cell: CELL, originX: 0, originY: 0, data, lane, source: 'walkable' };
}

describe('maze routes', () => {
  it('(d) finds the way round a wall over open ground', () => {
    const regions = [region('Spawn West', 5, 5), region('Castle', 55, 5)];
    const t = routesFromMaze({ mask: field(false), regions, spawns: [], ends: [], center: { x: at(30), y: at(20) } })!;
    const g = buildRouteGraph(t.raw, 'maze')!;
    expect(g.strategy).toBe('maze');
    expect(g.spawns).toEqual(['gg_rct_Spawn_West']);
    expect(g.end).toBe('gg_rct_Castle');
    // Up through the gap above the wall (y > 30) and down again: well over the straight 50 pixels
    expect(Math.max(...g.nodes.map((n) => n.y))).toBeGreaterThan(at(30));
    expect(routeLengths(g).get('gg_rct_Spawn_West')! / CELL).toBeGreaterThan(70);
  });

  it('(d) keeps to unbuildable lanes where the map has them', () => {
    const spawns = [{ id: 's', name: 'S', x: at(2), y: at(35) }];
    const ends = [{ id: 'e', name: 'E', x: at(57), y: at(35) }];
    const t = routesFromMaze({ mask: field(true), regions: [], spawns, ends, center: { x: 0, y: 0 } })!;
    const g = buildRouteGraph(t.raw, 'maze')!;
    for (const n of g.nodes) expect(Math.abs(n.y - at(35))).toBeLessThan(3 * CELL);
  });

  it('(d) puts the end in the middle when nothing names one', () => {
    const regions = [region('Spawn West', 5, 5)];
    const t = routesFromMaze({ mask: field(false), regions, spawns: [], ends: [], center: { x: at(45), y: at(20) } })!;
    const g = buildRouteGraph(t.raw, 'maze')!;
    expect(g.end).toBe('maze_end');
    expect(t.warnings.join()).toMatch(/middle of the map/);
  });

  it('gives up without spawns', () => {
    expect(routesFromMaze({ mask: field(false), regions: [], spawns: [], ends: [], center: { x: at(30), y: at(20) } })).toBeNull();
  });
});
