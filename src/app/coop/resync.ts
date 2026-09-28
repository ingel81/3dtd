import { TICK_SUB_STEPS } from './lockstep';
import { gunzipBase64, gzipBase64 } from '../utils/gzip-base64';
import type { WaveSnapshot } from '../simulator/wave-snapshot';

/**
 * Resync after a desync (docs/COOP_PLAN.md C5b, TODO E58). The relay holds
 * the room: no tick closes from `tick` on, so every client's simulation
 * stops at that tick's boundary (the lockstep barrier). There the host
 * takes its state and sends it; a guest loads it there and says so; then the
 * room goes on. No client runs past the boundary before the room goes on,
 * so nobody has to rewind or fast-forward.
 */

/** The relay takes messages up to 1 MB; the envelope needs a little of it */
export const RESYNC_MAX_GZ_CHARS = 1024 * 1024 - 4096;

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
  /** Host: the state, or null when it cannot be sent */
  state(tick: number, gz: string | null): void;
  /** Guest: loaded, or not */
  loaded(tick: number, ok: boolean): void;
}

export class ResyncDriver {
  private tick: number | null = null;
  private stateGz: string | null = null;
  private sent = false;
  private busy = false;

  constructor(
    private readonly isHost: () => boolean,
    private readonly game: ResyncGame,
    private readonly out: ResyncOut,
    private readonly warn: (text: string) => void = () => undefined,
  ) {}

  /** A resync is under way: the room holds at the boundary of this tick */
  get holdingAt(): number | null {
    return this.tick;
  }

  /** The relay holds the room at `tick`. */
  hold(tick: number): void {
    this.tick = tick;
    this.stateGz = null;
    this.sent = false;
  }

  /** Guest: the host's state for the resync at `tick`. */
  state(tick: number, gz: string): void {
    if (tick === this.tick) this.stateGz = gz;
  }

  /** The room goes on. */
  done(): void {
    this.tick = null;
    this.stateGz = null;
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
    try {
      const gz = await gzipBase64(JSON.stringify(snapshot));
      if (gz.length > RESYNC_MAX_GZ_CHARS) this.warn(`[Coop] resync: the state is ${Math.round(gz.length / 1024)} kB, more than the relay takes`);
      this.sendOnce(tick, gz.length > RESYNC_MAX_GZ_CHARS ? null : gz);
    } catch (error) {
      this.warn(`[Coop] resync: packing the state failed: ${String(error)}`);
      this.sendOnce(tick, null);
    }
  }

  private sendOnce(tick: number, gz: string | null): void {
    if (this.sent) return;
    this.sent = true;
    this.out.state(tick, gz);
  }

  private async loadState(tick: number, boundary: number): Promise<void> {
    const gz = this.stateGz;
    if (gz === null) return;
    this.stateGz = null;
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
