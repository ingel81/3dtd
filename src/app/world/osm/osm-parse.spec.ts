import type { OverpassResponse } from './overpass-client';
import { assembleRings, isAreaTags, OsmFrame, parseOsm, runs } from './osm-parse';
import { ringArea } from './square-clip';

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
    expect(isAreaTags({ 'building:part': 'yes' })).toBe(true);
    expect(isAreaTags({ highway: 'pedestrian' })).toBe(false);
    expect(isAreaTags({ highway: 'pedestrian', area: 'yes' })).toBe(true);
    expect(isAreaTags({ 'area:highway': 'pedestrian' })).toBe(true);
    expect(isAreaTags({ place: 'square', name: 'Marktplatz' })).toBe(true);
    expect(isAreaTags({ place: 'suburb' })).toBe(false);
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
    const { rings, open, forced } = assembleRings([a, b, c], 1000);
    expect(forced).toBe(0);
    expect(open).toEqual([]);
    expect(rings).toHaveLength(1);
    expect(Math.abs(ringArea(rings[0]))).toBeCloseTo(100);
    // A chain that never closes inside the map is closed straight across
    expect(assembleRings([[{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }]], 1000).forced).toBe(1);
  });

  it('keeps a ring the box cut open, its stretches joined end to end in either direction', () => {
    // Two members of a shore crossing the map, the second drawn the other way, the rest of the ring cut off
    const a = [{ x: -300, y: 10 }, { x: -50, y: 20 }, { x: 0, y: 0 }];
    const b = [{ x: 300, y: -10 }, { x: 50, y: 5 }, { x: 0, y: 0 }];
    const { rings, open, forced } = assembleRings([a, b], 100);
    expect(forced).toBe(0);
    expect(rings).toEqual([]);
    expect(open).toHaveLength(1);
    expect(open[0]).toHaveLength(5);
    expect([open[0][0].x, open[0][4].x].sort((p, q) => p - q)).toEqual([-300, 300]);
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

  it('keeps a building across the edge whole where its middle lies in the map, else leaves it out; a field is cut', () => {
    const g = (x: number, y: number) => at(x, y);
    const ring = (id: number, x0: number, x1: number, tags: Record<string, string>) => ({
      type: 'way' as const,
      id,
      nodes: [id * 10, id * 10 + 1, id * 10 + 2, id * 10 + 3, id * 10],
      geometry: [g(x0, 0), g(x1, 0), g(x1, 10), g(x0, 10), g(x0, 0)],
      tags,
    });
    const data: OverpassResponse = { elements: [ring(1, 92, 104, { building: 'house' }), ring(2, 97, 113, { building: 'house' }), ring(3, 92, 104, { landuse: 'meadow' })] };
    const f = parseOsm(data, frame, 100);
    const inside = f.areas.find((a) => a.id === 1)!;
    expect(Math.max(...inside.outer[0].map((p) => p.x))).toBeCloseTo(104, 3);
    expect(inside.area).toBeCloseTo(120, 0);
    expect(f.areas.some((a) => a.id === 2)).toBe(false);
    const field = f.areas.find((a) => a.id === 3)!;
    expect(field.area).toBeCloseTo(80, 0);
  });
});
