import { validateMap } from '../../../editor/validation/map-validation';
import { createMapDocument } from '../../custom-map/map-create';
import type { CustomMapDocument, MapPoint } from '../../custom-map/map-document';
import { OsmFrame, type OsmArea, type OsmFeatures, type OsmPoint, type OsmWay } from '../osm-parse';
import { barrierPiece, placeFurniture, pointAsset } from './furniture';
import { sampleGrid } from './raster';
import type { WaterResult } from './water';

let nextNode = 1;
function way(id: number, tags: Record<string, string>, points: MapPoint[]): OsmWay {
  return { id, tags, nodes: points.map(() => nextNode++), points };
}

/** A 200 m map with one 6 m road along y = 0 from west to east, the HQ far east */
function world(ways: OsmWay[], points: OsmPoint[] = [], areas: OsmArea[] = []): { doc: CustomMapDocument; features: OsmFeatures; water: WaterResult } {
  const doc = createMapDocument({ id: 't', name: 't', width: 200, depth: 200, cellSize: 2, baseMaterial: 'grass', splatResolution: 64, starter: false });
  doc.paths = { nodes: [{ id: 'a', x: -95, y: 0 }, { id: 'b', x: 95, y: 0 }], edges: [{ id: 'e1', a: 'a', b: 'b', width: 6, kind: 'road' }] };
  doc.hq = { x: 90, y: 0 };
  doc.spawns = [];
  doc.objects = [];
  const n = sampleGrid(200, 2).n * sampleGrid(200, 2).n;
  const water = { wet: new Uint8Array(n), sea: new Uint8Array(n) } as WaterResult;
  const features: OsmFeatures = { frame: new OsmFrame(0, 0), half: 100, ways, areas, points, stats: { elements: 0, ways: 0, relations: 0, points: 0, areas: 0, forcedRings: 0, areasOutside: 0 } };
  return { doc, features, water };
}

const costOf = () => 100;

