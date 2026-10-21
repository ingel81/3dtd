/**
 * The building footprints an OSM world keeps from its import
 * (CustomMapDocument.footprints, TODO E290): written by the import, read by
 * the developer layer that lays them over the buildings (CustomMapStreets,
 * BuildingOverlay). Layout of `rings` (format FOOTPRINTS_FORMAT): per ring
 * its point count, its storeys, a word of info (kind, why the import left
 * it out, its lowest storey), then its points as x, y in decimetres. A
 * courtyard follows the ring it is a hole of.
 */
import type { MapFootprints, MapPoint } from './map-document';

/**
 * What OSM says a footprint is: `ground` a building on the ground (what the
 * import builds from), `part` a `building:part`, `underground` below the
 * ground (`location=underground`, `layer` < 0), `offGround` a building OSM
 * marks as none standing on the ground (a bridge, ruins, a tent, building-tags.ts)
 */
export type FootprintKind = 'ground' | 'part' | 'underground' | 'offGround';

/** Why the import built nothing on a footprint on the ground (BuildingReport.dropped) */
export type FootprintDrop = 'tiny' | 'noModel' | 'roads' | 'water' | 'hq' | 'budget';

/** One footprint read back: its outer ring and courtyards (not closed, metres), its storeys, 0 where OSM says none */
export interface MapFootprint {
  points: MapPoint[];
  holes: MapPoint[][];
  levels: number;
  /** Storeys below the footprint (`building:min_level`): a part high up on another */
  minLevel: number;
  kind: FootprintKind;
  /** Why the import left it out, null where it stands (only footprints on the ground) */
  dropped: FootprintDrop | null;
}

/** What the import hands over for one footprint: storeys null where OSM gives none */
export interface FootprintRing {
  points: readonly MapPoint[];
  holes?: readonly (readonly MapPoint[])[];
  levels: number | null;
  minLevel?: number | null;
  kind: FootprintKind;
  dropped?: FootprintDrop | null;
}

/** Version of the layout, in the field (MapFootprints.format): a file with another one is read without its footprints */
export const FOOTPRINTS_FORMAT = 2;

/** Decimetres per metre: the points' unit */
const UNIT = 10;
const INT16_MAX = 32767;
/** Words before a ring's points: count, storeys, info */
const HEAD = 3;
/** Code of a courtyard in the info word, after the kinds */
const COURT = 4;
/** Codes in the info word: kind in bits 0-2, why left out in bits 3-5 (0: stands), lowest storey in bits 8-14 */
const KINDS: readonly FootprintKind[] = ['ground', 'part', 'underground', 'offGround'];
const DROPS: readonly (FootprintDrop | null)[] = [null, 'tiny', 'noModel', 'roads', 'water', 'hq', 'budget'];
const MAX_MIN_LEVEL = 127;

/** A ring's points without a closing point equal to the first; null for one of fewer than three, too many or past ±3.2 km */
function ringPoints(p: readonly MapPoint[]): readonly MapPoint[] | null {
  let n = p.length;
  if (n > 1 && p[0].x === p[n - 1].x && p[0].y === p[n - 1].y) n--;
  if (n < 3 || n > INT16_MAX) return null;
  for (let k = 0; k < n; k++) if (Math.abs(p[k].x * UNIT) > INT16_MAX || Math.abs(p[k].y * UNIT) > INT16_MAX) return null;
  return n === p.length ? p : p.slice(0, n);
}

/** Storeys as the array keeps them */
const storeys = (v: number | null | undefined, max: number) => Math.max(0, Math.min(max, Math.round(v ?? 0)));

/**
 * The footprints as one array. A ring keeps its points (a closing point
 * equal to the first goes); one of fewer than three, of more points than
 * Int16 counts or reaching past ±3.2 km is left out (an OSM world's frame
 * reaches 1.2 km), a courtyard with its ring
 */
export function packFootprints(rings: readonly FootprintRing[]): MapFootprints {
  const words: number[][] = [];
  let size = 0;
  for (const r of rings) {
    const outer = ringPoints(r.points);
    if (!outer) continue;
    const levels = storeys(r.levels, INT16_MAX);
    const minLevel = storeys(r.minLevel, MAX_MIN_LEVEL) << 8;
    const info = KINDS.indexOf(r.kind) | (Math.max(0, DROPS.indexOf(r.dropped ?? null)) << 3) | minLevel;
    const add = (p: readonly MapPoint[], word: number) => {
      const w = [p.length, levels, word];
      for (const q of p) w.push(Math.round(q.x * UNIT), Math.round(q.y * UNIT));
      words.push(w);
      size += w.length;
    };
    add(outer, info);
    for (const hole of r.holes ?? []) {
      const h = ringPoints(hole);
      if (h) add(h, COURT | minLevel);
    }
  }
  const out = new Int16Array(size);
  let at = 0;
  for (const w of words) {
    out.set(w, at);
    at += w.length;
  }
  return { format: FOOTPRINTS_FORMAT, rings: out };
}

/** Whether the array holds whole rings one after the other, each with a kind it knows, a courtyard after a ring (a file's may be cut or made by hand) */
export function footprintsWellFormed(rings: Int16Array): boolean {
  let at = 0;
  let first = true;
  while (at < rings.length) {
    const n = rings[at];
    if (n < 3 || at + HEAD + 2 * n > rings.length) return false;
    const code = rings[at + 2] & 7;
    if (code > COURT || (first && code === COURT)) return false;
    first = false;
    at += HEAD + 2 * n;
  }
  return true;
}

/** Number of footprints in the array, courtyards not counted */
export function footprintCount(fp: MapFootprints): number {
  const r = fp.rings;
  let count = 0;
  for (let at = 0; at < r.length; at += HEAD + 2 * r[at]) if ((r[at + 2] & 7) !== COURT) count++;
  return count;
}

/** The footprints back as rings in metres, the courtyards as holes of theirs */
export function readFootprints(fp: MapFootprints): MapFootprint[] {
  const r = fp.rings;
  const out: MapFootprint[] = [];
  let at = 0;
  while (at + HEAD <= r.length) {
    const n = r[at];
    const levels = r[at + 1];
    const info = r[at + 2];
    at += HEAD;
    const points: MapPoint[] = new Array(n);
    for (let k = 0; k < n; k++, at += 2) points[k] = { x: r[at] / UNIT, y: r[at + 1] / UNIT };
    const code = info & 7;
    if (code === COURT) {
      out[out.length - 1]?.holes.push(points);
      continue;
    }
    out.push({ points, holes: [], levels, minLevel: (info >> 8) & MAX_MIN_LEVEL, kind: KINDS[code], dropped: DROPS[(info >> 3) & 7] ?? null });
  }
  return out;
}
