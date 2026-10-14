/**
 * Landscape: paint a biome, grow landforms, erode, or draw a cliff, river
 * or road as a line. Every stroke has a seed (rolled anew after each stroke
 * unless the panel keeps it) and becomes one undo step. Under the cursor the
 * biome brush shows where it would grow plants.
 */
import type { MapPoint } from '../../world/custom-map/map-document';
import { finishBiome, biomeDab, previewSpots } from '../ops/landscape/biome-brush';
import { biomeById } from '../ops/landscape/biomes';
import { cracksDab } from '../ops/landscape/cracks';
import { cliffModelsFor, cliffRocksDab } from '../ops/landscape/cliff-rocks';
import { erosionDab } from '../ops/landscape/erosion';
import { LandscapeNoise, randomSeed } from '../ops/landscape/landscape-noise';
import { LandscapeStroke } from '../ops/landscape/landscape-stroke';
import { MAX_LAYERS } from '../ops/paint-ops';
import { carveRiver } from '../ops/landscape/river';
import { buildRoad } from '../ops/landscape/road';
import { cliffAlong, formDab } from '../ops/landscape/shapes';
import { symmetryImages } from '../ops/symmetry';
import {
  LANDSCAPE_MODES,
  type EditorTool,
  type LandscapeMode,
  type ToolContext,
  type ToolPointer,
} from './tool';

/** A drawn line takes a point every this many metres */
const LINE_STEP = 3;

export class LandscapeTool implements EditorTool {
  readonly id = 'landscape' as const;
  private stroke: LandscapeStroke | null = null;
  private line: MapPoint[] | null = null;
  private dab = 0;
  private previewNoise: LandscapeNoise | null = null;

  brushVisible(ctx: ToolContext): boolean {
    const mode = ctx.settings.landscape.mode;
    return mode !== 'river' && mode !== 'road';
  }

  deactivate(ctx: ToolContext): void {
    this.end(ctx);
    ctx.overlay.setPreview(null);
    ctx.overlay.setDraft(null);
  }

  pointerDown(p: ToolPointer, ctx: ToolContext): boolean {
    const s = ctx.settings.landscape;
    // A line may start off the map and come in; a brush needs ground under it
    if (p.button !== 0 || (!p.hit && !isLine(s.mode))) return false;
    const label = LANDSCAPE_MODES.find((m) => m.id === s.mode)!.label;
    this.stroke = new LandscapeStroke(
      ctx.editor,
      s.mode === 'biome' ? biomeById(s.biome).label : label,
      s.seed,
      ctx.catalog,
    );
    this.stroke.symmetry = ctx.settings.symmetry;
    this.dab = 0;
    if (isLine(s.mode)) this.line = p.hit ? [{ x: p.hit.x, y: p.hit.y }] : [];
    return true;
  }

  pointerMove(p: ToolPointer): void {
    const line = this.line;
    if (!line || !p.hit) return;
    const last = line[line.length - 1];
    if (!last || Math.hypot(p.hit.x - last.x, p.hit.y - last.y) >= LINE_STEP)
      line.push({ x: p.hit.x, y: p.hit.y });
  }

  pointerUp(p: ToolPointer, ctx: ToolContext): void {
    if (this.line && p.hit) this.pointerMove(p);
    this.end(ctx);
  }

  frame(dt: number, p: ToolPointer | null, ctx: ToolContext): void {
    const s = ctx.settings.landscape;
    const brush = ctx.settings.brush;
    if (this.line) {
      ctx.overlay.setDraft(p?.hit ? [...this.line, p.hit] : this.line);
      return;
    }
    // Preview of the next biome stroke under the cursor
    if (s.mode === 'biome' && p?.hit && !this.stroke) {
      if (this.previewNoise?.seed !== s.seed) this.previewNoise = new LandscapeNoise(s.seed);
      ctx.overlay.setPreview(
        previewSpots(this.previewNoise, ctx.catalog, p.hit, brush, biomeById(s.biome)),
        biomeById(s.biome).color,
      );
    } else if (!this.stroke) {
      ctx.overlay.setPreview(null);
    }
    const stroke = this.stroke;
    if (!stroke || !p?.hit) return;
    const center = { x: p.hit.x, y: p.hit.y };
    switch (s.mode) {
      case 'biome':
        biomeDab(stroke, center, brush, biomeById(s.biome), dt);
        ctx.overlay.setPreview(null);
        return;
      case 'mountain':
      case 'valley':
      case 'plateau':
      case 'crater':
      case 'dunes':
        stroke.changed({ heights: formDab(stroke, s.mode, center, brush, dt) }, center);
        return;
      case 'cracks': {
        const r = cracksDab(stroke, center, brush, dt);
        stroke.changed({ heights: r.heights, splat: r.splat ?? undefined }, center);
        return;
      }
      case 'erode':
        stroke.changed({ heights: erosionDab(stroke, center, brush, this.dab++) }, center);
        return;
      case 'cliffRocks': {
        const models = cliffModelsFor(stroke.doc.environment.biome, s.cliffModel, ctx.catalog);
        if (!models.length) {
          ctx.status('The catalogue has no cliff models');
          return;
        }
        const ids = cliffRocksDab(stroke, center, brush, models, ctx.catalog);
        if (ids.length) stroke.changed({ objects: ids });
        return;
      }
    }
  }

