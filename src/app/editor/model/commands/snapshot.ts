/**
 * Small parts of the document kept whole before and after (roads, spawns,
 * HQ, environment, meta, a whole map put back), and the one list of the
 * parts that make "all of the map".
 */
import type {
  CustomMapDocument,
  MapEnvironment,
  MapFootprints,
  MapGameplay,
  MapIntro,
  MapLife,
  MapLine,
  MapMeta,
  MapObject,
  MapPaths,
  MapPoint,
  MapPrefab,
  MapSpawn,
  MapSurface,
  MapTerrain,
} from '../../../world/custom-map/map-document';
import { mergeChanges, type DocChange, type EditCommand } from '../doc-change';

/** Parts of the document small enough to keep whole before and after */
export interface DocParts {
  objects: MapObject[];
  gameplay: MapGameplay | undefined;
  paths: MapPaths;
  spawns: MapSpawn[];
  hq: MapPoint;
  environment: MapEnvironment;
  life: MapLife | undefined;
  surfaces: MapSurface[] | undefined;
  intro: MapIntro | undefined;
  meta: MapMeta;
  terrain: MapTerrain;
  prefabs: MapPrefab[] | undefined;
  footprints: MapFootprints | undefined;
  lines: MapLine[] | undefined;
}

/** The parts that make the map's content: every field of the document but its format, version and `meta` (id, name, dates) */
type ContentPart = Exclude<keyof CustomMapDocument, 'format' | 'version' | 'meta'>;

// A Record over the document's own fields: a new field fails to compile until it is listed
const CONTENT_PART: Record<ContentPart, true> = {
  terrain: true,
  objects: true,
  paths: true,
  spawns: true,
  hq: true,
  environment: true,
  gameplay: true,
  life: true,
  surfaces: true,
  intro: true,
  prefabs: true,
  footprints: true,
  lines: true,
};

/**
 * The whole map as one snapshot (a version put back, an agent's play): every
 * part but `meta`. The one list for "all of the map"; a copy of it by hand
 * forgot life, intro and prefabs once
 */
export const ALL_DOC_PARTS = Object.keys(CONTENT_PART) as readonly (ContentPart & keyof DocParts)[];

const PART_CHANGE: Record<keyof DocParts, DocChange> = {
  objects: { objects: 'all' },
  gameplay: { gameplay: true },
  paths: { paths: true },
  spawns: { markers: true },
  hq: { markers: true },
  environment: { environment: true },
  life: { life: true },
  surfaces: { surfaces: true },
  intro: { intro: true },
  meta: { meta: true },
  terrain: { terrain: true, layers: true, water: true },
  prefabs: { prefabs: true },
  // No tool changes them and nothing draws them in the editor; the worker's mirror follows them by identity
  footprints: {},
  // The pieces draw a line (MapObject.line); its course alone draws nothing
  lines: {},
};

/** Swaps parts of the document between two copies */
export class SnapshotCommand implements EditCommand {
  readonly bytes: number;

  constructor(
    readonly label: string,
    private readonly before: Partial<DocParts>,
    private readonly after: Partial<DocParts>,
    private readonly extra: DocChange = {},
  ) {
    this.bytes = estimateBytes(before) + estimateBytes(after);
  }

  /** Copies of `keys` as they are now, for a command made of two captures (an edit that takes a while) */
  static capture<K extends keyof DocParts>(doc: CustomMapDocument, keys: readonly K[]): Partial<DocParts> {
    return pick(doc, keys);
  }

  /** Captures `keys` now, runs `edit`, captures again */
  static record<K extends keyof DocParts>(
    doc: CustomMapDocument,
    label: string,
    keys: readonly K[],
    edit: (doc: CustomMapDocument) => void,
    extra: DocChange = {},
  ): SnapshotCommand {
    const before = pick(doc, keys);
    edit(doc);
    return new SnapshotCommand(label, before, pick(doc, keys), extra);
  }

  /** Puts all of `from` (ALL_DOC_PARTS, a kept version) over `doc` as one step; `doc` keeps its meta */
  static restore(doc: CustomMapDocument, from: CustomMapDocument, label: string): SnapshotCommand {
    return new SnapshotCommand(label, pick(doc, ALL_DOC_PARTS), pick(from, ALL_DOC_PARTS));
  }

  apply(doc: CustomMapDocument): DocChange {
    return this.write(doc, this.after);
  }

  revert(doc: CustomMapDocument): DocChange {
    return this.write(doc, this.before);
  }

  private write(doc: CustomMapDocument, parts: Partial<DocParts>): DocChange {
    const keys = Object.keys(parts) as (keyof DocParts)[];
    for (const key of keys) (doc as unknown as Record<string, unknown>)[key] = structuredClone(parts[key]);
    return partsChange(keys, this.extra);
  }
}

/** What writing `keys` whole tells the view */
export function partsChange(keys: readonly (keyof DocParts)[], extra: DocChange = {}): DocChange {
  let change: DocChange = { ...extra };
  for (const key of keys) {
    change = mergeChanges(change, PART_CHANGE[key]);
    if (key === 'terrain') change = { ...change, objects: 'all', paths: true, markers: true };
  }
  return change;
}

function pick<K extends keyof DocParts>(doc: CustomMapDocument, keys: readonly K[]): Partial<DocParts> {
  const out: Partial<DocParts> = {};
  for (const k of keys) (out as Record<string, unknown>)[k] = structuredClone(doc[k]);
  return out;
}

function estimateBytes(parts: Partial<DocParts>): number {
  let n = 0;
  for (const value of Object.values(parts)) {
    if (!value) continue;
    if ((value as MapTerrain).grid) {
      const t = value as MapTerrain;
      n += t.grid.heights.byteLength + t.splat.maps[0].byteLength * t.splat.maps.length + (t.water?.mask.byteLength ?? 0);
      // Up to 64 further water bodies, each a mask of the whole grid
      for (const body of t.waterBodies ?? []) n += body.mask.byteLength;
    } else if (Array.isArray(value) && (value[0] as MapPrefab | undefined)?.stamp) {
      for (const p of value as MapPrefab[]) n += p.stamp.heights.byteLength + p.stamp.paint.byteLength + (p.preview?.length ?? 0) + p.stamp.objects.length * 160;
    } else if ((value as MapFootprints).rings) {
      n += (value as MapFootprints).rings.byteLength;
    } else n += JSON.stringify(value).length;
  }
  return n;
}

