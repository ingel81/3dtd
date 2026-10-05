import type { GeoPosition } from '../models/game.types';
import type { GameRngState } from '../utils/game-rng';
import type { DirectorSave } from '../director/wave-director';
import { isWaveSourceId } from '../director/wave-source.registry';
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

/** Where the run is played: the place as the location dialog names it, its HQ and spawns */
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
 * The largest save read, bytes: a run of 80 waves with many towers is far
 * below (the world package is most of it), a file far above it is not one
 * the game wrote.
 */
export const MAX_SAVE_FILE_BYTES = 128 * 1024 * 1024;

/** Why a save cannot be loaded, null when it can. */
export type SaveFileRefusal = 'not-a-save' | 'too-big' | 'damaged' | 'version';

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isPlace = (v: unknown): boolean => isObject(v) && Number.isFinite(v['lat']) && Number.isFinite(v['lon']);

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
    && isObject(data.sim) && Array.isArray(data.sim['towers']) && isObject(data.sim['rng'])
    && isObject(director) && isWaveSourceId(director['source'])
    && (director['planned'] === null || isObject(director['planned']))
    && isObject(data.mainRng) && Number.isFinite(data.mainRng['seed']) && isObject(data.mainRng['streams'])
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
export function saveFileName(file: Pick<SaveFile, 'place' | 'wave'>): string {
  const slug = file.place.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'map';
  return `3dtd-save-${slug}-w${file.wave}.json.gz`;
}
