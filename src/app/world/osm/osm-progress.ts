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

/** Steps of loading a place's data */
export type OsmLoadStep = 'stored' | 'overpass' | 'heights' | 'streets';
/** Every step, loading and making */
export type OsmStep = OsmLoadStep | OsmConvertStep | 'pack' | 'save';

/** What the making shows as one line of its list */
export type OsmStage = 'data' | 'terrain' | 'streets' | 'water' | 'ground' | 'layout' | 'buildings' | 'trees' | 'bake';

export interface OsmStepInfo {
  text: string;
  stage: OsmStage;
  /** Rough milliseconds the step takes (Stuttgart and Miltenberg, OSM_WORLD_PLAN.md O1 and O7), the bar's weights */
  weight: number;
}

export const OSM_STEPS: Readonly<Record<OsmStep, OsmStepInfo>> = {
  stored: { text: 'Opening the data kept on this device', stage: 'data', weight: 300 },
  overpass: { text: 'Streets, water and buildings from OpenStreetMap', stage: 'data', weight: 4000 },
  heights: { text: 'Heights of the ground', stage: 'data', weight: 1000 },
  streets: { text: 'Streets, HQ and spawns', stage: 'data', weight: 400 },
  parse: { text: 'Reading the OpenStreetMap data', stage: 'data', weight: 200 },
  terrain: { text: 'Ground from the heights', stage: 'terrain', weight: 150 },
  roads: { text: 'Streets, bridges and tunnels', stage: 'streets', weight: 250 },
  water: { text: 'Rivers, lakes and the coast', stage: 'water', weight: 150 },
  level: { text: 'Levelling the ground under the streets', stage: 'ground', weight: 800 },
  ground: { text: 'Painting the land', stage: 'ground', weight: 250 },
  shores: { text: 'Painting the shores', stage: 'ground', weight: 60 },
  paint: { text: 'Painting the road surfaces', stage: 'ground', weight: 300 },
  layout: { text: 'HQ and spawns', stage: 'layout', weight: 150 },
  buildings: { text: 'Buildings', stage: 'buildings', weight: 400 },
  furniture: { text: 'Fences, walls, tracks and lamps', stage: 'trees', weight: 200 },
  plants: { text: 'Forests and trees', stage: 'trees', weight: 400 },
  pack: { text: 'Packing the map file', stage: 'bake', weight: 1300 },
  save: { text: 'Saving', stage: 'bake', weight: 300 },
};

/** The making's steps in their order */
export const OSM_MAKE_STEPS: readonly OsmStep[] = ['parse', 'terrain', 'roads', 'water', 'level', 'ground', 'shores', 'paint', 'layout', 'buildings', 'furniture', 'plants', 'pack', 'save'];
/** The loading's steps as listed (the downloads run side by side) */
export const OSM_LOAD_STEPS: readonly OsmLoadStep[] = ['stored', 'overpass', 'heights', 'streets'];

export const OSM_STAGES: readonly { id: OsmStage; label: string }[] = [
  { id: 'data', label: 'Data' },
  { id: 'terrain', label: 'Terrain' },
  { id: 'streets', label: 'Streets' },
  { id: 'water', label: 'Water' },
  { id: 'ground', label: 'Ground' },
  { id: 'layout', label: 'HQ and spawns' },
  { id: 'buildings', label: 'Buildings' },
  { id: 'trees', label: 'Trees and details' },
  { id: 'bake', label: 'Bake' },
];

/** Least time between two reports of a step that only counts on (its share or its words) */
export const PROGRESS_EVERY_MS = 100;

/** What a step reports: it began (the default), counts on, ended or failed */
export interface OsmProgress {
  step: OsmStep;
  state?: 'active' | 'done' | 'failed';
  /** Share of the step done, 0 to 1, where the step knows it */
  share?: number;
  /** What the step has to say beside its words: "4.8 MB", "6 of 9 tiles", why it failed */
  detail?: string;
}

export type OsmStepStatus = 'waiting' | 'active' | 'done' | 'failed';

export interface OsmStepState {
  status: OsmStepStatus;
  share: number;
  detail: string | null;
}

/** The steps heard of so far; a step not in it waits */
export type OsmProgressState = Readonly<Partial<Record<OsmStep, OsmStepState>>>;

/**
 * The state after `event`: a step of the making that begins or ends ends the
 * ones before it in OSM_MAKE_STEPS (the conversion reports only beginnings);
 * the downloads side by side end each on its own
 */
export function reduceProgress(state: OsmProgressState, event: OsmProgress): OsmProgressState {
  const next: Partial<Record<OsmStep, OsmStepState>> = { ...state };
  const status = event.state ?? 'active';
  const before = state[event.step];
  if (status !== 'failed') {
    const at = OSM_MAKE_STEPS.indexOf(event.step);
    for (let k = 0; k < at; k++) {
      const s = OSM_MAKE_STEPS[k];
      if (next[s]?.status === 'active' || !next[s]) next[s] = { status: 'done', share: 1, detail: next[s]?.detail ?? null };
    }
  }
  next[event.step] = {
    status,
    share: status === 'done' ? 1 : (event.share ?? before?.share ?? 0),
    detail: event.detail ?? before?.detail ?? null,
  };
  return next;
}

export interface OsmStageView {
  id: OsmStage;
  label: string;
  status: OsmStepStatus;
}

/** The making as the frame draws it: its stages, the share of the whole (weighted), the step under way and its number */
export interface OsmMakingView {
  stages: OsmStageView[];
  share: number;
  current: { text: string; detail: string | null } | null;
  index: number;
  of: number;
}

export function makingView(state: OsmProgressState): OsmMakingView {
  const total = OSM_MAKE_STEPS.reduce((sum, s) => sum + OSM_STEPS[s].weight, 0);
  let done = 0;
  let current: OsmStep | null = null;
  for (const s of OSM_MAKE_STEPS) {
    const st = state[s];
    if (!st) continue;
    done += OSM_STEPS[s].weight * (st.status === 'done' ? 1 : st.share);
    if (st.status === 'active' || st.status === 'failed') current = s;
  }
  const stages = OSM_STAGES.map(({ id, label }): OsmStageView => {
    const steps = OSM_MAKE_STEPS.filter((s) => OSM_STEPS[s].stage === id).map((s) => state[s]?.status ?? 'waiting');
    const status: OsmStepStatus = steps.includes('failed')
      ? 'failed'
      : steps.every((s) => s === 'done')
        ? 'done'
        : steps.some((s) => s !== 'waiting')
          ? 'active'
          : 'waiting';
    return { id, label, status };
  });
  const stageAt = current ? OSM_STAGES.findIndex((g) => g.id === OSM_STEPS[current!].stage) : -1;
  return {
    stages,
    share: Math.min(1, done / total),
    current: current ? { text: OSM_STEPS[current].text, detail: state[current]?.detail ?? null } : null,
    index: stageAt + 1,
    of: OSM_STAGES.length,
  };
}

/** A row of the loading: a step heard of, in OSM_LOAD_STEPS' order */
export interface OsmLoadRow {
  step: OsmLoadStep;
  text: string;
  status: OsmStepStatus;
  share: number;
  detail: string | null;
}

export function loadingRows(state: OsmProgressState): OsmLoadRow[] {
  return OSM_LOAD_STEPS.flatMap((step) => {
    const st = state[step];
    return st ? [{ step, text: OSM_STEPS[step].text, status: st.status, share: st.share, detail: st.detail }] : [];
  });
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

/** "4.8 MB", "640 kB" */
export function sizeText(chars: number): string {
  return chars >= 1e6 ? `${(chars / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(chars / 1e3))} kB`;
}
