import type { CorridorConfig } from '../../utils/route-corridor';
import type { CorridorExplanation } from '../world/path-route.service';

/**
 * Most cells one report holds. Copying reads every cell the way
 * `__corridor.pick()` reads its click (rays into the tiles, the corridor
 * width at the nearest station), so a box over half the map would hold the
 * page up for seconds.
 */
export const MAX_REPORT_CELLS = 100;

/** A grid spot of the report: the centre of its lattice square in local metres and the height to frame it at. */
export interface CellSpot {
  x: number;
  y: number;
  z: number;
}

/** A rectangle on the screen in client pixels, left <= right and top <= bottom. */
export interface ScreenRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** The rectangle between two pointer positions, whichever way the drag went. */
export function screenRect(x0: number, y0: number, x1: number, y1: number): ScreenRect {
  return { left: Math.min(x0, x1), top: Math.min(y0, y1), right: Math.max(x0, x1), bottom: Math.max(y0, y1) };
}

/** Whether two spots are the same grid square. */
export function sameSpot(a: CellSpot, b: CellSpot): boolean {
  return a.x === b.x && a.z === b.z;
}

/** heightM and walkable of a spot beside a selected cell; null where that spot has no cell. */
export type NeighbourRow = [number | null, boolean | null] | null;

/**
 * One selected cell as the report tells it, read the way `__corridor.pick()`
 * reads its click (CorridorConsole.describeCells).
 */
export interface ProbedCell {
  /** lat,lon of the cell centre, 7 decimals: the local x and z only hold at this location. */
  geo: string;
  /** The pick row of the cell: grid, walk check, the selected tower's answers and display, what lies over it. */
  row: Record<string, unknown>;
  /** The eight spots around it, keyed "dx,dz" in cells along local x and z. */
  neighbours: Record<string, NeighbourRow>;
  /** The column at the centre, cached against a fresh ray (TerrainQueries.inspectColumn); null in DevWorld. */
  column: Record<string, string | null> | null;
  /** How the corridor width comes about at the route station nearest to the cell; null without routes. */
  station: CorridorExplanation | null;
}

/** What CorridorConsole reads off the game for a report. */
export interface CellProbe {
  /** The tower whose answers and display the rows carry, null while none is selected. */
  tower: string | null;
  routes: string[];
  cells: ProbedCell[];
}

/**
 * The head of a report. Nothing here comes from the tile credentials: no
 * token, no API key, nothing of localStorage `3dtd-tile-credentials`.
 */
export interface CellReportMeta {
  time: string;
  /** The page URL without parameters that could carry a key, see reportUrl. */
  url: string;
  version: string;
  location: string;
  /** Effect preset, `custom` for a mix of the player's own. */
  effects: string;
  /** Corridor settings that differ from CORRIDOR_DEFAULTS, see corridorChanges. */
  corridor: Record<string, unknown>;
}

/** Query parameter names that could carry a key or a token; the report leaves them out. */
const SECRET_PARAM = /token|key|secret|cred|auth|pass|sig/i;

/**
 * The page URL for a report: origin, path and the query parameters (`l`,
 * `s`, `devworld` and so on) except those whose name suggests a key or a
 * token. No user info, no fragment.
 */
export function reportUrl(href: string): string {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return '';
  }
  const kept = url.search.slice(1).split('&').filter((part) => part !== '' && !SECRET_PARAM.test(part.split('=')[0]));
  return `${url.origin}${url.pathname}${kept.length > 0 ? `?${kept.join('&')}` : ''}`;
}

/** The corridor settings that differ from `defaults`; of the highway table only the widths that differ. */
export function corridorChanges(config: Readonly<CorridorConfig>, defaults: Readonly<CorridorConfig>): Record<string, unknown> {
  const changes: Record<string, unknown> = {};
  for (const key of Object.keys(config) as (keyof CorridorConfig)[]) {
    if (key !== 'highwayWidths' && config[key] !== defaults[key]) changes[key] = config[key];
  }
  const widths: Record<string, number> = {};
  for (const [type, width] of Object.entries(config.highwayWidths)) {
    if (defaults.highwayWidths[type] !== width) widths[type] = width;
  }
  if (Object.keys(widths).length > 0) changes['highwayWidths'] = widths;
  return changes;
}

/** Every number to two decimals, however deep; a number that is not finite becomes null. */
export function roundNumbers(value: unknown): unknown {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
  if (Array.isArray(value)) return value.map(roundNumbers);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, roundNumbers(entry)]));
  }
  return value;
}

/**
 * The report as JSON for the clipboard: `meta`, `note`, `stations` (each
 * route station once, what `__corridor.pick()` prints about it except the
 * stations around it) and `cells` (per cell its pick row, `geo`, the
 * neighbours in `nb`, the `column` and the key and distance of its nearest
 * station). One station and one cell per line, numbers to two decimals.
 */
export function buildCellReport(meta: CellReportMeta, note: string, probe: CellProbe): string {
  const stations = new Map<string, Record<string, unknown>>();
  const cells = probe.cells.map((cell) => {
    const station = cell.station;
    const key = station ? `${station.route} ${station.station}` : null;
    if (station && key !== null && !stations.has(key)) {
      const { nearby: _nearby, distanceM: _distanceM, ...kept } = station;
      stations.set(key, kept);
    }
    return {
      ...cell.row,
      geo: cell.geo,
      nb: cell.neighbours,
      column: cell.column,
      station: key,
      stationM: station?.distanceM ?? null,
    };
  });
  const line = (value: unknown) => JSON.stringify(roundNumbers(value));
  const head = { ...meta, tower: probe.tower, routes: probe.routes, cells: cells.length };
  return [
    `{"meta":${line(head)},`,
    `"note":${JSON.stringify(note)},`,
    '"stations":{',
    [...stations].map(([key, station]) => `${JSON.stringify(key)}:${line(station)}`).join(',\n'),
    '},',
    '"cells":[',
    cells.map(line).join(',\n'),
    ']}',
  ].join('\n');
}
