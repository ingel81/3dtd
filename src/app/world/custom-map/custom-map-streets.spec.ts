import { describe, expect, it } from 'vitest';
import { CustomMapStreets, type StreetMap } from './custom-map-streets';
import { MAP_METERS_PER_DEGREE as M } from './map-document';
import { packFootprints } from './map-footprints';

const map = (footprints?: StreetMap['footprints']): StreetMap => ({
  paths: { nodes: [], edges: [] },
  terrain: { width: 400, depth: 400 },
  ...(footprints ? { footprints } : {}),
});

/** A map's footprints as the street source hands them to the building layer (TODO E290) */
describe('CustomMapStreets footprints', () => {
  const near = [{ x: 20, y: 10 }, { x: 30, y: 10 }, { x: 30, y: 18 }, { x: 20, y: 18 }];
  const far = [{ x: 20, y: 90 }, { x: 30, y: 90 }, { x: 30, y: 98 }, { x: 20, y: 98 }];
  const route = [{ lat: 0, lon: 0 }, { lat: 0, lon: 100 / M }];

  it('keeps none on a map without them', async () => {
    const streets = new CustomMapStreets(map());
    expect(streets.footprints).toBe('none');
    expect(await streets.loadBuildingsNearRoutes([route], 25)).toEqual({ buildings: [] });
  });

  it('hands an OSM world the footprints near the routes in the frame of its streets, the tiles default storeys where OSM gives none', async () => {
    const streets = new CustomMapStreets(map(packFootprints([{ points: near, levels: 0 }, { points: far, levels: 5 }])));
    expect(streets.footprints).toBe('kept');
    const { buildings } = await streets.loadBuildingsNearRoutes([route], 25);
    expect(buildings).toHaveLength(1);
    expect(buildings[0].levels).toBe(2);
    expect(buildings[0].nodes.map((n) => ({ x: Math.round(n.lon * M * 10) / 10, y: Math.round(n.lat * M * 10) / 10 }))).toEqual(near);
  });
});
