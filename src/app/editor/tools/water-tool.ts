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
import type { CatalogIndex } from '../catalog/asset-catalog';
import type { CustomMapDocument, MapRiver, MapTerrain, MapWater, MapWaterKind } from '../../world/custom-map/map-document';
import type { DocChange, EditCommand, EditorDocument, PatchTarget } from '../model/editor-document';
import { nearestSample, sampleRectAround, type GridRect } from '../model/grid';
import { addPouredBodies, basinBrim, BODY_COLORS, emptyWater, fillBasin, fillFromEdge, hollowFloor, lakeDab, waterBody, waterMaskDab, wetSamples } from '../ops/water-ops';
import { pourOffThread, POUR_MAX_LAKES } from '../ops/pour';
import { MAX_WATER_BODIES } from '../../world/custom-map/map-file';
import { LandscapeStroke } from '../ops/landscape/landscape-stroke';
import { moveRiverBed, removeRiver } from '../ops/landscape/river';
import { insertPoint, movePoint, nearestRiverPoint, nearestRiverSegment, removePoint } from '../ops/river-edit';
import { symmetryImages } from '../ops/symmetry';
import { RiverListCommand } from '../model/terrain-commands';
import { BrushStroke } from './brush-stroke';
import type { EditorTool, ToolContext, ToolPointer } from './tool';

export { BODY_COLORS } from '../ops/water-ops';

/** Metres a fill may stay below the hollow's rim before the status line says so */
const LOW_FILL = 1;
/** Share per second a lake bed sinks toward its depth at full strength */
const DIG_RATE = 3;

const ADD_LABELS: Record<MapWaterKind, string> = { water: 'Add lake', sea: 'Add sea', swamp: 'Add swamp', ice: 'Add ice', lava: 'Add lava' };

/** The patch target of a body's mask */
function maskTarget(body: number): PatchTarget {
  return body < 0 ? 'water' : `body${body}`;
}

export class WaterTool implements EditorTool {
  readonly id = 'water' as const;
  private stroke: BrushStroke | null = null;
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
      editor.execute(waterCommands.enable(editor, Math.round((p.hit.z - (s.mode === 'lake' ? 0 : 0.2)) * 10) / 10));
    }
    this.on = s.mode === 'erase' ? p.shift : !p.shift;
    const targets: PatchTarget[] = [maskTarget(s.body)];
    if (s.mode === 'lake') targets.push('heights');
    const label = s.mode === 'lake' ? 'Dig lake' : this.on ? 'Paint water' : 'Erase water';
    this.stroke = new BrushStroke(editor, label, targets, ctx.settings.symmetry);
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
      stroke.changed({ ...waterChange(s.body, rect, ctx), heights: rect }, p.hit, rect);
      return;
    }
    waterMaskDab(t, p.hit.x, p.hit.y, ctx.settings.brush, this.on, s.body);
    stroke.changed(waterChange(s.body, rect, ctx), p.hit, rect);
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
    const before = waterState(t);
    const body = waterBody(t, s.body);
    const fresh = !body || !body.mask.some((v) => v);
    if (s.body < 0 && !t.water) t.water = emptyWater(t, 0);
    const target = waterBody(t, s.body);
    if (!target) {
      ctx.status('Choose a body in the panel first');
      return;
    }
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
        let added = 0;
        const command = recordWater(editor, kind === 'lava' ? 'Pour lava' : 'Pour water', (w) => (added = addPouredBodies(w, result.lakes, kind, MAX_WATER_BODIES)));
        if (!added) {
          ctx.status(`The ${kind} runs off to the map's edge: no hollow on its way deep enough for a lake`);
          return;
        }
        editor.execute(command);
        const what = kind === 'lava' ? 'lava pool' : 'lake';
        const full = result.skipped > 0 || (t.waterBodies?.length ?? 0) >= MAX_WATER_BODIES;
        ctx.status(`${added} ${what}${added === 1 ? '' : 's'} filled${full ? `; further hollows on the way stayed dry (one pour fills at most ${POUR_MAX_LAKES}, a map holds ${MAX_WATER_BODIES} bodies)` : ''}`);
      })
      .catch((err: Error) => ctx.status(`The pour failed: ${err.message}`))
      .finally(() => (this.pouring = false));
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
    return recordWater(editor, ADD_LABELS[kind], (t) => {
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

/** Changes the rivers in place and records it as one step */
/** Takes a river off the map with its bed filled, as one undo step */
export function removeWholeRiver(editor: EditorDocument, index: number, catalog: CatalogIndex): void {
  const stroke = new LandscapeStroke(editor, 'Remove river', 1, catalog);
  removeRiver(stroke, index);
  stroke.finish();
}

/**
 * A river reshaped in place (`rivers` hold the new shape, `before` the old
 * list): its bed moves with it, the old one filled, the new one carved
 * (moveRiverBed), as one undo step with the river list
 */
export function relayRiver(editor: EditorDocument, catalog: CatalogIndex, label: string, index: number, before: MapRiver[] | undefined): void {
  const t = editor.doc.terrain;
  const after = t.rivers;
  t.rivers = before ? structuredClone(before) : undefined;
  const stroke = new LandscapeStroke(editor, label, 1, catalog);
  stroke.markRivers();
  t.rivers = after;
  const old = before?.[index];
  const now = after?.[index];
  if (old && now) moveRiverBed(stroke, old, now);
  else stroke.changed({ water: true });
  stroke.finish();
}

export function riverEdit(editor: EditorDocument, label: string, edit: (rivers: MapRiver[]) => void): EditCommand {
  const t = editor.doc.terrain;
  const before = t.rivers ? structuredClone(t.rivers) : undefined;
  const list = structuredClone(t.rivers ?? []);
  edit(list);
  return new RiverListCommand(label, before, list.length ? list : undefined);
}

/**
 * What a dab on a body's mask changed: without symmetry just that body
 * within the rectangle (-1 the main water: its tiles and wet banks there),
 * with symmetry all water
 */
function waterChange(body: number, rect: GridRect, ctx: ToolContext): DocChange {
  return ctx.settings.symmetry === 'none' ? { bodies: [body], bodyRect: rect } : { water: true };
}
