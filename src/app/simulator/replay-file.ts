import type { CommandLogEntry } from '../managers/game-state/command-log';
import { SIM_SNAPSHOT_VERSION } from './sim-snapshot';
import { replayable, type WaveRecord } from './sim-recorder';

/** Bumped whenever the file's shape changes; another version is refused. */
export const REPLAY_FILE_VERSION = 1;
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
  /** GameStateManager.worldKey of the world it was played on */
  worldKey: string;
  /** run-log/config-hash.ts: the balance it was played with */
  configHash: string;
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
  head: { worldKey: string; configHash: string; seed: number },
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
    ...head,
    createdAt: now.toISOString(),
    waves: waves.map((w) => ({ ...w, logStart: w.logStart - from })),
    log: log.slice(from, to),
  };
}

/** Why a file cannot be replayed here, null when it can. */
export type ReplayFileRefusal = 'not-a-replay' | 'version' | 'other-world' | 'other-balance' | 'empty';

/** Parse `text` and check it against the world and balance loaded now. */
export function readReplayFile(
  text: string,
  here: { worldKey: string; configHash: string },
): { file: ReplayFile; refusal: null } | { file: null; refusal: ReplayFileRefusal } {
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
  if (data.worldKey !== here.worldKey) return { file: null, refusal: 'other-world' };
  if (data.configHash !== here.configHash) return { file: null, refusal: 'other-balance' };
  if (data.waves.length === 0) return { file: null, refusal: 'empty' };
  return { file: data as ReplayFile, refusal: null };
}

/** What the player reads when a file does not load. */
export function replayFileRefusalText(refusal: ReplayFileRefusal): string {
  switch (refusal) {
    case 'not-a-replay': return 'That file is no 3DTD replay.';
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
