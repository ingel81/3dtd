/**
 * Seeded randomness for everything that decides how a run plays out.
 *
 * One run seed per game, and one independent stream per system. Separate
 * streams are the point: if a bot places a tower differently, that must not
 * shift which enemy spawns where, otherwise an A/B comparison measures the
 * random source instead of the rule (BALANCING_PLAN.md, section 5).
 *
 * VFX and audio keep `Math.random`. They do not affect the simulation, and
 * pulling them through a stream would make every visual effect a determinism
 * hazard for no gain.
 *
 * Gleicher Seed heißt gleiche Wellen, solange der Spielverlauf gleich ist:
 * Überlebbarkeits-Deckel und Leck-Regler lesen die Verteidigung und die Lecks,
 * die Wellen hängen also am Spiel. Bit-gleiche Läufe gibt es erst mit Stufe 2
 * (Replay als Neu-Simulation).
 */

/** The systems that draw from the run seed. */
export type RngStream = 'director' | 'spawn' | 'enemy' | 'bot';

/**
 * mulberry32: 32 bit state, one multiply-xorshift round. Small, fast and
 * stable across engines, which matters because a reference run has to give
 * the same numbers in a spec, in Chrome and in Firefox.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** fnv1a over a stream name, mixed with the run seed. */
function streamSeed(seed: number, stream: string): number {
  let h = 0x811c9dc5 ^ (seed >>> 0);
  for (let i = 0; i < stream.length; i++) {
    h ^= stream.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** A fresh run seed. The one place gameplay randomness starts from the clock. */
export function newRunSeed(): number {
  return (Math.random() * 0xffffffff) >>> 0;
}

/**
 * The run's random source. Held by the GameStateManager, reset with the run.
 *
 * The seed stays internal (decision D11): it goes into the run log, the bots
 * and the analysis, players neither see nor share it.
 */
export class GameRng {
  private _seed: number;
  private streams = new Map<RngStream, () => number>();

  constructor(seed: number = newRunSeed()) {
    this._seed = seed >>> 0;
  }

  get seed(): number {
    return this._seed;
  }

  /**
   * The stream for `name`, created on first use. Always the same function for
   * the same name, so a caller can hold on to it.
   */
  stream(name: RngStream): () => number {
    let next = this.streams.get(name);
    if (!next) {
      next = mulberry32(streamSeed(this._seed, name));
      this.streams.set(name, next);
    }
    return next;
  }

  /** New run: a fresh seed unless one is given, and every stream starts over. */
  reset(seed: number = newRunSeed()): void {
    this._seed = seed >>> 0;
    this.streams.clear();
  }
}
