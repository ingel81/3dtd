import { isSamePlace } from '../services/location/recent-locations';
import { AUTOSAVE_MAP_SLOT, AUTOSAVE_SLOT } from '../services/save-game/save-game.port';

/**
 * The three worlds of the start (docs/WORLDS_NAVIGATION_PLAN.md, 3): the
 * real places of the photorealistic 3D tiles, maps made from OpenStreetMap,
 * and the maps (shipped, own, from coop hosts). Mechanically the same game;
 * the world shows in its globe and its background.
 */
export type WorldId = 'real' | 'osm' | 'maps';

/** Their fixed order on the globes: only the size of the last one played changes */
export const WORLD_IDS: readonly WorldId[] = ['real', 'osm', 'maps'];

export const WORLD_NAMES: Readonly<Record<WorldId, string>> = {
  real: 'Real places',
  osm: 'OpenStreetMap',
  maps: 'Built Worlds',
};

/**
 * Why a whole world is locked, or null. A locked globe is grey and stays
 * clickable: its menu shows the list, Start is locked with this reason.
 * Why a single way is blocked is world/why-not.ts, one list of reasons for
 * the path, the game's menus and the globes.
 */
export function worldLock(world: WorldId, state: { hasKey: boolean; mapsOpen: boolean }): string | null {
  if (world === 'real') return state.hasKey ? null : 'No map key';
  return state.mapsOpen ? null : 'Coming soon';
}

/** What a world menu has chosen: a place of the real places, an own tileset there, or a map */
export type WorldPick =
  | { kind: 'place'; hq: { lat: number; lon: number }; spawns: { lat: number; lon: number; portalBearing?: number }[]; name: string }
  | { kind: 'tileset'; id: string; name: string }
  | { kind: 'map'; id: string; name: string };

/** The run an autosave holds, as the globes offer it to continue */
export interface AutosaveRun {
  slotId: string;
  world: WorldId;
  /** Its place or map: the pick that continues it; null for a save of before the place was kept */
  pick: WorldPick | null;
  /** As the list names it: "Heilbronn", "Demo Valley" */
  name: string;
  wave: number;
  savedAt: string;
}

/**
 * The autosave a run in `world` writes after its waves. The real places
 * keep their own; OpenStreetMap maps and the other maps share one, both are
 * custom maps (docs/WORLDS_NAVIGATION_PLAN.md, 3.5).
 */
export function autosaveSlotOf(world: WorldId): string {
  return world === 'real' ? AUTOSAVE_SLOT : AUTOSAVE_MAP_SLOT;
}

/** Two picks name the same place or map */
export function samePick(a: WorldPick, b: WorldPick): boolean {
  if (a.kind === 'place' && b.kind === 'place') return isSamePlace(a.hq, b.hq);
  if (a.kind === 'map' && b.kind === 'map') return a.id === b.id;
  if (a.kind === 'tileset' && b.kind === 'tileset') return a.id === b.id;
  return false;
}

/**
 * The run a start in `world` on `pick` puts at risk: the autosave of the
 * same slot at another place or map. Its next autosave takes that one's
 * place, so Start asks first (user decision 1: one run per world stays as
 * an autosave). Null when there is none, or it is this very pick (then
 * Start is Continue).
 */
export function runAtRisk(world: WorldId, pick: WorldPick, autosaves: readonly AutosaveRun[]): AutosaveRun | null {
  const slot = autosaveSlotOf(world);
  const run = autosaves.find((r) => r.slotId === slot);
  return run && !(run.pick && samePick(run.pick, pick)) ? run : null;
}

/**
 * The world that stands large on the globes (user decision 4): the one of
 * the last run started, else the one of the newest autosave, else the real
 * places.
 */
export function heroWorld(autosaves: readonly AutosaveRun[], lastPlayed: WorldId | null): WorldId {
  if (lastPlayed) return lastPlayed;
  const newest = [...autosaves].sort((a, b) => b.savedAt.localeCompare(a.savedAt))[0];
  return newest?.world ?? 'real';
}
