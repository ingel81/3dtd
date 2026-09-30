/**
 * Game-Clock — single source of truth for ALL gameplay timing.
 *
 * Advances by FIXED_STEP_MS per sub-step, SIM_STEPS_PER_SECOND of them per
 * second of game time (configs/timing.config.ts). Sub-stepping ensures the
 * simulation runs identically at every training timescale: at 75× a
 * pass of the same wall time runs ~75 times the sub-steps, each behaving like
 * one 1× tick. No /timescale compensation anywhere.
 *
 * Owned by the GameStateManager, which drives one pass as
 * `beginFrame()`, `while (nextSubStep()) { ... }`, `endFrame()`, or
 * `holdFrame()` while paused. Plain arithmetic, no allocation per sub-step.
 */
// With the extension: the relay loads this file in plain Node, which resolves no import without one
import { SIM_STEPS_PER_SECOND } from '../../configs/timing.config.ts';

/** See GameClock.getState. Plain data. */
export interface GameClockState {
  gameTimeMs: number;
  subStep: number;
}

export class GameClock {
  /**
   * Fixed game-time per sub-step, from the rate (SIM_STEPS_PER_SECOND):
   * 33.334 ms at 30 a second, 16.667 ms at 60.
   *
   * Rounded up to the next thousandth of a ms on purpose, not the exact
   * 1000 / rate: timers count sub-steps down or add them up, and with the
   * exact third the sum of 15 sub-steps comes out a rounding error short of
   * 500 ms, which costs a round duration (a 500 ms warning, a tick of
   * poison) one sub-step more. A hair over, the sub-step that completes a
   * round duration is past it whatever the rounding.
   */
  static readonly FIXED_STEP_MS = Math.ceil(1_000_000 / SIM_STEPS_PER_SECOND) / 1000;

  /**
   * Sub-steps in `ms` of game time, to the nearest: for windows and
   * intervals given as a duration (a stuck check every 10 s, a state hash
   * every second), so no count of sub-steps stands anywhere as a number.
   */
  static stepsIn(ms: number): number {
    return Math.max(1, Math.round(ms / GameClock.FIXED_STEP_MS));
  }
  /**
   * The most wall clock the simulation may lie behind (ms), times the
   * timescale in game time: what a pass did not get to is kept up to here and
   * worked off by the next ones, the rest is dropped. So a simulation that
   * cannot keep up runs slower than the wall clock instead of piling up debt,
   * and a loop that stood (a hidden tab, a long call, the coop barrier) does
   * not run minutes of game time at once. Start value, tuned by measurement
   * (docs/SIM_DECOUPLE_PLAN.md, TODO E85).
   */
  static readonly MAX_BACKLOG_MS = 250;

  private _gameTimeMs = 0;
  /** Sub-steps since the run started; the run log stamps events with it. */
  private _subStep = 0;
  /** Game-time left over from the last pass: below one sub-step, or what its deadline left undone. */
  private subStepRemainderMs = 0;
  /** Wall clock of the last pass; 0 means none yet. */
  private lastUpdateTime = 0;
  /** Game-time the current frame still has to run. */
  private pendingMs = 0;
  private _stepsThisFrame = 0;

  /** Read-only access to the game-clock for any consumer that needs
   *  game-time (status effects, sleep checks, AI bot ticks, etc). */
  get gameTimeMs(): number {
    return this._gameTimeMs;
  }

  /** Sub-steps taken since the last beginFrame(). */
  get stepsThisFrame(): number {
    return this._stepsThisFrame;
  }

  /**
   * Sub-steps since the run started, counting up without gaps.
   *
   * The game time alone cannot serve as that index: it is a sum of FIXED_STEP_MS
   * steps and drifts in floating point, so it neither compares nor sorts
   * exactly. The run log stamps every command with this number, which is what
   * a replay as a re-simulation needs to put commands back into the step they
   * took effect in (BALANCING_PLAN.md, section 5).
   */
  get subStep(): number {
    return this._subStep;
  }

  /**
   * A paused pass, or the moment a pause ends: no sub-step runs and the game
   * clock stands. The wall clock is still taken, otherwise the first pass
   * after the pause would try to catch up the pause (the loop sleeps through
   * it, docs/SIM_DECOUPLE_PLAN.md). The remainder stays as it was, the resume
   * continues where the pause began.
   */
  holdFrame(currentTime: number): void {
    this.lastUpdateTime = currentTime;
  }

  /**
   * Opens a pass: the game-time it may run is the remainder plus the
   * wall-clock delta times the timescale, at most MAX_BACKLOG_MS of wall
   * clock. The caller runs sub-steps while it has time (its deadline); what
   * is left carries over (endFrame).
   */
  beginFrame(currentTime: number, timescale: number): void {
    const rawDeltaTime = this.lastUpdateTime ? currentTime - this.lastUpdateTime : 16;
    this.lastUpdateTime = currentTime;
    this.pendingMs = Math.min(this.subStepRemainderMs + rawDeltaTime * timescale, GameClock.MAX_BACKLOG_MS * timescale);
    this._stepsThisFrame = 0;
  }

  /**
   * Takes the next sub-step if the pass still holds one: advances the game
   * clock by FIXED_STEP_MS and books the step. False once the game-time due
   * is used up.
   */
  nextSubStep(): boolean {
    if (this.pendingMs >= GameClock.FIXED_STEP_MS) {
      this._gameTimeMs += GameClock.FIXED_STEP_MS;
      this.pendingMs -= GameClock.FIXED_STEP_MS;
      this._stepsThisFrame++;
      this._subStep++;
      return true;
    }
    return false;
  }

  /**
   * One sub-step regardless of the frame's game-time: the re-simulation of a
   * wave steps the simulation by count, not by the wall clock
   * (docs/SIMULATOR_PLAN.md, P4). Advances game time and step count exactly
   * as nextSubStep() does.
   */
  forceSubStep(): void {
    this._gameTimeMs += GameClock.FIXED_STEP_MS;
    this._subStep++;
  }

  /** Game time and step count, for the wave-start snapshot. */
  getState(): GameClockState {
    return { gameTimeMs: this._gameTimeMs, subStep: this._subStep };
  }

  /**
   * Put game time and step count back. The frame bookkeeping starts over:
   * no remainder, and the next pass takes its wall clock afresh.
   */
  setState(state: GameClockState): void {
    this._gameTimeMs = state.gameTimeMs;
    this._subStep = state.subStep;
    this.subStepRemainderMs = 0;
    this.pendingMs = 0;
    this.lastUpdateTime = 0;
  }

  /** The pass still holds a sub-step it may take (what nextSubStep would do, without taking it). */
  hasDueStep(): boolean {
    return this.pendingMs >= GameClock.FIXED_STEP_MS;
  }

  /** Closes the pass: whatever game-time is left carries into the next one. */
  endFrame(): void {
    this.subStepRemainderMs = this.pendingMs;
  }

  /** Wall ms from the last pass until the next sub-step is due at `timescale`; 0 when one is due already. */
  dueInMs(timescale: number): number {
    const missing = GameClock.FIXED_STEP_MS - this.subStepRemainderMs;
    return missing <= 0 ? 0 : missing / timescale;
  }

  /** Back to game-time 0, no remainder, no previous frame, step count 0. */
  reset(): void {
    this.lastUpdateTime = 0;
    this._gameTimeMs = 0;
    this.subStepRemainderMs = 0;
    this._subStep = 0;
  }
}
