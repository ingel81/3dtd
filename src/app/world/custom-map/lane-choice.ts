import type { MapGameplay, MapSpawn } from './map-document';

/**
 * Lanes nobody holds in a coop room, at the start (TODO E130): closed like
 * a lane the host switched off (the default), all to the host, or shared out
 * among the players in turn.
 */
export type VacantLanes = 'close' | 'host' | 'split';
export const VACANT_LANES: readonly VacantLanes[] = ['close', 'host', 'split'];

/** A map's rules for its lanes (`gameplay.lanes`); every field optional */
export interface MapLanes {
  /** Fewest lanes open at the start; 1 when missing */
  min?: number;
  /** Most lanes open at the start; every lane when missing */
  max?: number;
  /** Lanes nobody holds in a coop room; 'close' when missing */
  vacant?: VacantLanes;
}

/** A spawn of the map as the lane list shows it */
export interface LaneOption {
  id: string;
  name: string;
  /** Its place in the map's list of spawns: the colour goes by it, so a lane keeps its colour when others close */
  slot: number;
  /** The player may close it (MapSpawn.optional); else it is always open */
  optional: boolean;
}

/** The lanes a run may open, and how many of them */
export interface LaneChoice {
  lanes: readonly LaneOption[];
  min: number;
  max: number;
  vacant: VacantLanes;
}

/**
 * The lane choice of a map's first `limit` spawns, its bounds held in what
 * the lanes allow: at least one open, at least the lanes that are always
 * open, at most all of them.
 */
export function laneChoiceOf(spawns: readonly MapSpawn[], gameplay: MapGameplay | undefined, limit = Infinity): LaneChoice {
  const lanes = spawns.slice(0, limit).map((s, slot) => ({ id: s.id, name: s.name, slot, optional: s.optional === true }));
  const always = lanes.filter((l) => !l.optional).length;
  const asked = gameplay?.lanes;
  const whole = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null);
  const max = Math.min(lanes.length, Math.max(always, 1, whole(asked?.max) ?? lanes.length));
  const min = Math.min(max, Math.max(1, always, whole(asked?.min) ?? 1));
  const vacant = VACANT_LANES.includes(asked?.vacant as VacantLanes) ? (asked!.vacant as VacantLanes) : 'close';
  return { lanes, min, max, vacant };
}

/** Whether the map lets the player choose at all: it has an optional lane */
export function hasLaneChoice(choice: LaneChoice): boolean {
  return choice.lanes.some((l) => l.optional);
}

/** The lanes open at first: every lane that is always open, then the optional ones in order up to `max` */
export function defaultOpenLanes(choice: LaneChoice): string[] {
  const open = new Set(choice.lanes.filter((l) => !l.optional).map((l) => l.id));
  for (const l of choice.lanes) if (l.optional && open.size < choice.max) open.add(l.id);
  return choice.lanes.filter((l) => open.has(l.id)).map((l) => l.id);
}

/** Why `open` is not a choice the map allows, null when it is */
export function laneChoiceProblem(choice: LaneChoice, open: Iterable<string>): string | null {
  const ids = new Set(open);
  for (const id of ids) if (!choice.lanes.some((l) => l.id === id)) return `no lane ${id} on this map`;
  const closed = choice.lanes.find((l) => !l.optional && !ids.has(l.id));
  if (closed) return `${closed.name} is always open`;
  if (ids.size < choice.min) return choice.min === 1 ? 'one lane stays open' : `at least ${choice.min} lanes stay open`;
  if (ids.size > choice.max) return `at most ${choice.max} lanes are open on this map`;
  return null;
}

/** The open lanes with `id` switched, in the map's order, or null when the map does not allow it */
export function toggledLanes(choice: LaneChoice, open: readonly string[], id: string): string[] | null {
  const next = new Set(open);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  const ordered = choice.lanes.filter((l) => next.has(l.id)).map((l) => l.id);
  return laneChoiceProblem(choice, ordered) === null ? ordered : null;
}

/** The line beside the choice: every open lane brings a whole wave */
export function laneLoadHint(open: number): string {
  return open === 1
    ? '1 lane open: one wave at a time'
    : `${open} lanes open: each brings a full wave, ${open} times the enemies`;
}
