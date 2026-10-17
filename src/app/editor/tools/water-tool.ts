/**
 * Water and lava: the map's main water and its further bodies (lakes up a
 * hill, lava pools, frozen ponds), each with its own level. The tool works
 * on the body chosen in the panel: Fill floods a hollow up to the body's
 * level (a new body takes the hollow's rim as its level), Pour pours water
 * or lava that fills the hollow, spills over and fills each hollow on its
 * way down as new bodies (ops/pour.ts), Lake digs a bed
 * under the brush and fills it, Paint and Erase draw the mask by hand
 * (Shift reverses). Sea floods the body in from the map's edge. The body
 * list, kinds, levels and colours live in the panel (`waterCommands`).
 */
import type { MapRiver } from '../../world/custom-map/map-document';
import type { DocChange } from '../model/doc-change';
import type { PatchTarget } from '../model/commands/patch';
import { nearestSample, sampleRectAround, type GridRect } from '../../map-ops/grid';
import { addPouredBodies, basinBrim, emptyWater, fillBasin, hollowFloor, lakeDab, waterBody, waterMaskDab, wetSamples } from '../../map-ops/water-ops';
import { pourOffThread, POUR_MAX_LAKES } from '../ops/pour';
import { MAX_WATER_BODIES } from '../../world/custom-map/map-file';
import { insertPoint, movePoint, nearestRiverPoint, nearestRiverSegment, removePoint } from '../ops/river-edit';
import { mirrorDab, symmetryImages, type SymmetryMode } from '../ops/symmetry';
import { relayRiver, removeWholeRiver, waterCommands } from '../ops/water-commands';
import type { EditTransaction } from '../model/edit-transaction';
import type { EditorTool, ToolContext, ToolPointer } from './tool';

export { BODY_COLORS } from '../../map-ops/water-ops';

/** Metres a fill may stay below the hollow's rim before the status line says so */
const LOW_FILL = 1;
/** Share per second a lake bed sinks toward its depth at full strength */
const DIG_RATE = 3;


/** The patch target of a body's mask */
function maskTarget(body: number): PatchTarget {
  return body < 0 ? 'water' : `body${body}`;
}

export class WaterTool implements EditorTool {
  readonly id = 'water' as const;
  private stroke: EditTransaction | null = null;
  private symmetry: SymmetryMode = 'none';
  /** A river point being dragged and the rivers before */
  private riverDrag: { river: number; point: number; before: MapRiver[] | undefined } | null = null;
  private on = true;
  /** A pour running in its worker */
  private pouring = false;

  brushVisible(ctx: ToolContext): boolean {
    const mode = ctx.settings.water.mode;
    return mode !== 'fill' && mode !== 'pour' && mode !== 'river';
  }

  frame(dt: number, p: ToolPointer | null, ctx: ToolContext): void {
    const s = ctx.settings.water;
    ctx.overlay.setRiverHandles(s.mode === 'river' ? (ctx.editor.doc.terrain.rivers ?? []) : null, s.river >= 0 ? { river: s.river, point: s.riverPoint } : null);
    this.brushFrame(dt, p, ctx);
  }

  deactivate(ctx: ToolContext): void {
    this.end();
    ctx.overlay.setRiverHandles(null, null);
  }

  pointerDown(p: ToolPointer, ctx: ToolContext): boolean {
    if (p.button !== 0 || !p.hit) return false;
    const editor = ctx.editor;
    const s = ctx.settings.water;
    if (s.mode === 'river') {
      this.riverDown(p, ctx);
      return true;
    }
    if (s.mode === 'fill' && !p.shift) {
      this.fill(p, ctx);
      return true;
    }
    if (s.mode === 'pour') {
      this.pour(p, ctx);
      return true;
    }
    // A body to work on: the main water appears at the clicked height when there is none
    if (!waterBody(editor.doc.terrain, s.body)) {
      if (s.body >= 0) {
        ctx.status('Choose a body in the panel first');
        return true;
      }
      waterCommands.enable(editor, Math.round((p.hit.z - (s.mode === 'lake' ? 0 : 0.2)) * 10) / 10);
    }
    this.on = s.mode === 'erase' ? p.shift : !p.shift;
    const targets: PatchTarget[] = [maskTarget(s.body)];
    if (s.mode === 'lake') targets.push('heights');
    const label = s.mode === 'lake' ? 'Dig lake' : this.on ? 'Paint water' : 'Erase water';
    this.stroke = editor.begin(label);
    for (const target of targets) this.stroke.record(target);
    this.symmetry = ctx.settings.symmetry;
    return true;
  }

