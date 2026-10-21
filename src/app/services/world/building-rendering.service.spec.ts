import { describe, expect, it } from 'vitest';
import { BufferGeometry, Group, LineSegments, Mesh } from 'three';
import { BuildingRenderingService, FOOTPRINT_COLORS } from './building-rendering.service';
import type { BuildingFootprint } from '../location/osm-street.service';

/** A square of `side` m at (x, y) m as nodes (1 m = 1e-5°, the fake engine's frame) */
const square = (x: number, y: number, side: number) =>
  [[x, y], [x + side, y], [x + side, y + side], [x, y + side]].map(([px, py], k) => ({ id: k, lat: py * 1e-5, lon: px * 1e-5 }));

function draw(buildings: BuildingFootprint[]): { group: Group; lines: LineSegments; fill: Mesh } {
  const group = new Group();
  const engine = {
    getOverlayGroup: () => group,
    sync: { geoToLocalSimple: (lat: number, lon: number) => ({ x: lon * 1e5, y: 0, z: lat * 1e5 }) },
    getTerrainHeightAtGeo: () => 10,
  };
  const service = Object.create(BuildingRenderingService.prototype) as BuildingRenderingService;
  service.renderBuildings(engine as never, buildings, { lat: 0, lon: 0 }, true);
  return { group, lines: group.children[0] as LineSegments, fill: group.children[1] as Mesh };
}

/** Heights and colours of the vertices of a geometry */
function vertices(geo: BufferGeometry): { ys: Set<number>; colors: Set<string> } {
  const p = geo.getAttribute('position');
  const c = geo.getAttribute('color');
  const ys = new Set<number>();
  const colors = new Set<string>();
  for (let i = 0; i < p.count; i++) {
    ys.add(Math.round(p.getY(i) * 10) / 10);
    colors.add([c.getX(i), c.getY(i), c.getZ(i)].map((v) => Math.round(v * 255)).join(','));
  }
  return { ys, colors };
}

const rgb = (hex: number) => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255].join(',');

/** The footprint layer: the tiles' buildings as before, an OSM world's by what they are (TODO E290) */
describe('BuildingRenderingService', () => {
  it('draws a building on the ground as a teal box from the ground up its storeys, edges and fill in two draw objects', () => {
    const { group, lines, fill } = draw([{ id: 1, type: 'yes', levels: 2, nodes: square(0, 0, 10) }]);
    expect(group.children).toHaveLength(2);
    expect(vertices(lines.geometry).ys).toEqual(new Set([10.8, 16.8]));
    expect(vertices(fill.geometry).colors).toEqual(new Set([rgb(FOOTPRINT_COLORS.ground)]));
    // 4 walls of 2 triangles and the roof's 2
    expect(fill.geometry.getAttribute('position').count).toBe(4 * 6 + 2 * 3);
  });

  it('starts a part at its lowest storey, lays those below or off the ground flat, colours the left out red', () => {
    const part = draw([{ id: 1, type: 'yes', levels: 5, minLevel: 3, kind: 'part', nodes: square(0, 0, 10) }]);
    expect(vertices(part.lines.geometry).ys).toEqual(new Set([19.8, 25.8]));
    expect(vertices(part.fill.geometry).colors).toEqual(new Set([rgb(FOOTPRINT_COLORS.part)]));
    for (const kind of ['underground', 'offGround'] as const) {
      const flat = draw([{ id: 1, type: 'yes', levels: 2, kind, nodes: square(0, 0, 10) }]);
      expect(vertices(flat.lines.geometry).ys).toEqual(new Set([10.8]));
      // The cap alone, no walls
      expect(flat.fill.geometry.getAttribute('position').count).toBe(2 * 3);
      expect(vertices(flat.fill.geometry).colors).toEqual(new Set([rgb(FOOTPRINT_COLORS[kind])]));
    }
    const dropped = draw([{ id: 1, type: 'yes', levels: 2, kind: 'ground', dropped: 'roads', nodes: square(0, 0, 10) }]);
    expect(vertices(dropped.lines.geometry).colors).toEqual(new Set([rgb(FOOTPRINT_COLORS.dropped)]));
  });

  it('leaves a courtyard out of the roof, walls it and draws its edges light', () => {
    const { lines, fill } = draw([{ id: 1, type: 'yes', levels: 2, nodes: square(0, 0, 30), holes: [square(10, 10, 10)] }]);
    expect(vertices(lines.geometry).colors).toEqual(new Set([rgb(FOOTPRINT_COLORS.ground), rgb(FOOTPRINT_COLORS.court)]));
    // Walls round both rings, the roof a ring of 8 triangles round the hole
    expect(fill.geometry.getAttribute('position').count).toBe(8 * 6 + 8 * 3);
  });
});
