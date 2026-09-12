import { FramePacer } from '../utils/frame-pacer';

/**
 * Longest wait for a drawn frame in the shader warm-up. A hidden tab gets no
 * rAF frames at all; the warm-up then closes the pools again without them.
 */
const FRAME_WAIT_TIMEOUT_MS = 1000;

/**
 * Longest game-time step a single background tick may advance.
 *
 * A throttled hidden tab can hand us gaps of seconds. At a training
 * timescale of 75 a one-second gap is 75 seconds of game time in one step,
 * which the fixed sub-step loop would try to catch up in a single frame,
 * the same sub-step pile-up that showed up as 225 sub-steps per frame and
 * 2 FPS. Capping means game time runs slower than wall-clock while hidden,
 * which is the right trade: slower beats stopped.
 */
const MAX_BACKGROUND_STEP_MS = 50;

/** Was der Loop am Engine antreibt. */
export interface RenderLoopHooks {
  /** Gameplay und Animationen um `deltaTime` ms weiter. Läuft pro rAF-Frame und pro Heartbeat-Tick. */
  update(deltaTime: number): void;
  /** Einen Frame zeichnen. Nur aus rAF-Frames, nie aus dem Heartbeat. */
  render(): void;
  /** False, solange render() nichts zeichnet (Headless-Training). */
  isRendering(): boolean;
}

/**
 * RenderLoop: treibt `update()` und `render()` des Engines.
 *
 * Vorher inline in `three-tiles-engine.ts` (`startRenderLoop`, `stopRenderLoop`,
 * `setFpsLimit`, `setBackgroundLoopEnabled`, der Heartbeat, `getFPS`,
 * `waitForRenderedFrame`). Zwei Treiber teilen sich eine Uhr:
 *
 * - rAF: pro Frame `update(delta)`, dann `render()`. Der {@link FramePacer} lässt zu
 *   frühe Frames bei einem FPS-Cap ganz aus.
 * - Heartbeat-Worker: nur im versteckten Tab und nur mit `setBackgroundLoopEnabled(true)`
 *   (Training). Pro Tick `update(delta)` ohne `render()`, der Schritt auf 50 ms gedeckelt.
 *   Solange er läuft, steppen rAF-Frames nicht.
 *
 * Der Engine meldet jeden gezeichneten Frame mit `frameRendered()` zurück; daran hängen
 * `waitForRenderedFrame()` (Shader-Warm-up) und der FPS-Zähler.
 *
 * Vom Engine besessen, als `engine.renderLoop` erreichbar. `stop()` aus dem Engine-dispose().
 */
export class RenderLoop {
  private animationFrameId: number | null = null;
  /**
   * Hidden-tab loop driver. Chrome freezes requestAnimationFrame outright
   * while a tab is not visible, so the render loop, and with it the bot, the
   * wave logic and every training episode, stops dead rather than slowing
   * down. Opt in via `setBackgroundLoopEnabled(true)`; training does.
   */
  private heartbeatWorker: Worker | null = null;
  private backgroundLoopEnabled = false;
  private onVisibilityChange: (() => void) | null = null;
  /** Shared between the rAF and heartbeat drivers so deltas stay continuous. */
  private lastLoopTime = 0;
  private isRunning = false;

  /** Frame cap of the rAF loop, see setFpsLimit(). */
  private readonly framePacer = new FramePacer();

  /** Released by the next drawn frame, see waitForRenderedFrame(). */
  private frameWaiters: (() => void)[] = [];

  // Performance stats
  private lastFrameTime = 0;
  private frameCount = 0;
  private fps = 0;

  constructor(private readonly hooks: RenderLoopHooks) {}

  /**
   * Cap the render loop at `fps` frames per second, 0 = unlimited (vsync).
   *
   * Frames that come too early are skipped whole, update included. The
   * simulation steps on the wall-clock delta between the frames that run, so
   * a 30 fps cap hands GameStateManager ~33 ms per frame, inside its
   * MAX_CATCHUP_MS of 50: game speed stays the same, training timescales
   * included. Persisted by DebugFacadeService.
   */
  setFpsLimit(fps: number): void {
    this.framePacer.setLimit(fps);
  }

  /**
   * Drive the loop from a worker timer while the tab is hidden.
   *
   * Only training turns this on. The normal game has no reason to run in a
   * tab nobody is looking at, and the browser's throttling is a feature there.
   */
  setBackgroundLoopEnabled(enabled: boolean): void {
    if (this.backgroundLoopEnabled === enabled) return;
    this.backgroundLoopEnabled = enabled;
    if (!enabled) {
      this.stopHeartbeat();
      if (this.onVisibilityChange) {
        document.removeEventListener('visibilitychange', this.onVisibilityChange);
        this.onVisibilityChange = null;
      }
      return;
    }
    this.onVisibilityChange = () => this.syncLoopDriver();
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    this.syncLoopDriver();
  }

