/**
 * Small terrain commands that swap one part of the terrain object in place:
 * the ground layer list, the water record, the rivers. The terrain object itself stays,
 * so the renderer keeps its ground.
 */
import type { CustomMapDocument, MapGroundLayer, MapRiver, MapWater } from '../../world/custom-map/map-document';
import type { DocChange, EditCommand } from './editor-document';

/** The list of ground layers before and after (the splat weights are not part of it) */
export class LayerListCommand implements EditCommand {
  readonly bytes = 256;

  constructor(
    readonly label: string,
    private readonly before: readonly MapGroundLayer[],
    private readonly after: readonly MapGroundLayer[],
  ) {}

  apply(doc: CustomMapDocument): DocChange {
    doc.terrain.layers = this.after.map((l) => ({ ...l }));
    return { layers: true };
  }

  revert(doc: CustomMapDocument): DocChange {
    doc.terrain.layers = this.before.map((l) => ({ ...l }));
    return { layers: true };
  }
}

/** The whole water record (level, colour, mask) before and after; null is no water */
export class WaterSwapCommand implements EditCommand {
  readonly bytes: number;

  constructor(
    readonly label: string,
    private readonly before: MapWater | null,
    private readonly after: MapWater | null,
  ) {
    this.bytes = (before?.mask.byteLength ?? 0) + (after?.mask.byteLength ?? 0);
  }

  apply(doc: CustomMapDocument): DocChange {
    doc.terrain.water = this.after ? structuredClone(this.after) : null;
    return { water: true };
  }

  revert(doc: CustomMapDocument): DocChange {
    doc.terrain.water = this.before ? structuredClone(this.before) : null;
    return { water: true };
  }
}

/** A water body a stroke added at the end of the list (its mask fills through the stroke's patches) */
export class BodyAddCommand implements EditCommand {
  readonly bytes: number;

  constructor(
    readonly label: string,
    private readonly index: number,
    private readonly body: MapWater,
  ) {
    this.bytes = body.mask.byteLength;
  }

  apply(doc: CustomMapDocument): DocChange {
    (doc.terrain.waterBodies ??= []).splice(this.index, 0, structuredClone(this.body));
    return { water: true };
  }

  revert(doc: CustomMapDocument): DocChange {
    const t = doc.terrain;
    t.waterBodies?.splice(this.index, 1);
    if (!t.waterBodies?.length) delete t.waterBodies;
    return { water: true };
  }
}

/** The list of rivers and lava flows before and after */
export class RiverListCommand implements EditCommand {
  readonly bytes: number;

  constructor(
    readonly label: string,
    private readonly before: readonly MapRiver[] | undefined,
    private readonly after: readonly MapRiver[] | undefined,
  ) {
    const size = (l: readonly MapRiver[] | undefined) => (l ?? []).reduce((n, r) => n + 64 + r.points.length * 32, 0);
    this.bytes = size(before) + size(after);
  }

  apply(doc: CustomMapDocument): DocChange {
    return setRivers(doc, this.after);
  }

  revert(doc: CustomMapDocument): DocChange {
    return setRivers(doc, this.before);
  }
}

function setRivers(doc: CustomMapDocument, rivers: readonly MapRiver[] | undefined): DocChange {
  // Exactly the list as it was, an empty one too: undo gives the map back byte for byte (its content hash)
  if (rivers) doc.terrain.rivers = structuredClone(rivers) as MapRiver[];
  else delete doc.terrain.rivers;
  return { water: true };
}
