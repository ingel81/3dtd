import { describe, expect, it } from 'vitest';
import type { MapPathEdge, MapPaths } from '../../custom-map/map-document';
import type { OsmArea, OsmFeatures } from '../osm-parse';
import { sidewalkTag } from '../osm-tags';
import { layPavements } from './pavements';

const square = (x0: number, y0: number, x1: number, y1: number, tags: Record<string, string>): OsmArea => ({
  id: 1,
  from: 'way',
  tags,
  outer: [[{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }]],
  inner: [],
  area: (x1 - x0) * (y1 - y0),
});

/** One street of `street` type 6 m wide along y = 0 from x = -50 to 50, among `areas` */
function lay(street: string, said: number | null, areas: OsmArea[] = []): MapPathEdge {
  const edge: MapPathEdge = { id: 'e1', a: 'a', b: 'b', width: 6, kind: 'road', street, surface: 'asphalt' };
  const paths: MapPaths = { nodes: [{ id: 'a', x: -50, y: 0 }, { id: 'b', x: 50, y: 0 }], edges: [edge] };
  layPavements(paths, new Map([['e1', said]]), { areas } as unknown as OsmFeatures);
  return edge;
}

describe('sidewalkTag', () => {
  it('reads pavements on either side, their width, none and ones mapped on their own', () => {
    expect(sidewalkTag({ sidewalk: 'both' })).toBe(1.8);
    expect(sidewalkTag({ sidewalk: 'right', 'sidewalk:width': '2,5' })).toBe(2.5);
    expect(sidewalkTag({ 'sidewalk:left': 'yes', 'sidewalk:right': 'no' })).toBe(1.8);
    expect(sidewalkTag({ sidewalk: 'separate' })).toBe(0);
    expect(sidewalkTag({ 'sidewalk:both': 'no' })).toBe(0);
    expect(sidewalkTag({ highway: 'residential' })).toBeNull();
  });
});

describe('layPavements', () => {
  it('gives a street one where its way says nothing only in a settlement: town land or among houses', () => {
    expect(lay('residential', null).sidewalk).toBeUndefined();
    expect(lay('tertiary', null).sidewalk).toBeUndefined();
    expect(lay('tertiary', null, [square(-100, -100, 100, 100, { landuse: 'residential' })]).sidewalk).toBe(1.8);
    const houses = [-30, -10, 10, 30].map((x) => square(x, 10, x + 8, 18, { building: 'house' }));
    expect(lay('residential', null, houses).sidewalk).toBe(1.8);
    expect(lay('residential', null, houses.slice(0, 3)).sidewalk).toBeUndefined();
    expect(lay('residential', 0).sidewalk).toBeUndefined();
    expect(lay('service', 2.2).sidewalk).toBe(2.2);
  });

  it('narrows a pavement where a house stands close and drops it where none fits', () => {
    // A wall 4.5 m off the middle: 1.5 m beyond the carriageway, less the gap to the wall
    expect(lay('residential', 1.8, [square(-10, 4.5, 10, 14, { building: 'house' })]).sidewalk).toBe(1.3);
    expect(lay('residential', 1.8, [square(-10, 3.5, 10, 14, { building: 'house' })]).sidewalk).toBeUndefined();
    // Through a building: none
    expect(lay('residential', 1.8, [square(-10, -8, 10, 8, { building: 'yes' })]).sidewalk).toBeUndefined();
  });
});
