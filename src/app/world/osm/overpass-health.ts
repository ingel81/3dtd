/**
 * How the Overpass servers fared lately, so that a load asks first the ones
 * that answer: per server its last attempts (answered or failed, how long)
 * and a pause it asked for. In memory for the session and, where the realm
 * has localStorage (the page, not the OSM worker), small in it for
 * HEALTH_TTL_MS, so a reload does not begin again with the server that just
 * failed. Every storage access sits in try/catch: a private window or blocked
 * site data leaves only the memory.
 */
import type { OverpassServer } from './overpass-servers';

/** One attempt at a server */
export interface OverpassAttempt {
  /** Date.now() at its end */
  at: number;
  ok: boolean;
  /** From the request to the end of the answer or the failure */
  ms: number;
}

interface ServerHealth {
  attempts: OverpassAttempt[];
  /** Date.now() before which the server is not asked (429, 406, Retry-After); 0 for none */
  pausedUntil: number;
}

/** Attempts kept per server */
const KEPT_ATTEMPTS = 6;

/** How long an attempt counts, here and in localStorage */
export const HEALTH_TTL_MS = 30 * 60_000;

/**
 * How long a server whose last attempt failed stays behind the others: asked
 * only after them, not left out (it may be the only one that comes back)
 */
export const FAILED_BEHIND_MS = 2 * 60_000;

export const HEALTH_STORAGE_KEY = '3dtd-overpass-health';

/** The realm's localStorage, or null where there is none or it may not be touched */
function defaultStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export class OverpassHealth {
  private readonly servers = new Map<string, ServerHealth>();

  constructor(
    private readonly storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null = defaultStorage(),
    private readonly now: () => number = Date.now,
  ) {
    this.restore();
  }

  /** Count an attempt at `url` */
  record(url: string, ok: boolean, ms: number): void {
    const health = this.of(url);
    health.attempts.push({ at: this.now(), ok, ms: Math.round(ms) });
    if (health.attempts.length > KEPT_ATTEMPTS) health.attempts.splice(0, health.attempts.length - KEPT_ATTEMPTS);
    this.save();
  }

  /** Ask `url` nothing for `ms` from now; a longer pause already set stays */
  pause(url: string, ms: number): void {
    const health = this.of(url);
    health.pausedUntil = Math.max(health.pausedUntil, this.now() + ms);
    this.save();
  }

  /** Date.now() before which `url` is not asked; 0 when it may be asked now */
  pausedUntil(url: string): number {
    const until = this.servers.get(url)?.pausedUntil ?? 0;
    return until > this.now() ? until : 0;
  }

  /**
   * `servers` in the order a load asks them: a paused server last, a server
   * whose last attempt failed within FAILED_BEHIND_MS behind the others, the
   * regional before the global ones, then more answers than failures in the
   * last attempts, then the faster answers; the order of `servers` where
   * nothing tells them apart (nothing known of either).
   */
  order(servers: readonly OverpassServer[]): OverpassServer[] {
    const now = this.now();
    const ranked = servers.map((server, index) => {
      const attempts = this.recent(server.url, now);
      const last = attempts[attempts.length - 1];
      const answers = attempts.filter((a) => a.ok);
      return {
        server,
        index,
        paused: this.pausedUntil(server.url) > 0 ? 1 : 0,
        behind: last && !last.ok && now - last.at < FAILED_BEHIND_MS ? 1 : 0,
        global: server.coverage ? 0 : 1,
        score: answers.length - (attempts.length - answers.length),
        ms: answers.length ? answers.reduce((sum, a) => sum + a.ms, 0) / answers.length : null,
      };
    });
    ranked.sort((a, b) =>
      a.paused - b.paused || a.behind - b.behind || a.global - b.global || b.score - a.score ||
      (a.ms !== null && b.ms !== null ? a.ms - b.ms : 0) || a.index - b.index,
    );
    return ranked.map((r) => r.server);
  }

  /** Forget everything, here and in storage */
  clear(): void {
    this.servers.clear();
    try {
      this.storage?.removeItem(HEALTH_STORAGE_KEY);
    } catch {
      // Storage blocked: the memory is cleared all the same
    }
  }

  private recent(url: string, now: number): OverpassAttempt[] {
    return (this.servers.get(url)?.attempts ?? []).filter((a) => now - a.at < HEALTH_TTL_MS);
  }

  private of(url: string): ServerHealth {
    let health = this.servers.get(url);
    if (!health) {
      health = { attempts: [], pausedUntil: 0 };
      this.servers.set(url, health);
    }
    return health;
  }

  private restore(): void {
    let stored: Record<string, ServerHealth> | null;
    try {
      const text = this.storage?.getItem(HEALTH_STORAGE_KEY);
      stored = text ? (JSON.parse(text) as Record<string, ServerHealth>) : null;
    } catch {
      return;
    }
    if (!stored || typeof stored !== 'object') return;
    const now = this.now();
    for (const [url, health] of Object.entries(stored)) {
      if (!health || !Array.isArray(health.attempts)) continue;
      const attempts = health.attempts.filter(
        (a) => a && typeof a.at === 'number' && typeof a.ms === 'number' && typeof a.ok === 'boolean' && now - a.at < HEALTH_TTL_MS,
      );
      const pausedUntil = typeof health.pausedUntil === 'number' && health.pausedUntil > now ? health.pausedUntil : 0;
      if (attempts.length || pausedUntil) this.servers.set(url, { attempts: attempts.slice(-KEPT_ATTEMPTS), pausedUntil });
    }
  }

  private save(): void {
    if (!this.storage) return;
    const now = this.now();
    const kept: Record<string, ServerHealth> = {};
    for (const [url, health] of this.servers) {
      const attempts = health.attempts.filter((a) => now - a.at < HEALTH_TTL_MS);
      if (attempts.length || health.pausedUntil > now) kept[url] = { attempts, pausedUntil: health.pausedUntil };
    }
    try {
      this.storage.setItem(HEALTH_STORAGE_KEY, JSON.stringify(kept));
    } catch {
      // Storage full or blocked: the memory keeps it for the session
    }
  }
}

/** The health the loads of this realm share */
export const overpassHealth = new OverpassHealth();
