/**
 * What an edit touched (DocChange, the view refreshes just that) and the
 * shape of every undoable step (EditCommand).
 */
import type { CustomMapDocument } from '../../world/custom-map/map-document';
import { rectUnion, type GridRect } from '../../map-ops/grid';

/** What an edit touched; the view refreshes just that */
export interface DocChange {
  /** Height samples */
  heights?: GridRect;
  /** Splat texels */
  splat?: GridRect;
  /** Water level or mask (all water: main, bodies, rivers) */
  water?: boolean;
  /** Only the masks of these bodies changed (-1 the main water, 0.. further ones), within `bodyRect` (samples); the view redraws just them there */
  bodies?: number[];
  bodyRect?: GridRect;
  /** Object ids added, removed or changed, or all of them */
  objects?: 'all' | string[];
  paths?: boolean;
  /** Spawns and HQ */
  markers?: boolean;
  environment?: boolean;
  /** Life areas and the map's life switches (map-life.ts) */
  life?: boolean;
  /** Name, author, description */
  meta?: boolean;
  /** The map's rules and wave list */
  gameplay?: boolean;
  /** The intro flight */
  intro?: boolean;
  /** The stamps and prefabs the map keeps */
  prefabs?: boolean;
  /** Ground layer list (materials, order) */
  layers?: boolean;
  /** The whole terrain was replaced (resize, new grid) */
  terrain?: boolean;
}

export function mergeChanges(a: DocChange, b: DocChange): DocChange {
  const objects =
    a.objects === 'all' || b.objects === 'all'
      ? 'all'
      : a.objects || b.objects
        ? [...new Set([...(a.objects ?? []), ...(b.objects ?? [])])]
        : undefined;
  return {
    heights: rectUnion(a.heights ?? null, b.heights ?? null) ?? undefined,
    splat: rectUnion(a.splat ?? null, b.splat ?? null) ?? undefined,
    water: a.water || b.water || undefined,
    bodies: a.bodies || b.bodies ? [...new Set([...(a.bodies ?? []), ...(b.bodies ?? [])])] : undefined,
    bodyRect: rectUnion(a.bodyRect ?? null, b.bodyRect ?? null) ?? undefined,
    objects,
    paths: a.paths || b.paths || undefined,
    markers: a.markers || b.markers || undefined,
    environment: a.environment || b.environment || undefined,
    life: a.life || b.life || undefined,
    meta: a.meta || b.meta || undefined,
    gameplay: a.gameplay || b.gameplay || undefined,
    intro: a.intro || b.intro || undefined,
    prefabs: a.prefabs || b.prefabs || undefined,
    layers: a.layers || b.layers || undefined,
    terrain: a.terrain || b.terrain || undefined,
  };
}

export interface EditCommand {
  readonly label: string;
  /** Do (or redo) it */
  apply(doc: CustomMapDocument): DocChange;
  /** Undo it */
  revert(doc: CustomMapDocument): DocChange;
  /** Memory it holds, for the history's budget */
  readonly bytes: number;
}
