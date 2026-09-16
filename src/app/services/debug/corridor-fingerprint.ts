import type { CorridorState } from '../world/path-route.service';
import type { RouteCellDump } from '../../utils/route-grid-diagnostics';

/**
 * `__corridor.fingerprint()`: a short hash over the corridor in use, to tell
 * whether two loads of a place gave the same corridor (docs/ROUTE_CORRIDOR.md,
 * Phase 0). Only stored state goes in (PathAndRouteService.corridorState and
 * the grid's cells), nothing measured or judged anew, so where the camera
 * looks does not change it; the same corridor gives the same hash. Each part
 * is hashed on its own, so two hashes that differ tell which part did:
 *
 * - `band`: per route and station of its walkable band what it decided:
 *   the kind, the backbone (offset cm, height dm), the street under it (dm),
 *   the edges left and right and the offset of the enemies' line (cm)
 * - `stations`: per measured station the free space left and right (cm)
 *   and why it stayed unmeasured
 * - `cells`: the cells, by their centre (cm)
 * - `heights`: their heights, rounded to 0.1 m
 * - `tiles`: the geometric error of the tile under each measured station,
 *   and each cell's sample state, tile depth and geometric error
 *
 * Routes, segments and cells are sorted by key, so the order the maps were
 * filled in does not count.
 */

export const FINGERPRINT_PARTS = ['band', 'stations', 'cells', 'heights', 'tiles'] as const;
export type FingerprintPartName = (typeof FINGERPRINT_PARTS)[number];

/** One part of the fingerprint: how many entries went in and their hash. */
export interface FingerprintPart {
  entries: number;
  hash: string;
}

export interface CorridorFingerprint {
  /** Hash over the hashes of all parts, 8 hex digits. */
  hash: string;
  parts: Record<FingerprintPartName, FingerprintPart>;
}

/** A number as it goes into the hash: rounded to `digits`, and spelled out where it is not finite. */
function num(value: number | null, digits: number): string {
  if (value === null) return '-';
  if (Number.isNaN(value)) return 'nan';
  if (!Number.isFinite(value)) return value > 0 ? 'inf' : '-inf';
  const f = 10 ** digits;
  // `+ 0` turns -0 into 0
  return String(Math.round(value * f) / f + 0);
}

const byKey = <T extends { key: string }>(a: T, b: T) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

/** FNV-1a, 32 bit, as 8 hex digits: short enough to compare by eye. */
export function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** The fingerprint of a corridor, see the file comment. Pure: the same input gives the same hash. */
export function corridorFingerprint(state: CorridorState, cells: readonly RouteCellDump[]): CorridorFingerprint {
  const lines: Record<FingerprintPartName, string[]> = {
    band: [], stations: [], cells: [], heights: [], tiles: [],
  };

  for (const route of [...state.routes].sort(byKey)) {
    for (const station of route.band) {
      lines.band.push(
        `${route.key}#${station.segment}:${station.k}:${station.kind},` +
        `${num(station.backbone?.offset ?? null, 2)},${num(station.backbone?.y ?? null, 1)},${num(station.street, 1)},` +
        `${num(station.left, 2)},${num(station.right, 2)},${num(station.centre, 2)}`,
      );
    }
  }
  for (const segment of [...state.stations].sort(byKey)) {
    segment.left.forEach((left, k) => {
      lines.stations.push(`${segment.key}#${k}:${num(left, 2)},${num(segment.right[k], 2)},${segment.unmeasured[k] ?? '-'}`);
      lines.tiles.push(`${segment.key}#${k}:${num(segment.tileError[k], 3)}`);
    });
  }
  const sorted = [...cells].sort((a, b) => (a.x - b.x) || (a.z - b.z));
  for (const cell of sorted) {
    const at = `${num(cell.x, 2)},${num(cell.z, 2)}`;
    lines.cells.push(at);
    lines.heights.push(`${at}:${num(cell.terrainHeight, 1)}`);
    lines.tiles.push(`${at}:${cell.state},${cell.tileDepth},${num(cell.tileGeometricError, 3)}`);
  }

  const parts = {} as Record<FingerprintPartName, FingerprintPart>;
  for (const name of FINGERPRINT_PARTS) {
    parts[name] = { entries: lines[name].length, hash: fnv1a(lines[name].join('\n')) };
  }
  return { hash: fnv1a(FINGERPRINT_PARTS.map((name) => parts[name].hash).join('|')), parts };
}
