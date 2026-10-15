import type { OverpassResponse } from './overpass-client';
import { assembleRings, clipRing, isAreaTags, OsmFrame, parseOsm, ringArea, runs } from './osm-parse';

const frame = new OsmFrame(50, 10);
/** lat, lon of a map point around `frame` */
const at = (x: number, y: number) => frame.geo({ x, y });

describe('OSM parse', () => {
  it('projects to map metres around the centre and back', () => {
    const p = frame.point(at(300, -120));
    expect(p.x).toBeCloseTo(300, 6);
    expect(p.y).toBeCloseTo(-120, 6);
    expect(frame.point({ lat: 50, lon: 10 })).toEqual({ x: 0, y: 0 });
  });

  it('tells areas from lines by their tags', () => {
    expect(isAreaTags({ landuse: 'forest' })).toBe(true);
    expect(isAreaTags({ building: 'yes' })).toBe(true);
    expect(isAreaTags({ highway: 'pedestrian' })).toBe(false);
    expect(isAreaTags({ highway: 'pedestrian', area: 'yes' })).toBe(true);
    expect(isAreaTags({ natural: 'tree_row' })).toBe(false);
    expect(isAreaTags({ barrier: 'hedge' })).toBe(false);
  });

  it('keeps the runs of a way between the nodes the answer cut off', () => {
    const p = (x: number) => ({ x, y: 0 });
    expect(runs([p(0), p(1), null, p(3), null, p(5), p(6), p(7)])).toEqual([[p(0), p(1)], [p(5), p(6), p(7)]]);
  });

  it('puts member ways together into rings, turning one round where it runs the other way', () => {
    const a = [{ x: 0, y: 0 }, { x: 10, y: 0 }];
    const b = [{ x: 10, y: 10 }, { x: 10, y: 0 }];
    const c = [{ x: 10, y: 10 }, { x: 0, y: 10 }, { x: 0, y: 0 }];
    const { rings, forced } = assembleRings([a, b, c]);
    expect(forced).toBe(0);
    expect(rings).toHaveLength(1);
    expect(Math.abs(ringArea(rings[0]))).toBeCloseTo(100);
    // A chain that never closes is closed straight across
    expect(assembleRings([[{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }]]).forced).toBe(1);
  });

  it('cuts a ring to the map square', () => {
    const ring = [{ x: -50, y: -50 }, { x: 150, y: -50 }, { x: 150, y: 50 }, { x: -50, y: 50 }];
    expect(Math.abs(ringArea(clipRing(ring, 100)))).toBeCloseTo(150 * 100);
    expect(clipRing([{ x: 200, y: 200 }, { x: 300, y: 200 }, { x: 300, y: 300 }], 100)).toEqual([]);
  });

  it('reads ways with node ids, closed areas, multipolygons with holes and tagged points', () => {
    const g = (x: number, y: number) => at(x, y);
    const data: OverpassResponse = {
      elements: [
        { type: 'node', id: 1, lat: g(5, 5).lat, lon: g(5, 5).lon, tags: { natural: 'tree' } },
        { type: 'node', id: 2, lat: g(5000, 5).lat, lon: g(5000, 5).lon, tags: { natural: 'tree' } },
        { type: 'way', id: 10, nodes: [100, 101, 102], geometry: [g(0, 0), g(50, 0), null], tags: { highway: 'residential' } },
        { type: 'way', id: 11, nodes: [200, 201, 202, 203, 200], geometry: [g(0, 0), g(20, 0), g(20, 20), g(0, 20), g(0, 0)], tags: { building: 'house' } },
        {
          type: 'relation',
          id: 20,
          tags: { type: 'multipolygon', landuse: 'forest' },
          members: [
            { type: 'way', ref: 1, role: 'outer', geometry: [g(-100, -100), g(100, -100), g(100, 100)] },
            { type: 'way', ref: 2, role: 'outer', geometry: [g(100, 100), g(-100, 100), g(-100, -100)] },
            { type: 'way', ref: 3, role: 'inner', geometry: [g(-10, -10), g(10, -10), g(10, 10), g(-10, 10), g(-10, -10)] },
          ],
        },
      ],
    };
    const f = parseOsm(data, frame, 1200);
    expect(f.points.map((p) => p.id)).toEqual([1]);
    expect(f.ways.map((w) => w.id)).toEqual([10, 11]);
    expect(f.ways[0].nodes).toEqual([100, 101, 102]);
    expect(f.ways[0].points[2]).toBeNull();
    const house = f.areas.find((a) => a.id === 11)!;
    expect(house.area).toBeCloseTo(400, 0);
    const forest = f.areas.find((a) => a.id === 20)!;
    expect(forest.from).toBe('relation');
    expect(forest.area).toBeCloseTo(200 * 200 - 20 * 20, -1);
    expect(f.stats.forcedRings).toBe(0);
  });
});
