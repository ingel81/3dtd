/**
 * Plays an AI agent's script on the open map (docs/AGENT_MCP.md): the
 * commands the sandbox kept (map-script.ts), one after another through the
 * map kit, so whoever watches the editor sees the map being built. A
 * Terrain, Paint or Water stroke goes in runs of a few dabs, as if drawn;
 * a Landscape stroke, a road or a river lands whole. The editor turns the
 * whole play into one undo step (EditorSession.agentEdit).
 *
 * The kit runs the same code with the same seed as in the sandbox, so the
 * map comes out as the sandbox saw it; the fingerprint says whether it did.
 */
import type { CatalogIndex } from '../catalog/asset-catalog';
import { mergeChanges, type DocChange, type EditorDocument } from '../model/editor-document';
import { rectUnion, sampleRectAround, texelRectAround, type GridRect } from '../model/grid';
import { contentFingerprint } from './agent-reads';
import { applyCommand, changesWholeGround, strokeArgs, type ScriptCommand } from './map-script';
import { dabCentres, MapKit, type Brush, type Where } from '../ops/map-kit';
import type { CustomMapDocument, MapPoint } from '../../world/custom-map/map-document';

/** Dabs per step of a drawn stroke */
const DABS_PER_STEP = 6;
/** Longest a play takes when animated, ms; a short script takes STEP_MS a step */
export const PLAY_MS = 8000;
const STEP_MS = 140;
/** Work between two frames when the play is behind, ms */
const FRAME_BUDGET_MS = 12;

/** Strokes drawn in runs: they change the ground dab by dab, the run boundaries do not matter */
const DRAWN = new Set(['raise', 'smooth', 'level', 'roughen', 'slide', 'terrace', 'plateau', 'paint', 'lake', 'waterMask']);
/** Of those, what they change */
const PAINTS = new Set(['paint']);
const WATERS = new Set(['lake', 'waterMask']);

export interface PlayOptions {
  /** Draw it over time for a watcher; false lands it as fast as the frames allow */
  animate?: boolean;
  signal?: AbortSignal;
  /** 0..1 after each step */
  onProgress?: (share: number) => void;
  /** Waits `ms` (at least a frame); tests pass their own */
  wait?: (ms: number) => Promise<void>;
  now?: () => number;
}

export interface PlayResult {
  steps: number;
  /** The map's fingerprint after the play */
  fingerprint: string;
}

/** One step of the play: a command, or a run of a drawn stroke's dabs */
interface Step {
  command: ScriptCommand;
  /** The dabs of this run, for the view's rectangle */
  dabs?: MapPoint[];
  radius?: number;
}

/** A drawn stroke as runs of DABS_PER_STEP dabs, any other command as one step */
export function playSteps(commands: readonly ScriptCommand[]): Step[] {
  const steps: Step[] = [];
  for (const command of commands) {
    const at = strokeArgs(command.op);
    if (!at || !DRAWN.has(command.op)) {
      steps.push({ command });
      continue;
    }
    const brush = command.args[at.brush] as Brush;
    const dabs = dabCentres(command.args[at.where] as Where, brush);
    for (let k = 0; k < dabs.length; k += DABS_PER_STEP) {
      const run = dabs.slice(k, k + DABS_PER_STEP);
      const args = [...command.args];
      args[at.where] = { dabs: run };
      steps.push({ command: { op: command.op, args }, dabs: run, radius: brush.radius });
    }
  }
  return steps;
}

/** What of the map a step may have touched beyond what its rectangle says */
interface Marks {
  objects: unknown;
  objectCount: number;
  paths: string;
  markers: string;
  environment: string;
  gameplay: string;
  layers: number;
  water: string;
}

function marks(doc: CustomMapDocument): Marks {
  const t = doc.terrain;
  return {
    objects: doc.objects,
    objectCount: doc.objects.length,
    paths: JSON.stringify(doc.paths),
    markers: JSON.stringify([doc.spawns, doc.hq]),
    environment: JSON.stringify(doc.environment),
    gameplay: JSON.stringify(doc.gameplay ?? null),
    layers: t.layers.length,
    water: JSON.stringify([t.water?.level, t.water?.kind, t.waterBodies?.map((b) => [b.level, b.kind]), t.rivers?.length]),
  };
}

