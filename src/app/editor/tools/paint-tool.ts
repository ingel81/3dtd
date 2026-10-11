/**
 * Paint: hold the left button to lay the chosen ground layer; Shift (or the
 * erase switch) takes it away. The layer list and auto paint live in the
 * panel, which runs them as commands (`paintCommands`).
 */
import type { MapGroundLayer } from '../../world/custom-map/map-document';
import { SnapshotCommand, type EditCommand, type EditorDocument } from '../model/editor-document';
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
    this.stroke = new BrushStroke(ctx.editor, this.erase ? 'Erase paint' : 'Paint', ['splat0', 'splat1']);
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
    stroke.touch('splat0', rect);
    stroke.touch('splat1', rect);
    paintDab(t, p.hit.x, p.hit.y, brush, layer, PAINT_RATE * Math.min(dt, 0.1), this.erase);
    stroke.changed({ splat: rect });
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

/** Layer list and auto paint as undoable steps; they rewrite the splat maps, so they keep the terrain whole */
export const paintCommands = {
  addLayer(editor: EditorDocument, material: string): EditCommand {
    return SnapshotCommand.record(editor.doc, 'Add layer', ['terrain'], (d) => {
      d.terrain.layers.push({ material } satisfies MapGroundLayer);
    });
  },
  setMaterial(editor: EditorDocument, index: number, material: string): EditCommand {
    return SnapshotCommand.record(editor.doc, 'Change material', ['terrain'], (d) => {
      d.terrain.layers[index] = { ...d.terrain.layers[index], material };
    });
  },
  setScale(editor: EditorDocument, index: number, scale: number | undefined): EditCommand {
    return SnapshotCommand.record(editor.doc, 'Texture size', ['terrain'], (d) => {
      const layer = { ...d.terrain.layers[index] };
      if (scale && scale > 0) layer.scale = scale;
      else delete layer.scale;
      d.terrain.layers[index] = layer;
    });
  },
  removeLayer(editor: EditorDocument, index: number): EditCommand {
    return SnapshotCommand.record(editor.doc, 'Remove layer', ['terrain'], (d) => removeLayer(d.terrain, index));
  },
  moveLayer(editor: EditorDocument, from: number, to: number): EditCommand {
    return SnapshotCommand.record(editor.doc, 'Move layer', ['terrain'], (d) => moveLayer(d.terrain, from, to));
  },
  autoPaint(editor: EditorDocument, rules?: AutoPaintRule[]): EditCommand {
    return SnapshotCommand.record(editor.doc, 'Auto paint', ['terrain'], (d) => {
      autoPaint(d.terrain, rules ?? defaultAutoRules(d.terrain));
    });
  },
  setCliff(editor: EditorDocument, material: string, angle: number): EditCommand {
    return SnapshotCommand.record(editor.doc, 'Cliff material', ['terrain'], (d) => {
      d.terrain.cliffMaterial = material;
      d.terrain.cliffAngle = angle;
    });
  },
};
