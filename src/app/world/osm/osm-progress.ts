/**
 * Progress of an OSM world's loading and making (E218), one list for the
 * worker that reports it and the frame that shows it: each step with its
 * stage, its words and its weight, the one event a step sends, the state the
 * events add up to and what the frame draws of it. Plain data, so the events
 * cross from a worker as they are (osm.worker.ts posts them; a step that
 * only counts on is sent at most every PROGRESS_EVERY_MS).
 *
 * Loading (the frame opens or its square moves): the data kept on this
 * device, or the Overpass answer and the elevation tiles side by side, then
 * the streets with the HQ and the spawns. Making: the conversion's steps in
 * their order (import-osm.ts convertOsm), packing, saving; they are shown in
 * stages (data, terrain, streets, water, ground, HQ and spawns, buildings,
 * trees, bake) with a bar weighted by what each step takes.
 */
import type { OsmConvertStep } from './import-osm';
import type { Messages } from '../../i18n/messages/en';
import type { Said } from '../../i18n/said';

/** Steps of loading a place's data */
export type OsmLoadStep = 'stored' | 'overpass' | 'heights' | 'streets';
/** Every step, loading and making */
export type OsmStep = OsmLoadStep | OsmConvertStep | 'pack' | 'save';

/** What the making shows as one line of its list */
export type OsmStage = 'data' | 'terrain' | 'streets' | 'water' | 'ground' | 'layout' | 'buildings' | 'trees' | 'bake';

/** A step's words are the dictionary's (`osm.steps`), by its id */
export interface OsmStepInfo {
  stage: OsmStage;
  /** Rough milliseconds the step takes (Stuttgart and Miltenberg, OSM_WORLD_PLAN.md O1 and O7), the bar's weights */
  weight: number;
}

export const OSM_STEPS: Readonly<Record<OsmStep, OsmStepInfo>> = {
  stored: { stage: 'data', weight: 300 },
  overpass: { stage: 'data', weight: 4000 },
  heights: { stage: 'data', weight: 1000 },
  streets: { stage: 'data', weight: 400 },
  parse: { stage: 'data', weight: 200 },
  terrain: { stage: 'terrain', weight: 150 },
  roads: { stage: 'streets', weight: 250 },
  water: { stage: 'water', weight: 150 },
  level: { stage: 'ground', weight: 800 },
  ground: { stage: 'ground', weight: 250 },
  shores: { stage: 'ground', weight: 60 },
  paint: { stage: 'ground', weight: 300 },
  layout: { stage: 'layout', weight: 150 },
  areas: { stage: 'ground', weight: 120 },
  buildings: { stage: 'buildings', weight: 400 },
  furniture: { stage: 'trees', weight: 200 },
  pois: { stage: 'trees', weight: 60 },
  plants: { stage: 'trees', weight: 400 },
  life: { stage: 'trees', weight: 20 },
  pack: { stage: 'bake', weight: 1300 },
  save: { stage: 'bake', weight: 300 },
};

/** The making's steps in their order */
export const OSM_MAKE_STEPS: readonly OsmStep[] = ['parse', 'terrain', 'roads', 'water', 'level', 'ground', 'shores', 'paint', 'layout', 'areas', 'buildings', 'furniture', 'pois', 'plants', 'life', 'pack', 'save'];
/** The loading's steps as listed (the downloads run side by side) */
export const OSM_LOAD_STEPS: readonly OsmLoadStep[] = ['stored', 'overpass', 'heights', 'streets'];

/** The making's stages in their order; their words are the dictionary's (`osm.stages`) */
export const OSM_STAGES: readonly OsmStage[] = ['data', 'terrain', 'streets', 'water', 'ground', 'layout', 'buildings', 'trees', 'bake'];

/** Least time between two reports of a step that only counts on (its share or its words) */
export const PROGRESS_EVERY_MS = 100;

/** What a step reports: it began (the default), counts on, ended or failed */
export interface OsmProgress {
  step: OsmStep;
  state?: 'active' | 'done' | 'failed';
  /** Share of the step done, 0 to 1, where the step knows it */
  share?: number;
  /** What the step has to say beside its words ("4.8 MB", "6 of 9 tiles", why it failed), as data the frame words */
  detail?: OsmDetail;
}

export type OsmStepStatus = 'waiting' | 'active' | 'done' | 'failed';

/** What a step says beside its words (`osm.detail`) */
export type OsmDetail = Said<Messages['osm']['detail']>;

export interface OsmStepState {
  status: OsmStepStatus;
  share: number;
  detail: OsmDetail | null;
  /** When it began (ms, the reducer's clock): a step that reports no share moves by its time against its weight */
  since: number;
}

/** The steps heard of so far; a step not in it waits */
export type OsmProgressState = Readonly<Partial<Record<OsmStep, OsmStepState>>>;

/**
 * The state after `event`: a step of the making that begins or ends ends the
 * ones before it in OSM_MAKE_STEPS (the conversion reports only beginnings);
 * the downloads side by side end each on its own
 */
