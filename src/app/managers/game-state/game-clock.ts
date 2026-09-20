/**
 * Game-Clock — single source of truth for ALL gameplay timing.
 *
 * Advances by FIXED_STEP_MS per sub-step. Sub-stepping ensures the
 * simulation runs identically at every training timescale: at 75× a
 * single render-frame splits into ~75 sub-steps, each behaving like
 * one 1× tick. No /timescale compensation anywhere.
 *
 * Owned by the GameStateManager, which drives one frame as
 * `beginFrame()`, `while (nextSubStep()) { ... }`, `endFrame()`, or
 * `holdFrame()` while paused. Plain arithmetic, no allocation per sub-step.
 */
export class GameClock {
  /** Fixed game-time per sub-step (~60Hz game-time granularity). */
  static readonly FIXED_STEP_MS = 16.667;
  /** Max sub-steps per real-frame. At 75× training and 10fps real-time
   *  we need ~450 sub-steps to keep up; 600 gives headroom for heavier
   *  scenes before the simulation falls behind wall-clock-timescale. */
  static readonly MAX_SUBSTEPS_PER_FRAME = 600;
  /** Cap on unprocessed game-time debt. Without a cap, frame-drops cause
   *  the remainder to grow unboundedly — the sim trails further behind
   *  every frame and never catches up. Capping at one real-frame worth
   *  of timescale lets spikes recover but bounds the debt. */
  static readonly MAX_REMAINDER_MS = 2000;

  /**
   * Upper bound on the wall-clock delta a single frame may carry into the
   * sub-step loop (ms), applied before the timescale scales it.
   *
   * 50 ms ≈ three sub-steps, i.e. real-time is held down to 20 FPS. Below
   * that the simulation runs slower than the wall clock instead of trying
   * to catch up — a consistent slow-motion rather than a spiral. Everything
   * in gameplay reasons in game-time, so nothing observes the difference.
   *
   * The player's 30 fps frame cap (RenderLoop.setFpsLimit) hands in
   * ~33 ms per frame, inside the bound, so a capped game keeps full speed.
   * Going below ~34 ms here would turn that cap into slow motion.
   */
  static readonly MAX_CATCHUP_MS = 50;

  private _gameTimeMs = 0;
  /** Sub-steps since the run started; the run log stamps events with it. */
  private _subStep = 0;
  /** Game-time left over from the last frame, below one sub-step unless capped. */
  private subStepRemainderMs = 0;
  /** Wall clock of the last frame; 0 means no frame yet. */
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
   * The game time alone cannot serve as that index: it is a sum of 16.667 ms
   * steps and drifts in floating point, so it neither compares nor sorts
   * exactly. The run log stamps every command with this number, which is what
   * a replay as a re-simulation needs to put commands back into the step they
   * took effect in (BALANCING_PLAN.md, section 5).
   */
  get subStep(): number {
    return this._subStep;
  }

  /**
   * A paused frame: no sub-step runs and the game clock stands. The wall
   * clock is still taken, otherwise the first frame after the pause would
   * try to catch up the whole pause. The remainder stays as it was, the
   * resume continues where the pause began.
   */
  holdFrame(currentTime: number): void {
    this.lastUpdateTime = currentTime;
  }

  /**
   * Opens a frame: the game-time it runs is the remainder plus the clamped
   * wall-clock delta times the timescale.
   *
   * Clamp the wall-clock delta BEFORE the timescale multiplies it. The
   * sub-step loop exists to keep game-time in step with wall-clock, so an
   * unclamped delta means a slow frame is fully caught up on the next one:
   * more sub-steps, more work, a slower frame still. Measured at 11.7k
   * enemies with rendering off: 40.5 sub-steps per frame and climbing.
   *
   * Clamping the real delta rather than the sub-step count keeps timescale
   * semantics exact — 20x still runs its 20 steps for a healthy frame,
   * because the multiplication happens after. Only catch-up debt from
   * frames that ran long is dropped, which the loop already did via
   * `maxBudget`, just at a ~12 second threshold.
   *
   * This also covers a case that has nothing to do with load: rAF is
   * throttled in a background tab, so returning to one produced a delta of
   * minutes and a multi-second hang while the loop worked it off.
   */
  beginFrame(currentTime: number, timescale: number): void {
    const rawDeltaTime = this.lastUpdateTime
      ? Math.min(currentTime - this.lastUpdateTime, GameClock.MAX_CATCHUP_MS)
      : 16;
    this.lastUpdateTime = currentTime;

    const frameGameTimeMs = rawDeltaTime * timescale;

    // Cap accumulated game-time so a slow real-frame (heavy rendering /
    // massive waves) doesn't grow the sim debt without bound. Excess is
    // dropped — simulation stays ≤ MAX_REMAINDER_MS behind wall-clock
    // × timescale but never more.
    let pendingMs = this.subStepRemainderMs + frameGameTimeMs;
    const maxBudget =
      GameClock.MAX_SUBSTEPS_PER_FRAME * GameClock.FIXED_STEP_MS
      + GameClock.MAX_REMAINDER_MS;
    if (pendingMs > maxBudget) pendingMs = maxBudget;
    this.pendingMs = pendingMs;
    this._stepsThisFrame = 0;
  }

  /**
   * Takes the next sub-step if the frame still holds one: advances the game
   * clock by FIXED_STEP_MS and books the step. False once the frame's
   * game-time is used up or MAX_SUBSTEPS_PER_FRAME is reached.
   */
  nextSubStep(): boolean {
    if (
      this.pendingMs >= GameClock.FIXED_STEP_MS &&
      this._stepsThisFrame < GameClock.MAX_SUBSTEPS_PER_FRAME
    ) {
      this._gameTimeMs += GameClock.FIXED_STEP_MS;
      this.pendingMs -= GameClock.FIXED_STEP_MS;
      this._stepsThisFrame++;
      this._subStep++;
      return true;
    }
    return false;
  }

  /** Closes the frame: whatever game-time is left carries into the next one. */
  endFrame(): void {
    this.subStepRemainderMs = this.pendingMs;
  }

  /** Back to game-time 0, no remainder, no previous frame, step count 0. */
  reset(): void {
    this.lastUpdateTime = 0;
    this._gameTimeMs = 0;
    this.subStepRemainderMs = 0;
    this._subStep = 0;
  }
}
