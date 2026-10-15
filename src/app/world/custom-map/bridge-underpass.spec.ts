import { mapStreetNetwork } from './custom-map-streets';
import { CustomMapFrame, CustomMapSurface } from './custom-map-surface';
import { createMapDocument } from './map-create';
import { mapToGeo, type CustomMapDocument } from './map-document';
import { StreetEdgeIndex } from '../../utils/route-ways';
import { UnderpassIndex } from '../../utils/underpass';

/**
 * A road under a bridge on a hand-made map: the road runs west to east at
 * ground level 0 m; a bridge runs south to north over it between two
 * embankments 6 m high (ground at |y| >= 30 m), its deck at about 6 to 7 m
 * where it crosses the road.
 */
function underpassMap(): CustomMapDocument {
  const doc = createMapDocument({ id: 'underpass', name: 'Underpass', width: 200, depth: 200, cellSize: 2, starter: false });
  const g = doc.terrain.grid;
  for (let j = 0; j < g.rows; j++) {
    const y = -100 + j * g.cellSize;
    for (let i = 0; i < g.columns; i++) g.heights[j * g.columns + i] = Math.min(6, Math.max(0, (Math.abs(y) - 20) * 0.6));
  }
  doc.paths = {
    nodes: [
      { id: 'w', x: -90, y: 0 },
      { id: 'e', x: 90, y: 0 },
      { id: 's0', x: 0, y: -90 },
      { id: 's', x: 0, y: -30 },
      { id: 'n', x: 0, y: 30 },
      { id: 'n0', x: 0, y: 90 },
    ],
    edges: [
      { id: 'road', a: 'w', b: 'e', width: 8, kind: 'road' },
      { id: 'south', a: 's0', b: 's', width: 8, kind: 'road' },
      { id: 'bridge', a: 's', b: 'n', width: 8, kind: 'bridge' },
      { id: 'north', a: 'n', b: 'n0', width: 8, kind: 'road' },
    ],
  };
  return doc;
}

describe('a road under a bridge deck on a custom map', () => {
  const doc = underpassMap();
  const frame = new CustomMapFrame();
  const surface = new CustomMapSurface(doc, frame);
  const at = (x: number, y: number) => mapToGeo({ x, y });

  it('walks the road under the deck at ground height, the road on the bridge at deck height', () => {
    const under = at(0, 0);
    // Off a bridge way (the road below) the walker stays on the ground
    expect(surface.getStreetHeightEstimate(under.lat, under.lon, under.lat, under.lon - 1e-5, under.lat, under.lon + 1e-5, null)).toBeCloseTo(0, 1);
    expect(surface.getGroundHeightEstimate(under.lat, under.lon)).toBeCloseTo(0, 1);
    // On the bridge way the deck carries it
    const deck = surface.getStreetHeightEstimate(under.lat, under.lon, under.lat - 1e-5, under.lon, under.lat + 1e-5, under.lon, 'bridge')!;
    expect(deck).toBeGreaterThan(6);
    // At the bridge end the deck meets the embankment: no step for a walker coming off it
    const end = at(0, 31);
    expect(surface.getGroundHeightEstimate(end.lat, end.lon)).toBeCloseTo(6, 0);
  });

  it('cuts the route under the deck as the real places do, so its cells take the ground between the portals', () => {
    const network = mapStreetNetwork(doc);
    const route = [at(-60, 0), at(-10, 0), at(10, 0), at(60, 0)];
    const ways = new StreetEdgeIndex(network.streets).match(route);
    const open = ways.map((w) => w === null || w.bridge === undefined);
    const spans = new UnderpassIndex(network.streets).spans(route, ways, open);
    expect(spans).toHaveLength(1);
    expect(spans[0].from).toBeLessThan(60);
    expect(spans[0].to).toBeGreaterThan(60);
  });

  it('stands a tower under the deck on the ground, with the deck over it as the top of its column', () => {
    frame.setOrigin(0, 0);
    const column = surface.footprintColumn(frame.sceneX(2), frame.sceneZ(0))!;
    expect(column.groundY).toBeCloseTo(0, 1);
    expect(column.topY).toBeGreaterThan(6);
    const p = at(2, 0);
    expect(surface.getTerrainHeightAtGeo(p.lat, p.lon)).toBeCloseTo(0, 1);
  });
});
