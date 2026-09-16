import type { CorridorConfig } from '../../utils/route-corridor';
import type { CorridorState } from '../world/path-route.service';
import type { RouteCellDump, RouteCellProbe } from '../../utils/route-grid-diagnostics';
import type { CellMiss } from '../../utils/route-cell-sampler';
import type { CameraPose } from '../../utils/camera-timeline';
import type { TilesLodSnapshot } from '../../three-engine/tiles-lod-debug';
import type { RegionLodState } from '../../three-engine/route-corridor-region';
import { PAGE_LOAD, type CorridorLoad, type CorridorTraceEntry } from '../../utils/corridor-trace';
import { isSamePlace, type RecentLocation } from '../location/recent-locations';
import { fileSlug } from '../../utils/download';
import { roundNumbers } from './cell-report';
import { FINGERPRINT_PARTS, byKey, corridorFingerprintLines, fingerprintOfLines } from './corridor-fingerprint';

/**
 * The corridor snapshot: everything of the corridor in use at a place as one
 * JSON file (the Snapshot tile, `__corridor.snapshot()`), so two loads of a
 * place, one from a page load and one reached in the game, can be compared
 * entry by entry. This file holds its shape and puts it together; the
 * service takes it and saves it (CorridorSnapshotService), the reader reads
 * it off the game (CorridorSnapshotReader).
 */

/** How the place in use was loaded: `cold` by the page load, `nav` by a location change or an HQ move in the game. */
export type LoadKind = 'cold' | 'nav';

/** A point in geo and in the local frame of this location load, metres to 2 decimals. */
export interface SnapshotPoint {
  lat: number;
  lon: number;
  x: number;
  z: number;
}

/** How the place in use came to be loaded, see describeLoad. */
export interface SnapshotLoad {
  kind: LoadKind;
  /** The label of this location load in the corridor trace. */
  label: string;
  /** Location loads of this page so far, this one included. */
  loads: number;
  /** Seconds since this location load began. */
  sinceLoadS: number;
  /** Every location load of this page, oldest first, seconds since the page load (CorridorTrace.loads). */
  history: readonly CorridorLoad[];
  /** The place played before this one since the page load, from the recent list; null for none. */
  previous: { name: string; lat: number; lon: number; visitedAt: string } | null;
}

/** The head of a snapshot. Nothing of the tile credentials. */
export interface CorridorSnapshotMeta {
  time: string;
  version: string;
  /** The page URL with `l=` and `s=`, without parameters whose name suggests a key (reportUrl). */
  url: string;
  location: string;
  load: SnapshotLoad;
  /** Every corridor setting in use, and those of them that differ from CORRIDOR_DEFAULTS. */
  corridor: CorridorConfig;
  corridorChanged: Record<string, unknown>;
}

/** What `__corridor.pick()` knows of a cell beyond its dump, read by CorridorSnapshotReader. */
export interface SnapshotCellProbe {
  /** The pick row of the cell's spot (RouteCellProbe); null where the grid gave none. */
  row: RouteCellProbe | null;
  /** A tunnel cell of a passage under an obstacle on the centre line (TunnelSpan.passage). */
  passage: boolean;
  /** Why the cell has no height (GlobalRouteGrid.missOf), null with one. */
  miss: CellMiss | null;
  /** The column at its centre as pick prints it (describeColumn); null without tiles. */
  column: Record<string, string | null> | null;
}

/** What a snapshot cost, ms of the main thread unless it says otherwise. */
export interface SnapshotCost {
  cells: number;
  /** Pick rows and columns of all cells, and of that the columns alone. */
  cellsMs: number;
  columnsMs: number;
  /** Slices the cells were read in, one per frame. */
  slices: number;
  /** Waiting for the next frame, copying and encoding the screenshot. */
  screenshotMs: number;
  /** From the start of the read to its end, frames between the slices included. */
  wallMs: number;
}

/** What CorridorSnapshotReader reads off the game. */
export interface CorridorSnapshotData {
  hq: SnapshotPoint;
  spawns: (SnapshotPoint & { id: string })[];
  cellSize: number;
  /** Where the camera stood for the screenshot. */
  camera: CameraPose | null;
  state: CorridorState;
  /** Every cell of the grid (dumpCellsInBox), sorted by x, then z. */
  cells: readonly RouteCellDump[];
  /** What pick knows of each cell, in the order of `cells`. */
  probes: readonly SnapshotCellProbe[];
  /** The corridor trace of this location load. */
  trace: readonly CorridorTraceEntry[];
  /** As `__tiles.stats()` prints them; null without 3D tiles. */
  tiles: (TilesLodSnapshot & { lodVersion: number }) | null;
  /** The route corridor region as the trace's `tiles` line counts it; null without one. */
  region: (RegionLodState & { pending: number }) | null;
  /** The content paths of the region's fine tiles, the ones `tileSet` hashes; null without a region. */
  tilePaths: readonly string[] | null;
  /** The canvas as a PNG data URL; null where no frame came. */
  screenshot: string | null;
  cost: SnapshotCost;
}

/** Longest place name in a file name. */
const FILE_PLACE_LENGTH = 24;

/** `cold` for the page load, `nav` for every location load after it. */
export function loadKind(label: string): LoadKind {
  return label === PAGE_LOAD ? 'cold' : 'nav';
}

