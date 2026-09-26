/**
 * Run logs the players send after a coop game (TODO E38): checked, kept as
 * gzip files under `<dir>/coop/<day>_<room>/`, both players' logs of a room
 * side by side, and pruned by age and total size. The relay collects only
 * with `--collect-runs`; the players agree in the game once (opt in).
 *
 * The check keeps junk out without trusting the client: a file has to be a
 * run log (JSONL, the head of this format, a game version) and every wave's
 * bookkeeping has to agree with what the game itself wrote into it. The
 * game writes a wave's mismatches into the record (reconcileWave); a log
 * made up by hand would have to fake both. A real run with a hole in its
 * bookkeeping still passes, and that hole is what the analysis wants.
 */
import { gunzipSync } from 'node:zlib';
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { RUN_LOG_FORMAT, reconcileWave, type ReconcilableWave } from '../../src/app/run-log/run-log-check.ts';

/** Largest run log after unpacking; a long game is a few MB */
const MAX_UNPACKED_BYTES = 32 * 1024 * 1024;
/** Records one log may hold */
const MAX_RECORDS = 400_000;

export interface RunStoreOptions {
  dir: string;
  /** All kept logs together, bytes; the oldest go first above it */
  maxBytes: number;
  /** Older logs are deleted, ms */
  maxAgeMs: number;
  now: () => number;
}

/** A kept log, for the status page */
export interface StoredRun {
  /** Relative to the store, with forward slashes: `coop/2026-09-26_ABC123/Ann_p1.jsonl.gz` */
  path: string;
  bytes: number;
  at: number;
}

/** Why a log was not kept, null when it was */
export function checkRunLog(text: string): string | null {
  const lines = text.split('\n').filter((line) => line.trim() !== '');
  if (lines.length === 0) return 'empty';
  if (lines.length > MAX_RECORDS) return 'too many records';
  let head: Record<string, unknown>;
  try {
    head = JSON.parse(lines[0]) as Record<string, unknown>;
  } catch {
    return 'not JSONL';
  }
  if (head['kind'] !== 'head' || head['format'] !== RUN_LOG_FORMAT) return 'not a run log of this format';
  if (typeof head['gameVersion'] !== 'string' || typeof head['runId'] !== 'string') return 'head incomplete';
  let waves = 0;
  for (let i = 1; i < lines.length; i++) {
    let record: Record<string, unknown>;
    try {
      record = JSON.parse(lines[i]) as Record<string, unknown>;
    } catch {
      return `line ${i + 1} is no JSON`;
    }
    if (record['kind'] !== 'wave') continue;
    waves++;
    let found: string[];
    try {
      found = reconcileWave(record as unknown as ReconcilableWave);
    } catch {
      return `wave record on line ${i + 1} is incomplete`;
    }
    const written = Array.isArray(record['mismatches']) ? record['mismatches'] as unknown[] : [];
    if (found.length !== written.length || found.some((m, k) => m !== written[k])) {
      return `wave ${String(record['wave'])} does not add up the way the game wrote it`;
    }
  }
  return waves > 0 ? null : 'no wave played';
}

/** A name that is safe as one path segment */
const segment = (text: string): string => text.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 40) || 'x';

export class RunStore {
  private readonly root: string;
  private readonly options: RunStoreOptions;

  constructor(options: RunStoreOptions) {
    this.options = options;
    this.root = resolve(options.dir);
    mkdirSync(this.root, { recursive: true });
  }

  /**
   * Keep the log `gzBase64` of `playerId` from room `room`. One log per
   * player and room; the answer says why not when it was refused.
   */
  accept(room: string, playerId: string, name: string, gzBase64: string): { ok: true; path: string } | { ok: false; reason: string } {
    let packed: Buffer;
    let text: string;
    try {
      packed = Buffer.from(gzBase64, 'base64');
      text = gunzipSync(packed, { maxOutputLength: MAX_UNPACKED_BYTES }).toString('utf8');
    } catch {
      return { ok: false, reason: 'not gzip or too large' };
    }
    const problem = checkRunLog(text);
    if (problem) return { ok: false, reason: problem };
    const day = new Date(this.options.now()).toISOString().slice(0, 10);
    const folder = join(this.root, 'coop', `${day}_${segment(room)}`);
    const file = join(folder, `${segment(name)}_${segment(playerId)}.jsonl.gz`);
    if (existsSync(file)) return { ok: false, reason: 'already sent' };
    mkdirSync(folder, { recursive: true });
    writeFileSync(file, packed);
    this.prune();
    return { ok: true, path: this.relativePath(file) };
  }

  /** Every kept log, newest first */
  list(): StoredRun[] {
    return this.files().sort((a, b) => b.at - a.at).map(({ file, bytes, at }) => ({ path: this.relativePath(file), bytes, at }));
  }

  /** The bytes of a kept log by its listed path, null for anything else */
  read(path: string): Buffer | null {
    const file = resolve(this.root, path);
    if (!file.startsWith(this.root + sep) || !file.endsWith('.jsonl.gz')) return null;
    try {
      return readFileSync(file);
    } catch {
      return null;
    }
  }

  /** Delete what is too old, then the oldest until the rest fits */
  prune(): void {
    const now = this.options.now();
    const files = this.files().sort((a, b) => a.at - b.at);
    let total = files.reduce((sum, f) => sum + f.bytes, 0);
    for (const f of files) {
      if (now - f.at <= this.options.maxAgeMs && total <= this.options.maxBytes) break;
      rmSync(f.file, { force: true });
      total -= f.bytes;
    }
    this.removeEmptyFolders();
  }

  private files(): { file: string; bytes: number; at: number }[] {
    const found: { file: string; bytes: number; at: number }[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.jsonl.gz')) {
          const stat = statSync(full);
          found.push({ file: full, bytes: stat.size, at: stat.mtimeMs });
        }
      }
    };
    walk(this.root);
    return found;
  }

  private removeEmptyFolders(): void {
    const coop = join(this.root, 'coop');
    if (!existsSync(coop)) return;
    for (const entry of readdirSync(coop, { withFileTypes: true })) {
      const folder = join(coop, entry.name);
      if (entry.isDirectory() && readdirSync(folder).length === 0) rmSync(folder, { recursive: true, force: true });
    }
  }

  private relativePath(file: string): string {
    return relative(this.root, file).split(sep).join('/');
  }
}
