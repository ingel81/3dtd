/**
 * Small terrain commands that swap one part of the terrain object in place:
 * the ground layer list and paint, the water record and all water, the rivers. The terrain object itself stays,
 * so the renderer keeps its ground.
 */
import { fitSplatMaps, type CustomMapDocument, type MapGroundLayer, type MapRiver, type MapTerrain, type MapWater } from '../../../world/custom-map/map-document';
import type { DocChange, EditCommand, EditorDocument } from '../editor-document';

/**
 * The list of ground layers before and after (the splat weights are not part
 * of it; the third splat map comes and goes with the layers past 8)
 */
export class LayerListCommand implements EditCommand {
  readonly bytes = 256;

  constructor(
    readonly label: string,
    private readonly before: readonly MapGroundLayer[],
    private readonly after: readonly MapGroundLayer[],
  ) {}

  apply(doc: CustomMapDocument): DocChange {
    doc.terrain.layers = this.after.map((l) => ({ ...l }));
    fitSplatMaps(doc.terrain);
    return { layers: true };
  }

  revert(doc: CustomMapDocument): DocChange {
    doc.terrain.layers = this.before.map((l) => ({ ...l }));
    fitSplatMaps(doc.terrain);
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

/** What a layer edit changes: the list, the splat weights and the cliff material */
interface GroundState {
  layers: MapGroundLayer[];
  /** Two splat maps, three on a map with more than 8 layers */
  maps: Uint8Array[];
  cliffMaterial: string;
  cliffAngle: number;
}

function groundState(t: MapTerrain): GroundState {
  return {
    layers: t.layers.map((l) => ({ ...l })),
    maps: t.splat.maps.map((m) => m.slice()),
    cliffMaterial: t.cliffMaterial,
    cliffAngle: t.cliffAngle,
  };
}

/**
 * A change of the ground layers, written into the terrain in place: the
 * renderer keeps its terrain and only reloads the layers (`updateLayers`).
 */
export class GroundCommand implements EditCommand {
  readonly bytes: number;

  constructor(
    readonly label: string,
    private readonly before: GroundState,
    private readonly after: GroundState,
  ) {
    this.bytes = [...before.maps, ...after.maps].reduce((n, m) => n + m.byteLength, 0);
  }

  static record(editor: EditorDocument, label: string, edit: (t: MapTerrain) => void): GroundCommand {
    const t = editor.doc.terrain;
    const before = groundState(t);
    edit(t);
    const after = groundState(t);
    // The edit ran on the live terrain: put it back, apply() writes it again
    write(t, before);
    return new GroundCommand(label, before, after);
  }

  apply(doc: CustomMapDocument): DocChange {
    return write(doc.terrain, this.after);
  }

  revert(doc: CustomMapDocument): DocChange {
    return write(doc.terrain, this.before);
  }
}

function write(t: MapTerrain, state: GroundState): DocChange {
  t.layers = state.layers.map((l) => ({ ...l }));
  // Into the maps in place (the renderer keeps their textures); the third comes and goes with the layers past 8
  fitSplatMaps(t);
  state.maps.forEach((m, k) => t.splat.maps[k].set(m));
  t.cliffMaterial = state.cliffMaterial;
  t.cliffAngle = state.cliffAngle;
  const r = t.splat.resolution - 1;
  return { layers: true, splat: { i0: 0, j0: 0, i1: r, j1: r } };
}

/** All water of a map: the main body and the further ones */
export interface WaterState {
  water: MapWater | null;
  bodies: MapWater[] | undefined;
}

export function waterState(t: MapTerrain): WaterState {
  return { water: t.water ? structuredClone(t.water) : null, bodies: t.waterBodies ? structuredClone(t.waterBodies) : undefined };
}

export function setWaterState(t: MapTerrain, s: WaterState): void {
  t.water = s.water ? structuredClone(s.water) : null;
  if (s.bodies?.length) t.waterBodies = structuredClone(s.bodies);
  else delete t.waterBodies;
}

/** Swaps all water of the map before and after: levels, kinds, colours, masks, the body list */
export class WaterStateCommand implements EditCommand {
  readonly bytes: number;

  constructor(
    readonly label: string,
    private readonly before: WaterState,
    private readonly after: WaterState,
  ) {
    const size = (s: WaterState) => (s.water?.mask.byteLength ?? 0) + (s.bodies ?? []).reduce((n, b) => n + b.mask.byteLength, 0);
    this.bytes = size(before) + size(after);
  }

  apply(doc: CustomMapDocument): DocChange {
    setWaterState(doc.terrain, this.after);
    return { water: true };
  }

  revert(doc: CustomMapDocument): DocChange {
    setWaterState(doc.terrain, this.before);
    return { water: true };
  }
}
