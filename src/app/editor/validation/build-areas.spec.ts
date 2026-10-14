import { describe, expect, it } from 'vitest';
import { createMapDocument } from '../../world/custom-map/map-create';
import { emptyWater } from '../ops/water-ops';
import { spawnRoutes } from '../ops/path-graph';
import { BuildCell, TYPICAL_TOWER_RANGE, buildAreaInput, computeBuildAreas, type BuildAreas } from './build-areas';

/** A 600 x 400 m starter map: a road from the west edge (spawn at -296, 0) to the HQ at (150, 0) */
function map() {
  const doc = createMapDocument({ id: 'm', name: 'M', width: 600, depth: 400 });
  const t = doc.terrain;
  const g = t.grid;
  const x0 = -t.width / 2;
  const y0 = -t.depth / 2;
  // A pond at (-80, 120), a tree at (60, 120), a 20 m step north of y = 171
  t.water = emptyWater(t, 1);
  for (let j = 0; j < g.rows; j++) {
    for (let i = 0; i < g.columns; i++) {
      const x = x0 + i * g.cellSize;
      const y = y0 + j * g.cellSize;
      if (Math.hypot(x + 80, y - 120) < 20) t.water.mask[j * g.columns + i] = 255;
      if (y >= 171) g.heights[j * g.columns + i] = 20;
    }
  }
  doc.objects.push({ id: 'o1', asset: 'tree', x: 60, y: 120, z: 0, rotation: 0, scale: 1 });
  return doc;
}

function areas(doc: ReturnType<typeof map>, unreachable: string[] = []): BuildAreas {
  const routes = spawnRoutes(doc);
  return computeBuildAreas(buildAreaInput(
    doc,
    (asset) => ({ radius: asset === 'tree' ? 2 : 1, blocksBuild: asset === 'tree' }),
    doc.spawns.map((s) => ({ spawnId: s.id, name: s.name, points: unreachable.includes(s.id) ? null : routes.get(s.id)?.points ?? null })),
  ));
}

const at = (a: BuildAreas, x: number, y: number) =>
  a.kind[Math.floor((y - a.y0) / a.cell) * a.columns + Math.floor((x - a.x0) / a.cell)];

describe('computeBuildAreas', () => {
  it("judges each cell by the game's placement rules", () => {
    const a = areas(map());
    expect(a.cell).toBe(4);
    expect(at(a, 0, 5)).toBe(BuildCell.Route);
    expect(at(a, 0, 40)).toBe(BuildCell.InReach);
    expect(at(a, 0, -40)).toBe(BuildCell.InReach);
    expect(at(a, 0, 150)).toBe(BuildCell.OutOfReach);
    expect(at(a, 150, 20)).toBe(BuildCell.Marker);
    expect(at(a, -270, 30)).toBe(BuildCell.Marker);
    expect(at(a, -80, 120)).toBe(BuildCell.Water);
    expect(at(a, 60, 120)).toBe(BuildCell.Object);
    // The step: the cells at its foot and on its edge refuse the footprint, the plateau behind it is ground again
    expect([at(a, 0, 166), at(a, 0, 170), at(a, 0, 174)]).toContain(BuildCell.Steep);
    expect(at(a, 0, 190)).toBe(BuildCell.OutOfReach);
  });

  it('adds up the room in reach of each lane', () => {
    const a = areas(map());
    expect(a.lanes).toHaveLength(1);
    expect(a.lanes[0].area).toBe(a.inReach);
    // The road is about 450 m long: in reach on both sides, less the route itself and the markers
    expect(a.inReach).toBeGreaterThan(300 * 2 * (TYPICAL_TOWER_RANGE - 10));
    expect(a.inReach).toBeLessThan(a.buildable);
  });

  it('counts no room for a lane without a route', () => {
    const doc = map();
    doc.spawns.push({ id: 's2', name: 'Lost', x: 0, y: 150 });
    const a = areas(doc, ['s2']);
    expect(a.lanes.map((l) => [l.spawnId, l.area > 0])).toEqual([['s1', true], ['s2', false]]);
  });
});
