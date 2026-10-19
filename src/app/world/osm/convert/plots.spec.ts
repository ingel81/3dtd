import { describe, expect, it } from 'vitest';
import { createMapDocument } from '../../custom-map/map-create';
import type { CustomMapDocument } from '../../custom-map/map-document';
import { readWeights } from '../../../map-ops/paint-ops';
import type { OsmArea, OsmFeatures } from '../osm-parse';
import { BACK_MATERIAL, DRIVE_MATERIAL, FRONT_MATERIAL, layPlots } from './plots';

const square = (id: number, x0: number, y0: number, x1: number, y1: number, tags: Record<string, string>): OsmArea => ({
  id,
  from: 'way',
  tags,
  outer: [[{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }]],
  inner: [],
  area: (x1 - x0) * (y1 - y0),
});

/** A 200 m map with a street along y = 0 and houses 12 x 9 m set back to the north of it */
function street(houses: OsmArea[]): { doc: CustomMapDocument; features: OsmFeatures } {
  const doc = createMapDocument({ id: 'plots', name: 'Plots', width: 200, depth: 200, starter: false, splatResolution: 256 });
  doc.hq = { x: -90, y: -90 };
  doc.spawns = [];
  doc.paths = {
    nodes: [{ id: 'a', x: -100, y: 0 }, { id: 'b', x: 100, y: 0 }],
    edges: [{ id: 'e1', a: 'a', b: 'b', width: 6, kind: 'road', street: 'residential', surface: 'asphalt', sidewalk: 1.8 }],
  };
  return { doc, features: { areas: houses, ways: [], points: [], frame: { lat: 49.7, lon: 9.26 } } as unknown as OsmFeatures };
}

const house = (id: number, x: number): OsmArea => square(id, x - 6, 14, x + 6, 23, { building: 'house' });

/** The layer weights the ground has at map point (x, y) */
function weightAt(doc: CustomMapDocument, material: string, x: number, y: number): number {
  const t = doc.terrain;
  const res = t.splat.resolution;
  const texel = Math.floor((y / t.depth + 0.5) * res) * res + Math.floor((x / t.width + 0.5) * res);
  const w = new Float32Array(12);
  readWeights(t, texel, w);
  const k = t.layers.findIndex((l) => l.material === material);
  return k < 0 ? 0 : w[k] / 255;
}

describe('layPlots', () => {
  it('paints the front garden as lawn and the garden behind leafier, between the house and the street', () => {
    const { doc, features } = street([house(1, 0)]);
    const report = layPlots(doc, features, { costOf: () => 1 });
    expect(report).toMatchObject({ houses: 1, fronts: 1 });
    // Front: between the pavement's edge (4.8 m) and the house (14 m); behind it to the north
    expect(weightAt(doc, FRONT_MATERIAL, -1, 9)).toBeGreaterThan(0.9);
    expect(weightAt(doc, BACK_MATERIAL, -1, 30)).toBeGreaterThan(0.5);
    // Not on the street, not past the plot's reach
    expect(weightAt(doc, FRONT_MATERIAL, -1, 2)).toBe(0);
    expect(weightAt(doc, BACK_MATERIAL, 0, 60)).toBe(0);
  });

  it('lays a driveway of pavers from the street along the side of the house past its front', () => {
    const { doc, features } = street([house(1, 0)]);
    expect(layPlots(doc, features, { costOf: () => 1 }).driveways).toBe(1);
    const drive = doc.surfaces!.find((s) => s.material === DRIVE_MATERIAL)!;
    const xs = drive.outer.map((p) => p.x);
    const ys = drive.outer.map((p) => p.y);
    // 3 m wide beside a wall at x = +-6, from under the road's edge (4.8 m) to 5 m behind the front (14 m)
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(3, 1);
    expect(Math.min(...xs) >= 6.3 || Math.max(...xs) <= -6.3).toBe(true);
    expect(Math.min(...ys)).toBeCloseTo(4.8 + 0.3 - 0.3, 0);
    expect(Math.max(...ys)).toBeCloseTo(19, 0);
    // A way mapped there (OSM's driveway) leaves it out
    const mapped = street([house(1, 0)]);
    mapped.doc.paths.nodes.push({ id: 'c', x: 7.9, y: 0 }, { id: 'd', x: 7.9, y: 20 }, { id: 'f', x: -7.9, y: 0 }, { id: 'g', x: -7.9, y: 20 });
    mapped.doc.paths.edges.push({ id: 'e2', a: 'c', b: 'd', width: 3, kind: 'road', street: 'service', surface: 'asphalt' }, { id: 'e3', a: 'f', b: 'g', width: 3, kind: 'road', street: 'service', surface: 'asphalt' });
    expect(layPlots(mapped.doc, mapped.features, { costOf: () => 1 }).driveways).toBe(0);
  });

  it('runs a boundary between two plots, hedges on it within the budget, none along the walls', () => {
    const { doc, features } = street([house(1, -12), house(2, 12)]);
    const report = layPlots(doc, features, { costOf: () => 1 });
    expect(report.hedges).toBeGreaterThan(0);
    const hedges = doc.objects.filter((o) => o.asset === 'hedge-long');
    // The boundary between the two plots runs north from between the houses (x = 0)
    expect(hedges.some((o) => Math.abs(o.x) < 1.5 && o.y > 14)).toBe(true);
    // None on a footprint
    const onHouse = (x: number, y: number) => Math.abs(Math.abs(x) - 12) < 6 && y > 14 && y < 23;
    expect(hedges.filter((o) => onHouse(o.x, o.y))).toEqual([]);
    // The budget holds: none past it
    const tight = street([house(1, -12), house(2, 12)]);
    const capped = layPlots(tight.doc, tight.features, { costOf: () => 1, budget: 2 });
    expect(capped.hedges + capped.fences).toBeLessThanOrEqual(2);
  });

  it('leaves blocks of flats, sheds and buildings across the street out', () => {
    const { doc, features } = street([square(1, -15, 14, 15, 40, { building: 'apartments' }), square(2, 30, 14, 33, 17, { building: 'yes' })]);
    expect(layPlots(doc, features, { costOf: () => 1 }).houses).toBe(0);
  });
});
