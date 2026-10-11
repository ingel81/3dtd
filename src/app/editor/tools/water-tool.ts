/**
 * Water and lava: the map's main water and its further bodies (lakes up a
 * hill, lava pools, frozen ponds), each with its own level. The tool works
 * on the body chosen in the panel: Fill floods a hollow up to the body's
 * level (a new body takes the hollow's rim as its level), Lake digs a bed
 * under the brush and fills it, Paint and Erase draw the mask by hand
 * (Shift reverses). Sea floods the body in from the map's edge. The body
 * list, kinds, levels and colours live in the panel (`waterCommands`).
 */
import type { CustomMapDocument, MapTerrain, MapWater, MapWaterKind } from '../../world/custom-map/map-document';
import type { DocChange, EditCommand, EditorDocument, PatchTarget } from '../model/editor-document';
import { nearestSample, sampleRectAround } from '../model/grid';
import { basinSpillHeight, emptyWater, fillBasin, fillFromEdge, lakeDab, waterBody, waterMaskDab } from '../ops/water-ops';
import { symmetryImages } from '../ops/symmetry';
import { BrushStroke } from './brush-stroke';
import type { EditorTool, ToolContext, ToolPointer } from './tool';

/** Metres the water stays below a hollow's rim */
const RIM_MARGIN = 0.3;
/** Share per second a lake bed sinks toward its depth at full strength */
const DIG_RATE = 3;

/** Default look of a new body by kind */
export const BODY_COLORS: Record<MapWaterKind, string> = { water: '#2f5f6f', lava: '#ff5a14', ice: '#cfe6ef' };

/** The patch target of a body's mask */
function maskTarget(body: number): PatchTarget {
  return body < 0 ? 'water' : `body${body}`;
}

export class WaterTool implements EditorTool {
  readonly id = 'water' as const;
  private stroke: BrushStroke | null = null;
  private on = true;

  brushVisible(ctx: ToolContext): boolean {
    return ctx.settings.water.mode !== 'fill';
  }

  deactivate(): void {
    this.end();
  }

  pointerDown(p: ToolPointer, ctx: ToolContext): boolean {
    if (p.button !== 0 || !p.hit) return false;
    const editor = ctx.editor;
    const s = ctx.settings.water;
    if (s.mode === 'fill' && !p.shift) {
      this.fill(p, ctx);
      return true;
    }
    // A body to work on: the main water appears at the clicked height when there is none
    if (!waterBody(editor.doc.terrain, s.body)) {
      if (s.body >= 0) {
        ctx.status('Choose a body in the panel first');
        return true;
      }
      editor.execute(waterCommands.enable(editor, Math.round((p.hit.z - (s.mode === 'lake' ? 0 : 0.2)) * 10) / 10));
    }
    this.on = s.mode === 'erase' ? p.shift : !p.shift;
    const targets: PatchTarget[] = [maskTarget(s.body)];
    if (s.mode === 'lake') targets.push('heights');
    const label = s.mode === 'lake' ? 'Dig lake' : this.on ? 'Paint water' : 'Erase water';
    this.stroke = new BrushStroke(editor, label, targets, s.body < 0 ? ctx.settings.symmetry : 'none');
    return true;
  }

  pointerUp(): void {
    this.end();
  }

  frame(dt: number, p: ToolPointer | null, ctx: ToolContext): void {
    const stroke = this.stroke;
    if (!stroke || !p?.hit) return;
    const s = ctx.settings.water;
    const t = stroke.doc.terrain;
    const rect = sampleRectAround(t, p.hit.x, p.hit.y, ctx.settings.brush.radius);
    stroke.touch(maskTarget(s.body), rect);
    if (s.mode === 'lake' && this.on) {
      stroke.touch('heights', rect);
      lakeDab(t, p.hit.x, p.hit.y, ctx.settings.brush, s.depth, DIG_RATE * Math.min(dt, 0.1), s.body);
      stroke.changed({ water: true, heights: rect }, p.hit, rect);
      return;
    }
    waterMaskDab(t, p.hit.x, p.hit.y, ctx.settings.brush, this.on, s.body);
    stroke.changed({ water: true }, p.hit, rect);
  }

  hint(ctx: ToolContext): string {
    const s = ctx.settings.water;
    const body = waterBody(ctx.editor.doc.terrain, s.body);
    const name = s.body < 0 ? 'the main water' : `body ${s.body + 1}`;
    switch (s.mode) {
      case 'fill':
        return !body
          ? 'Click a hollow to fill it up to its rim'
          : `Click a hollow to fill ${name} up to ${body.level} m | Ctrl click fills to the rim | Shift erases`;
      case 'lake':
        return `Hold to dig a lake bed under ${name} and fill it | [ ] size`;
      case 'paint':
        return `Hold to paint ${name}, Shift erases | [ ] size`;
      case 'erase':
        return `Hold to erase ${name}, Shift paints | [ ] size`;
    }
    return '';
  }

