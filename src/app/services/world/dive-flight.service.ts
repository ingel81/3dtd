import { Injectable, inject } from '@angular/core';
import { Matrix4 } from 'three';
import type { ThreeTilesEngine } from '../../three-engine';
import { EngineInitializationService } from '../infrastructure/engine-initialization.service';
import { cameraTimeline } from '../../utils/camera-timeline';
import {
  type DivePlan,
  HANDOVER_ALTITUDE,
  altitudeAt,
  divePoseAt,
  easeIn,
  easeOut,
  planDive,
  warmPoses,
} from '../../globe/dive-path';

/** Called each frame of a flight with the game camera's pose in ECEF, after the camera moved */
export type DiveFrame = (ecef: Matrix4, fov: number, altitude: number) => void;

/** Before a rise out of a place: what is not cached by then loads while the camera climbs */
const RISE_WARM_TIMEOUT_MS = 2500;

interface Flight {
  plan: DivePlan;
  /** Down: progress 0 to 1 eased out; up: 1 to 0 eased in */
  down: boolean;
  startMs: number;
  durationMs: number;
  onFrame: DiveFrame | null;
  resolve: () => void;
}

/**
 * The game camera's part of the dive from the menu globe into a place and of
 * the rise out of it (docs/GLOBE_PLAN.md, Übergabe in Nadir-Sicht): it warms
 * the tiles along the path, flies the camera on it with the controls off,
 * scales view distance and fog to the altitude (DiveView), and hands the
 * pose of each frame to the globe while the two cross-fade. Ticked by the
 * engine's frame hook while it flies, after the game's update and before the
 * draw, so the globe draws in the same frame as the game.
 */
@Injectable({ providedIn: 'root' })
export class DiveFlightService {
  private readonly engineInit = inject(EngineInitializationService);
  private flight: Flight | null = null;
  /** Takes update() off the engine's frame again */
  private unhook: (() => void) | null = null;
  private readonly pose = new Matrix4();
  private readonly ecef = new Matrix4();
  private readonly toEcef = new Matrix4();

  /** A flight is under way */
  isRunning(): boolean {
    return this.flight !== null;
  }

  private engine(): ThreeTilesEngine | null {
    return this.engineInit.getEngine();
  }

  /** The dive into the game's view as the camera has it now; null without tiles (DevWorld) */
  planFromView(): DivePlan | null {
    const engine = this.engine();
    if (!engine || !engine.sceneToEcef(this.toEcef)) return null;
    const camera = engine.getCamera();
    camera.updateMatrixWorld();
    return planDive(camera.matrixWorld, HANDOVER_ALTITUDE);
  }

  /**
   * Load the tiles along the plan's path; the game camera stays where it is.
   * `upper` warms only the part straight above the HQ, which the game's
   * final view does not change: it can run while the place still loads.
   */
  async warm(plan: DivePlan, stepTimeoutMs?: number, upper = false): Promise<void> {
    const engine = this.engine();
    if (!engine) return;
    cameraTimeline.record(upper ? 'dive.warmUpper' : 'dive.warm');
    await engine.dive.warm(warmPoses(plan, upper), stepTimeoutMs);
  }

  /** Warm the rise out of the game's view, at most RISE_WARM_TIMEOUT_MS in all */
  async warmRise(plan: DivePlan): Promise<void> {
    await Promise.race([
      this.warm(plan, RISE_WARM_TIMEOUT_MS / 4),
      new Promise<void>((resolve) => setTimeout(resolve, RISE_WARM_TIMEOUT_MS)),
    ]);
  }

  /** The plan's start in ECEF, the pose the globe hands over at */
  startInEcef(plan: DivePlan, target: Matrix4): Matrix4 | null {
    const engine = this.engine();
    if (!engine || !engine.sceneToEcef(this.toEcef)) return null;
    return target.multiplyMatrices(this.toEcef, plan.start);
  }

  /**
   * Fly the camera from the plan's start down into the game's view. Resolves
   * on landing, with the camera exactly in the view and the controls on.
   */
  descend(plan: DivePlan, durationMs: number, onFrame: DiveFrame | null, startMs = performance.now()): Promise<void> {
    return this.fly(plan, true, durationMs, onFrame, startMs);
  }

  /** Fly the camera from the game's view (the plan's end) up to the plan's start, straight above the HQ */
  ascend(plan: DivePlan, durationMs: number, onFrame: DiveFrame | null, startMs = performance.now()): Promise<void> {
    return this.fly(plan, false, durationMs, onFrame, startMs);
  }

  /** Stop a flight where it is (a new place, the component gone) */
  cancel(): void {
    const flight = this.flight;
    if (!flight) return;
    this.flight = null;
    this.finish(flight.down);
    flight.resolve();
  }

  private fly(plan: DivePlan, down: boolean, durationMs: number, onFrame: DiveFrame | null, startMs: number): Promise<void> {
    this.cancel();
    const engine = this.engine();
    if (!engine) return Promise.resolve();
    const controls = engine.getControls();
    if (controls) controls.enabled = false;
    cameraTimeline.record(down ? 'dive.descend' : 'dive.ascend', { ms: Math.round(durationMs) });
    return new Promise((resolve) => {
      this.flight = { plan, down, startMs, durationMs, onFrame, resolve };
      this.unhook ??= engine.addFrameHook(() => this.update());
      this.apply(this.flight, 0);
    });
  }

  /** Per frame, after the game's update, before the engine draws (ThreeTilesEngine.addFrameHook) */
  update(): void {
    const flight = this.flight;
    if (!flight) return;
    const t = Math.min(1, (performance.now() - flight.startMs) / Math.max(1, flight.durationMs));
    this.apply(flight, t);
    if (t < 1) return;
    this.flight = null;
    this.finish(flight.down);
    flight.resolve();
  }

  private apply(flight: Flight, t: number): void {
    const engine = this.engine();
    if (!engine) return;
    const s = flight.down ? easeOut(t) : 1 - easeIn(t);
    divePoseAt(flight.plan, s, this.pose);
    const camera = engine.getCamera();
    this.pose.decompose(camera.position, camera.quaternion, camera.scale);
    camera.updateMatrixWorld();
    const altitude = altitudeAt(flight.plan, s);
    engine.dive.setScale(altitude / flight.plan.endAltitude);
    if (flight.onFrame && engine.sceneToEcef(this.toEcef)) {
      flight.onFrame(this.ecef.multiplyMatrices(this.toEcef, camera.matrixWorld), camera.fov, altitude);
    }
  }

  /**
   * Back to the game's view distance either way. Risen, the camera hangs
   * 500 km up under the globe and sees nothing at 8 km: the old place's
   * tiles go, and nothing loads until the next place frames the camera.
   */
  private finish(down: boolean): void {
    this.unhook?.();
    this.unhook = null;
    const engine = this.engine();
    if (!engine) return;
    engine.dive.setScale(1);
    engine.dive.release();
    const controls = engine.getControls();
    if (controls) controls.enabled = true;
    cameraTimeline.record(down ? 'dive.landed' : 'dive.risen');
  }
}