export function reduceProgress(state: OsmProgressState, event: OsmProgress, now: number = Date.now()): OsmProgressState {
  const next: Partial<Record<OsmStep, OsmStepState>> = { ...state };
  const status = event.state ?? 'active';
  const before = state[event.step];
  if (status !== 'failed') {
    const at = OSM_MAKE_STEPS.indexOf(event.step);
    for (let k = 0; k < at; k++) {
      const s = OSM_MAKE_STEPS[k];
      if (next[s]?.status === 'active' || !next[s]) next[s] = { status: 'done', share: 1, detail: next[s]?.detail ?? null, since: next[s]?.since ?? now };
    }
  }
  next[event.step] = {
    status,
    share: status === 'done' ? 1 : (event.share ?? before?.share ?? 0),
    detail: event.detail ?? before?.detail ?? null,
    since: before?.since ?? now,
  };
  return next;
}

export interface OsmStageView {
  id: OsmStage;
  status: OsmStepStatus;
}

/** The making as the frame draws it: its stages, the share of the whole (weighted), the step under way and its number */
export interface OsmMakingView {
  stages: OsmStageView[];
  share: number;
  current: { step: OsmStep; detail: OsmDetail | null } | null;
  index: number;
  of: number;
}

/** How far a step under way stands: its own share, else its time against its weight, never past ESTIMATE_CAP */
const ESTIMATE_CAP = 0.9;

function shareOf(step: OsmStep, st: OsmStepState, now: number): number {
  if (st.status === 'done') return 1;
  const estimate = st.status === 'active' ? Math.min(ESTIMATE_CAP, (now - st.since) / OSM_STEPS[step].weight) : 0;
  return Math.max(st.share, estimate);
}

/** The making at `now` (the bar moves on between reports by the steps' weights) */
export function makingView(state: OsmProgressState, now: number = Date.now()): OsmMakingView {
  const total = OSM_MAKE_STEPS.reduce((sum, s) => sum + OSM_STEPS[s].weight, 0);
  let done = 0;
  let current: OsmStep | null = null;
  for (const s of OSM_MAKE_STEPS) {
    const st = state[s];
    if (!st) continue;
    done += OSM_STEPS[s].weight * shareOf(s, st, now);
    if (st.status === 'active' || st.status === 'failed') current = s;
  }
  const stages = OSM_STAGES.map((id): OsmStageView => {
    const steps = OSM_MAKE_STEPS.filter((s) => OSM_STEPS[s].stage === id).map((s) => state[s]?.status ?? 'waiting');
    const status: OsmStepStatus = steps.includes('failed')
      ? 'failed'
      : steps.every((s) => s === 'done')
        ? 'done'
        : steps.some((s) => s !== 'waiting')
          ? 'active'
          : 'waiting';
    return { id, status };
  });
  const stageAt = current ? OSM_STAGES.indexOf(OSM_STEPS[current].stage) : -1;
  return {
    stages,
    share: Math.min(1, done / total),
    current: current ? { step: current, detail: state[current]?.detail ?? null } : null,
    index: stageAt + 1,
    of: OSM_STAGES.length,
  };
}

/** A row of the loading: a step heard of, in OSM_LOAD_STEPS' order */
export interface OsmLoadRow {
  step: OsmLoadStep;
  status: OsmStepStatus;
  share: number;
  detail: OsmDetail | null;
}

export function loadingRows(state: OsmProgressState): OsmLoadRow[] {
  return OSM_LOAD_STEPS.flatMap((step) => {
    const st = state[step];
    return st ? [{ step, status: st.status, share: st.share, detail: st.detail }] : [];
  });
}

/** The loading as the veil over the frame's square draws it (E282): the share by the steps' weights, the row under way */
export interface OsmLoadingView {
  share: number;
  current: OsmLoadRow | null;
}

/**
 * The loading at `now`: the steps to come are the data kept here, the two
 * downloads unless the data was found kept, and the streets; the row under
 * way is the first active one in the list's order, else the last heard of
 */
export function loadingView(state: OsmProgressState, now: number = Date.now()): OsmLoadingView {
  const found = state.stored?.status === 'done' && state.stored.detail?.key === 'found';
  const steps: OsmLoadStep[] = found ? ['stored', 'streets'] : ['stored', 'overpass', 'heights', 'streets'];
  const total = steps.reduce((sum, s) => sum + OSM_STEPS[s].weight, 0);
  const done = steps.reduce((sum, s) => {
    const st = state[s];
    return st ? sum + OSM_STEPS[s].weight * shareOf(s, st, now) : sum;
  }, 0);
  const rows = loadingRows(state);
  return { share: Math.min(1, done / total), current: rows.find((r) => r.status === 'active') ?? rows.at(-1) ?? null };
}

/**
 * `send` with the reports of a step that only counts on thinned to one per
 * PROGRESS_EVERY_MS; a step that begins, ends or fails, and another step,
 * goes at once (the worker's line to the frame)
 */
export function thinProgress(send: (event: OsmProgress) => void, now: () => number = () => performance.now()): (event: OsmProgress) => void {
  const last = new Map<OsmStep, { at: number; state: OsmProgress['state'] }>();
  return (event) => {
    const t = now();
    const was = last.get(event.step);
    const counting = was && (event.state ?? 'active') === (was.state ?? 'active') && (event.state ?? 'active') === 'active';
    if (counting && t - was.at < PROGRESS_EVERY_MS) return;
    last.set(event.step, { at: t, state: event.state });
    send(event);
  };
}


