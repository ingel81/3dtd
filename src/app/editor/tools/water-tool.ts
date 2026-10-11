/**
 * Water: click into a hollow to fill it up to the water level, or paint the
 * mask by hand (Shift erases). The level, colour and "no water" live in the
 * panel (`waterCommands`).
 */
import type { CustomMapDocument, MapWater } from '../../world/custom-map/map-document';
import type { DocChange, EditCommand, EditorDocument } from '../model/editor-document';
import { nearestSample, sampleRectAround } from '../model/grid';
import { emptyWater, fillBasin, waterMaskDab } from '../ops/water-ops';
import { BrushStroke } from './brush-stroke';
import type { EditorTool, ToolContext, ToolPointer } from './tool';

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
    if (!editor.doc.terrain.water) {
      editor.execute(waterCommands.enable(editor, Math.round(p.hit.z * 10) / 10));
    }
    const mode = ctx.settings.water.mode;
    if (mode === 'fill' && !p.shift) {
      const t = editor.doc.terrain;
      const { i, j } = nearestSample(t, p.hit.x, p.hit.y);
      const stroke = new BrushStroke(editor, 'Fill basin', ['water']);
      stroke.touch('water', { i0: 0, j0: 0, i1: t.grid.columns - 1, j1: t.grid.rows - 1 });
      const rect = fillBasin(t, i, j);
      if (!rect) {
        ctx.status(`The ground here lies above the water level (${t.water!.level} m)`);
        return true;
      }
      stroke.changed({ water: true });
      stroke.finish();
      return true;
    }
    this.on = mode === 'paint' ? !p.shift : mode === 'fill' ? false : p.shift;
    this.stroke = new BrushStroke(editor, this.on ? 'Paint water' : 'Erase water', ['water']);
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
    waterMaskDab(t, p.hit.x, p.hit.y, ctx.settings.brush, this.on);
    stroke.changed({ water: true });
  }



  hint(ctx: ToolContext): string {
    const level = ctx.editor.doc.terrain.water?.level;
    const at = level === undefined ? 'the clicked height' : `${level} m`;
    switch (ctx.settings.water.mode) {
      case 'fill':
        return `Click a hollow to fill it with water up to ${at}; Shift click erases there`;
      case 'paint':
        return 'Hold to paint water, Shift erases | [ ] size';
      case 'erase':
        return 'Hold to erase water, Shift paints | [ ] size';
    }
  }

  private end(): void {
    this.stroke?.finish();
    this.stroke = null;
  }
}

/** Swaps the whole water record (level, colour, mask); small next to the map */
class WaterCommand implements EditCommand {
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

export const waterCommands = {
  enable(editor: EditorDocument, level: number): EditCommand {
    return new WaterCommand('Add water', null, emptyWater(editor.doc.terrain, level));
  },
  remove(editor: EditorDocument): EditCommand {
    return new WaterCommand('Remove water', structuredClone(editor.doc.terrain.water), null);
  },
  setLevel(editor: EditorDocument, level: number): EditCommand {
    const before = editor.doc.terrain.water ?? emptyWater(editor.doc.terrain, level);
    return new WaterCommand('Water level', structuredClone(editor.doc.terrain.water), { ...structuredClone(before), level });
  },
  setColor(editor: EditorDocument, color: string): EditCommand {
    const w = editor.doc.terrain.water;
    return new WaterCommand('Water colour', structuredClone(w), w ? { ...structuredClone(w), color } : null);
  },
};
