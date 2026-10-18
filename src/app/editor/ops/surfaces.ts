/**
 * The map's surfaces (MapSurface, TODO E237) in the editor: a changed copy
 * of the list as one step, a new surface with its marking fitted, a marking
 * fitted again after its outline changed, and a marking's rectangle pulled
 * by one corner. The tool, its panel and the AI agent share them.
 */
import type { CustomMapDocument, MapPoint, MapSurface, MapSurfaceMarking, MapSurfaceMarkingKind } from '../../world/custom-map/map-document';
import { fitMarking, markingFrame, markingPoint, newSurfaceId } from '../../world/custom-map/map-surfaces';
import type { EditCommand } from '../model/doc-change';
import { SnapshotCommand } from '../model/commands/snapshot';

/** The map's surfaces with `change` made to a copy, one step (the document keeps undo snapshots of the old list) */
export function surfacesCommand(doc: CustomMapDocument, change: (surfaces: MapSurface[]) => void, label: string): EditCommand {
  return SnapshotCommand.record(doc, label, ['surfaces'], (d) => {
    const list = structuredClone(d.surfaces ?? []);
    change(list);
    d.surfaces = list.length ? list : undefined;
  });
}

/**
 * A new surface of `material` on an outline, its marking of `kind` fitted
 * to it; in the editor a marking fits any outline (the player chose it),
 * the OSM world asks for a well filled rectangle (map-surfaces.ts MARKING_FILL)
 */
export function newSurface(surfaces: readonly MapSurface[], material: string, outer: MapPoint[], kind: MapSurfaceMarkingKind | null): MapSurface {
  const s: MapSurface = { id: newSurfaceId(surfaces), material, outer };
  const marking = kind ? fitMarking(kind, outer, [], 0) : null;
  if (marking) s.marking = marking;
  return s;
}

/** The surface's marking fitted again to its outline (after the outline changed); one without stays so */
export function refitMarking(s: MapSurface): void {
  if (!s.marking) return;
  const m = fitMarking(s.marking.kind, s.outer, s.holes ?? [], 0);
  if (m) s.marking = m;
  else delete s.marking;
}

/** The marking's corners in map space, counter-clockwise from the one at (-length / 2, -width / 2) */
export function markingCorners(m: MapSurfaceMarking): MapPoint[] {
  const l = m.length / 2;
  const w = m.width / 2;
  return [markingPoint(m, -l, -w), markingPoint(m, l, -w), markingPoint(m, l, w), markingPoint(m, -l, w)];
}

/**
 * The marking with corner `k` (markingCorners) moved to `p` and the
 * opposite corner where it was: the rectangle keeps its turn and which of
 * its sides the court runs along
 */
export function pullMarkingCorner(m: MapSurfaceMarking, k: number, p: MapPoint): MapSurfaceMarking {
  const opposite = markingCorners(m)[(k + 2) % 4];
  const a = markingFrame(m, opposite);
  const b = markingFrame(m, p);
  const length = Math.max(1, Math.abs(b.u - a.u));
  const width = Math.max(1, Math.abs(b.v - a.v));
  const mid = markingPoint(m, (a.u + b.u) / 2, (a.v + b.v) / 2);
  return { ...m, x: round(mid.x), y: round(mid.y), length: round(length), width: round(width) };
}

const round = (v: number) => Math.round(v * 100) / 100;