  cancel(ctx: ToolContext): boolean {
    const busy = !!this.stroke || !!this.line;
    this.end(ctx);
    return busy;
  }

  hint(ctx: ToolContext): string {
    const s = ctx.settings.landscape;
    const mode = LANDSCAPE_MODES.find((m) => m.id === s.mode)!;
    const what =
      s.mode === 'biome'
        ? `${biomeById(s.biome).label}: ${biomeById(s.biome).hint}`
        : `${mode.label}: ${mode.hint}`;
    return `${what} | [ ] size | seed ${s.seed}`;
  }

  /** Ends the stroke: lines are built now, biomes grow their rim plants; one undo step */
  private end(ctx: ToolContext): void {
    const stroke = this.stroke;
    const line = this.line;
    this.stroke = null;
    this.line = null;
    ctx.overlay.setDraft(null);
    if (!stroke) return;
    const s = ctx.settings.landscape;
    const brush = ctx.settings.brush;
    if (line) {
      // Lines are built at every symmetric image; a mirrored line runs backwards so a cliff keeps its side
      const t = stroke.doc.terrain;
      const lines = symmetryImages(ctx.settings.symmetry, t.grid.columns === t.grid.rows).map(
        (img) => {
          const mapped = line.map((q) => img.point(q));
          return img.flips ? mapped.reverse() : mapped;
        },
      );
      stroke.symmetry = 'none';
      for (const l of lines) this.buildLine(stroke, l, ctx);
    } else if (s.mode === 'biome') {
      finishBiome(stroke, brush, biomeById(s.biome));
    }
    if (stroke.layersFull.length) {
      ctx.status(`The map has ${MAX_LAYERS} ground layers: ${stroke.layersFull.join(', ')} left out. Remove a layer in Paint to make room`);
    }
    if (stroke.finish() && s.reroll) {
      s.seed = randomSeed();
      ctx.settingsChanged();
    }
  }

  private buildLine(stroke: LandscapeStroke, line: MapPoint[], ctx: ToolContext): void {
    const s = ctx.settings.landscape;
    const brush = ctx.settings.brush;
    switch (s.mode) {
      case 'cliff': {
        const rect = cliffAlong(
          stroke,
          line,
          s.cliffHeight * (0.4 + 0.6 * brush.strength),
          brush.radius,
        );
        if (rect) stroke.changed({ heights: rect });
        break;
      }
      case 'river': {
        const r = carveRiver(stroke, line, s.river);
        if (!r) ctx.status('Draw a longer line for a river');
        else {
          const extras = [
            r.waterfalls ? `${r.waterfalls} ${r.waterfalls === 1 ? 'waterfall' : 'waterfalls'}` : '',
            r.bridges ? `${r.bridges} ${r.bridges === 1 ? 'bridge' : 'bridges'}` : '',
          ].filter((e) => e);
          const fall = Math.round(r.river.points[0].height - r.river.points[r.river.points.length - 1].height);
          ctx.status(`${r.river.kind === 'lava' ? 'Lava flow' : 'River'} falling ${fall} m${extras.length ? `, ${extras.join(', ')}` : ''}`);
        }
        break;
      }
      case 'road': {
        const r = buildRoad(stroke, line, s.road);
        if (!r) ctx.status('Draw a longer line for a road');
        else ctx.status(`Road of ${Math.round(r.length)} m${r.lamps ? `, ${r.lamps} lamps` : ''}`);
        break;
      }
    }
  }
}

function isLine(mode: LandscapeMode): boolean {
  return !!LANDSCAPE_MODES.find((m) => m.id === mode)?.line;
}
