import type { CommandLogEntry } from '../managers/game-state/command-log';
import { SIM_SNAPSHOT_VERSION } from './sim-snapshot';
import { replayable, type WaveRecord } from './sim-recorder';
import { STATE_HASH_VERSION } from './state-hash';

/** Bumped whenever the file's shape changes; another version is refused. */
export const REPLAY_FILE_VERSION = 2;
const FORMAT = '3dtd-replay';

/**
 * The replayable waves of a run as a file (decision D4 of
 * docs/SIMULATOR_PLAN.md): their snapshots, configs and hashes and the part
 * of the command log they read. The same as a match log for coop later
 * (section 18 of docs/MULTIPLAYER_CONCEPT.md): world key, config hash,
 * seed, inputs.
 *
 * The world is not in it: a replay re-simulates on the world it was played
 * on, so the file carries a key of it and only loads where the key matches.
 */
export interface ReplayFile {
  format: typeof FORMAT;
  version: number;
  snapshotVersion: number;
  /**
   * STATE_HASH_VERSION of the hashes in `waves`; missing in files before it
   * came, which read as 1. Another version plays without its hashes checked.
   */
  hashVersion?: number;
  /** GameStateManager.worldKey of the world it was played on */
  worldKey: string;
  /** run-log/config-hash.ts: the balance it was played with */
  configHash: string;
  /**
   * The game version (BUILD_VERSION) and commit it was played with. The
   * config hash covers the balance tables, not the code: a replay of another
   * version loads, but may differ where the code changed (readReplayFile
   * says so in `note`).
   */
  gameVersion: string;
  commit: string;
  /** The run's seed, for the record; the snapshots carry the streams */
  seed: number;
  createdAt: string;
  waves: WaveRecord[];
  /** The log from the first wave's inputs to the last one's end; WaveRecord.logStart points into it */
  log: CommandLogEntry[];
}

/** The replayable waves of `records` with the log they need, logStart moved into the slice. */
export function buildReplayFile(
  records: readonly WaveRecord[],
  log: readonly CommandLogEntry[],
  head: { worldKey: string; configHash: string; seed: number; gameVersion: string; commit: string },
  now: Date = new Date(),
): ReplayFile {
  const waves = records.filter(replayable);
  const from = waves.length > 0 ? Math.min(...waves.map((w) => w.logStart)) : 0;
  const lastStep = waves.length > 0 ? Math.max(...waves.map((w) => w.endStep ?? 0)) : 0;
  let to = from;
  while (to < log.length && log[to].step <= lastStep) to++;
  return {
    format: FORMAT,
    version: REPLAY_FILE_VERSION,
    snapshotVersion: SIM_SNAPSHOT_VERSION,
    hashVersion: STATE_HASH_VERSION,
    ...head,
    createdAt: now.toISOString(),
    waves: waves.map((w) => ({ ...w, logStart: w.logStart - from })),
    log: log.slice(from, to),
  };
}

/**
 * The largest replay file read, bytes. A full run to wave 60 is about 6 MB; a file far above that is not one
 * the game wrote, and parsing it could freeze the tab.
 */
export const MAX_REPLAY_FILE_BYTES = 64 * 1024 * 1024;

/** Why a file cannot be replayed here, null when it can. */
export type ReplayFileRefusal = 'not-a-replay' | 'too-big' | 'damaged' | 'version' | 'other-world' | 'other-balance' | 'empty';

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStep = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;

/**
 * The waves and the log hold what the replay reads, of the types it reads them as: a wave a number, a config
 * object, its log start inside the log, its steps whole and in order, its hashes numbers, its snapshot an
 * object or null; a log entry a step, a player and a command with a type. Anything else is a damaged or
 * hand-made file, refused before the simulation reads it.
 */