  pointerMove(p: ToolPointer, ctx: ToolContext): void {
    const drag = this.riverDrag;
    if (!drag || !p.hit) return;
    const river = ctx.editor.doc.terrain.rivers?.[drag.river];
    if (!river) return;
    movePoint(river, drag.point, p.hit);
    ctx.editor.emit({ water: true });
  }

  pointerUp(_p: ToolPointer, ctx: ToolContext): void {
    this.end();
    if (this.riverDrag) {
      const { before, river } = this.riverDrag;
      this.riverDrag = null;
      const after = ctx.editor.doc.terrain.rivers;
      if (JSON.stringify(before) !== JSON.stringify(after)) relayRiver(ctx.editor, ctx.catalog, 'Move river point', river, before);
    }
  }

  key(e: KeyboardEvent, ctx: ToolContext): boolean {
    const s = ctx.settings.water;
    if (s.mode !== 'river' || (e.key !== 'Delete' && e.key !== 'Backspace') || s.river < 0) return false;
    const editor = ctx.editor;
    const river = editor.doc.terrain.rivers?.[s.river];
    if (s.riverPoint >= 0 && river && river.points.length > 2) {
      const before = structuredClone(editor.doc.terrain.rivers);
      removePoint(river, s.riverPoint);
      relayRiver(editor, ctx.catalog, 'Remove river point', s.river, before);
    } else {
      removeWholeRiver(editor, s.river, ctx.catalog);
    }
    s.riverPoint = -1;
    if (!editor.doc.terrain.rivers?.[s.river]) s.river = -1;
    ctx.settingsChanged();
    return true;
  }

  /** Choose a point (drag moves it), Shift on the river puts a new point there, a click elsewhere lets go */
  private riverDown(p: ToolPointer, ctx: ToolContext): void {
    const s = ctx.settings.water;
    const editor = ctx.editor;
    const rivers = editor.doc.terrain.rivers ?? [];
    const before = structuredClone(editor.doc.terrain.rivers);
    if (p.shift) {
      const at = nearestRiverSegment(rivers, p.hit!);
      if (at) {
        const index = insertPoint(rivers[at.river], at.segment, at.t);
        s.river = at.river;
        s.riverPoint = index;
        ctx.settingsChanged();
        editor.emit({ water: true });
        this.riverDrag = { river: at.river, point: index, before };
        return;
      }
    }
    const ref = nearestRiverPoint(rivers, p.hit!, ctx.metresPerPixel(p.hit!) * 12);
    if (ref) {
      s.river = ref.river;
      s.riverPoint = ref.point;
      this.riverDrag = { ...ref, before };
    } else {
      const on = nearestRiverSegment(rivers, p.hit!);
      s.river = on ? on.river : -1;
      s.riverPoint = -1;
    }
    ctx.settingsChanged();
  }

