import { describe, expect, it } from 'vitest';
import { CustomMapStreets, mapStreetNetwork, type StreetMap } from './custom-map-streets';
import { streetWeight, UNDERPASS_WEIGHT } from '../../utils/street-astar';
import { MAP_METERS_PER_DEGREE as M } from './map-document';
import { packFootprints } from './map-footprints';
import type { WorldStreetSource } from '../world-provider';

const map = (footprints?: StreetMap['footprints']): StreetMap => ({
  paths: { nodes: [], edges: [] },
  terrain: { width: 400, depth: 400 },
  ...(footprints ? { footprints } : {}),
});

const metres = (nodes: readonly { lat: number; lon: number }[]) =>
  nodes.map((n) => ({ x: Math.round(n.lon * M * 10) / 10, y: Math.round(n.lat * M * 10) / 10 }));

/** A map's footprints as the street source hands them to the building layer (TODO E290) */
describe('CustomMapStreets footprints', () => {
  const near = [{ x: 20, y: 10 }, { x: 30, y: 10 }, { x: 30, y: 18 }, { x: 20, y: 18 }];
  const far = [{ x: 20, y: 190 }, { x: 40, y: 190 }, { x: 40, y: 198 }, { x: 20, y: 198 }];
  const court = [{ x: 24, y: 192 }, { x: 28, y: 192 }, { x: 28, y: 196 }];
  const route = [{ lat: 0, lon: 0 }, { lat: 0, lon: 100 / M }];

  it('keeps none on a map without them', async () => {
    const streets = new CustomMapStreets(map());
    expect(streets.footprints).toBe('none');
    expect(await streets.loadBuildingsNearRoutes()).toEqual({ buildings: [] });
  });

  it('hands an OSM world all of its footprints, far from the routes and without any, in the frame of its streets, with what they are', async () => {
    const streets = new CustomMapStreets(map(packFootprints([
      { points: near, levels: 0, kind: 'ground', dropped: 'water' },
      { points: far, holes: [court], levels: 5, kind: 'ground' },
      { points: near, levels: 0, minLevel: 3, kind: 'part' },
      { points: far, levels: null, kind: 'underground' },
    ])));
    expect(streets.footprints).toBe('kept');
    const { buildings } = await streets.loadBuildingsNearRoutes();
    expect(buildings.map((b) => [b.kind, b.dropped, b.levels, b.minLevel, b.holes!.length])).toEqual([
      // The tiles' default storeys where OSM gives none; a part high up stands a storey over its foot
      ['ground', 'water', 2, 0, 0],
      ['ground', null, 5, 0, 1],
      ['part', null, 4, 3, 0],
      ['underground', null, 2, 0, 0],
    ]);
    expect(metres(buildings[0].nodes)).toEqual(near);
    expect(metres(buildings[1].holes![0])).toEqual(court);
    // The routes do not narrow them down (the game asks with its routes and the tiles' corridor)
    const source: WorldStreetSource = streets;
    expect((await source.loadBuildingsNearRoutes([route], 25)).buildings).toHaveLength(4);
  });
});

describe('CustomMapStreets underpasses', () => {
  it('hands the router a path tunnel as an underpass, weighed a thousandfold; a road tunnel stays a road', () => {
    const network = mapStreetNetwork({
      terrain: { width: 400, depth: 400 },
      footprints: undefined,
      paths: {
        nodes: [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 100, y: 0 }, { id: 'c', x: 100, y: 100 }],
        edges: [
          { id: 'sub', a: 'a', b: 'b', width: 3, kind: 'path', street: 'footway', tunnel: true },
          { id: 'tun', a: 'b', b: 'c', width: 8, kind: 'road', street: 'secondary', tunnel: true },
        ],
      },
    } as unknown as StreetMap);
    const [sub, tun] = network.streets;
    expect([sub.underpass, tun.underpass]).toEqual([true, undefined]);
    expect(streetWeight(sub)).toBe(streetWeight({ type: 'footway' }) * UNDERPASS_WEIGHT);
    expect(streetWeight(tun)).toBe(streetWeight({ type: 'secondary' }));
  });
});