function wellFormed(data: { waves: unknown[]; log: unknown[] }): boolean {
  const logOk = data.log.every((e) => isObject(e) && isStep(e['step']) && typeof e['playerId'] === 'string'
    && isObject(e['command']) && typeof e['command']['type'] === 'string');
  if (!logOk) return false;
  return data.waves.every((w) => isObject(w)
    && Number.isInteger(w['wave'])
    && isObject(w['config'])
    && (w['snapshot'] === null || isObject(w['snapshot']))
    && isStep(w['startStep'])
    && isStep(w['logStart']) && (w['logStart'] as number) <= data.log.length
    && (w['endStep'] === null || (isStep(w['endStep']) && (w['endStep'] as number) >= (w['startStep'] as number)))
    && Array.isArray(w['hashes']) && (w['hashes'] as unknown[]).every((h) => typeof h === 'number'));
}

/**
 * Parse `text` and check it against the world and balance loaded now. A file
 * of another game version loads, with `note` naming the version it was saved
 * with: the code may have changed since, and the replay may then differ. A
 * file whose hashes came about another way (hashVersion) loads without them, so
 * the replay does not report a divergence that is none.
 */
export function readReplayFile(
  text: string,
  here: { worldKey: string; configHash: string; gameVersion: string },
): { file: ReplayFile; refusal: null; note: string | null } | { file: null; refusal: ReplayFileRefusal } {
  // UTF-16 code units, at least the bytes of any ASCII file: a cap for a file that came another way than loadFile
  if (text.length > MAX_REPLAY_FILE_BYTES) return { file: null, refusal: 'too-big' };
  let data: Partial<ReplayFile>;
  try {
    data = JSON.parse(text) as Partial<ReplayFile>;
  } catch {
    return { file: null, refusal: 'not-a-replay' };
  }
  if (data?.format !== FORMAT || !Array.isArray(data.waves) || !Array.isArray(data.log)) {
    return { file: null, refusal: 'not-a-replay' };
  }
  if (data.version !== REPLAY_FILE_VERSION || data.snapshotVersion !== SIM_SNAPSHOT_VERSION) {
    return { file: null, refusal: 'version' };
  }
  if (!wellFormed(data as { waves: unknown[]; log: unknown[] })) return { file: null, refusal: 'damaged' };
  if (data.worldKey !== here.worldKey) return { file: null, refusal: 'other-world' };
  if (data.configHash !== here.configHash) return { file: null, refusal: 'other-balance' };
  if (data.waves.length === 0) return { file: null, refusal: 'empty' };
  const notes: string[] = [];
  if (data.gameVersion && data.gameVersion !== here.gameVersion) {
    notes.push(`Saved with ${data.gameVersion}, this is ${here.gameVersion}: the replay may differ.`);
  }
  const file = data as ReplayFile;
  if ((data.hashVersion ?? 1) !== STATE_HASH_VERSION) {
    notes.push('Its checksums are of an older kind: it plays without the divergence check.');
    file.waves = file.waves.map((wave) => ({ ...wave, hashes: [] }));
  }
  return { file, refusal: null, note: notes.length > 0 ? notes.join(' ') : null };
}

/** What the player reads when a file does not load. */
export function replayFileRefusalText(refusal: ReplayFileRefusal): string {
  switch (refusal) {
    case 'not-a-replay': return 'That file is no 3DTD replay.';
    case 'too-big': return 'That file is far too big for a 3DTD replay.';
    case 'damaged': return 'That replay file is damaged.';
    case 'version': return 'That replay was saved by another version of the game.';
    case 'other-world': return 'That replay was played on another map. Load the same place first.';
    case 'other-balance': return 'That replay was played with other tower or enemy values.';
    case 'empty': return 'That replay holds no wave.';
  }
}

/** File name for a download: 3dtd-replay-<place>-w<first>-w<last>.json */
export function replayFileName(file: ReplayFile, place: string): string {
  const waves = file.waves.map((w) => w.wave);
  const slug = place.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'map';
  return `3dtd-replay-${slug}-w${Math.min(...waves)}-w${Math.max(...waves)}.json`;
}
