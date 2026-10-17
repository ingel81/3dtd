/**
 * A stroke's undo step: the tiles of the arrays it touched (heights, splat
 * maps, water masks), before and after (region-patch.ts).
 */
import type { CustomMapDocument } from '../../../world/custom-map/map-document';
import { mergeChanges, type DocChange, type EditCommand } from '../editor-document';
import { applyPatches, patchBytes, type ArrayLayout, type PatchArray, type TilePatch } from '../region-patch';

/** `water` is the main water body's mask, `body0`, `body1` … the further bodies' masks */
export type PatchTarget = 'heights' | SplatTarget | 'water' | `body${number}`;

/** A splat map; `splat2` only on maps with more than 8 layers */
export type SplatTarget = 'splat0' | 'splat1' | 'splat2';

/** The splat maps the map has now */
export function splatTargets(doc: CustomMapDocument): SplatTarget[] {
  return (['splat0', 'splat1', 'splat2'] as const).slice(0, doc.terrain.splat.maps.length);
}

export function patchArray(doc: CustomMapDocument, target: PatchTarget): PatchArray {
  const t = doc.terrain;
  switch (target) {
    case 'heights':
      return t.grid.heights;
    case 'splat0':
    case 'splat1':
    case 'splat2': {
      const map = t.splat.maps[Number(target.slice(5))];
      if (!map) throw new Error(`The map has no ${target}`);
      return map;
    }
    case 'water':
      if (!t.water) throw new Error('The map has no water');
      return t.water.mask;
    default: {
      const body = t.waterBodies?.[Number(target.slice(4))];
      if (!body) throw new Error(`The map has no water body ${target}`);
      return body.mask;
    }
  }
}

export function patchLayout(doc: CustomMapDocument, target: PatchTarget): ArrayLayout {
  const t = doc.terrain;
  if (target.startsWith('splat')) {
    return { columns: t.splat.resolution, rows: t.splat.resolution, channels: 4 };
  }
  return { columns: t.grid.columns, rows: t.grid.rows, channels: 1 };
}

/** A stroke over one or more arrays, as tile patches */
export class PatchCommand implements EditCommand {
  readonly bytes: number;

  constructor(
    readonly label: string,
    private readonly parts: readonly { target: PatchTarget; patches: TilePatch[] }[],
  ) {
    this.bytes = parts.reduce((n, p) => n + patchBytes(p.patches), 0);
  }

  get empty(): boolean {
    return this.parts.every((p) => p.patches.length === 0);
  }

  apply(doc: CustomMapDocument): DocChange {
    return this.write(doc, 'after');
  }

  revert(doc: CustomMapDocument): DocChange {
    return this.write(doc, 'before');
  }

  private write(doc: CustomMapDocument, side: 'before' | 'after'): DocChange {
    let change: DocChange = {};
    for (const part of this.parts) {
      const rect = applyPatches(patchArray(doc, part.target), patchLayout(doc, part.target), part.patches, side);
      if (!rect) continue;
      if (part.target === 'heights') change = mergeChanges(change, { heights: rect });
      else if (part.target === 'water' || part.target.startsWith('body')) change = mergeChanges(change, { water: true });
      else change = mergeChanges(change, { splat: rect });
    }
    return change;
  }
}