  private brushFrame(dt: number, p: ToolPointer | null, ctx: ToolContext): void {
    const stroke = this.stroke;
    if (!stroke || !p?.hit) return;
    const s = ctx.settings.water;
    const t = stroke.doc.terrain;
    const rect = sampleRectAround(t, p.hit.x, p.hit.y, ctx.settings.brush.radius);
    stroke.touch(maskTarget(s.body), rect);
    if (s.mode === 'lake' && this.on) {
      stroke.touch('heights', rect);
      lakeDab(t, p.hit.x, p.hit.y, ctx.settings.brush, s.depth, DIG_RATE * Math.min(dt, 0.1), s.body);
      stroke.changed(mirrorDab(stroke, this.symmetry, p.hit, { ...waterChange(s.body, rect, ctx), heights: rect }, { waterRect: rect }));
      return;
    }
    waterMaskDab(t, p.hit.x, p.hit.y, ctx.settings.brush, this.on, s.body);
    stroke.changed(mirrorDab(stroke, this.symmetry, p.hit, waterChange(s.body, rect, ctx), { waterRect: rect }));
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
      case 'pour':
        return `Click to pour ${s.pour}: it fills the hollow, spills over and fills every hollow on its way down to the map's edge`;
      case 'lake':
        return `Hold to dig a lake bed under ${name} and fill it | [ ] size`;
      case 'paint':
        return `Hold to paint ${name}, Shift erases | [ ] size`;
      case 'erase':
        return `Hold to erase ${name}, Shift paints | [ ] size`;
      case 'river':
        return 'Drag a river point to move it | Shift click on a river adds a point | Del removes the point (or the river)';
    }
    return '';
  }

  /**
   * Fill the hollow under the pointer, from its floor (a click on its wall
   * or rim fills it too, hollowFloor). A body without water yet (or with
   * Ctrl) takes the hollow's rim as its level, a little below the spill.
   */
  private fill(p: ToolPointer, ctx: ToolContext): void {
    const editor = ctx.editor;
    const t = editor.doc.terrain;
    const s = ctx.settings.water;
    const clicked = nearestSample(t, p.hit!.x, p.hit!.y);
    const { i, j } = hollowFloor(t, clicked.i, clicked.j);
    const body = waterBody(t, s.body);
    const fresh = !body || !body.mask.some((v) => v);
    if (!body && s.body >= 0) {
      ctx.status('Choose a body in the panel first');
      return;
    }
    const tx = editor.begin('Fill basin');
    tx.snapshot('water');
    if (s.body < 0 && !t.water) t.water = emptyWater(t, 0);
    const target = waterBody(t, s.body)!;
    const brim = basinBrim(t, i, j);
    if (fresh || p.ctrl) target.level = brim;
    const rect = fillBasin(t, i, j, s.body);
    if (rect) {
      // The images of the hollow fill too
      const g = t.grid;
      for (const img of symmetryImages(ctx.settings.symmetry, g.columns === g.rows).slice(1)) {
        const [ii, jj] = img.cell(i, j, g.columns, g.rows);
        fillBasin(t, ii, jj, s.body);
      }
    }
    const level = target.level;
    if (!rect) {
      tx.abort();
      ctx.status(
        !fresh && !p.ctrl
          ? `The ground here lies above the level (${level} m); Ctrl click fills to the rim`
          : 'This spot is no hollow: the water would run off',
      );
      return;
    }
    tx.commit({ water: true });
    // A body that keeps its level fills a deeper hollow only part way: say so, and how to fill it up
    if (brim - level > LOW_FILL) {
      const name = s.body < 0 ? 'the main water' : `body ${s.body + 1}`;
      ctx.status(`Filled up to ${level} m, the level of ${name}; this hollow holds water up to ${brim} m: Ctrl click fills it to the rim`);
    }
  }

  /**
   * Pour water or lava at the pointer (and its symmetry images): each hollow
   * on the way down becomes a new body, all in one step. The flood runs in a
   * worker; a map changed meanwhile keeps its water.
   */
  private pour(p: ToolPointer, ctx: ToolContext): void {
    if (this.pouring) return;
    const editor = ctx.editor;
    const t = editor.doc.terrain;
    const g = t.grid;
    const kind = ctx.settings.water.pour;
    const { i, j } = nearestSample(t, p.hit!.x, p.hit!.y);
    const wet = wetSamples(t);
    if (wet[j * g.columns + i]) {
      ctx.status('There is water here already: pour onto dry ground');
      return;
    }
    const starts = symmetryImages(ctx.settings.symmetry, g.columns === g.rows).map((img) => {
      const [ii, jj] = img.cell(i, j, g.columns, g.rows);
      return jj * g.columns + ii;
    });
    const doc = editor.doc;
    const state = editor.stateId;
    this.pouring = true;
    ctx.status(`Pouring ${kind}…`);
    pourOffThread({ columns: g.columns, rows: g.rows, heights: g.heights, starts, wet, cellSize: g.cellSize })
      .then((result) => {
        if (editor.doc !== doc || editor.stateId !== state) {
          ctx.status('The map changed while the water ran: pour again');
          return;
        }
        const tx = editor.begin(kind === 'lava' ? 'Pour lava' : 'Pour water');
        tx.snapshot('water');
        const added = addPouredBodies(t, result.lakes, kind, MAX_WATER_BODIES);
        if (!added) {
          tx.abort();
          ctx.status(`The ${kind} runs off to the map's edge: no hollow on its way deep enough for a lake`);
          return;
        }
        tx.commit({ water: true });
        const what = kind === 'lava' ? 'lava pool' : 'lake';
        const full = result.skipped > 0 || (t.waterBodies?.length ?? 0) >= MAX_WATER_BODIES;
        ctx.status(`${added} ${what}${added === 1 ? '' : 's'} filled${full ? `; further hollows on the way stayed dry (one pour fills at most ${POUR_MAX_LAKES}, a map holds ${MAX_WATER_BODIES} bodies)` : ''}`);
      })
      .catch((err: Error) => ctx.status(`The pour failed: ${err.message}`))
      .finally(() => (this.pouring = false));
  }

  private end(): void {
    this.stroke?.commit();
    this.stroke = null;
  }
}

/**
 * What a dab on a body's mask changed: without symmetry just that body
 * within the rectangle (-1 the main water: its tiles and wet banks there),
 * with symmetry all water
 */
function waterChange(body: number, rect: GridRect, ctx: ToolContext): DocChange {
  return ctx.settings.symmetry === 'none' ? { bodies: [body], bodyRect: rect } : { water: true };
}