/**
 * How the place in use came to be loaded: the kind and label of the last
 * location load of the page (CorridorTrace.loads), how many there were, and
 * the place played before it. That one is the newest entry of the recent
 * list visited since the page load (`pageStart`, epoch ms) at another place
 * than `hq`; the list keeps one entry per place, so a place played twice
 * counts once.
 *
 * @param nowS Seconds since the page load
 */
export function describeLoad(
  loads: readonly CorridorLoad[],
  recents: readonly RecentLocation[],
  hq: { lat: number; lon: number } | null,
  pageStart: number,
  nowS: number,
): SnapshotLoad {
  const current = loads.at(-1) ?? { label: PAGE_LOAD, atS: 0 };
  const previous = recents.find((recent) => recent.visitedAt >= pageStart && !(hq && isSamePlace(recent.hq, hq)));
  return {
    kind: loadKind(current.label),
    label: current.label,
    loads: loads.length,
    sinceLoadS: Math.round((nowS - current.atS) * 10) / 10,
    history: loads,
    previous: previous
      ? { name: previous.name, ...previous.hq, visitedAt: new Date(previous.visitedAt).toISOString() }
      : null,
  };
}

/** `corridor-<place>-<cold|nav>-<hhmmss>.json`, the place reduced to ASCII letters, digits and dashes, local time. */
export function snapshotFileName(place: string, kind: LoadKind, date: Date): string {
  const pad2 = (n: number) => String(n).padStart(2, '0');
  const time = `${pad2(date.getHours())}${pad2(date.getMinutes())}${pad2(date.getSeconds())}`;
  return `corridor-${fileSlug(place, FILE_PLACE_LENGTH) || 'unknown'}-${kind}-${time}.json`;
}

/** A cell as the snapshot lists it: its dump, and what pick knows of it. */
function snapshotCell(cell: RouteCellDump, probe: SnapshotCellProbe | undefined): Record<string, unknown> {
  const row = probe?.row ?? null;
  return {
    key: cell.key,
    x: cell.x,
    z: cell.z,
    state: cell.state,
    heightM: cell.terrainHeight,
    anchorM: cell.routeAnchorY,
    surface: cell.surface,
    passage: probe?.passage ?? false,
    tileDepth: cell.tileDepth,
    tileError: cell.tileGeometricError,
    miss: probe?.miss ?? null,
    routeM: row?.routeM ?? null,
    walkable: row?.walkable ?? null,
    walkCheck: row?.walkCheck ?? null,
    overLineM: row?.overLineM ?? null,
    aboveNeighboursM: row?.aboveNeighboursM ?? null,
    column: probe?.column ?? null,
  };
}

/**
 * The snapshot as JSON, one entry per line so that two files compare line
 * by line: `meta` (with HQ, spawns, cell size and camera), `cost`,
 * `fingerprint` (the hash of `__corridor.fingerprint()` and its parts),
 * `lines` (the entries of each part before hashing), `tiles`, `region`,
 * `tilePaths`, `band` (each station of each route's band), `stations` (each
 * measured station), `cells` (each cell with its column), `trace` and last
 * the `screenshot`. Routes and segments in the order of the fingerprint,
 * cells by x, then z. Numbers to 2 decimals except in `meta`; a number that
 * is not finite (no tile, not measured) becomes null.
 */
export function buildCorridorSnapshot(meta: CorridorSnapshotMeta, data: CorridorSnapshotData): string {
  const lines = corridorFingerprintLines(data.state, data.cells);
  const line = (value: unknown) => JSON.stringify(roundNumbers(value));
  const list = <T>(name: string, rows: readonly T[] | null, write: (row: T) => string = line): string => {
    if (rows === null) return `${JSON.stringify(name)}:null`;
    return `${JSON.stringify(name)}:[${rows.length > 0 ? `\n${rows.map(write).join(',\n')}\n` : ''}]`;
  };

  const head = { ...meta, hq: data.hq, spawns: data.spawns, cellSize: data.cellSize, camera: data.camera };
  const band = [...data.state.routes].sort(byKey)
    .flatMap((route) => route.band.map((station) => ({ route: route.key, ...station })));
  const stations = [...data.state.stations].sort(byKey).flatMap((segment) => segment.left.map((left, k) => ({
    segment: segment.key,
    k,
    leftM: left,
    rightM: segment.right[k],
    tileError: segment.tileError[k],
    unmeasured: segment.unmeasured[k],
    shiftM: segment.shiftM[k],
  })));
  const cells = data.cells.map((cell, i) => snapshotCell(cell, data.probes[i]));

  return [
    '{"snapshot":"corridor",',
    `"meta":${JSON.stringify(head)},`,
    `"cost":${line(data.cost)},`,
    `"fingerprint":${JSON.stringify(fingerprintOfLines(lines))},`,
    '"lines":{',
    FINGERPRINT_PARTS.map((part) => list(part, lines[part], (entry) => JSON.stringify(entry))).join(',\n'),
    '},',
    `"tiles":${line(data.tiles)},`,
    `"region":${line(data.region)},`,
    `${list('tilePaths', data.tilePaths, (path) => JSON.stringify(path))},`,
    `${list('band', band)},`,
    `${list('stations', stations)},`,
    `${list('cells', cells)},`,
    `${list('trace', data.trace)},`,
    `"screenshot":${JSON.stringify(data.screenshot)}}`,
  ].join('\n');
}
