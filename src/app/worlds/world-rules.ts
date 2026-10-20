import { isSamePlace } from '../services/location/recent-locations';
import { AUTOSAVE_BUILT_SLOT, AUTOSAVE_OSM_SLOT, AUTOSAVE_SLOT } from '../services/save-game/save-game.port';

/**
 * The three worlds of the start (docs/WORLDS_NAVIGATION_PLAN.md, 3): the
 * real places of the photorealistic 3D tiles, maps made from OpenStreetMap,
 * and the maps (shipped, own, from coop hosts). Mechanically the same game;
 * the world shows in its globe and its background.
 */
export type WorldId = 'real' | 'osm' | 'maps';

/** Their fixed order on the globes: only the size of the last one played changes */
export const WORLD_IDS: readonly WorldId[] = ['real', 'osm', 'maps'];

/** Why a whole world is locked; the words are the dictionary's (worlds.lock) */
export type WorldLock = 'noKey' | 'soon';

/**
 * Why a whole world is locked, or null. A locked globe is grey and stays
 * clickable: its menu shows the list, Start is locked with this reason.
 * Why a single way is blocked is world/why-not.ts, one list of reasons for
 * the path, the game's menus and the globes. The world names are the
 * dictionary's (worlds.names).
 */
export function worldLock(world: WorldId, state: { hasKey: boolean; mapsOpen: boolean }): WorldLock | null {
  if (world === 'real') return state.hasKey ? null : 'noKey';
  return state.mapsOpen ? null : 'soon';
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
 * The autosave a run in `world` writes after its waves: each world keeps its
 * own, one run each (docs/WORLDS_STATE_PLAN.md, 3.2)
 */
export function autosaveSlotOf(world: WorldId): string {
  return world === 'real' ? AUTOSAVE_SLOT : world === 'osm' ? AUTOSAVE_OSM_SLOT : AUTOSAVE_BUILT_SLOT;
}

/**
 * The world a map belongs to: one made from OpenStreetMap and not changed in
 * the editor since (MapMeta.generated) is OpenStreetMap's, every other map a
 * Built World (docs/WORLDS_STATE_PLAN.md, 3.6). The one rule for the globes,
 * the game's menus and the autosave.
 */
export function worldOfMap(map: { generated?: boolean } | null | undefined): WorldId {
  return map?.generated ? 'osm' : 'maps';
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
 * The world that stands large on the globes: the one of the newest
 * Continue, else the one of the last run started, else the real places
 * (docs/WORLDS_STATE_PLAN.md, 4)
 */
export function heroWorld(autosaves: readonly AutosaveRun[], lastPlayed: WorldId | null): WorldId {
  const newest = [...autosaves].sort((a, b) => b.savedAt.localeCompare(a.savedAt))[0];
  return newest?.world ?? lastPlayed ?? 'real';
}
