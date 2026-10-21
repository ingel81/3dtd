import { heightAt } from '../../../map-ops/grid';
import { createMapDocument } from '../../custom-map/map-create';
import { OsmFrame, parseOsm } from '../osm-parse';
import type { OverpassElement } from '../overpass-client';
import { buildRoads } from './roads';
import { ENTRANCE_ASSET, RAILING_ASSET, RAMP_ASSET, STAIRS_ASSET, STAIRS_LENGTH, SUBWAY_DEPTH, placeDescents } from './subway-descents';

const frame = new OsmFrame(48, 9);
const g = (x: number, y: number) => frame.geo({ x, y });

function way(id: number, tags: Record<string, string>, points: [number, number, number][]): OverpassElement {
  return { type: 'way', id, tags, nodes: points.map((p) => p[2]), geometry: points.map(([x, y]) => g(x, y)) };
}

/** Three tracks across x = 40, 50 and 60 and a footway under them from west to east, x 0 to 100 at y 0 */
const station = [
  way(1, { railway: 'rail' }, [[40, -100, 1], [40, 100, 2]]),
  way(2, { railway: 'rail' }, [[50, -100, 3], [50, 100, 4]]),
  way(3, { railway: 'rail' }, [[60, -100, 5], [60, 100, 6]]),
  way(10, { highway: 'footway', tunnel: 'yes', layer: '-1' }, [[0, 0, 11], [100, 0, 12]]),
];
const build = (elements: OverpassElement[]) => buildRoads(parseOsm({ elements: [...station, ...elements] }, frame, 400));
const near = (a: { x: number; y: number }, x: number, y: number) => Math.hypot(a.x - x, a.y - y) < 0.01;

describe('OSM subway descents', () => {
  it('takes the steps up from an underpass mouth under with it, their stairs from their end on the ground', () => {
    // Steps west from the mouth at x 0 up to x -9, a footway on from there; a lift's link of a metre at the east mouth
    const { paths, descents, stats } = build([
      way(20, { highway: 'steps', incline: 'up' }, [[0, 0, 11], [-9, 0, 21]]),
      way(21, { highway: 'footway' }, [[-9, 0, 21], [-60, 0, 22]]),
      way(22, { highway: 'footway', level: '-1;0' }, [[100, 0, 12], [101, 0, 23]]),
    ]);
    expect(stats.descents).toEqual({ stairs: 1, ramps: 0, skipped: 1 });
    expect(descents).toHaveLength(1);
    expect(near(descents[0].top, -9, 0)).toBe(true);
    expect(descents[0].dir.x).toBeCloseTo(1);
    expect(descents[0].kind).toBe('stairs');
    // The steps go under with the subway (out of the picture); the footway on the ground stays
    expect(paths.edges.find((e) => e.street === 'steps')!.tunnel).toBe(true);
    expect(paths.edges.filter((e) => e.street === 'footway' && !e.tunnel)).toHaveLength(2);
  });

  it('gives a long way up a ramp, none to one too long for it or indoors', () => {
    const { descents, stats } = build([
      way(20, { highway: 'footway' }, [[0, 0, 11], [-20, 0, 21]]),
      way(21, { highway: 'footway' }, [[100, 0, 12], [140, 0, 22]]),
    ]);
    expect(descents.map((d) => d.kind)).toEqual(['ramp']);
    expect(stats.descents.skipped).toBe(1);
    const indoors = build([way(20, { highway: 'footway', indoor: 'yes', layer: '-1' }, [[0, 0, 11], [-9, 0, 21]])]);
    expect(indoors.descents).toEqual([]);
  });

  it('finds the stairs of a subway mapped indoors, without taking its ways into the graph', () => {
    const indoor = { indoor: 'yes', level: '-1' };
    const { paths, descents } = buildRoads(parseOsm({
      elements: [
        ...station.slice(0, 3),
        way(10, { highway: 'footway', tunnel: 'yes', layer: '-1', ...indoor }, [[0, 0, 11], [100, 0, 12]]),
        way(20, { highway: 'steps', layer: '-1', ...indoor }, [[100, 0, 12], [100, 9, 21]]),
      ],
    }, frame, 400));
    expect(descents).toHaveLength(1);
    expect(near(descents[0].top, 100, 9)).toBe(true);
    expect(paths.edges).toEqual([]);
  });

  it('leaves out stairs in a building, not those under a platform roof', () => {
    const steps = way(20, { highway: 'steps' }, [[0, 0, 11], [-9, 0, 21]]);
    const over = (building: string) => way(900, { building }, [[-15, -5, 901], [5, -5, 902], [5, 5, 903], [-15, 5, 904], [-15, -5, 901]]);
    expect(build([steps, over('yes')]).descents).toEqual([]);
    expect(build([steps, over('roof')]).descents).toHaveLength(1);
  });

  it('places the stairs down the way, the entrance at their foot, railings on the walls, the ground levelled to the top', () => {
    const doc = createMapDocument({ id: 't', name: 't', width: 200, depth: 200, cellSize: 2, splatResolution: 256, starter: false });
    const t = doc.terrain;
    for (let j = 0; j < t.grid.rows; j++) for (let i = 0; i < t.grid.columns; i++) t.grid.heights[j * t.grid.columns + i] = i * t.grid.cellSize * 0.05;
    const top = { x: -9, y: 0 };
    const level = heightAt(t, top.x, top.y);
    const objects = placeDescents(t, [{ top, dir: { x: 1, y: 0 }, kind: 'stairs' }]);
    const stairs = objects.find((o) => o.asset === STAIRS_ASSET)!;
    // Model -z, map (sin r, -cos r), runs down the way
    expect(Math.sin(stairs.rotation)).toBeCloseTo(1);
    expect(-Math.cos(stairs.rotation)).toBeCloseTo(0);
    expect(near(stairs, -9, 0)).toBe(true);
    const entrance = objects.find((o) => o.asset === ENTRANCE_ASSET)!;
    expect(entrance.x).toBeCloseTo(-9 + STAIRS_LENGTH + 0.4);
    expect(entrance.z).toBe(-SUBWAY_DEPTH);
    expect(entrance.rotation).toBe(stairs.rotation);
    // Three on each wall, one across the head wall
    expect(objects.filter((o) => o.asset === RAILING_ASSET)).toHaveLength(7);
    expect(objects.some((o) => o.asset === RAMP_ASSET)).toBe(false);
    // Level over the stairs and the entrance's ceiling, the ground as it was further off
    for (const x of [-9, -5, 0, 2]) expect(heightAt(t, x, 0)).toBeCloseTo(level, 5);
    expect(heightAt(t, 30, 0)).toBeCloseTo((30 + 100) * 0.05, 5);
  });
});
