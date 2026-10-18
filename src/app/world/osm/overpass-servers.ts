/**
 * The public Overpass servers the game asks, as data: where each one is and
 * which part of the world it holds. A regional server holds only the ways of
 * its region (plus a few km past its border, patchy), so it is asked only for
 * a query box that lies wholly inside one of its boxes; there it answers in
 * well under a second, where the global ones take seconds or are at capacity.
 * The boxes are drawn inside the region's border, measured 2026-10-18 with
 * small queries along the borders (overpass.osm.ch has ways about 3 to 5 km
 * past the Swiss border, overpass.atownsend.org.uk a few of northern France,
 * overpass.maprva.org none past Virginia's).
 *
 * Every origin here is also in the CSP of public/.htaccess and of the desktop
 * app (desktop/src/protocol.js) and in its User-Agent hosts
 * (desktop/src/user-agent.js); overpass-servers.spec.ts and the desktop tests
 * check that. https://wiki.openstreetmap.org/wiki/Overpass_API (public instances)
 */
import type { GeoBox } from '../../services/location/street-box';

export interface OverpassServer {
  url: string;
  /** For the log and the docs */
  name: string;
  /** Null: the whole planet. Else the boxes inside which the server holds every way */
  coverage: readonly GeoBox[] | null;
}

const box = (minLat: number, minLon: number, maxLat: number, maxLon: number): GeoBox => ({ minLat, minLon, maxLat, maxLon });

/**
 * The servers in their order when nothing is known of their health
 * (overpass-health.ts reorders them): the regional ones, then the global
 * ones, the fastest of a good day first and maps.mail.ru as the last
 * fallback. overpass.kumi.systems is a DNS alias of
 * overpass.private.coffee, the same server, so it is not listed apart.
 */
export const OVERPASS_SERVERS: readonly OverpassServer[] = [
  {
    url: 'https://overpass.osm.ch/api/interpreter',
    name: 'overpass.osm.ch (Switzerland)',
    coverage: [
      box(46.75, 7.1, 47.45, 9.4), // Mittelland: Bern, Biel, Luzern, Zürich, St. Gallen
      box(47.3, 7.55, 47.6, 8.95), // Basel, Aargau, Winterthur
      box(46.4, 6.4, 46.8, 7.2), // Lausanne, Montreux, Fribourg
      box(46.14, 6.05, 46.3, 6.25), // Geneva
      box(46.05, 7.0, 46.4, 8.4), // Valais
      box(45.88, 8.75, 46.45, 9.1), // Ticino
      box(46.6, 9.35, 47.0, 9.75), // Chur
      box(46.4, 9.75, 46.95, 10.05), // Davos, Engadin
    ],
  },
  {
    url: 'https://overpass.atownsend.org.uk/api/interpreter',
    name: 'overpass.atownsend.org.uk (Great Britain and Ireland)',
    coverage: [
      box(49.85, -8.7, 61, 1.0), // Great Britain west of Dover's longitude, Northern Ireland
      box(51.05, 1.0, 61, 1.8), // Kent north of Folkestone, East Anglia
      box(51.3, -10.7, 55.5, -5.3), // Ireland
    ],
  },
  {
    url: 'https://overpass.maprva.org/api/interpreter',
    name: 'overpass.maprva.org (Virginia)',
    coverage: [
      box(36.55, -80.0, 37.95, -75.8), // Richmond, Lynchburg, Roanoke, Hampton Roads
      box(37.95, -78.95, 38.95, -77.6), // Charlottesville, Shenandoah
      box(37.95, -77.6, 38.7, -77.35), // Fredericksburg, Quantico
      box(38.7, -77.6, 38.98, -77.15), // Fairfax, Reston
      box(36.6, -83.6, 37.0, -80.0), // Southwest Virginia, Bristol
    ],
  },
  { url: 'https://overpass-api.de/api/interpreter', name: 'overpass-api.de', coverage: null },
  { url: 'https://overpass.private.coffee/api/interpreter', name: 'overpass.private.coffee', coverage: null },
  // The last fallback: answers when the others are at capacity, slowly (11 to 19 s on 2026-10-18)
  { url: 'https://maps.mail.ru/osm/tools/overpass/api/interpreter', name: 'maps.mail.ru', coverage: null },
];

const inside = (inner: GeoBox, outer: GeoBox): boolean =>
  inner.minLat >= outer.minLat && inner.maxLat <= outer.maxLat && inner.minLon >= outer.minLon && inner.maxLon <= outer.maxLon;

/** Whether `server` holds every way of `query`; without a box only a global server does */
export function serverCovers(server: OverpassServer, query: GeoBox | undefined): boolean {
  if (!server.coverage) return true;
  return !!query && server.coverage.some((region) => inside(query, region));
}

/** The servers that hold every way of `query`, the regional ones first, each group in its order in `servers` */
export function serversFor(servers: readonly OverpassServer[], query: GeoBox | undefined): OverpassServer[] {
  const covering = servers.filter((server) => serverCovers(server, query));
  return [...covering.filter((s) => s.coverage), ...covering.filter((s) => !s.coverage)];
}
