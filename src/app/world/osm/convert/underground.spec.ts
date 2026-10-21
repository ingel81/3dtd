import { heightAt } from '../../../map-ops/grid';
import { createMapDocument } from '../../custom-map/map-create';
import { OsmFrame, parseOsm } from '../osm-parse';
import type { OverpassElement } from '../overpass-client';
import { buildRoads } from './roads';
import { OPENING_STUB, RAMP_DEPTH, sinkRamps } from './underground';

const frame = new OsmFrame(48, 9);
const g = (x: number, y: number) => frame.geo({ x, y });

function way(id: number, tags: Record<string, string>, points: [number, number, number][]): OverpassElement {
  return { type: 'way', id, tags, nodes: points.map((p) => p[2]), geometry: points.map(([x, y]) => g(x, y)) };
}

/** A house from x -20 to 20, y 10 to 40 */
const house = way(900, { building: 'yes' }, [[-20, 10, 901], [20, 10, 902], [20, 40, 903], [-20, 40, 904], [-20, 10, 901]]);
/** A street along y = 0 with a node of its own at x = 0 */
const street = way(1, { highway: 'residential' }, [[-150, 0, 1], [0, 0, 3], [150, 0, 2]]);

const build = (elements: OverpassElement[]) => buildRoads(parseOsm({ elements }, frame, 200));
const nodeAt = (paths: ReturnType<typeof build>['paths'], id: string) => paths.nodes.find((n) => n.id === id)!;

describe('OSM tunnels under buildings', () => {
  it('makes a tunnel mostly under a house a passage: covered, no tunnel, no portal', () => {
    // 50 m north from the street, 30 of them under the house
    const { paths, mouths, tunnels, stats } = build([street, house, way(2, { highway: 'pedestrian', tunnel: 'yes' }, [[0, 0, 3], [0, 50, 5]])]);
    expect(tunnels).toEqual([]);
    expect(mouths).toEqual([]);
    expect(paths.edges.some((e) => e.tunnel)).toBe(false);
    expect(paths.edges.filter((e) => e.covered).length).toBe(1);
    expect(stats.underground.passages).toBe(1);
  });

  it('keeps a tunnel through the ground a tunnel, with its mouths', () => {
    const { mouths, tunnels, stats } = build([street, way(2, { highway: 'pedestrian', tunnel: 'yes' }, [[0, 0, 3], [0, 50, 5]])]);
    expect(tunnels.length).toBe(1);
    expect(mouths.length).toBe(2);
    expect(stats.underground.passages).toBe(0);
  });

  it('keeps of a car park only its entrance: a ramp down to the wall and a covered stub behind it, no aisles', () => {
    const { paths, mouths, tunnels, ramps, stats } = build([
      street,
      house,
      // The drive from the street north under the house, into the aisle along y = 25
      way(2, { highway: 'service', tunnel: 'yes', layer: '-1' }, [[0, 0, 3], [0, 25, 6]]),
      way(3, { highway: 'service', service: 'parking_aisle', tunnel: 'yes', layer: '-1' }, [[-15, 25, 7], [0, 25, 6], [15, 25, 8]]),
    ]);
    expect(tunnels).toEqual([]);
    expect(mouths).toEqual([]);
    expect(stats.underground).toEqual({ passages: 0, carParks: 1, entrances: 1 });
    // No aisle under the ground
    expect(paths.nodes.some((n) => Math.abs(n.y - 25) < 0.01)).toBe(false);
    // The ramp from the street's node to the wall, the stub OPENING_STUB on into the house
    const ramp = paths.edges.find((e) => e.a === 'n3' && e.street === 'service' && !e.covered)!;
    const wall = nodeAt(paths, ramp.b);
    expect(wall.x).toBeCloseTo(0, 2);
    expect(wall.y).toBeGreaterThan(9.4);
    expect(wall.y).toBeLessThan(10.6);
    const stub = paths.edges.find((e) => e.covered)!;
    expect(stub.a).toBe(ramp.b);
    expect(nodeAt(paths, stub.b).y - wall.y).toBeCloseTo(OPENING_STUB, 1);
    expect(ramps).toEqual([{ line: [{ x: 0, y: 0 }, { x: wall.x, y: wall.y }], wall: true, width: 4 }]);

    // Sunk: the street keeps its height, the ramp falls toward the wall, the ground beside it falls off to it
    const doc = createMapDocument({ id: 'r', name: 'r', width: 400, depth: 400, cellSize: 2, splatResolution: 256, starter: false });
    expect(sinkRamps(doc.terrain, ramps)).toBeGreaterThan(0);
    const t = doc.terrain;
    expect(heightAt(t, 0, -2)).toBe(0);
    const atWall = heightAt(t, 0, 9.5);
    expect(atWall).toBeLessThan(-1.2);
    expect(atWall).toBeGreaterThanOrEqual(-RAMP_DEPTH);
    expect(heightAt(t, 0, 5)).toBeLessThan(0);
    expect(heightAt(t, 0, 5)).toBeGreaterThan(atWall);
    expect(heightAt(t, 12, 5)).toBe(0);
  });

  it('leaves a service tunnel below ground that is no car park (no aisle, under no building) to the tunnel rules', () => {
    const { stats, tunnels } = build([street, way(2, { highway: 'service', tunnel: 'yes', layer: '-1' }, [[0, 0, 3], [0, 60, 5]])]);
    expect(stats.underground.carParks).toBe(0);
    expect(tunnels.length).toBe(1);
  });
});