  /**
   * Fill the hollow under the pointer. A body without water yet (or with
   * Ctrl) takes the hollow's rim as its level, a little below the spill.
   */
  private fill(p: ToolPointer, ctx: ToolContext): void {
    const editor = ctx.editor;
    const t = editor.doc.terrain;
    const s = ctx.settings.water;
    const { i, j } = nearestSample(t, p.hit!.x, p.hit!.y);
    const before = waterState(t);
    const body = waterBody(t, s.body);
    const fresh = !body || !body.mask.some((v) => v);
    if (s.body < 0 && !t.water) t.water = emptyWater(t, 0);
    const target = waterBody(t, s.body);
    if (!target) {
      ctx.status('Choose a body in the panel first');
      return;
    }
    if (fresh || p.ctrl) target.level = Math.round((basinSpillHeight(t, i, j) - RIM_MARGIN) * 10) / 10;
    const rect = fillBasin(t, i, j, s.body);
    if (rect && s.body < 0) {
      // The images of the hollow fill too
      const g = t.grid;
      for (const img of symmetryImages(ctx.settings.symmetry, g.columns === g.rows).slice(1)) {
        const [ii, jj] = img.cell(i, j, g.columns, g.rows);
        fillBasin(t, ii, jj, s.body);
      }
    }
    const level = target.level;
    const after = waterState(t);
    setWaterState(t, before);
    if (!rect) {
      ctx.status(
        !fresh && !p.ctrl
          ? `The ground here lies above the level (${level} m); Ctrl click fills to the rim`
          : 'This spot is no hollow: the water would run off',
      );
      return;
    }
    editor.execute(new WaterStateCommand('Fill basin', before, after));
  }

  private end(): void {
    this.stroke?.finish();
    this.stroke = null;
  }
}

/** All water of a map: the main body and the further ones */
export interface WaterState {
  water: MapWater | null;
  bodies: MapWater[] | undefined;
}

export function waterState(t: MapTerrain): WaterState {
  return { water: t.water ? structuredClone(t.water) : null, bodies: t.waterBodies ? structuredClone(t.waterBodies) : undefined };
}

function setWaterState(t: MapTerrain, s: WaterState): void {
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

/** Changes all water in place and records it as one step */
function recordWater(editor: EditorDocument, label: string, edit: (t: MapTerrain) => void): EditCommand {
  const t = editor.doc.terrain;
  const before = waterState(t);
  edit(t);
  const after = waterState(t);
  setWaterState(t, before);
  return new WaterStateCommand(label, before, after);
}

export const waterCommands = {
  enable(editor: EditorDocument, level: number): EditCommand {
    return recordWater(editor, 'Add water', (t) => (t.water = emptyWater(t, level)));
  },
  remove(editor: EditorDocument, body = -1): EditCommand {
    return recordWater(editor, body < 0 ? 'Remove water' : 'Remove body', (t) => {
      if (body < 0) t.water = null;
      else t.waterBodies?.splice(body, 1);
    });
  },
  /** A new, empty body of a kind; its level comes with its first fill */
  addBody(editor: EditorDocument, kind: MapWaterKind, level: number): EditCommand {
    return recordWater(editor, kind === 'lava' ? 'Add lava' : kind === 'ice' ? 'Add ice' : 'Add lake', (t) => {
      const body: MapWater = { ...emptyWater(t, level), color: BODY_COLORS[kind], kind };
      t.waterBodies = [...(t.waterBodies ?? []), body];
    });
  },
  set(editor: EditorDocument, body: number, patch: Partial<Pick<MapWater, 'level' | 'color' | 'kind'>>, label: string): EditCommand {
    return recordWater(editor, label, (t) => {
      const w = waterBody(t, body);
      if (!w) return;
      const oldKind = w.kind ?? 'water';
      Object.assign(w, patch);
      // A body that kept its kind's colour takes the new kind's
      if (patch.kind && !patch.color && w.color === BODY_COLORS[oldKind]) w.color = BODY_COLORS[patch.kind];
    });
  },
  /** The body floods in from the map's edge over everything below its level: a sea or a coast */
  sea(editor: EditorDocument, body: number): EditCommand {
    return recordWater(editor, 'Sea from the edge', (t) => {
      if (body < 0 && !t.water) t.water = emptyWater(t, 0);
      fillFromEdge(t, body);
    });
  },
  clearMask(editor: EditorDocument, body: number): EditCommand {
    return recordWater(editor, 'Clear water', (t) => waterBody(t, body)?.mask.fill(0));
  },
};
