import type { GeoPosition } from '../models/game.types';
import type { GameRngState } from '../utils/game-rng';
import type { DirectorSave } from '../director/wave-director';
import { createWaveSource, isWaveSourceId } from '../director/wave-source.registry';
import type { RunLog } from '../run-log/run-log.types';
import type { WaveSeriesPoint } from '../run-log/wave-series';
import { WORLD_PACKAGE_VERSION, worldPackageShape, type WorldPackage } from '../coop/world-package';
import { SIM_SNAPSHOT_VERSION, type SimSnapshot } from './sim-snapshot';

/** Bumped whenever the file's shape changes; another version is refused. */
export const SAVE_FILE_VERSION = 1;
const FORMAT = '3dtd-save';

/**
 * A single-player run between two waves as a file (docs/SAVE_LOAD_PLAN.md,
 * TODO E110), modelled on the replay file (replay-file.ts): a head with the
 * versions and the balance, then everything the run goes on from.
 *
 * Unlike a replay it brings its world: a snapshot only holds on the world it
 * was taken on (`worldKey`), and the same place loaded again can measure
 * other cells and heights from the tiles. The world package (the coop
 * host's, coop/world-package.ts) carries routes, cells and heights; the
 * place's HQ and spawns load the tiles to look at. The format serves a coop
 * host later as a room's start (decision 5): the snapshot already holds
 * every player.
 */
export interface SaveFile {
  format: typeof FORMAT;
  version: number;
  snapshotVersion: number;
  /** The game version (BUILD_VERSION) and commit it was saved with */
  gameVersion: string;
  commit: string;
  /** run-log/config-hash.ts: the balance it was saved with */
  configHash: string;
  /** When it was saved, ISO 8601 */
  createdAt: string;
  /** The player's name for it, or place and wave */
  name: string;
  /** The wave the run stands before: the next start is this one */
  wave: number;
  place: SavePlace;
  world: WorldPackage;
  /** The simulation between the waves */
  sim: SimSnapshot;
  /** The wave director: source, its state, the committed wave */
  director: DirectorSave;
  /** The main thread's GameRng (SimMirror.rng): the director stream where the run left it */
  mainRng: GameRngState;
  /** The run log so far, written on after loading; null when none was open */
  runLog: RunLog | null;
  /** The game-over charts' points so far (run-log/wave-series.ts) */
  waveSeries: WaveSeriesPoint[];
}

/** Where the run is played: the place as the place picker names it, its HQ and spawns */
export interface SavePlace {
  name: string;
  hq: GeoPosition;
  spawns: { lat: number; lon: number }[];
}

/** What a save is made of; the head comes from the game running now */
export type SaveParts = Omit<SaveFile, 'format' | 'version' | 'snapshotVersion' | 'createdAt'>;

export function buildSaveFile(parts: SaveParts, now: Date = new Date()): SaveFile {
  return {
    format: FORMAT,
    version: SAVE_FILE_VERSION,
    snapshotVersion: SIM_SNAPSHOT_VERSION,
    createdAt: now.toISOString(),
    ...parts,
  };
}

/**
 * The largest save read, bytes, packed and unpacked: a run of 80 waves with
 * many towers is far below (the world package is most of it, some hundred
 * kB), a file far above it is not one the game wrote. Unpacked and parsed on
 * the main thread, so a small gzip that unpacks to more stops here.
 */
export const MAX_SAVE_FILE_BYTES = 32 * 1024 * 1024;

/** Why a save cannot be loaded, null when it can. */
export type SaveFileRefusal = 'not-a-save' | 'too-big' | 'damaged' | 'version';

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isPlace = (v: unknown): boolean => isObject(v) && Number.isFinite(v['lat']) && Number.isFinite(v['lon']);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const strings = (v: unknown): boolean => Array.isArray(v) && v.every((s) => typeof s === 'string');
/** [player id, state] pairs of a per-player part, absent in a snapshot from before coop */
const perPlayer = (v: unknown, state: (s: unknown) => boolean): boolean =>
  v === undefined || (Array.isArray(v) && v.every((p) => Array.isArray(p) && p.length === 2 && typeof p[0] === 'string' && state(p[1])));

/** Random state: a seed and finite numbers per stream */
function isRng(v: unknown): boolean {
  return isObject(v) && finite(v['seed']) && isObject(v['streams'])
    && Object.values(v['streams']).every(finite);
}

function isResearch(v: unknown): boolean {
  return isObject(v) && strings(v['completed']) && finite(v['slots']) && finite(v['centerLevel'])
    && Array.isArray(v['active']) && (v['active'] as unknown[]).every((a) => isObject(a) && typeof a['researchId'] === 'string' && finite(a['elapsed']))
    && (v['queued'] === undefined || strings(v['queued']));
}

function isAbilities(v: unknown): boolean {
  return isObject(v) && finite(v['nextStrikeId']) && Array.isArray(v['states'])
    && (v['states'] as unknown[]).every((s) => isObject(s) && typeof s['id'] === 'string' && typeof s['unlocked'] === 'boolean'
      && finite(s['charges']) && finite(s['wavesTowardCharge']));
}

function isHero(v: unknown): boolean {
  if (!isObject(v) || typeof v['unlocked'] !== 'boolean' || typeof v['ammo'] !== 'string' || !finite(v['kills']) || !finite(v['level'])) return false;
  const hired = v['hired'];
  return hired === null || (isObject(hired) && finite(hired['lat']) && finite(hired['lon']) && finite(hired['height'])
    && finite(hired['cooldownMs']) && finite(hired['replanMs']) && finite(hired['clockMs']) && isObject(hired['anchor']));
}

