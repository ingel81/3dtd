import { TICK_SUB_STEPS } from './lockstep';
import { gunzipBase64, gzipBase64 } from '../utils/gzip-base64';
import type { WaveSnapshot } from '../simulator/wave-snapshot';
import { MAX_RESYNC_PARTS } from './protocol';

/**
 * Resync after a desync (docs/COOP_PLAN.md C5b, TODO E58). The relay holds
 * the room: no tick closes from `tick` on, so every client's simulation
 * stops at that tick's boundary (the lockstep barrier). There the host
 * takes its state and sends it; a guest loads it there and says so; then the
 * room goes on. No client runs past the boundary before the room goes on,
 * so nobody has to rewind or fast-forward.
 */

/**
 * The relay takes messages up to 1 MB and 4 MB a second from one
 * connection: a state goes in pieces of at most this many characters (a
 * multiple of 4, so every piece is base64 of its own), a piece every
 * RESYNC_PART_GAP_MS.
 */
export const RESYNC_PART_CHARS = 768 * 1024;
export const RESYNC_PART_GAP_MS = 250;


/** What the resync needs of the game */
export interface ResyncGame {
  /** Sub-steps run so far; at a tick's boundary it is tick × TICK_SUB_STEPS */
  subStep(): number;
  /** Why the state cannot be taken now (debug enemies and the like), null when it can */
  refusal(): string | null;
  capture(): WaveSnapshot;
  restore(snapshot: WaveSnapshot): void;
}

/** What the resync sends */
export interface ResyncOut {
  /** Host: a piece of the state (`part` of `parts`, from 0), or null when it cannot be sent */
  state(tick: number, gz: string | null, part: number, parts: number): void;
  /** Guest: loaded, or not */
  loaded(tick: number, ok: boolean): void;
}

export class ResyncDriver {
  private tick: number | null = null;
  /** Guest: the pieces of the host's state so far */
  private pieces: string[] = [];
  private piecesExpected = 0;
  private sent = false;
  private busy = false;

  constructor(
    private readonly isHost: () => boolean,
    private readonly game: ResyncGame,
    private readonly out: ResyncOut,
    private readonly warn: (text: string) => void = () => undefined,
    /** Waits between two pieces; the spec passes one that does not */
    private readonly wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  ) {}

  /** A resync is under way: the room holds at the boundary of this tick */
  get holdingAt(): number | null {
    return this.tick;
  }

  /** The relay holds the room at `tick`. */
  hold(tick: number): void {
    this.tick = tick;
    this.pieces = [];
    this.piecesExpected = 0;
    this.sent = false;
  }

  /** Guest: a piece of the host's state for the resync at `tick` (`part` of `parts`, from 0). */
  state(tick: number, gz: string, part = 0, parts = 1): void {
    if (tick !== this.tick) return;
    // Pieces come in order; one out of it starts the state over and it will not load
    if (part !== this.pieces.length) {
      this.warn(`[Coop] resync: piece ${part + 1} of ${parts} out of order`);
      this.pieces = [];
      return;
    }
    this.pieces.push(gz);
    this.piecesExpected = parts;
  }

  /** The room goes on. */
  done(): void {
    this.tick = null;
    this.pieces = [];
    this.piecesExpected = 0;
  }

  /** Guest: every piece of the state is here */
  private get stateComplete(): boolean {
    return this.piecesExpected > 0 && this.pieces.length === this.piecesExpected;
  }

  /** Call often while holding: acts once the simulation stands at the boundary. */
  async poll(): Promise<void> {
    const tick = this.tick;
    if (tick === null || this.busy) return;
    const boundary = tick * TICK_SUB_STEPS;
    const at = this.game.subStep();
    if (at < boundary) return;
    const host = this.isHost();
    if (at > boundary) {
      // The barrier should make this impossible; a state from the boundary would be wrong here
      this.warn(`[Coop] resync: past the boundary of tick ${tick} (sub-step ${at})`);
      if (host) this.sendOnce(tick, null);
      else this.out.loaded(tick, false);
      this.tick = null;
      return;
    }
    this.busy = true;
    try {
      if (host) await this.sendState(tick);
      else await this.loadState(tick, boundary);
    } finally {
      this.busy = false;
    }
  }

  private async sendState(tick: number): Promise<void> {
    if (this.sent) return;
    const refusal = this.game.refusal();
    if (refusal) {
      this.warn(`[Coop] resync: the state cannot be taken now (${refusal})`);
      return this.sendOnce(tick, null);
    }
    // Taken at once: the simulation stands at the boundary now
    const snapshot = this.game.capture();
    let gz: string;
    try {
      gz = await gzipBase64(JSON.stringify(snapshot));
    } catch (error) {
      this.warn(`[Coop] resync: packing the state failed: ${String(error)}`);
      return this.sendOnce(tick, null);
    }
    const parts = Math.ceil(gz.length / RESYNC_PART_CHARS);
    if (parts > MAX_RESYNC_PARTS) {
      this.warn(`[Coop] resync: the state is ${Math.round(gz.length / 1024)} kB, more than ${MAX_RESYNC_PARTS} pieces`);
      return this.sendOnce(tick, null);
    }
    this.sent = true;
    for (let part = 0; part < parts; part++) {
      if (part > 0) await this.wait(RESYNC_PART_GAP_MS);
      // The room went on meanwhile (timeout): the rest would go nowhere
      if (this.tick !== tick) return;
      this.out.state(tick, gz.slice(part * RESYNC_PART_CHARS, (part + 1) * RESYNC_PART_CHARS), part, parts);
    }
  }

  private sendOnce(tick: number, gz: string | null): void {
    if (this.sent) return;
    this.sent = true;
    this.out.state(tick, gz, 0, 1);
  }

  private async loadState(tick: number, boundary: number): Promise<void> {
    if (!this.stateComplete) return;
    const gz = this.pieces.join('');
    this.pieces = [];
    this.piecesExpected = 0;
    try {
      const snapshot = JSON.parse(await gunzipBase64(gz)) as WaveSnapshot;
      // Still at the boundary: the room holds until every guest answered
      if (this.tick !== tick || this.game.subStep() !== boundary) return;
      this.game.restore(snapshot);
      this.out.loaded(tick, true);
    } catch (error) {
      this.warn(`[Coop] resync: loading the host's state failed: ${String(error)}`);
      this.out.loaded(tick, false);
    }
    this.tick = null;
  }
}
