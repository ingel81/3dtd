/**
 * Terrain: hold the left button to work the ground under the brush. Shift
 * turns raise into lower (and back) and a cliff one level down; Ctrl click
 * picks the height under the pointer for Level. Ramp takes two clicks.
 */
import { sampleRectAround, type GridRect } from '../model/grid';
import {
  erodeDab,
  flattenDab,
  noiseDab,
  plateauDab,
  raiseDab,
  rampBetween,
  smoothDab,
  terraceDab,
  type RampEnd,
} from '../ops/terrain-ops';
import { symmetryImages } from '../ops/symmetry';
import { BrushStroke } from './brush-stroke';
import { TERRAIN_MODES, type EditorTool, type ToolContext, type ToolPointer } from './tool';

/** Metres per second at full strength */
const RAISE_SPEED = 12;
const NOISE_SPEED = 4;
/** Share per second the pull brushes close toward their target */
const PULL_RATE = 5;

export class TerrainTool implements EditorTool {
  readonly id = 'terrain' as const;
  brushVisible(ctx: ToolContext): boolean {
    return ctx.settings.terrain.mode !== 'ramp';
  }
  private stroke: BrushStroke | null = null;
  private invert = false;
  private target = 0;
  private seed = 1;
  private rampStart: RampEnd | null = null;


  deactivate(ctx: ToolContext): void {
    this.end();
    this.cancel(ctx);
  }

  pointerDown(p: ToolPointer, ctx: ToolContext): boolean {
    if (p.button !== 0 || !p.hit) return false;
    const s = ctx.settings.terrain;
    if (p.ctrl && (s.mode === 'level' || s.mode === 'flatten' || s.mode === 'terrace')) {
      s.level = Math.round(p.hit.z * 10) / 10;
      ctx.settingsChanged();
      ctx.status(`Height ${s.level} m picked`);
      return true;
    }
    if (s.mode === 'ramp') {
      this.rampClick(p, ctx);
      return true;
    }
    const mode = TERRAIN_MODES.find((m) => m.id === s.mode)!;
    this.stroke = new BrushStroke(ctx.editor, mode.label, ['heights'], ctx.settings.symmetry);
    this.invert = p.shift;
    this.seed = Math.floor(Math.random() * 1e6);
    if (s.mode === 'flatten') this.target = p.hit.z;
    else if (s.mode === 'level') this.target = s.level;
    else if (s.mode === 'plateau') {
      const step = Math.max(0.5, s.step);
      const base = Math.round(p.hit.z / step) * step;
      this.target = base + (p.shift ? -step : step);
    }
    return true;
  }


  pointerUp(): void {
    this.end();
  }

  frame(dt: number, p: ToolPointer | null, ctx: ToolContext): void {
    const s = ctx.settings;
    if (s.terrain.mode === 'ramp') {
      ctx.overlay.setDraft(this.rampStart && p?.hit ? [this.rampStart, p.hit] : null);
    }
    const stroke = this.stroke;
    if (!stroke || !p?.hit) return;
    const t = stroke.doc.terrain;
    const { x, y } = p.hit;
    const brush = s.brush;
    const step = Math.min(dt, 0.1);
    stroke.touch('heights', sampleRectAround(t, x, y, brush.radius + t.grid.cellSize));
    let rect: GridRect;
    const pull = 1 - Math.exp(-PULL_RATE * step);
    switch (s.terrain.mode) {
      case 'raise':
        rect = raiseDab(t, x, y, brush, (this.invert ? -1 : 1) * RAISE_SPEED * step);
        break;
      case 'lower':
        rect = raiseDab(t, x, y, brush, (this.invert ? 1 : -1) * RAISE_SPEED * step);
        break;
      case 'smooth':
        rect = smoothDab(t, x, y, brush, pull * 2);
        break;
      case 'flatten':
      case 'level':
        rect = flattenDab(t, x, y, brush, this.target, pull);
        break;
      case 'noise':
        rect = noiseDab(t, x, y, brush, NOISE_SPEED * step, this.seed);
        break;
      case 'erode':
        rect = erodeDab(t, x, y, brush, 2);
        break;
      case 'terrace':
        rect = terraceDab(t, x, y, brush, s.terrain.step, pull, s.terrain.level);
        break;
      case 'plateau':
        rect = plateauDab(t, x, y, brush, this.target, pull * 1.5);
        break;
      default:
        return;
    }
    stroke.changed({ heights: rect }, { x, y });
  }


  cancel(ctx: ToolContext): boolean {
    const busy = !!this.rampStart;
    this.rampStart = null;
    ctx.overlay.setDraft(null);
    return busy;
  }

  hint(ctx: ToolContext): string {
    const mode = TERRAIN_MODES.find((m) => m.id === ctx.settings.terrain.mode)!;
    if (mode.id === 'ramp' && this.rampStart) return 'Click where the ramp ends | Esc cancels';
    return `${mode.label}: ${mode.hint} | [ ] size`;
  }

  private rampClick(p: ToolPointer, ctx: ToolContext): void {
    const hit = p.hit!;
    if (!this.rampStart) {
      this.rampStart = { x: hit.x, y: hit.y, h: hit.z };
      ctx.status('Ramp start set');
      return;
    }
    const a = this.rampStart;
    const b = { x: hit.x, y: hit.y, h: hit.z };
    this.rampStart = null;
    ctx.overlay.setDraft(null);
    const stroke = new BrushStroke(ctx.editor, 'Ramp', ['heights']);
    const t = stroke.doc.terrain;
    // A symmetric map gets the ramp at every image, each built from its own ends
    for (const img of symmetryImages(ctx.settings.symmetry, t.grid.columns === t.grid.rows)) {
      const ia = { ...img.point(a), h: a.h };
      const ib = { ...img.point(b), h: b.h };
      const rect = rampBetween(t, ia, ib, ctx.settings.terrain.rampWidth, ctx.settings.brush.falloff, (r) => stroke.touch('heights', r));
      if (rect) stroke.changed({ heights: rect });
    }
    stroke.finish();
  }

  private end(): void {
    this.stroke?.finish();
    this.stroke = null;
  }
}
