/**
 * Paint: hold the left button to lay the chosen ground layer; Shift (or the
 * erase switch) takes it away. The layer list and auto paint live in the
 * panel, which runs them as commands (`paintCommands`).
 */
import { splatTargets } from '../model/commands/patch';
import { texelRectAround } from '../../map-ops/grid';
import { paintDab } from '../../map-ops/paint-ops';
import { mirrorDab, type SymmetryMode } from '../ops/symmetry';
import type { EditTransaction } from '../model/edit-transaction';
import type { EditorTool, ToolContext, ToolPointer } from './tool';

/** Share of full weight per second at full strength */
const PAINT_RATE = 3;

export class PaintTool implements EditorTool {
  readonly id = 'paint' as const;
  brushVisible(): boolean {
    return true;
  }
  private stroke: EditTransaction | null = null;
  private symmetry: SymmetryMode = 'none';
  private erase = false;


  deactivate(): void {
    this.end();
  }

  pointerDown(p: ToolPointer, ctx: ToolContext): boolean {
    if (p.button !== 0 || !p.hit) return false;
    this.erase = ctx.settings.paint().erase !== p.shift;
    this.stroke = ctx.editor.begin(this.erase ? 'Erase paint' : 'Paint');
    for (const target of splatTargets(ctx.editor.doc)) this.stroke.record(target);
    this.symmetry = ctx.settings.symmetry();
    return true;
  }


  pointerUp(): void {
    this.end();
  }

  frame(dt: number, p: ToolPointer | null, ctx: ToolContext): void {
    const stroke = this.stroke;
    if (!stroke || !p?.hit) return;
    const t = stroke.doc.terrain;
    const brush = ctx.settings.brush();
    const layer = Math.min(ctx.settings.paint().layer, t.layers.length - 1);
    const rect = texelRectAround(t, p.hit.x, p.hit.y, brush.radius);
    stroke.touchSplat(rect);
    paintDab(t, p.hit.x, p.hit.y, brush, layer, PAINT_RATE * Math.min(dt, 0.1), this.erase);
    stroke.changed(mirrorDab(stroke, this.symmetry, p.hit, { splat: rect }));
  }



  hint(ctx: ToolContext): string {
    const t = ctx.editor.doc.terrain;
    const layer = t.layers[Math.min(ctx.settings.paint().layer, t.layers.length - 1)];
    const name = layer ? ctx.catalog.material(layer.material).name : '';
    return `Paint ${name}: hold to paint, Shift erases | [ ] size`;
  }

  private end(): void {
    this.stroke?.commit();
    this.stroke = null;
  }
}