  /** Pick the driver that actually ticks under the current visibility. */
  private syncLoopDriver(): void {
    if (!this.backgroundLoopEnabled || !this.isRunning) {
      this.stopHeartbeat();
      return;
    }
    if (document.hidden) {
      this.startHeartbeat();
    } else {
      this.stopHeartbeat();
    }
  }

  private startHeartbeat(): void {
    if (this.heartbeatWorker) return;
    try {
      this.heartbeatWorker = new Worker(
        new URL('../workers/heartbeat.worker', import.meta.url),
        { type: 'module' },
      );
    } catch (err) {
      console.warn('[ThreeTilesEngine] Heartbeat worker unavailable:', err);
      this.heartbeatWorker = null;
      return;
    }
    this.heartbeatWorker.onmessage = ({ data }) => {
      if (data?.type === 'tick') this.tickFromHeartbeat();
    };
    this.lastLoopTime = performance.now();
    this.heartbeatWorker.postMessage({ type: 'start', intervalMs: 16 });
  }

  private stopHeartbeat(): void {
    if (!this.heartbeatWorker) return;
    this.heartbeatWorker.postMessage({ type: 'stop' });
    this.heartbeatWorker.terminate();
    this.heartbeatWorker = null;
    // Hand the clock back to rAF without a giant catch-up delta.
    this.lastLoopTime = performance.now();
  }

  /**
   * One loop step driven by the heartbeat instead of a frame.
   *
   * Deliberately skips `render()`: nothing is visible, and the GPU half is the
   * expensive one. Gameplay, the bot and the wave logic all hang off
   * `update()`.
   */
  private tickFromHeartbeat(): void {
    if (!this.isRunning || !document.hidden) return;
    const currentTime = performance.now();
    const deltaTime = Math.min(
      currentTime - this.lastLoopTime,
      MAX_BACKGROUND_STEP_MS,
    );
    this.lastLoopTime = currentTime;
    if (deltaTime <= 0) return;
    this.hooks.update(deltaTime);
  }

  /**
   * Start the render loop
   */
  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    this.lastLoopTime = performance.now();
    this.framePacer.reset();
    const animate = (currentTime: number) => {
      if (!this.isRunning) return;

      // While the heartbeat owns the clock, rAF must not also step the world.
      // A tab can deliver a straggling frame right as it goes hidden, and two
      // drivers stepping the same fixed sub-step loop double gameplay speed.
      if (this.heartbeatWorker) {
        this.animationFrameId = requestAnimationFrame(animate);
        return;
      }

      // FPS cap: a frame that comes too early is skipped whole.
      if (!this.framePacer.shouldRun(currentTime)) {
        this.animationFrameId = requestAnimationFrame(animate);
        return;
      }

      const deltaTime = currentTime - this.lastLoopTime;
      this.lastLoopTime = currentTime;

      this.hooks.update(deltaTime);
      this.hooks.render();

      this.animationFrameId = requestAnimationFrame(animate);
    };

    this.animationFrameId = requestAnimationFrame(animate);
    this.syncLoopDriver();
  }

  /**
   * Stop the render loop
   */
  stop(): void {
    this.isRunning = false;
    this.stopHeartbeat();
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  /**
   * Called by the engine's render() after every drawn frame: releases
   * waitForRenderedFrame() and counts the frame for getFPS().
   */
  frameRendered(): void {
    this.notifyFrameRendered();
    this.updateFPS();
  }

  private updateFPS(): void {
    this.frameCount++;
    const now = performance.now();
    if (now - this.lastFrameTime >= 1000) {
      this.fps = this.frameCount;
      this.frameCount = 0;
      this.lastFrameTime = now;
    }
  }

  /**
   * Get current FPS
   */
  getFPS(): number {
    return this.fps;
  }

  /**
   * Resolves after the next frame the loop draws, or after
   * {@link FRAME_WAIT_TIMEOUT_MS} when none comes. Right away when nothing
   * draws at all (loop stopped, headless training).
   */
  waitForRenderedFrame(): Promise<void> {
    if (!this.isRunning || !this.hooks.isRendering()) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(done, FRAME_WAIT_TIMEOUT_MS);
      this.frameWaiters.push(done);
    });
  }

  /** Releases the waiters of waitForRenderedFrame(). */
  private notifyFrameRendered(): void {
    if (this.frameWaiters.length === 0) return;
    const waiters = this.frameWaiters;
    this.frameWaiters = [];
    for (const done of waiters) done();
  }
}