function isTower(v: unknown): boolean {
  if (!isObject(v)) return false;
  const state = v['state'];
  return typeof v['id'] === 'string' && typeof v['typeId'] === 'string'
    && finite(v['lat']) && finite(v['lon']) && finite(v['height']) && finite(v['customRotation']) && finite(v['plinthHeight'])
    && Array.isArray(v['plinthOverhang']) && Array.isArray(v['upgrades'])
    && (v['upgrades'] as unknown[]).every((u) => Array.isArray(u) && typeof u[0] === 'string' && finite(u[1]))
    && isObject(state) && finite(state['cooldownMs']) && finite(state['kills']) && finite(state['damageDealt']);
}

/** The snapshot as SimSnapshots.restore reads it: a damaged one would stop that half way, with the run gone */
function isSimSnapshot(v: unknown): boolean {
  if (!isObject(v)) return false;
  const clock = v['clock'];
  return isObject(clock) && finite(clock['gameTimeMs']) && finite(clock['subStep']) && isRng(v['rng'])
    && finite(v['idCounter']) && finite(v['credits']) && finite(v['baseHealth'])
    && Number.isInteger(v['waveNumber']) && (v['waveNumber'] as number) >= 0
    && typeof v['phase'] === 'string' && typeof v['runStarted'] === 'boolean' && finite(v['economyPerfectStreak'])
    && (v['accounts'] === undefined || perPlayer(v['accounts'], finite))
    && isResearch(v['research']) && perPlayer(v['researchByPlayer'], isResearch)
    && isAbilities(v['abilities']) && perPlayer(v['abilitiesByPlayer'], isAbilities)
    && isHero(v['hero']) && perPlayer(v['heroesByPlayer'], isHero)
    && Array.isArray(v['towers']) && (v['towers'] as unknown[]).every(isTower)
    && Array.isArray(v['losQueue']);
}

/** The director: a known source, the state that source reads, a committed wave or none */
function isDirector(v: unknown): boolean {
  if (!isObject(v) || !isWaveSourceId(v['source'])) return false;
  const state = v['sourceState'];
  const source = createWaveSource(v['source']);
  const stateOk = state === null || (source.validState ? source.validState(state) : false);
  return stateOk && (v['planned'] === null || isObject(v['planned']));
}

/**
 * Parse `text` and check it. A save of another game version or balance
 * loads, with `note` saying so (decision 4): the code or the values may have
 * changed since. Only another format, a damaged file or a snapshot of
 * another shape is refused.
 */
export function readSaveFile(
  text: string,
  here: { gameVersion: string; configHash: string },
): { file: SaveFile; refusal: null; note: string | null } | { file: null; refusal: SaveFileRefusal } {
  if (text.length > MAX_SAVE_FILE_BYTES) return { file: null, refusal: 'too-big' };
  let data: Partial<SaveFile>;
  try {
    data = JSON.parse(text) as Partial<SaveFile>;
  } catch {
    return { file: null, refusal: 'not-a-save' };
  }
  if (!isObject(data) || data.format !== FORMAT) return { file: null, refusal: 'not-a-save' };
  if (data.version !== SAVE_FILE_VERSION || data.snapshotVersion !== SIM_SNAPSHOT_VERSION) {
    return { file: null, refusal: 'version' };
  }
  if (!wellFormed(data)) return { file: null, refusal: 'damaged' };
  const file = data as SaveFile;
  if (file.world.version !== WORLD_PACKAGE_VERSION || file.sim.version !== SIM_SNAPSHOT_VERSION) {
    return { file: null, refusal: 'version' };
  }
  return { file, refusal: null, note: saveNote(file, here) };
}

/** The parts a load reads, of the types it reads them as */
function wellFormed(data: Partial<SaveFile>): boolean {
  const place = data.place;
  const director = data.director;
  return typeof data.gameVersion === 'string' && typeof data.configHash === 'string'
    && typeof data.name === 'string' && typeof data.createdAt === 'string'
    && Number.isInteger(data.wave) && (data.wave as number) >= 1
    && isObject(place) && typeof place['name'] === 'string' && isPlace(place['hq'])
    && Array.isArray(place['spawns']) && (place['spawns'] as unknown[]).length > 0
    && (place['spawns'] as unknown[]).every(isPlace)
    && worldPackageShape(data.world) !== null
    && isSimSnapshot(data.sim)
    && isDirector(director)
    && isRng(data.mainRng)
    && (data.runLog === null || (isObject(data.runLog) && isObject(data.runLog['head']) && Array.isArray(data.runLog['records'])))
    && Array.isArray(data.waveSeries);
}

/** Saved with another version or other values: it loads, but the run may go on differently */
export function saveNote(file: Pick<SaveFile, 'gameVersion' | 'configHash'>, here: { gameVersion: string; configHash: string }): string | null {
  if (file.gameVersion !== here.gameVersion) {
    return `Saved with version ${file.gameVersion}, this is ${here.gameVersion}: values may differ.`;
  }
  if (file.configHash !== here.configHash) return 'Saved with other tower or enemy values: values may differ.';
  return null;
}

/** What the player reads when a save does not load. */
export function saveFileRefusalText(refusal: SaveFileRefusal): string {
  switch (refusal) {
    case 'not-a-save': return 'That file is no 3DTD save.';
    case 'too-big': return 'That file is far too big for a 3DTD save.';
    case 'damaged': return 'That save is damaged.';
    case 'version': return 'That save was written by a version of the game that saved in another format.';
  }
}

/** File name for a download: 3dtd-save-<place>-w<wave>.json.gz */
export function saveFileName(placeName: string, wave: number): string {
  const slug = placeName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'map';
  return `3dtd-save-${slug}-w${wave}.json.gz`;
}
