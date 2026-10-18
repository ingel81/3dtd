/**
 * The state of the host for the status page: Overpass's own status and the
 * date of its data, the size of the database and the room on its disk, the
 * memory of the Overpass container (start-overpass.sh writes it) and of the
 * machine, and how far a clone under way has come.
 */
import { existsSync, readdirSync, readFileSync, statfsSync, statSync } from 'node:fs';
import { join } from 'node:path';

export interface OverpassState {
  reachable: boolean;
  /** /api/timestamp: the time of the newest data in the database */
  dataUntil: string | null;
  slotsFree: number | null;
  rateLimit: number | null;
  /** Queries running in Overpass right now */
  running: number | null;
  error: string | null;
}

export interface HostState {
  overpass: OverpassState;
  disk: { totalBytes: number; freeBytes: number } | null;
  /** Bytes the database's files take on the disk */
  dbBytes: number | null;
  /** The memory of the Overpass container: in use, its limit, of it the processes' own and the file cache */
  overpassMemory: { current: number; max: number | null; anon: number | null; file: number | null; ageS: number } | null;
  hostMemory: { totalBytes: number; availableBytes: number } | null;
  clone: { maintenance: boolean; complete: boolean; totalBytes: number | null; source: string | null; finished: string | null };
}

const read = (path: string): string | null => {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
};

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

/** The lines of Overpass's /api/status read, as far as the page shows them */
export function parseOverpassStatus(text: string): Pick<OverpassState, 'slotsFree' | 'rateLimit' | 'running'> {
  const rate = /^Rate limit: (\d+)/m.exec(text);
  const free = /^(\d+) slots available now/m.exec(text);
  const running = text.split(/Currently running queries[^\n]*\n/)[1];
  return {
    rateLimit: rate ? Number(rate[1]) : null,
    slotsFree: free ? Number(free[1]) : null,
    running: running === undefined ? null : running.split('\n').filter((line) => /^\d+\s/.test(line.trim())).length,
  };
}

export async function overpassState(api: string): Promise<OverpassState> {
  const base = api.replace(/\/+$/, '');
  try {
    const [status, stamp] = await Promise.all([fetchText(`${base}/status`), fetchText(`${base}/timestamp`)]);
    return { reachable: true, dataUntil: stamp.trim() || null, ...parseOverpassStatus(status), error: null };
  } catch (error) {
    return {
      reachable: false, dataUntil: null, slotsFree: null, rateLimit: null, running: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Bytes the files below `dir` take on the disk (blocks, so a file a clone is still filling counts what it has) */
function diskUsage(dir: string, depth = 2): number {
  let bytes = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (depth > 0) bytes += diskUsage(path, depth - 1);
    } else if (entry.isFile()) {
      bytes += statSync(path).blocks * 512;
    }
  }
  return bytes;
}

/** The database's size changes only during a clone; measured at most once a minute */
let usage: { at: number; bytes: number | null } = { at: -Infinity, bytes: null };

export async function hostState(api: string, dbDir: string, sharedDir: string, now = Date.now()): Promise<HostState> {
  let disk: HostState['disk'] = null;
  try {
    const fs = statfsSync(dbDir);
    disk = { totalBytes: fs.blocks * fs.bsize, freeBytes: fs.bavail * fs.bsize };
  } catch {
    // not mounted
  }
  const maintenance = existsSync(join(sharedDir, 'maintenance'));
  if (now - usage.at > (maintenance ? 10_000 : 60_000)) {
    try {
      usage = { at: now, bytes: diskUsage(join(dbDir, 'db')) };
    } catch {
      usage = { at: now, bytes: null };
    }
  }
  let overpassMemory: HostState['overpassMemory'] = null;
  try {
    const m = JSON.parse(read(join(sharedDir, 'overpass-memory.json')) ?? 'null') as
      { t: number; current: number; max: number | null; anon: number | null; file: number | null } | null;
    if (m) overpassMemory = { current: m.current, max: m.max, anon: m.anon, file: m.file, ageS: Math.round(now / 1000 - m.t) };
  } catch {
    // half written
  }
  const meminfo = read('/proc/meminfo') ?? '';
  const kb = (name: string): number | null => {
    const match = new RegExp(`^${name}:\\s+(\\d+) kB`, 'm').exec(meminfo);
    return match ? Number(match[1]) * 1024 : null;
  };
  const total = kb('MemTotal');
  const available = kb('MemAvailable');
  const totalBytes = Number(read(join(dbDir, 'clone', 'total-bytes'))?.trim());
  const done = read(join(dbDir, 'clone', 'done'))?.trim().split(' ') ?? null;
  return {
    overpass: await overpassState(api),
    disk,
    dbBytes: usage.bytes,
    overpassMemory,
    hostMemory: total !== null && available !== null ? { totalBytes: total, availableBytes: available } : null,
    clone: {
      maintenance,
      complete: existsSync(join(dbDir, 'init_done')),
      totalBytes: Number.isFinite(totalBytes) && totalBytes > 0 ? totalBytes : null,
      source: read(join(dbDir, 'clone', 'base-url'))?.trim() ?? done?.[1] ?? null,
      finished: done?.[0] ?? null,
    },
  };
}
