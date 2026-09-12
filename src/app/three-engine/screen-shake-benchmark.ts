import { Vector3 } from 'three';

/**
 * Phases of a shake benchmark run:
 * - off: no shake
 * - shake: the screen-space shake running the whole phase
 * - camera-move: the camera moved by up to `CAMERA_MOVE_M` on X and Z every
 *   frame and put back after drawing, which is what the shake did before
 *   2026-09-12. Measures what that cost.
 */
export type ShakeBenchPhase = 'off' | 'shake' | 'camera-move';

export interface ShakeBenchResult {
  phase: ShakeBenchPhase;
  frames: number;
  /** Time between frames, mean and 95th percentile, ms */
  frameMs: number;
  frameP95Ms: number;
  /** render() on the CPU per frame, mean: tiles update plus draw submission, ms */
  renderMs: number;
  /** tilesRenderer.update() per frame, mean, ms */
  tilesUpdateMs: number;
  /** Frames in which the tiles renderer ran its full traversal */
  traversals: number;
}

interface PhaseSamples {
  intervals: number[];
  renderMs: number;
  tilesMs: number;
  traversals: number;
  frames: number;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/**
 * A/B/C measurement of the screen shake, driven by the engine's render():
 * `beginFrame` before the camera and tiles update, `endFrame` after the
 * frame is drawn. The phases run back to back, `phaseMs` each; `done`
 * resolves with one row per phase.
 */
export class ShakeBenchmark {
  static readonly PHASES: readonly ShakeBenchPhase[] = ['off', 'shake', 'camera-move'];
  /** Old rocket preset: 0.8 m camera offset */
  static readonly CAMERA_MOVE_M = 0.8;

  readonly done: Promise<ShakeBenchResult[]>;
  private resolveDone!: (rows: ShakeBenchResult[]) => void;

  private phaseIndex = 0;
  private phaseStart: number;
  private frameStart = 0;
  private lastFrameStart = -1;
  private samples: PhaseSamples = ShakeBenchmark.emptySamples();
  private readonly results: ShakeBenchResult[] = [];
  private readonly nudge = new Vector3();

  /**
   * @param phaseMs - Length of each phase, ms
   * @param now - Wall clock at the start, ms
   * @param shake - Keeps the shake running, called every frame of the shake phase
   */
  constructor(
    private readonly phaseMs: number,
    now: number,
    private readonly shake: (now: number) => void,
  ) {
    this.phaseStart = now;
    this.done = new Promise((resolve) => (this.resolveDone = resolve));
  }

  get phase(): ShakeBenchPhase {
    return ShakeBenchmark.PHASES[this.phaseIndex];
  }

  /**
   * Start of a frame. Moves the camera in the camera-move phase, keeps the
   * shake going in the shake phase.
   *
   * @returns false once all phases are done (the run is over, `done` resolved)
   */
  beginFrame(now: number, camera: { position: Vector3 }): boolean {
    if (now - this.phaseStart >= this.phaseMs) {
      this.results.push(this.summarise());
      this.phaseIndex++;
      this.phaseStart = now;
      this.lastFrameStart = -1;
      this.samples = ShakeBenchmark.emptySamples();
      if (this.phaseIndex >= ShakeBenchmark.PHASES.length) {
        this.resolveDone(this.results);
        return false;
      }
    }

    if (this.lastFrameStart >= 0) this.samples.intervals.push(now - this.lastFrameStart);
    this.lastFrameStart = now;
    this.frameStart = now;

    if (this.phase === 'shake') {
      this.shake(now);
    } else if (this.phase === 'camera-move') {
      const m = ShakeBenchmark.CAMERA_MOVE_M;
      this.nudge.set((Math.random() * 2 - 1) * m, 0, (Math.random() * 2 - 1) * m);
      camera.position.add(this.nudge);
    }
    return true;
  }

  /**
   * End of a frame: puts a moved camera back and records the timings.
   *
   * @param tilesMs - Time spent in tilesRenderer.update(), ms
   * @param traversed - Whether that update ran the traversal
   */
  endFrame(now: number, camera: { position: Vector3 }, tilesMs: number, traversed: boolean): void {
    if (this.phase === 'camera-move') camera.position.sub(this.nudge);
    const s = this.samples;
    s.frames++;
    s.renderMs += now - this.frameStart;
    s.tilesMs += tilesMs;
    if (traversed) s.traversals++;
  }

  private summarise(): ShakeBenchResult {
    const s = this.samples;
    const frames = Math.max(s.frames, 1);
    const sorted = [...s.intervals].sort((a, b) => a - b);
    const mean = sorted.length ? sorted.reduce((sum, v) => sum + v, 0) / sorted.length : 0;
    const p95 = sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] : 0;
    return {
      phase: this.phase,
      frames: s.frames,
      frameMs: round2(mean),
      frameP95Ms: round2(p95),
      renderMs: round2(s.renderMs / frames),
      tilesUpdateMs: round2(s.tilesMs / frames),
      traversals: s.traversals,
    };
  }

  private static emptySamples(): PhaseSamples {
    return { intervals: [], renderMs: 0, tilesMs: 0, traversals: 0, frames: 0 };
  }
}
