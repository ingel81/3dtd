/**
 * Seeded PRNG (mulberry32), 0..1, that can be seeded again: a caller that
 * draws a few numbers for each of many parts (a killed ooze's mess) keeps
 * one of these instead of a closure per part.
 */
export class SeededRandom {
  private state: number;

  constructor(seed = 0) {
    this.state = seed >>> 0;
  }

  /** Start over from `seed`. */
  seed(seed: number): this {
    this.state = seed >>> 0;
    return this;
  }

  /** The next number, 0..1; bound, so it passes as a `() => number`. */
  readonly next = (): number => {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A 32-bit seed from a string (FNV-1a), e.g. an enemy id. */
export function seedOf(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
