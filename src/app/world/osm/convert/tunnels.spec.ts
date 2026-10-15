import { heightAt } from '../../../editor/model/grid';
import { createMapDocument } from '../../custom-map/map-create';
import { mapStreetNetwork } from '../../custom-map/custom-map-streets';
import { OsmFrame, parseOsm } from '../osm-parse';
import type { OverpassElement } from '../overpass-client';
import { buildRoads } from './roads';
import { buildTunnels, pairTwins, TUNNEL_COVER, TUNNEL_PORTAL_ASSET } from './tunnels';

const frame = new OsmFrame(48, 9);
const g = (x: number, y: number) => frame.geo({ x, y });

function way(id: number, tags: Record<string, string>, points: [number, number, number][]): OverpassElement {
  return { type: 'way', id, tags, nodes: points.map((p) => p[2]), geometry: points.map(([x, y]) => g(x, y)) };
}

/** A flat 400 m map with a road running east into a tunnel from x -100 to 100 and out again */
function tunnelWorld() {
  const doc = createMapDocument({ id: 't', name: 't', width: 400, depth: 400, cellSize: 2, splatResolution: 256, starter: false });
  const f = parseOsm({
    elements: [
      way(1, { highway: 'secondary' }, [[-180, 0, 1], [-100, 0, 2]]),
      way(2, { highway: 'secondary', tunnel: 'yes' }, [[-100, 0, 2], [100, 0, 3]]),
      way(3, { highway: 'secondary' }, [[100, 0, 3], [180, 0, 4]]),
    ],
  }, frame, 200);
  const roads = buildRoads(f);
  doc.paths = roads.paths;
  return { doc, roads };
}

describe('OSM tunnels', () => {
  it('sets a portal at each mouth, turned to face out along its road', () => {
    const { doc, roads } = tunnelWorld();
    const { objects, report } = buildTunnels(doc.terrain, roads.tunnels, roads.mouths);
    expect(report).toMatchObject({ tunnels: 1, portals: 2, twins: 0 });
    expect(objects.map((o) => [o.asset, o.x, o.y])).toEqual([
      [TUNNEL_PORTAL_ASSET, -100, 0],
      [TUNNEL_PORTAL_ASSET, 100, 0],
    ]);
    // Model +z into the vault: east at the west mouth, west at the east one (rotation as buildings.ts turns a front)
    const into = (r: number) => ({ x: -Math.sin(r), y: Math.cos(r) });
    expect(into(objects[0].rotation).x).toBeCloseTo(1, 3);
    expect(into(objects[1].rotation).x).toBeCloseTo(-1, 3);
  });

  it('raises the hill behind each mouth and keeps the tunnel covered, leaving the road in front alone', () => {
    const { doc, roads } = tunnelWorld();
    const t = doc.terrain;
    const { objects } = buildTunnels(t, roads.tunnels, roads.mouths);
    // A 9 m road: the portal scaled to 9/7, its top 9.6 m at scale 1
    const top = 9.6 * objects[0].scale;
    expect(objects[0].scale).toBeCloseTo(9 / 7, 2);
    expect(heightAt(t, -110, 0)).toBe(0);
    expect(heightAt(t, -100, 0)).toBe(0);
    // The portal's hill: its top over the facade's width behind the mouth
    expect(heightAt(t, -90, 0)).toBeCloseTo(top, 1);
    expect(heightAt(t, -90, 12)).toBeCloseTo(top, 1);
    // Mid tunnel: the cover over the road, falling off to the sides
    expect(heightAt(t, 0, 0)).toBeCloseTo(TUNNEL_COVER, 1);
    expect(heightAt(t, 0, 30)).toBe(0);
  });

  it('leaves a higher hill as it is', () => {
    const { doc, roads } = tunnelWorld();
    const t = doc.terrain;
    // A ridge 40 m high over the middle, the mouths at 0
    for (let j = 0; j < t.grid.rows; j++) for (let i = 0; i < t.grid.columns; i++) {
      const x = i * 2 - 200;
      t.grid.heights[j * t.grid.columns + i] = Math.max(0, 40 - Math.abs(x) * 0.4);
    }
    const before = heightAt(t, 0, 0);
    const { report } = buildTunnels(t, roads.tunnels, roads.mouths);
    expect(heightAt(t, 0, 0)).toBe(before);
    expect(report.raised).toBeGreaterThan(0);
  });

  it('shares one wider portal between the two tubes of a motorway', () => {
    const portals = pairTwins([
      { p: { x: 0, y: -6 }, inward: { x: 1, y: 0 }, width: 8, tunnel: 0 },
      { p: { x: 0, y: 6 }, inward: { x: 1, y: 0 }, width: 8, tunnel: 1 },
      { p: { x: 300, y: 0 }, inward: { x: -1, y: 0 }, width: 8, tunnel: 0 },
    ]);
    expect(portals.map((p) => [p.p.x, p.p.y, p.mouths.length])).toEqual([[0, 0, 2], [300, 0, 1]]);
    expect(portals[0].scale).toBeCloseTo(2.2, 3);
    expect(portals[1].scale).toBeCloseTo(8 / 7, 3);
  });

  it('gives routes the tunnel as a tunnel street, as on a real place', () => {
    const { doc } = tunnelWorld();
    const net = mapStreetNetwork(doc);
    expect(net.streets.map((s) => s.tunnel)).toEqual([undefined, 'yes', undefined]);
  });
});
