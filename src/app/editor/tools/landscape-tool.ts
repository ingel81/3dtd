/**
 * Landscape: paint a biome, grow landforms, erode, or draw a cliff, river
 * or road as a line. Every stroke has a seed (rolled anew after each stroke
 * unless the panel keeps it) and becomes one undo step. Under the cursor the
 * biome brush shows where it would grow plants.
 */
import type { MapPoint } from '../../world/custom-map/map-document';
import { finishBiome, biomeDab, previewSpots } from '../ops/landscape/biome-brush';
import { biomeById, type BiomeId } from '../ops/landscape/biomes';
import { cracksDab } from '../ops/landscape/cracks';
import { cliffModelsFor, cliffRocksDab } from '../ops/landscape/cliff-rocks';
import { erosionDab } from '../ops/landscape/erosion';
import { LandscapeNoise, randomSeed } from '../../map-ops/landscape-noise';
import { LandscapeContext } from '../ops/landscape/landscape-context';
import { MAX_LAYERS } from '../../map-ops/paint-ops';
import { carveRiver } from '../ops/landscape/river';
import { buildRoad } from '../ops/landscape/road';
import { cliffAlong, formDab } from '../ops/landscape/shapes';
import { symmetryImages } from '../ops/symmetry';
import {
  LANDSCAPE_MODES,
  patch,
  type EditorTool,
  type LandscapeMode,
  type ToolContext,
  type ToolPointer,
} from './tool';

/** A drawn line takes a point every this many metres */
const LINE_STEP = 3;

export class LandscapeTool implements EditorTool {
  readonly id = 'landscape' as const;
  private stroke: LandscapeContext | null = null;
  private line: MapPoint[] | null = null;
  private dab = 0;
  private previewNoise: LandscapeNoise | null = null;
  /** What the preview dots were last worked out for, and the spots (their objects kept from frame to frame) */
  private previewKey = '';
  private readonly previewAt: MapPoint[] = [];

  brushVisible(ctx: ToolContext): boolean {
    const mode = ctx.settings.landscape().mode;
    return mode !== 'river' && mode !== 'road';
  }

  deactivate(ctx: ToolContext): void {
    this.end(ctx);
  }

  pointerDown(p: ToolPointer, ctx: ToolContext): boolean {
    const s = ctx.settings.landscape();
    // A line may start off the map and come in; a brush needs ground under it
    if (p.button !== 0 || (!p.hit && !isLine(s.mode))) return false;
    const says = ctx.t().editor.landscape;
    this.stroke = new LandscapeContext(ctx.editor.begin(s.mode === 'biome' ? says.biomes[s.biome].label : says.modes[s.mode].label), s.seed, ctx.catalog);
    this.stroke.symmetry = ctx.settings.symmetry();
    this.stroke.heightsAdd = addsToGround(s.mode, s.biome);
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
    const s = ctx.settings.landscape();
    const brush = ctx.settings.brush();
    if (this.line) {
      ctx.overlay.draft.set(p?.hit ? [...this.line, p.hit] : this.line);
      return;
    }
    // Preview of the next biome stroke under the cursor
    if (s.mode === 'biome' && p?.hit && !this.stroke) {
      // Worked out again only when the spot (to half a metre), the brush, the biome, the seed, the catalogue or the
      // dots' size changed: every frame it made 10 to 17 MB of garbage in a second and a half
      const x = Math.round(p.hit.x * 2) / 2;
      const y = Math.round(p.hit.y * 2) / 2;
      const preview = ctx.overlay.preview;
      const key = `${x}|${y}|${brush.radius}|${brush.strength}|${brush.falloff}|${s.biome}|${s.seed}|${ctx.catalog.objects.size}|${preview.scale}`;
      if (key !== this.previewKey) {
        this.previewKey = key;
        if (this.previewNoise?.seed !== s.seed) this.previewNoise = new LandscapeNoise(s.seed);
        const biome = biomeById(s.biome);
        preview.set(previewSpots(this.previewNoise, ctx.catalog, { x, y }, brush, biome, undefined, this.previewAt), biome.color);
      }
    } else if (!this.stroke) {
      this.previewKey = '';
      ctx.overlay.preview.clear();
    }
    const stroke = this.stroke;
    if (!stroke || !p?.hit) return;
    const center = { x: p.hit.x, y: p.hit.y };
    switch (s.mode) {
      case 'biome':
        biomeDab(stroke, center, brush, biomeById(s.biome), dt);
        this.previewKey = '';
        ctx.overlay.preview.clear();
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
          ctx.status(ctx.t().editor.landscape.noCliffModels);
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
    const s = ctx.settings.landscape();
    const says = ctx.t().editor.landscape;
    const what = s.mode === 'biome' ? says.biomes[s.biome] : says.modes[s.mode];
    return says.hint(what.label, what.hint, s.seed);
  }

  /** Ends the stroke: lines are built now, biomes grow their rim plants; one undo step */
  private end(ctx: ToolContext): void {
    const stroke = this.stroke;
    const line = this.line;
    this.stroke = null;
    this.line = null;
    ctx.overlay.draft.clear();
    if (!stroke) return;
    const s = ctx.settings.landscape();
    const brush = ctx.settings.brush();
    if (line) {
      // Lines are built at every symmetric image; a mirrored line runs backwards so a cliff keeps its side
      const t = stroke.doc.terrain;
      const lines = symmetryImages(ctx.settings.symmetry(), t.grid.columns === t.grid.rows).map(
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
    const says = ctx.t().editor.landscape;
    const full = [...stroke.layersReused.map(says.layerUnused), ...stroke.layersShared.map(says.layerShared), ...stroke.layersFull.map(says.layerLeft)];
    if (full.length) ctx.status(says.layersFull(MAX_LAYERS, full.join('; ')));
    if (stroke.finish() && s.reroll) patch(ctx.settings.landscape, { seed: randomSeed() });
  }

  private buildLine(stroke: LandscapeContext, line: MapPoint[], ctx: ToolContext): void {
    const s = ctx.settings.landscape();
    const brush = ctx.settings.brush();
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
        if (!r) ctx.status(ctx.t().editor.landscape.longerRiver);
        else {
          const fall = Math.round(r.river.points[0].height - r.river.points[r.river.points.length - 1].height);
          ctx.status(ctx.t().editor.landscape.riverDone(r.river.kind === 'lava', fall, r.waterfalls, r.bridges));
        }
        break;
      }
      case 'road': {
        const r = buildRoad(stroke, line, s.road);
        if (!r) ctx.status(ctx.t().editor.landscape.longerRoad);
        else ctx.status(ctx.t().editor.landscape.roadDone(Math.round(r.length), r.lamps));
        break;
      }
    }
  }
}

function isLine(mode: LandscapeMode): boolean {
  return !!LANDSCAPE_MODES.find((m) => m.id === mode)?.line;
}

/**
 * Whether a stroke adds to the ground, so a symmetric image takes the same
 * change on its own ground: the forms that raise or carve (a mountain, a
 * crater, gullies) and a biome's rolling relief. A plateau, a cliff, rivers
 * and roads set heights, and so does a biome that flattens or sinks pools
 * under a water level: their images take the source's heights.
 */
export function addsToGround(mode: LandscapeMode, biome: BiomeId): boolean {
  if (mode === 'biome') {
    const def = biomeById(biome);
    return def.relief.kind !== 'flatten' && !def.pools;
  }
  return mode === 'mountain' || mode === 'valley' || mode === 'crater' || mode === 'dunes' || mode === 'cracks' || mode === 'erode';
}