function wholeGround(doc: CustomMapDocument): DocChange {
  const t = doc.terrain;
  return {
    heights: { i0: 0, j0: 0, i1: t.grid.columns - 1, j1: t.grid.rows - 1 },
    splat: { i0: 0, j0: 0, i1: t.splat.resolution - 1, j1: t.splat.resolution - 1 },
    water: true,
    layers: true,
  };
}

/** What the view redraws after a step */
function stepChange(doc: CustomMapDocument, step: Step, before: Marks, symmetric: boolean): DocChange {
  const op = step.command.op;
  let change: DocChange = {};
  if (changesWholeGround(op) || (symmetric && step.dabs)) change = wholeGround(doc);
  else if (step.dabs && step.radius) {
    const t = doc.terrain;
    let rect: GridRect | null = null;
    for (const c of step.dabs) {
      rect = rectUnion(rect, PAINTS.has(op) ? texelRectAround(t, c.x, c.y, step.radius + 1) : sampleRectAround(t, c.x, c.y, step.radius + t.grid.cellSize));
    }
    if (rect) change = PAINTS.has(op) ? { splat: rect } : { heights: rect, water: WATERS.has(op) || undefined };
  } else if (op === 'ramp') {
    const [a, b, width] = step.command.args as [MapPoint, MapPoint, number];
    const t = doc.terrain;
    change = { heights: rectUnion(sampleRectAround(t, a.x, a.y, width * 2), sampleRectAround(t, b.x, b.y, width * 2))! };
  }
  const after = marks(doc);
  if (after.objects !== before.objects || after.objectCount !== before.objectCount) change = mergeChanges(change, { objects: 'all' });
  if (after.paths !== before.paths) change = mergeChanges(change, { paths: true });
  if (after.markers !== before.markers) change = mergeChanges(change, { markers: true });
  if (after.environment !== before.environment) change = mergeChanges(change, { environment: true });
  if (after.gameplay !== before.gameplay) change = mergeChanges(change, { meta: true });
  if (after.layers !== before.layers) change = mergeChanges(change, { layers: true, splat: wholeGround(doc).splat });
  if (after.water !== before.water) change = mergeChanges(change, { water: true });
  return change;
}

/** Waits `ms`, at least one frame (a timer where there are no frames) */
const frame = (ms: number) =>
  new Promise<void>((resolve) => {
    const start = performance.now();
    const next = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (f: () => void) => setTimeout(f, 16);
    const tick = () => (performance.now() - start >= ms ? resolve() : next(tick));
    next(tick);
  });

/**
 * Plays `commands` on the editor's map with the kit's `seed`, telling the
 * view about each step. Throws an AbortError when `signal` ends it, and
 * whatever a command throws; the caller puts the map back then.
 */
export async function playCommands(editor: EditorDocument, catalog: CatalogIndex, commands: readonly ScriptCommand[], seed: number, options: PlayOptions = {}): Promise<PlayResult> {
  const doc = editor.doc;
  const kit = new MapKit(doc, catalog, { name: 'script', seed });
  // A Landscape stroke tells its own editor what each dab changed: the open one's view hears it
  const off = kit.editor.onChange((change) => editor.emit(change));
  const steps = playSteps(commands);
  const now = options.now ?? (() => performance.now());
  const wait = options.wait ?? frame;
  const total = options.animate === false ? 0 : Math.min(PLAY_MS, steps.length * STEP_MS);
  const start = now();
  let yielded = start;
  try {
    for (let k = 0; k < steps.length; k++) {
      if (options.signal?.aborted) throw new DOMException('The play was stopped', 'AbortError');
      const before = marks(doc);
      applyCommand(kit, steps[k].command);
      editor.emit(stepChange(doc, steps[k], before, kit.symmetry !== 'none'));
      options.onProgress?.((k + 1) / steps.length);
      const due = start + (total * (k + 1)) / steps.length;
      const t = now();
      if (t < due) {
        await wait(due - t);
        yielded = now();
      } else if (t - yielded > FRAME_BUDGET_MS || k === steps.length - 1) {
        await wait(0);
        yielded = now();
      }
    }
  } finally {
    off();
  }
  return { steps: steps.length, fingerprint: contentFingerprint(doc) };
}
