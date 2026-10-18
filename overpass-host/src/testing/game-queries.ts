/**
 * The game's queries as it sends them, for the specs (tsconfig.json leaves this folder to tsconfig.spec.json, the
 * image leaves it out). The OSM world's query is the game's own function; the street and building queries are
 * built inline in an Angular service, so their templates are written out here as osm-street.service.ts has them.
 */
export { osmQueryBox, osmWorldQuery } from '../../../src/app/world/osm/osm-query.ts';
export { OSM_QUERY_MARGIN, OSM_WORLD_SIDE } from '../../../src/app/world/osm/import-osm.ts';
export { boxAround } from '../../../src/app/services/location/street-box.ts';

/** STREET_RADIUS_M of osm-street.service.ts (an Angular service, not imported here) */
export const STREET_RADIUS_M = 2000;

/** The street query of osm-street.service.ts (streetQuery), as the game sends it */
export function streetQuery(boxes: { minLat: number; minLon: number; maxLat: number; maxLon: number }[]): string {
  const types = 'motorway|motorway_link|trunk|primary|residential|service|footway|path|steps';
  const ways = boxes.map((b) => `way["highway"~"^(${types})$"](${b.minLat},${b.minLon},${b.maxLat},${b.maxLon});`).join('\n        ');
  return `
      [out:json][timeout:25][maxsize:4194304];
      (
        ${ways}
      );
      out body;
      >;
      out skel qt;
    `;
}

/** The building query of osm-street.service.ts (loadBuildingsNearRoutes), `around` the routes */
export function buildingQuery(routes: { lat: number; lon: number }[][], radius: number): string {
  const ways = routes
    .map((line) => `way["building"](around:${radius},${line.map((p) => `${p.lat.toFixed(6)},${p.lon.toFixed(6)}`).join(',')});`)
    .join('\n        ');
  return `
      [out:json][timeout:25][maxsize:4194304];
      (
        ${ways}
      );
      out body;
      >;
      out skel qt;
    `;
}

/** A route of `n` points from the centre outwards over `km` */
export const route = (lat: number, lon: number, km: number, n: number, dLat: number, dLon: number) =>
  Array.from({ length: n }, (_, k) => ({ lat: lat + (dLat * km * k) / n / 111.32, lon: lon + (dLon * km * k) / n / 111.32 / Math.cos((lat * Math.PI) / 180) }));

