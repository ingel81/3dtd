/**
 * What kind of query and which client, for the statistics: never the query
 * or the User-Agent themselves, only their class.
 *
 * The kinds follow the game's own queries: the street load of a real place
 * (services/location/osm-street.service.ts, streetQuery: highway ways in one
 * or more boxes), the buildings along the routes (loadBuildingsNearRoutes:
 * building ways `around` the routes) and the one query of an OSM world
 * (world/osm/osm-query.ts, osmWorldQuery: a global [bbox], the world's keys,
 * the multipolygons, `out body geom`). Anything else is `other`.
 */

export type QueryKind = 'streets' | 'buildings' | 'osm-world' | 'other';

/** The query's text without its comments, for the patterns below */
const plain = (query: string): string => query.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

export function queryKind(query: string): QueryKind {
  const q = plain(query);
  if (/\[bbox:[^\]]+\]/.test(q) && /relation\s*\[\s*"type"\s*=\s*"multipolygon"\s*\]/.test(q) && /out\s+body\s+geom/.test(q)) {
    return 'osm-world';
  }
  if (/way\s*\[\s*"building"\s*\]\s*\(\s*around\s*:/.test(q)) return 'buildings';
  if (/way\s*\[\s*"highway"\s*~\s*"\^\(/.test(q) && /out\s+skel\s+qt/.test(q)) return 'streets';
  return 'other';
}

export type ClientKind = 'web' | 'desktop' | 'other';
export type BrowserFamily = 'chrome' | 'firefox' | 'safari' | 'edge' | 'electron' | 'other';

export interface ClientInfo {
  client: ClientKind;
  /** The desktop app's version from its User-Agent (`3DTD/0.8.0`); the web version does not say its own */
  version: string | null;
  browser: BrowserFamily;
}

/** The family of a browser's User-Agent; Edge and Opera say Chrome as well, so they are asked first */
export function browserFamily(userAgent: string): BrowserFamily {
  if (/\b3DTD\//.test(userAgent) || /\bElectron\//.test(userAgent)) return 'electron';
  if (/\bEdg(e|A|iOS)?\//.test(userAgent)) return 'edge';
  if (/\b(Firefox|FxiOS)\//.test(userAgent)) return 'firefox';
  if (/\b(Chrome|Chromium|CriOS)\//.test(userAgent)) return 'chrome';
  if (/\bSafari\//.test(userAgent) && /\bVersion\//.test(userAgent)) return 'safari';
  return 'other';
}

/**
 * Web or desktop, by the page that asks (`app://app` is the desktop app, any
 * other allowed page the web game) and by the desktop app's own User-Agent,
 * which its main process sets for this host (desktop/src/user-agent.js).
 * A request without a page is `other` (a script, curl).
 */
export function clientInfo(origin: string | undefined, userAgent: string | undefined): ClientInfo {
  const ua = userAgent ?? '';
  const version = /\b3DTD\/(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/.exec(ua)?.[1] ?? null;
  const desktop = origin === 'app://app' || version !== null;
  return {
    client: desktop ? 'desktop' : origin ? 'web' : 'other',
    version: desktop ? version : null,
    browser: desktop ? 'electron' : browserFamily(ua),
  };
}
