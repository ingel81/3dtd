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

/** Every stream, in a fixed order for the snapshot. */
export const RNG_STREAMS: readonly RngStream[] = ['director', 'spawn', 'enemy', 'bot'];

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
  private readonly streams = new Map<RngStream, MulberryStream>();
  private pendingSeed: number | null = null;

  constructor(seed: number = newRunSeed()) {
    this._seed = seed >>> 0;
  }

  get seed(): number {
    return this._seed;
  }

  /**
   * The stream for `name`, created on first use. Always the same function for
   * the same name, also across resets and restores, so a caller can hold on
   * to it: the wave and enemy managers take theirs once when a location loads.
   */
  stream(name: RngStream): () => number {
    return this.streamFor(name).next;
  }

  /**
   * The seed the next reset takes, instead of a fresh one.
   *
   * The bot server names the seed of a run before that run starts, and the
   * restart in between resets the source. Setting the seed by hand and then
   * restarting threw it away again, so the log's head and the dice went
   * separate ways. The wish is kept here until the reset picks it up.
   */
  useNextSeed(seed: number): void {
    this.pendingSeed = seed >>> 0;
  }

  /**
   * New run: the seed that was given, else the one asked for with
   * `useNextSeed`, else a fresh one. Every stream starts over in place, so the
   * functions handed out keep working and draw from the new seed.
   */
  reset(seed?: number): void {
    this._seed = (seed ?? this.pendingSeed ?? newRunSeed()) >>> 0;
    this.pendingSeed = null;
    for (const [name, stream] of this.streams) stream.state = streamSeed(this._seed, name);
  }

  /**
   * Where the run's random source stands: the seed and the position of every
   * stream. Plain data, for the snapshot a wave is re-simulated from
   * (docs/SIMULATOR_PLAN.md, P4).
   */
  getState(): GameRngState {
    const streams: Partial<Record<RngStream, number>> = {};
    for (const name of RNG_STREAMS) streams[name] = this.streamFor(name).state;
    return { seed: this._seed, streams };
  }

  /** Put the source back where getState() found it. The functions handed out stay the same. */
  setState(state: GameRngState): void {
    this._seed = state.seed >>> 0;
    for (const name of RNG_STREAMS) {
      this.streamFor(name).state = (state.streams[name] ?? streamSeed(this._seed, name)) >>> 0;
    }
  }

  private streamFor(name: RngStream): MulberryStream {
    let stream = this.streams.get(name);
    if (!stream) {
      stream = new MulberryStream(streamSeed(this._seed, name));
      this.streams.set(name, stream);
    }
    return stream;
  }
}

/** Seed and stream positions of a GameRng, see GameRng.getState. */
export interface GameRngState {
  seed: number;
  streams: Partial<Record<RngStream, number>>;
}

/**
 * mulberry32 with its state in the open: the same numbers as mulberry32(seed),
 * but the state can be read and set, and `next` stays the same function.
 */
class MulberryStream {
  constructor(public state: number) {
    this.state = state >>> 0;
  }

  readonly next = (): number => {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    const a = this.state;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
