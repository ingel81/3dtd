/**
 * Small terrain commands that swap one part of the terrain object in place:
 * the ground layer list, the water record. The terrain object itself stays,
 * so the renderer keeps its ground.
 */
import type { CustomMapDocument, MapGroundLayer, MapWater } from '../../world/custom-map/map-document';
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