describe('OSM furniture', () => {
  it('reads the model of a barrier line and of a point from its tags', () => {
    expect(barrierPiece({ barrier: 'fence' })?.asset).toBe('fence-wood');
    expect(barrierPiece({ barrier: 'fence', fence_type: 'chain_link' })?.asset).toBe('fence-chainlink');
    expect(barrierPiece({ barrier: 'wall', wall: 'dry_stone' })?.asset).toBe('wall-dry-stone');
    expect(barrierPiece({ barrier: 'retaining_wall' })?.asset).toBe('retaining-wall');
    expect(barrierPiece({ barrier: 'hedge' })?.asset).toBe('hedge-long');
    expect(barrierPiece({ barrier: 'guard_rail' })).toBeNull();
    expect(barrierPiece({ barrier: 'kerb' })).toBeNull();
    expect(pointAsset({ amenity: 'bench' })).toBe('bench');
    expect(pointAsset({ power: 'tower' })).toBe('power-pylon');
    expect(pointAsset({ man_made: 'tower', 'tower:type': 'communication' })).toBe('antenna-mast');
    expect(pointAsset({ man_made: 'tower', 'tower:type': 'bell_tower' })).toBeNull();
  });

  it('puts fence pieces along the line, turned across it, none on the road', () => {
    // A fence from south of the road to north of it, crossing it
    const { doc, features, water } = world([way(1, { barrier: 'fence' }, [{ x: -20, y: -40 }, { x: -20, y: 40 }])]);
    const report = placeFurniture(doc, features, water, { costOf });
    const fence = doc.objects.filter((o) => o.asset === 'fence-wood');
    expect(fence.length).toBeGreaterThan(15);
    expect(report.dropped.road).toBeGreaterThan(0);
    for (const o of fence) {
      expect(o.x).toBeCloseTo(-20, 5);
      expect(Math.abs(o.y)).toBeGreaterThan(3.4);
      // The line runs north, the piece's length (model X) along it: a quarter turn
      expect(Math.abs(Math.cos(o.rotation))).toBeLessThan(1e-3);
    }
    expect(validateMap(doc).map((i) => i.code)).not.toContain('object-on-path');
  });

  it('turns a retaining wall\'s face to the right of its way, and keeps furniture out of buildings and away from the HQ', () => {
    const building: OsmArea = { id: 9, from: 'way', tags: { building: 'yes' }, outer: [[{ x: 10, y: 20 }, { x: 30, y: 20 }, { x: 30, y: 30 }, { x: 10, y: 30 }]], inner: [], area: 200 };
    const { doc, features, water } = world(
      [
        way(1, { barrier: 'retaining_wall' }, [{ x: -60, y: 50 }, { x: -20, y: 50 }]),
        way(2, { barrier: 'wall' }, [{ x: 0, y: 25 }, { x: 40, y: 25 }]),
        way(3, { barrier: 'hedge' }, [{ x: 80, y: 10 }, { x: 80, y: 30 }]),
      ],
      [],
      [building],
    );
    const report = placeFurniture(doc, features, water, { costOf });
    const retaining = doc.objects.filter((o) => o.asset === 'retaining-wall');
    expect(retaining.length).toBeGreaterThan(5);
    // The way runs east, its right is south: the model's front (+y at turn 0) faces south
    for (const o of retaining) expect(Math.cos(o.rotation)).toBeCloseTo(-1, 3);
    const wall = doc.objects.filter((o) => o.asset === 'wall-stone');
    expect(wall.every((o) => o.x < 10 || o.x > 30)).toBe(true);
    expect(report.dropped.building).toBeGreaterThan(0);
    for (const o of doc.objects) expect(Math.hypot(o.x - doc.hq.x, o.y - doc.hq.y)).toBeGreaterThan(20);
  });

  it('moves a bus stop mapped on the road to its edge, and lights a lit road with lamps beside it', () => {
    const stop: OsmPoint = { id: 50, tags: { highway: 'bus_stop' }, x: 0, y: 0.5 };
    const { doc, features, water } = world([way(1, { highway: 'residential', lit: 'yes' }, [{ x: -95, y: 0 }, { x: 60, y: 0 }])], [stop]);
    const report = placeFurniture(doc, features, water, { costOf });
    const bus = doc.objects.find((o) => o.asset === 'bus-stop')!;
    expect(bus.x).toBeCloseTo(0, 3);
    expect(bus.y).toBeCloseTo(3.9, 3);
    const lamps = doc.objects.filter((o) => o.asset === 'lamp-post');
    expect(lamps.length).toBeGreaterThanOrEqual(3);
    expect(report.placed['lit roads']).toBe(lamps.length);
    // On the right of the eastward way, beside the road's edge
    for (const o of lamps) expect(o.y).toBeCloseTo(-3.9, 3);
    expect(validateMap(doc).map((i) => i.code)).not.toContain('object-on-path');
  });

  it('holds the furniture to its budget, the lit-road lamps going first, the same every time', () => {
    const ways = [way(1, { barrier: 'fence' }, [{ x: -60, y: -40 }, { x: -60, y: -90 }]), way(2, { highway: 'residential', lit: 'yes' }, [{ x: -95, y: 0 }, { x: 60, y: 0 }])];
    const full = world(ways);
    placeFurniture(full.doc, full.features, full.water, { costOf });
    const fence = full.doc.objects.filter((o) => o.asset === 'fence-wood').length;
    const tight = world(ways);
    const report = placeFurniture(tight.doc, tight.features, tight.water, { costOf, budget: (fence + 1) * 100 });
    expect(report.placed['fence']).toBe(fence);
    expect(report.placed['lit roads']).toBe(1);
    expect(report.dropped.budget).toBeGreaterThan(0);
    const again = world(ways);
    placeFurniture(again.doc, again.features, again.water, { costOf });
    expect(again.doc.objects).toEqual(full.doc.objects);
  });
});
