/**
 * Water: click into a hollow to fill it up to the water level, or paint the
 * mask by hand (Shift erases). The level, colour and "no water" live in the
 * panel (`waterCommands`).
 */
import type { MapWaterKind } from '../../world/custom-map/map-document';
import type { EditCommand, EditorDocument } from '../model/editor-document';
import { WaterSwapCommand } from '../model/terrain-commands';
import { nearestSample, sampleRectAround } from '../model/grid';
import { basinSpillHeight, emptyWater, fillBasin, waterMaskDab } from '../ops/water-ops';
import { symmetryImages } from '../ops/symmetry';
import { BrushStroke } from './brush-stroke';
import type { EditorTool, ToolContext, ToolPointer } from './tool';

/** Metres the water stays below a hollow's rim */
const RIM_MARGIN = 0.3;

export class WaterTool implements EditorTool {
  readonly id = 'water' as const;
  brushVisible(ctx: ToolContext): boolean {
    return ctx.settings.water.mode !== 'fill';
  }
  private stroke: BrushStroke | null = null;
  private on = true;


  deactivate(): void {
    this.end();
  }

  pointerDown(p: ToolPointer, ctx: ToolContext): boolean {
    if (p.button !== 0 || !p.hit) return false;
    const editor = ctx.editor;
    const mode = ctx.settings.water.mode;
    if (mode === 'fill' && !p.shift) {
      this.fill(p, ctx);
      return true;
    }
    if (!editor.doc.terrain.water) {
      editor.execute(waterCommands.enable(editor, Math.round(p.hit.z * 10) / 10));
    }
    this.on = mode === 'paint' ? !p.shift : mode === 'fill' ? false : p.shift;
    this.stroke = new BrushStroke(editor, this.on ? 'Paint water' : 'Erase water', ['water'], ctx.settings.symmetry);
    return true;
  }


  pointerUp(): void {
    this.end();
  }

  frame(_dt: number, p: ToolPointer | null, ctx: ToolContext): void {
    const stroke = this.stroke;
    if (!stroke || !p?.hit) return;
    const t = stroke.doc.terrain;
    stroke.touch('water', sampleRectAround(t, p.hit.x, p.hit.y, ctx.settings.brush.radius));
    const rect = waterMaskDab(t, p.hit.x, p.hit.y, ctx.settings.brush, this.on);
    stroke.changed({ water: true }, p.hit, rect);
  }



  hint(ctx: ToolContext): string {
    const level = ctx.editor.doc.terrain.water?.level;
    const at = level === undefined ? 'the clicked height' : `${level} m`;
    switch (ctx.settings.water.mode) {
      case 'fill':
        return level === undefined
          ? 'Click a hollow to fill it with water up to its rim'
          : `Click a hollow to fill it with water up to ${at} | Ctrl click fills to the rim | Shift erases`;
      case 'paint':
        return 'Hold to paint water, Shift erases | [ ] size';
      case 'erase':
        return 'Hold to erase water, Shift paints | [ ] size';
    }
  }

  /**
   * Fill the hollow under the pointer. Without water yet (or with Ctrl) the
   * level becomes the hollow's rim, a little below where it would spill.
   */
  private fill(p: ToolPointer, ctx: ToolContext): void {
    const editor = ctx.editor;
    const t = editor.doc.terrain;
    const { i, j } = nearestSample(t, p.hit!.x, p.hit!.y);
    const before = t.water ? structuredClone(t.water) : null;
    const water = t.water ? structuredClone(t.water) : emptyWater(t, 0);
    if (!before || p.ctrl) {
      const rim = basinSpillHeight(t, i, j);
      water.level = Math.round((rim - RIM_MARGIN) * 10) / 10;
    }
    t.water = water;
    const rect = fillBasin(t, i, j);
    if (rect) {
      // The images of the hollow fill too
      const g = t.grid;
      for (const img of symmetryImages(ctx.settings.symmetry, g.columns === g.rows).slice(1)) {
        const [ii, jj] = img.cell(i, j, g.columns, g.rows);
        fillBasin(t, ii, jj);
      }
    }
    const after = t.water;
    t.water = before;
    if (!rect) {
      ctx.status(before && !p.ctrl
        ? `The ground here lies above the water level (${before.level} m); Ctrl click fills to the rim`
        : 'This spot is no hollow: water would run off');
      return;
    }
    editor.execute(new WaterSwapCommand(before ? 'Fill basin' : 'Add water', before, after));
  }

  private end(): void {
    this.stroke?.finish();
    this.stroke = null;
  }
}

export const waterCommands = {
  enable(editor: EditorDocument, level: number): EditCommand {
    return new WaterSwapCommand('Add water', null, emptyWater(editor.doc.terrain, level));
  },
  remove(editor: EditorDocument): EditCommand {
    return new WaterSwapCommand('Remove water', structuredClone(editor.doc.terrain.water), null);
  },
  setLevel(editor: EditorDocument, level: number): EditCommand {
    const before = editor.doc.terrain.water ?? emptyWater(editor.doc.terrain, level);
    return new WaterSwapCommand('Water level', structuredClone(editor.doc.terrain.water), { ...structuredClone(before), level });
  },
  setKind(editor: EditorDocument, kind: MapWaterKind): EditCommand {
    const w = editor.doc.terrain.water;
    return new WaterSwapCommand(kind === 'lava' ? 'Lava' : kind === 'ice' ? 'Ice' : 'Water', structuredClone(w), w ? { ...structuredClone(w), kind } : null);
  },
  setColor(editor: EditorDocument, color: string): EditCommand {
    const w = editor.doc.terrain.water;
    return new WaterSwapCommand('Water colour', structuredClone(w), w ? { ...structuredClone(w), color } : null);
  },
};
