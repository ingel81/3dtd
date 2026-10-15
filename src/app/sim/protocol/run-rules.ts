import { GAME_BALANCE } from '../../configs/game-balance.config';
import { TOWER_TYPES, type TowerTypeId } from '../../configs/tower-types.config';
import { getResearch } from '../../configs/research/research-tree.config';
import type { ResearchId } from '../../configs/research/research.types';
import { MAX_START_WAVE, type RunStart } from './run-start';
import { WAVE_EVENT_LIMITS } from '../../world/custom-map/map-document';

/**
 * The rules a world sets for the runs on it (a custom map's gameplay,
 * docs/CUSTOM_MAPS.md): start credits, HQ health, which tower types may be
 * built, and where a run starts (the editor's test from wave N). A world
 * without its own (the tiles, DevWorld) plays the game's
 * (DEFAULT_RUN_RULES). Part of the SimWorld and its key, so a coop guest and
 * a replay play by the same.
 */
export interface RunRules {
  /** Start credits per lane of a player (GAME_BALANCE.player.startCredits) */
  startCredits: number;
  /** HQ health at the start and its maximum (GAME_BALANCE.player.startHealth) */
  hqHealth: number;
  /** The tower types that may be built at all (research still unlocks them); null: every type */
  towers: readonly TowerTypeId[] | null;
  /**
   * The structures that take damage and fall (a custom map with
   * `gameplay.destructible`, TODO E131), null where nothing falls. The
   * simulation keeps their HP (StructureLedger)
   */
  structures: readonly RunStructure[] | null;
  /** The run starts past wave 1 (run-start.ts), null at wave 1 */
  start: RunStart | null;
  /**
   * What happens before which wave (a custom map's wave events, TODO E170,
   * world/custom-map/wave-events.ts), null without. The simulation opens
   * lanes and shows and hides objects by them, the main thread the rest
   */
  events?: readonly RunWaveEvent[] | null;
}

/** An object a wave event shows or hides: where it stands, for the towers whose sight it changes */
export interface RunEventObject {
  id: string;
  /** Map degrees, as RunStructure */
  lat: number;
  lon: number;
  /** Ground radius, m */
  radius: number;
}

/** A wave event as the simulation runs it (MapWaveEvent with its objects placed) */
export type RunWaveEvent =
  | { wave: number; kind: 'message'; text: string }
  | { wave: number; kind: 'weather'; weather: 'clear' | 'rain' | 'snow' | 'fog'; strength?: number }
  | { wave: number; kind: 'time'; hour: number }
  | { wave: number; kind: 'portal'; spawn: string }
  | { wave: number; kind: 'objects'; show: boolean; ids: string[]; objects: RunEventObject[] };

/** A structure that takes damage: a custom map's building, wall or structure object */
export interface RunStructure {
  /** The map object's id */
  id: string;
  /** Map degrees (custom-map map-document: map metres over MAP_METERS_PER_DEGREE) */
  lat: number;
  lon: number;
  /** Ground radius and height, m */
  radius: number;
  height: number;
  /** HP when standing */
  hp: number;
}

export const DEFAULT_RUN_RULES: RunRules = {
  startCredits: GAME_BALANCE.player.startCredits,
  hqHealth: GAME_BALANCE.player.startHealth,
  towers: null,
  structures: null,
  start: null,
};

/** Bounds a world's values are held in */
export const RUN_RULE_LIMITS = {
  startCredits: { min: 0, max: 100_000 },
  hqHealth: { min: 1, max: 100_000 },
} as const;

