import { clearStrikeEffects } from '../three-engine/strike-effects';
import type { GameStateManager } from '../managers/game-state.manager';
import { GameClock } from '../managers/game-state/game-clock';
import type { ThreeTilesEngine } from '../three-engine';
import { Resimulation } from './resimulation';
import type { SimSnapshot } from './sim-snapshot';
import type { WaveRecord } from './sim-recorder';
import type { CommandLogEntry } from '../managers/game-state/command-log';

/**
 * A replay as a re-simulation (docs/SIMULATOR_PLAN.md, P6, decision D1):
 * the live state is kept as a snapshot, the wave is re-simulated from its
 * own snapshot with the real renderers, and leaving puts the live state
 * back. The replay shows what the game shows because it is the game: damage
 * numbers, sounds on enemies, ice, upgrades, all of it.
 *
 * Playing advances the re-simulation by speed times the frame's wall time,
 * at most GameClock.MAX_CATCHUP_MS per frame like the game clock. Seeking
 * runs the simulation without rendering to the point sought (backwards from
 * the wave's start), with the show (VFX, sounds) muted meanwhile.
 *
 * Angular-free; ReplayService owns one per replay.
 */
export class ReplaySession {
  private readonly resim: Resimulation;
  private live: SimSnapshot | null = null;
  private carryMs = 0;
  private _playing = false;
  private _speed = 1;

  constructor(
    private readonly gameState: GameStateManager,
    private readonly engine: ThreeTilesEngine,
    readonly record: WaveRecord,
    /** The log the record points into: the run's own, or one from a replay file */
    log: readonly CommandLogEntry[] = gameState.commandLog.entries,
  ) {
    this.resim = new Resimulation(gameState.resimHost, record, log);
  }

  get wave(): number {
    return this.record.wave;
  }

  get playing(): boolean {
    return this._playing;
  }

  get speed(): number {
    return this._speed;
  }

  /** Game time into the wave, ms */
  get currentMs(): number {
    return this.resim.stepInWave * GameClock.FIXED_STEP_MS;
  }

  /** The wave's length, ms */
  get durationMs(): number {
    return (this.resim.lengthInSteps ?? 0) * GameClock.FIXED_STEP_MS;
  }

  /** Sub-step of the first state that did not match the live run, null while all match */
  get divergedAt(): number | null {
    return this.resim.divergedAt;
  }

  /**
   * Keep the live state and put the simulation at the wave's start. Only
   * between waves or after game over (GameStateManager.snapshotRefusal).
   */
  enter(): void {
    this.live = this.gameState.captureSnapshot();
    // Blood, scorch marks, damage numbers, a strike still running: the replay starts on a clean field
    this.engine.effects.clear();
    clearStrikeEffects(this.engine);
    this.resim.start();
    this.carryMs = 0;
    this._playing = true;
    this.present();
  }

  /** Give the live game back as it was, then leave replay mode. */
  exit(): void {
    const live = this.live;
    this.live = null;
    this._playing = false;
    // In replay mode still: the live listeners hear nothing of the way back
    if (live) this.gameState.restoreSnapshot(live, 'live');
    this.resim.end();
    this.engine.spatialAudio.stopAll();
    // The replay's marks, numbers and strikes stay behind in it
    this.engine.effects.clear();
    clearStrikeEffects(this.engine);
    this.present();
  }

  play(): void {
    if (this.resim.finished) this.seek(0);
    this._playing = true;
  }

  pause(): void {
    this._playing = false;
  }

  togglePlay(): void {
    if (this._playing) this.pause();
    else this.play();
  }

  setSpeed(speed: number): void {
    this._speed = speed;
  }

  /**
   * Per rendered frame, wall-clock ms: step the re-simulation by speed times
   * the frame, capped like the game clock, and show it. The renderers' clock
   * follows the speed (0 in the pause), so walk cycles and death animations
   * keep pace.
   */
  update(deltaMs: number): void {
    this.engine.setTimescale(this._playing ? this._speed : 0);
    if (!this._playing) return;
    this.carryMs += Math.min(deltaMs, GameClock.MAX_CATCHUP_MS) * this._speed;
    let stepped = false;
    while (this.carryMs >= GameClock.FIXED_STEP_MS) {
      this.carryMs -= GameClock.FIXED_STEP_MS;
      stepped = true;
      if (!this.resim.step()) {
        this._playing = false;
        this.carryMs = 0;
        break;
      }
    }
    if (stepped) this.present();
  }

  /**
   * Jump to `ms` into the wave: without rendering and with the show muted,
   * forward from here or from the wave's start. The sounds and effects of
   * the stretch skipped are left out; what stands on the field at the point
   * is shown.
   */
  seek(ms: number): void {
    const target = Math.max(0, Math.round(ms / GameClock.FIXED_STEP_MS));
    const bus = this.gameState.getEventBus();
    const rendering = this.engine.renderingEnabled;
    bus.setShowMuted(true);
    this.engine.setRenderingEnabled(false);
    try {
      this.resim.stepTo(target);
    } finally {
      this.engine.setRenderingEnabled(rendering);
      bus.setShowMuted(false);
    }
    this.carryMs = 0;
    this.engine.spatialAudio.stopAll();
    // Damage numbers, gold and particles of the stretch skipped would come all at
    // once; a strike from before the jump would play on (a laser seen twice)
    this.engine.effects.clear();
    clearStrikeEffects(this.engine);
    // The show heard nothing of the stretch: the silo's missile by the charges now
    this.gameState.abilityManager.announceState();
    this.present();
  }

  private present(): void {
    this.gameState.presentReplayFrame();
  }
}
