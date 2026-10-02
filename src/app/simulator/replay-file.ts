import type { CommandLogEntry } from '../managers/game-state/command-log';
import type { LosMaskJson } from '../utils/los-mask';
import { SIM_SNAPSHOT_VERSION } from './sim-snapshot';
import { replayable, type WaveRecord } from './sim-recorder';
import { STATE_HASH_VERSION } from './state-hash';

/**
 * Bumped whenever the file's shape changes; another version is refused. 3 keeps each line of sight once in
 * `masks` (serializeReplayFile); a file of version 2 holds them in place and still reads.
 */
export const REPLAY_FILE_VERSION = 3;
const READABLE_VERSIONS: readonly number[] = [2, REPLAY_FILE_VERSION];
const FORMAT = '3dtd-replay';

/**
 * The replayable waves of a run as a file (decision D4 of
 * docs/SIMULATOR_PLAN.md): their snapshots, configs and hashes and the part
 * of the command log they read. The same as a match log for coop later
 * (section 18 of docs/archive/MULTIPLAYER_CONCEPT.md): world key, config hash,
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
  /**
   * Every line of sight of the file once, in the text only: a tower's `losMask` in a snapshot and a log
   * command's `mask` hold an index into it there. readReplayFile puts the masks back in place.
   */
  masks?: LosMaskJson[];
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The keys a line of sight sits under: SavedTower.losMask, and `mask` of command:los-mask and los:resolved */
const MASK_KEYS = new Set(['losMask', 'mask']);

const isMaskJson = (v: unknown): v is LosMaskJson => isObject(v) && typeof v['bits'] === 'string'
  && typeof v['range'] === 'number' && typeof v['ground'] === 'boolean' && typeof v['air'] === 'boolean';

/**
 * The file as text with each line of sight once: a tower keeps its mask from wave to wave and the log
 * repeats it, so a long run held the same masks many times over (TODO E95). The masks go into a table at
 * the end, their places hold an index into it.
 */
export function serializeReplayFile(file: ReplayFile): string {
  const masks: LosMaskJson[] = [];
  const index = new Map<string, number>();
  const body = JSON.stringify({ ...file, masks: undefined }, (key, value: unknown) => {
    if (!MASK_KEYS.has(key) || !isMaskJson(value)) return value;
    const id = `${value.range}|${value.ground ? 1 : 0}|${value.air ? 1 : 0}|${value.bits}`;
    let at = index.get(id);
    if (at === undefined) {
      at = masks.length;
      masks.push({ range: value.range, ground: value.ground, air: value.air, bits: value.bits });
      index.set(id, at);
    }
    return at;
  });
  return `${body.slice(0, -1)},"masks":${JSON.stringify(masks)}}`;
}

/**
 * Put the masks of `table` back where serializeReplayFile left an index; false when an index points
 * nowhere or the table holds no mask.
 */
function expandMasks(data: { waves: unknown[]; log: unknown[] }, table: unknown): boolean {
  if (table === undefined) return true;
  if (!Array.isArray(table) || !table.every(isMaskJson)) return false;
  const masks = table as LosMaskJson[];
  const resolve = (holder: Record<string, unknown>, key: string): boolean => {
    const ref = holder[key];
    if (typeof ref !== 'number') return true;
    if (!Number.isInteger(ref) || ref < 0 || ref >= masks.length) return false;
    holder[key] = masks[ref];
    return true;
  };
  for (const wave of data.waves as Record<string, unknown>[]) {
    const towers = isObject(wave['snapshot']) ? wave['snapshot']['towers'] : undefined;
    if (!Array.isArray(towers)) continue;
    for (const tower of towers) if (isObject(tower) && !resolve(tower, 'losMask')) return false;
  }
  for (const entry of data.log as Record<string, unknown>[]) {
    if (!resolve(entry['command'] as Record<string, unknown>, 'mask')) return false;
  }
  return true;
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

const isStep = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;

/**
 * The waves and the log hold what the replay reads, of the types it reads them as: a wave a number, a config
 * object, its log start inside the log, its steps whole and in order, its hashes numbers, its snapshot an
 * object or null, its speeds [step, speed] pairs; a log entry a step, a player and a command with a type.
 * Anything else is a damaged or hand-made file, refused before the simulation reads it.
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
    && Array.isArray(w['hashes']) && (w['hashes'] as unknown[]).every((h) => typeof h === 'number')
    && (w['speeds'] === undefined || (Array.isArray(w['speeds']) && (w['speeds'] as unknown[]).every((s) => Array.isArray(s)
      && s.length === 2 && isStep(s[0]) && typeof s[1] === 'number' && s[1] > 0 && s[1] <= 75))));
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
  if (!READABLE_VERSIONS.includes(data.version as number) || data.snapshotVersion !== SIM_SNAPSHOT_VERSION) {
    return { file: null, refusal: 'version' };
  }
  const parts = data as { waves: unknown[]; log: unknown[] };
  if (!wellFormed(parts) || !expandMasks(parts, data.masks)) return { file: null, refusal: 'damaged' };
  delete data.masks;
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

/** A stream of the one chunk `bytes` (not Blob.stream, which not every runtime has) */
function streamOf(bytes: Uint8Array<ArrayBuffer>): ReadableStream<BufferSource> {
  return new ReadableStream<BufferSource>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

/** The file as a download: its text gzipped, which a long run's snapshots and log shrink to about a tenth */
export async function replayFileBlob(text: string): Promise<Blob> {
  const reader = streamOf(new TextEncoder().encode(text)).pipeThrough(new CompressionStream('gzip')).getReader();
  const chunks: BlobPart[] = [];
  for (let read = await reader.read(); !read.done; read = await reader.read()) chunks.push(read.value as BlobPart);
  return new Blob(chunks, { type: 'application/gzip' });
}

/**
 * The text of a replay file, gzipped (replayFileBlob) or plain as the game wrote it before; 'too-big' when
 * it unpacks to more than `max`, which stops reading there, and 'not-a-replay' when the gzip in it is broken.
 */
export async function replayFileText(blob: Blob, max = MAX_REPLAY_FILE_BYTES): Promise<string | 'too-big' | 'not-a-replay'> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const decoder = new TextDecoder();
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return decoder.decode(bytes);
  const reader = streamOf(bytes).pipeThrough(new DecompressionStream('gzip')).getReader();
  let text = '';
  let size = 0;
  try {
    for (let read = await reader.read(); !read.done; read = await reader.read()) {
      size += read.value.byteLength;
      if (size > max) {
        await reader.cancel();
        return 'too-big';
      }
      text += decoder.decode(read.value, { stream: true });
    }
  } catch {
    return 'not-a-replay';
  }
  return text + decoder.decode();
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

/** File name for a download: 3dtd-replay-<place>-w<first>-w<last>.json.gz */
export function replayFileName(file: ReplayFile, place: string): string {
  const waves = file.waves.map((w) => w.wave);
  const slug = place.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'map';
  return `3dtd-replay-${slug}-w${Math.min(...waves)}-w${Math.max(...waves)}.json.gz`;
}
