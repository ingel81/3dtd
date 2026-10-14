/**
 * Paint: hold the left button to lay the chosen ground layer; Shift (or the
 * erase switch) takes it away. The layer list and auto paint live in the
 * panel, which runs them as commands (`paintCommands`).
 */
import { fitSplatMaps, type CustomMapDocument, type MapGroundLayer, type MapTerrain } from '../../world/custom-map/map-document';
import { splatTargets, type DocChange, type EditCommand, type EditorDocument } from '../model/editor-document';
import { texelRectAround } from '../model/grid';
import { autoPaint, defaultAutoRules, moveLayer, paintDab, removeLayer, type AutoPaintRule } from '../ops/paint-ops';
import { BrushStroke } from './brush-stroke';
import type { EditorTool, ToolContext, ToolPointer } from './tool';

/** Share of full weight per second at full strength */
const PAINT_RATE = 3;

export class PaintTool implements EditorTool {
  readonly id = 'paint' as const;
  brushVisible(): boolean {
    return true;
  }
  private stroke: BrushStroke | null = null;
  private erase = false;


  deactivate(): void {
    this.end();
  }

  pointerDown(p: ToolPointer, ctx: ToolContext): boolean {
    if (p.button !== 0 || !p.hit) return false;
    this.erase = ctx.settings.paint.erase !== p.shift;
    this.stroke = new BrushStroke(ctx.editor, this.erase ? 'Erase paint' : 'Paint', splatTargets(ctx.editor.doc), ctx.settings.symmetry);
    return true;
  }


  pointerUp(): void {
    this.end();
  }

  frame(dt: number, p: ToolPointer | null, ctx: ToolContext): void {
    const stroke = this.stroke;
    if (!stroke || !p?.hit) return;
    const t = stroke.doc.terrain;
    const brush = ctx.settings.brush;
    const layer = Math.min(ctx.settings.paint.layer, t.layers.length - 1);
    const rect = texelRectAround(t, p.hit.x, p.hit.y, brush.radius);
    stroke.touchSplat(rect);
    paintDab(t, p.hit.x, p.hit.y, brush, layer, PAINT_RATE * Math.min(dt, 0.1), this.erase);
    stroke.changed({ splat: rect }, p.hit);
  }



  hint(ctx: ToolContext): string {
    const t = ctx.editor.doc.terrain;
    const layer = t.layers[Math.min(ctx.settings.paint.layer, t.layers.length - 1)];
    const name = layer ? ctx.catalog.material(layer.material).name : '';
    return `Paint ${name}: hold to paint, Shift erases | [ ] size`;
  }

  private end(): void {
    this.stroke?.finish();
    this.stroke = null;
  }
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
class GroundCommand implements EditCommand {
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

/** Layer list, auto paint and cliff as undoable steps; the terrain stays the same object */
export const paintCommands = {
  addLayer(editor: EditorDocument, material: string): EditCommand {
    return GroundCommand.record(editor, 'Add layer', (t) => {
      t.layers.push({ material });
      fitSplatMaps(t);
    });
  },
  setMaterial(editor: EditorDocument, index: number, material: string): EditCommand {
    return GroundCommand.record(editor, 'Change material', (t) => (t.layers[index] = { ...t.layers[index], material }));
  },
  setScale(editor: EditorDocument, index: number, scale: number | undefined): EditCommand {
    return GroundCommand.record(editor, 'Texture size', (t) => {
      const layer = { ...t.layers[index] };
      if (scale && scale > 0) layer.scale = scale;
      else delete layer.scale;
      t.layers[index] = layer;
    });
  },
  removeLayer(editor: EditorDocument, index: number): EditCommand {
    return GroundCommand.record(editor, 'Remove layer', (t) => removeLayer(t, index));
  },
  moveLayer(editor: EditorDocument, from: number, to: number): EditCommand {
    return GroundCommand.record(editor, 'Move layer', (t) => moveLayer(t, from, to));
  },
  autoPaint(editor: EditorDocument, rules?: AutoPaintRule[]): EditCommand {
    return GroundCommand.record(editor, 'Auto paint', (t) => autoPaint(t, rules ?? defaultAutoRules(t)));
  },
  setCliff(editor: EditorDocument, material: string, angle: number): EditCommand {
    return GroundCommand.record(editor, 'Cliff material', (t) => {
      t.cliffMaterial = material;
      t.cliffAngle = angle;
    });
  },
};