const clamp = (value: unknown, { min, max }: { min: number; max: number }, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;

/**
 * The rules a world asks for, completed with the game's and held in bounds:
 * whole numbers, known tower types only (an empty or unknown list: every
 * type), in the order TOWER_TYPES lists them.
 */
export function runRulesOf(
  asked: Partial<{ startCredits: unknown; hqHealth: unknown; towers: unknown; structures: unknown; start: unknown; events: unknown }> | null | undefined,
): RunRules {
  if (!asked) return DEFAULT_RUN_RULES;
  const listed = Array.isArray(asked.towers) ? new Set(asked.towers.filter((t): t is string => typeof t === 'string')) : null;
  const towers = listed ? (Object.keys(TOWER_TYPES) as TowerTypeId[]).filter((id) => listed.has(id)) : [];
  const structures = Array.isArray(asked.structures) ? asked.structures.filter(isRunStructure) : [];
  const events = Array.isArray(asked.events) ? asked.events.filter(isRunWaveEvent).slice(0, WAVE_EVENT_LIMITS.events) : [];
  return {
    startCredits: clamp(asked.startCredits, RUN_RULE_LIMITS.startCredits, DEFAULT_RUN_RULES.startCredits),
    hqHealth: clamp(asked.hqHealth, RUN_RULE_LIMITS.hqHealth, DEFAULT_RUN_RULES.hqHealth),
    towers: towers.length > 0 ? towers : null,
    structures: structures.length > 0 ? structures : null,
    start: isRunStart(asked.start) ? asked.start : null,
    ...(events.length ? { events } : {}),
  };
}

function isRunWaveEvent(e: unknown): e is RunWaveEvent {
  if (!e || typeof e !== 'object') return false;
  const r = e as Record<string, unknown>;
  const wave = r['wave'];
  if (!Number.isInteger(wave) || (wave as number) < 1 || (wave as number) > WAVE_EVENT_LIMITS.wave) return false;
  const finite = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
  switch (r['kind']) {
    case 'message':
      return typeof r['text'] === 'string';
    case 'weather':
      return ['clear', 'rain', 'snow', 'fog'].includes(r['weather'] as string) && (r['strength'] === undefined || finite(r['strength']));
    case 'time':
      return finite(r['hour']);
    case 'portal':
      return typeof r['spawn'] === 'string';
    case 'objects': {
      const objects = r['objects'];
      const ids = r['ids'];
      return typeof r['show'] === 'boolean' && Array.isArray(ids) && ids.every((id) => typeof id === 'string')
        && Array.isArray(objects) && objects.every((o) => o && typeof o === 'object' && typeof o.id === 'string' && finite(o.lat) && finite(o.lon) && finite(o.radius));
    }
    default:
      return false;
  }
}

function isRunStart(s: unknown): s is RunStart {
  if (!s || typeof s !== 'object') return false;
  const r = s as Record<string, unknown>;
  const gold = (k: string) => typeof r[k] === 'number' && Number.isFinite(r[k]) && (r[k] as number) >= 0;
  return Number.isInteger(r['wave']) && (r['wave'] as number) > 1 && (r['wave'] as number) <= MAX_START_WAVE
    && gold('kill') && gold('complete') && gold('researchCost')
    && Array.isArray(r['research']) && r['research'].every((id) => typeof id === 'string' && getResearch(id as ResearchId) !== undefined);
}

function isRunStructure(s: unknown): s is RunStructure {
  if (!s || typeof s !== 'object') return false;
  const r = s as Record<string, unknown>;
  const finite = (k: string) => typeof r[k] === 'number' && Number.isFinite(r[k]);
  return typeof r['id'] === 'string' && finite('lat') && finite('lon') && finite('radius') && finite('height') && finite('hp') && (r['hp'] as number) > 0;
}

/** Whether the rules allow building `towerId` at all */
export function towerAllowed(rules: RunRules, towerId: TowerTypeId): boolean {
  return rules.towers === null || rules.towers.includes(towerId);
}

/** The rules as a stable text for the world key; empty for the game's own */
export function runRulesKey(rules: RunRules | undefined): string {
  if (!rules) return '';
  const start = rules.start;
  const base = `r=${rules.startCredits},${rules.hqHealth},${rules.towers?.join('+') ?? '*'}`
    + (start ? `,w=${start.wave}:${start.kill}:${start.complete}:${start.researchCost}:${start.research.join('+')}` : '');
  // The structures as one digest: which can fall, where, with what HP; the wave events as another
  const withStructures = rules.structures?.length
    ? `${base},s=${rules.structures.length}:${digest(rules.structures.flatMap((s) => [s.id, s.lat.toFixed(7), s.lon.toFixed(7), s.radius.toFixed(2), String(s.hp)]))}`
    : base;
  if (!rules.events?.length) return withStructures;
  return `${withStructures},e=${rules.events.length}:${digest(rules.events.map((e) => JSON.stringify(e)))}`;
}

/** FNV-1a over the parts, hex */
function digest(parts: readonly string[]): string {
  let h = 0x811c9dc5;
  for (const part of parts) {
    for (let i = 0; i < part.length; i++) h = Math.imul(h ^ part.charCodeAt(i), 0x01000193) >>> 0;
  }
  return h.toString(16);
}

/**
 * Whether `towerId` can be built: the rules allow it, and it is the archer or
 * the research center or a completed research unlocks it. The one test of
 * the simulation (ResearchManager) and the build menu (ResearchStore).
 */
export function towerUnlockedBy(towerId: TowerTypeId, completed: Iterable<ResearchId>, rules: RunRules): boolean {
  if (!towerAllowed(rules, towerId)) return false;
  if (towerId === 'archer' || towerId === 'research-center') return true;
  for (const researchId of completed) {
    const config = getResearch(researchId);
    if (config?.effects.some((effect) => effect.kind === 'unlock-tower' && effect.towerId === towerId)) return true;
  }
  return false;
}
