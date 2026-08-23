import { Injectable, NgZone, inject, signal } from '@angular/core';
import { CatmullRomCurve3, MathUtils, Matrix4, Quaternion, Vector3 } from 'three';
import { ThreeTilesEngine } from '../../three-engine';
import { GeoPosition } from '../../models/game.types';
import { routePathToLocalPoints } from '../../utils/route-path.util';
import { CameraControlService } from '../camera-control.service';
import { RouteAnimationService } from './route-animation.service';

/**
 * Phases of the intro sequence, in order. Each runs to its own timer except
 * `travel`, which runs until the path is used up.
 */
type FlightPhase = 'hold-start' | 'travel' | 'hold-end' | 'outro';

/**
 * Live-tunable parameters. Mutated from DevTools via `__flight.cfg` so the
 * flight can be tuned without a rebuild — this is a spike, the numbers are
 * expected to move a lot before any of them is worth freezing.
 */
interface FlightConfig {
  /** Seconds held over the HQ before departing. */
  holdStartSec: number;
  /**
   * Target seconds for the trip itself. Speed is derived from this and the
   * path length (`length / travelDurationSec`), so the intro takes about the
   * same time regardless of how far the spawn happens to be — a 400 m route
   * and a 2 km route both land near this number.
   */
  travelDurationSec: number;
  /** Lower clamp on the derived speed (m/s) — keeps short routes from crawling. */
  minSpeed: number;
  /** Upper clamp on the derived speed (m/s) — keeps long routes from blurring. */
  maxSpeed: number;
  /** Seconds held over the spawn before pulling out. */
  holdEndSec: number;
  /** Seconds of the pull-back into the normal game view. */
  outroSec: number;

  /**
   * Minimum distance short of the HQ the flight starts at (m), extrapolated
   * back along the opening tangent. The actual standoff is the larger of this
   * and the distance needed to frame the marker (see `holdFramingFill`).
   */
  standoffStart: number;
  /** Same for the spawn end: the flight stops at least this far short of it (m). */
  standoffEnd: number;
  /**
   * Fraction of the vertical frame the HQ / spawn marker should fill during
   * its hold. Drives the standoff distance:
   * `distance = subjectHalfHeight / tan(fill * fov/2)`.
   *
   * The camera's `fov` is the vertical one and the viewport is wider than it
   * is tall, so the vertical fit is the binding constraint — solving it means
   * the marker is fully in frame horizontally too. Raise for a tighter shot,
   * lower to back off.
   */
  holdFramingFill: number;

  /** Floor: never fly closer than this above the bare ground (m). */
  minAltitude: number;
  /** Vertical margin above the dilated skyline (m). */
  clearance: number;
  /** Half-width of the forward/backward max filter over the skyline (m). */
  dilationWindow: number;
  /** Max vertical speed climbing (m/s). Climbs may be brisk — safety first. */
  maxClimbRate: number;
  /** Max vertical speed descending (m/s). Kept low; this is what smooths. */
  maxDescendRate: number;

  /** How far ahead on the curve the camera looks (m). */
  lookAhead: number;
  /**
   * Look-at target sits this far above the ground (m). Together with
   * `lookAhead` and the flight altitude this is what sets the pitch:
   * `atan((altitude - lift) / lookAhead)`. Raise it (or raise lookAhead) for
   * a flatter, more forward-looking shot; lower it to tilt down.
   */
  lookAtLift: number;

  /** Distance between profile samples (m). */
  sampleSpacing: number;
  /** New profile samples taken per frame (one column probe each). */
  samplesPerFrame: number;

  /**
   * Angular damping for the camera orientation (1/s). Lower = lazier, more
   * cinematic turns; higher = sticks tighter to the path direction. Applied
   * as a quaternion slerp, so it smooths the actual rotation rather than the
   * point being looked at.
   */
  aimDamping: number;
  /**
   * Positional damping (1/s). Only there to absorb frame-time jitter and the
   * curvature spikes a Catmull-Rom throws at street intersections — keep it
   * high. Lowering it makes the camera lag and cut the *inside* of corners,
   * which is exactly where the buildings are: at 20 m/s a rate of 4 already
   * cuts ~5 m, about half a street width.
   */
  posDamping: number;
}

const DEFAULT_CONFIG: FlightConfig = {
  holdStartSec: 3,
  travelDurationSec: 26,
  minSpeed: 8,
  maxSpeed: 60,
  holdEndSec: 3,
  outroSec: 3.5,

  standoffStart: 60,
  standoffEnd: 50,
  holdFramingFill: 0.55,

  minAltitude: 22,
  clearance: 18,
  dilationWindow: 90,
  maxClimbRate: 45,
  maxDescendRate: 14,

  lookAhead: 60,
  lookAtLift: 8,

  sampleSpacing: 10,
  samplesPerFrame: 2,
  aimDamping: 2.2,
  posDamping: 10,
};

/**
 * Frame-rate independent exponential smoothing factor.
 *
 * The naive `min(1, rate * dt)` makes the effective smoothing depend on the
 * frame time, so a tile-parse stall (which is exactly when dt spikes) snaps
 * the camera instead of easing it — that was the visible jerk at direction
 * changes. `1 - e^(-rate * dt)` is stable for any dt.
 */
function smoothingAlpha(rate: number, dt: number): number {
  return 1 - Math.exp(-rate * dt);
}

/** Height above ground the path points are lifted to (matches route rendering). */
const PATH_HEIGHT_OFFSET = 1;

/**
 * Geometry of the HQ / spawn diamond markers, mirrored from
 * `MarkerVisualizationService`. They are overlay-group objects, so no raycast
 * against the tiles ever reports them — the flight has to know about them.
 *
 * `addBaseMarker` / `addSpawnMarker` place both at `HEIGHT_ABOVE_GROUND = 30`
 * with scales 1.2 (HQ) and 0.8 (spawn). `createDiamondMarker` builds an
 * `OctahedronGeometry(8 * size)` scaled 1.8× in Y for the opaque core and
 * rings out to `16 * size` horizontally.
 */
const MARKER_FLOAT_HEIGHT = 30;
const MARKER_CORE_RADIUS = 8;
const MARKER_Y_STRETCH = 1.8;
const MARKER_RING_RADIUS = 16;
const HQ_MARKER_SCALE = 1.2;
const SPAWN_MARKER_SCALE = 0.8;

/**
 * Top of the name label above the diamond's centre (m).
 * `MarkerLabelManager` places it at `LABEL_Y_OFFSET = 20` with a quad of
 * `labelSize = 5`, so its upper edge sits ~22.5 m up. The label is the part
 * that has to stay in frame for the shot to be readable — it is taller above
 * the centre than the diamond core is.
 */
const MARKER_LABEL_TOP = 22.5;

/** A marker treated as an obstacle in the altitude profile and as a subject to frame. */
interface MarkerObstacle {
  x: number;
  z: number;
  radiusSq: number;
  /** Top of the opaque core, relative to the ground beneath it (m). */
  topAboveGround: number;
  /** Half the height of what must be framed (diamond core + label). */
  subjectHalfHeight: number;
  /** Offset of the framed subject's centre from the diamond centre (m). */
  subjectCentreOffset: number;
}

function markerObstacle(x: number, z: number, scale: number): MarkerObstacle {
  const radius = MARKER_RING_RADIUS * scale;
  const coreHalf = MARKER_CORE_RADIUS * scale * MARKER_Y_STRETCH;
  // Subject spans the core's bottom up to the label's top — asymmetric about
  // the diamond centre, so aiming at the diamond itself pushes the label
  // toward the top edge of the frame.
  return {
    x,
    z,
    radiusSq: radius * radius,
    // Glow shell is barely visible (opacity 0.15); clearing the opaque core
    // is enough and keeps the flight from ballooning at both ends.
    topAboveGround: MARKER_FLOAT_HEIGHT + coreHalf,
    subjectHalfHeight: (MARKER_LABEL_TOP + coreHalf) / 2,
    subjectCentreOffset: (MARKER_LABEL_TOP - coreHalf) / 2,
  };
}

/** Profile samples taken synchronously in start() so frame 1 is not blind. */
const PREWARM_SAMPLES = 40;

/**
 * IntroCameraFlightService
 *
 * Scripted camera move from the HQ out to the spawn, played once after
 * loading completes. Two jobs:
 *
 *  1. Intro — trace the enemy route back to its source, at street level:
 *     hold over the HQ, fly out along the route, hold over the spawn, then
 *     pull back into the normal game view.
 *  2. Tile prewarm — flying the route makes the tiles renderer stream exactly
 *     the corridor the game cares about (road surface for terrain heights,
 *     adjacent facades as LOS blockers) while nobody is playing yet.
 *
 * Building avoidance is the interesting part. The camera follows the route
 * centreline; its altitude comes from an incrementally sampled skyline
 * profile that is max-filtered over a window reaching *ahead* of the camera,
 * so it is already above an obstacle before it arrives. In an open street
 * canyon there is no geometry above the road, the profile collapses to the
 * ground and the camera stays low.
 *
 * Ticked from `GameLoopFacadeService.onEngineUpdate`.
 */
@Injectable({ providedIn: 'root' })
export class IntroCameraFlightService {
  private readonly cameraControl = inject(CameraControlService);
  private readonly routeAnimation = inject(RouteAnimationService);
  private readonly ngZone = inject(NgZone);

  readonly cfg: FlightConfig = { ...DEFAULT_CONFIG };

  /** Master switch — flipped from DevTools while tuning. */
  private enabled = true;

  private engine: ThreeTilesEngine | null = null;

  // ── Flight state ────────────────────────────────────────────────────
  private running = false;
  private phase: FlightPhase = 'hold-start';
  /** Seconds spent in the current phase. */
  private phaseElapsed = 0;
  private curve: CatmullRomCurve3 | null = null;
  private totalLength = 0;
  /** Travel speed resolved from path length at start (m/s). */
  private speed = 0;
  /**
   * Position along the path in metres. Runs from `travelStart` to
   * `travelEnd`, both of which sit outside / inside the curve's own
   * [0, totalLength] range by the standoffs — values outside are
   * extrapolated along the end tangents by `pointAtDistance`.
   */
  private distance = 0;
  private travelStart = 0;
  private travelEnd = 0;
  /** Distance that profile index 0 corresponds to (negative: the standoff). */
  private profileOrigin = 0;
  /** HQ / spawn markers, invisible to raycasts, folded into the profile. */
  private markers: MarkerObstacle[] = [];
  /** Smoothed / rate-limited camera altitude. */
  private currentY = 0;

  // ── Profiles (scene space, see the note on sampleIndex) ─────────────
  /** Sampled skyline Y per index; NaN = not (yet) sampled. */
  private profile: Float32Array = new Float32Array(0);
  /** Sampled bare terrain Y per index; NaN = not (yet) sampled. */
  private groundProfile: Float32Array = new Float32Array(0);

  // ── Outro ───────────────────────────────────────────────────────────
  private endPos: Vector3 | null = null;
  private endTarget: Vector3 | null = null;
  /** Camera pose captured when the outro begins, so it blends from a fixed source. */
  private readonly outroFromPos = new Vector3();
  private readonly outroFromQuat = new Quaternion();
  private readonly outroToQuat = new Quaternion();

  // ── Scratch (no per-frame allocation) ───────────────────────────────
  private readonly pathPoint = new Vector3();
  private readonly aimPoint = new Vector3();
  private readonly samplePoint = new Vector3();
  private readonly tangent = new Vector3();
  /** Raw on-curve position before positional smoothing. */
  private readonly rawPos = new Vector3();
  /** Smoothed camera position actually written to the camera. */
  private readonly camPos = new Vector3();
  /** Scratch for groundAt's cold-profile fallback raycast. */
  private readonly fallbackPoint = new Vector3();
  private readonly orientMatrix = new Matrix4();
  private readonly targetQuat = new Quaternion();

  /** First tick of a run snaps instead of easing — the entry is a hard cut. */
  private firstTick = true;

  /**
   * True while the intro is playing. Drives the Skip button in the UI.
   * Signal rather than a plain flag so the template reacts without a manual
   * change-detection poke — `update()` runs outside the Angular zone.
   */
  readonly active = signal(false);

  private cancelHandler: (() => void) | null = null;

  /** Why the last start() bailed — surfaced via `__flight.state()`. */
  private skipReason: string | null = null;

  /** Record why a start attempt did nothing. Silent; read from DevTools. */
  private skip(reason: string): void {
    this.skipReason = reason;
  }

  // ========================================
  // LIFECYCLE
  // ========================================

  initialize(engine: ThreeTilesEngine): void {
    this.engine = engine;

    // DevTools: `__flight.cfg.travelDurationSec = 15`, `__flight.replay()`
    (globalThis as Record<string, unknown>)['__flight'] = {
      cfg: this.cfg,
      setEnabled: (v: boolean) => { this.enabled = v; },
      stop: () => this.stop(),
      replay: () => this.replay(),
      state: () => ({
        running: this.running,
        enabled: this.enabled,
        phase: this.phase,
        phaseElapsed: +this.phaseElapsed.toFixed(2),
        skipReason: this.skipReason,
        distance: Math.round(this.distance),
        totalLength: Math.round(this.totalLength),
        speed: +this.speed.toFixed(1),
        currentY: +this.currentY.toFixed(1),
        sampled: this.profile.reduce((n, v) => (Number.isNaN(v) ? n : n + 1), 0),
        samples: this.profile.length,
      }),
    };
  }

  isRunning(): boolean {
    return this.running;
  }

  /**
   * Start the flight along the longest cached route, flown HQ → spawn.
   *
   * @param cachedPaths Routes keyed by spawn id (`PathRouteService.getCachedPaths()`)
   */
  start(cachedPaths: Map<string, GeoPosition[]>): void {
    const engine = this.engine;
    if (!this.enabled) return this.skip('disabled');
    if (!engine) return this.skip('no-engine');
    if (cachedPaths.size === 0) return this.skip('no-paths');

    this.stop();

    const points = this.pickLongestRoute(engine, cachedPaths);
    if (!points || points.length < 2) return this.skip('route-too-short');

    const curve = new CatmullRomCurve3(points, false, 'centripetal');
    // Default 200 divisions is far too coarse for a multi-hundred-metre
    // street route — getPointAt() would not be evenly spaced.
    curve.arcLengthDivisions = Math.max(200, points.length * 8);
    const totalLength = curve.getLength();
    // Too short to be worth a cinematic
    if (totalLength < 50) return this.skip('path-under-50m');

    this.skipReason = null;
    this.curve = curve;
    this.totalLength = totalLength;

    // HQ is the local origin (ReorientationPlugin recenters on it); the spawn
    // marker is snapped to the path's own end by `snapSpawnMarkerToPathStart`.
    curve.getPointAt(1, this.samplePoint);
    this.markers = [
      markerObstacle(0, 0, HQ_MARKER_SCALE),
      markerObstacle(this.samplePoint.x, this.samplePoint.z, SPAWN_MARKER_SCALE),
    ];

    // Back off far enough that each marker (diamond + label) fits the frame
    // with the configured margin, but never closer than the explicit minimum.
    const framingDistance = (m: MarkerObstacle) => {
      const halfAngle = MathUtils.degToRad((this.cfg.holdFramingFill * engine.getCamera().fov) / 2);
      return m.subjectHalfHeight / Math.tan(Math.max(0.01, halfAngle));
    };

    this.travelStart = -Math.max(this.cfg.standoffStart, framingDistance(this.markers[0]));
    this.travelEnd = Math.max(
      this.cfg.sampleSpacing,
      totalLength - Math.max(this.cfg.standoffEnd, framingDistance(this.markers[1])),
    );
    // Profile covers the opening standoff too, so the camera has real ground
    // and skyline data before it reaches the path proper.
    this.profileOrigin = this.travelStart;

    // Derived from the span actually flown, not the raw path length — the
    // standoffs trim both ends and would otherwise skew the duration.
    this.speed = MathUtils.clamp(
      (this.travelEnd - this.travelStart) / Math.max(1, this.cfg.travelDurationSec),
      this.cfg.minSpeed,
      this.cfg.maxSpeed,
    );

    const span = totalLength - this.profileOrigin;
    const sampleCount = Math.ceil(span / this.cfg.sampleSpacing) + 2;
    this.profile = new Float32Array(sampleCount).fill(NaN);
    this.groundProfile = new Float32Array(sampleCount).fill(NaN);

    // Capture the view the flight has to land in BEFORE moving the camera —
    // it is stored during engine init and would otherwise be at risk of
    // being re-captured mid-flight.
    const initialView = this.cameraControl.getInitialView();
    this.endPos = initialView ? new Vector3(initialView.position.x, initialView.position.y, initialView.position.z) : null;
    this.endTarget = initialView ? new Vector3(initialView.target.x, initialView.target.y, initialView.target.z) : null;

    this.beginRun();
  }

  /**
   * Stop the flight and hand the camera back to the controls. Idempotent.
   * Does NOT reposition the camera — whoever stops it decides that; the
   * normal end-of-flight path has already blended into the game view.
   */
  stop(): void {
    this.detachCancelHandlers();
    if (!this.running) return;
    this.running = false;
    // The natural end of the flight is reached from inside the render loop,
    // which runs outside the Angular zone — same reason the game loop wraps
    // its store writes. Without this the Skip button would linger.
    this.ngZone.run(() => this.active.set(false));

    // Let the route animation resume its normal fade.
    this.routeAnimation.setHoldUntilReleased(false);

    const controls = this.engine?.getControls();
    if (controls) controls.enabled = true;
  }

  /**
   * Skip the intro: stop and jump straight to the final game view.
   *
   * Called by the Skip button and by the canvas input handlers — in both
   * cases the player asked for control, so hand it over immediately rather
   * than playing out the remaining phases.
   */
  cancel(): void {
    if (!this.running) return;
    this.stop();
    this.cameraControl.resetCamera();
  }

  /**
   * Re-run the last flight from the start (DevTools convenience).
   *
   * Reuses the geometry resolved by the last `start()` — standoffs, travel
   * bounds and speed are NOT recomputed, so changing those `cfg` values needs
   * a fresh `start()` (reload) to take effect. Everything read per frame
   * (altitudes, damping, framing aim) does apply immediately.
   */
  private replay(): void {
    if (!this.curve) return;
    this.stop();
    this.profile.fill(NaN);
    this.groundProfile.fill(NaN);
    this.beginRun();
  }

  /**
   * Arm a run on the already-built curve: reset progress, prewarm the
   * profile, seed altitude + aim so the first tick does not snap, take the
   * camera from the controls and pin the route animation on.
   */
  private beginRun(): void {
    const curve = this.curve;
    if (!curve) return;

    this.phase = 'hold-start';
    this.phaseElapsed = 0;
    this.distance = this.travelStart;
    this.firstTick = true;

    // Frame 1 must not be blind — sample the opening window synchronously.
    this.prewarmProfile();

    this.currentY = this.desiredAltitude(this.travelStart);

    const controls = this.engine?.getControls();
    if (controls) controls.enabled = false;

    // The cinematic outlasts the route animation's single pass — pin it.
    this.routeAnimation.setHoldUntilReleased(true);

    this.attachCancelHandlers();
    this.running = true;
    // Zone-wrapped for the same reason as in stop(): `replay()` is invoked
    // from the DevTools console, outside Angular.
    this.ngZone.run(() => this.active.set(true));
  }

  // ========================================
  // PER-FRAME
  // ========================================

  /**
   * @param deltaTime Frame time in milliseconds
   */
  update(deltaTime: number): void {
    if (!this.running || !this.curve || !this.engine) return;

    // Cap dt so a stall (tile parse spike, tab switch) does not teleport the
    // camera through a building.
    const dt = Math.min(deltaTime, 100) / 1000;
    const cfg = this.cfg;

    this.sampleProfileAhead();
    this.phaseElapsed += dt;

    // Advance the phase machine. Falls through deliberately: a phase that
    // ends mid-frame hands the remainder to the next one on the next tick.
    switch (this.phase) {
      case 'hold-start':
        if (this.phaseElapsed >= cfg.holdStartSec) this.enterPhase('travel');
        break;

      case 'travel':
        this.distance += this.speed * dt;
        if (this.distance >= this.travelEnd) {
          this.distance = this.travelEnd;
          this.enterPhase('hold-end');
        }
        break;

      case 'hold-end':
        if (this.phaseElapsed >= cfg.holdEndSec) {
          if (!this.endPos || !this.endTarget) {
            // No stored game view to blend into — nothing to pull back to.
            this.finish();
            return;
          }
          // Freeze the current pose as the outro's source, and precompute the
          // destination orientation so the blend lands exactly on the game
          // view. Capturing the live quaternion (not a recomputed lookAt)
          // avoids a snap: the slerped orientation lags the aim slightly.
          const cam = this.engine.getCamera();
          this.outroFromPos.copy(cam.position);
          this.outroFromQuat.copy(cam.quaternion);
          this.orientMatrix.lookAt(this.endPos, this.endTarget, cam.up);
          this.outroToQuat.setFromRotationMatrix(this.orientMatrix);
          this.enterPhase('outro');
        }
        break;

      case 'outro':
        if (this.phaseElapsed >= cfg.outroSec) {
          this.finish();
          return;
        }
        break;
    }

    const camera = this.engine.getCamera();

    if (this.phase === 'outro' && this.endPos) {
      const raw = MathUtils.clamp(this.phaseElapsed / Math.max(0.001, cfg.outroSec), 0, 1);
      const eased = raw * raw * (3 - 2 * raw); // smoothstep
      camera.position.copy(this.outroFromPos).lerp(this.endPos, eased);
      camera.quaternion.copy(this.outroFromQuat).slerp(this.outroToQuat, eased);
      return;
    }

    // hold-start / travel / hold-end all fly the same way — only `distance`
    // differs (frozen at `travelStart` resp. `travelEnd` during the holds).
    // Keeping the altitude loop live during the holds matters: tiles stream
    // in and the profile improves, so the camera settles instead of sitting
    // on a stale guess.
    this.pointAtDistance(this.distance, this.pathPoint);

    const desiredY = this.desiredAltitude(this.distance);
    const delta = MathUtils.clamp(
      desiredY - this.currentY,
      -cfg.maxDescendRate * dt,
      cfg.maxClimbRate * dt,
    );
    this.currentY += delta;

    this.rawPos.set(this.pathPoint.x, this.currentY, this.pathPoint.z);

    // During the holds the shot is *of* the marker, so aim at it rather than
    // at a point on the road ahead. Aiming ahead put the diamond and its label
    // near the top edge of the frame — the marker floats 30 m up while the
    // generic aim sits at ground + lookAtLift.
    const holdMarker =
      this.phase === 'hold-start' ? 0 : this.phase === 'hold-end' ? 1 : -1;
    if (holdMarker < 0 || !this.markerAim(holdMarker, this.aimPoint)) {
      this.computeAim(this.distance + cfg.lookAhead);
    }

    // Orientation as a quaternion target, then slerp — smoothing the actual
    // rotation instead of the point being looked at. Damping the look-at
    // point alone still let `lookAt()` rebuild the full basis every frame,
    // which is where the twitch at corners came from.
    this.orientMatrix.lookAt(this.rawPos, this.aimPoint, camera.up);
    this.targetQuat.setFromRotationMatrix(this.orientMatrix);

    if (this.firstTick) {
      this.firstTick = false;
      this.camPos.copy(this.rawPos);
      camera.quaternion.copy(this.targetQuat);
    } else {
      this.camPos.lerp(this.rawPos, smoothingAlpha(cfg.posDamping, dt));
      camera.quaternion.slerp(this.targetQuat, smoothingAlpha(cfg.aimDamping, dt));
    }

    camera.position.copy(this.camPos);
  }

  private enterPhase(phase: FlightPhase): void {
    this.phase = phase;
    this.phaseElapsed = 0;
  }

  private finish(): void {
    const camera = this.engine?.getCamera();
    if (camera && this.endPos && this.endTarget) {
      camera.position.copy(this.endPos);
      camera.lookAt(this.endTarget);
    }
    this.stop();
  }

  /**
   * Centre of the framed subject for marker `i` (0 = HQ, 1 = spawn), written
   * to `out`. Returns false while the ground under the marker is still
   * unsampled, in which case the caller falls back to the generic aim.
   *
   * Aims at the midpoint between the diamond's lower tip and the label's top,
   * not at the diamond's centre — the label reaches further up than the core
   * reaches down, so centring on the diamond alone crops the label.
   */
  private markerAim(i: number, out: Vector3): boolean {
    const m = this.markers[i];
    if (!m) return false;
    const ground = this.groundAt(i === 0 ? 0 : this.totalLength);
    if (ground === null) return false;

    out.set(m.x, ground + MARKER_FLOAT_HEIGHT + m.subjectCentreOffset, m.z);
    return true;
  }

  /**
   * Generic look-at target: `aimDistance` metres along the path, at ground
   * level plus `lookAtLift`. Written to `aimPoint`. Used while travelling;
   * the holds aim at their marker instead.
   */
  private computeAim(aimDistance: number): void {
    if (!this.pointAtDistance(aimDistance, this.aimPoint)) return;
    const groundRef = this.groundAt(aimDistance);
    this.aimPoint.y = (groundRef ?? this.currentY - this.cfg.minAltitude) + this.cfg.lookAtLift;
  }

  /**
   * Point on the path at `d` metres, written to `out`. Returns false if there
   * is no curve.
   *
   * Distances outside [0, totalLength] are extrapolated along the end
   * tangents rather than clamped — the flight deliberately starts before the
   * HQ (standoff) and looks past the spawn, and clamping would collapse those
   * onto the endpoints.
   */
  private pointAtDistance(d: number, out: Vector3): boolean {
    const curve = this.curve;
    if (!curve) return false;

    if (d < 0) {
      curve.getPointAt(0, out);
      curve.getTangentAt(0, this.tangent);
      out.addScaledVector(this.tangent, d);
    } else if (d > this.totalLength) {
      curve.getPointAt(1, out);
      curve.getTangentAt(1, this.tangent);
      out.addScaledVector(this.tangent, d - this.totalLength);
    } else {
      curve.getPointAt(d / this.totalLength, out);
    }
    return true;
  }

  /** Distance in metres that profile index `i` samples. */
  private indexToDistance(i: number): number {
    return this.profileOrigin + i * this.cfg.sampleSpacing;
  }

  /** Nearest profile index for a distance in metres (may be out of bounds). */
  private distanceToIndex(d: number): number {
    return Math.round((d - this.profileOrigin) / this.cfg.sampleSpacing);
  }

  // ========================================
  // PROFILES
  // ========================================

  /**
   * Max of all sampled skyline values within ±dilationWindow of `distance`,
   * plus clearance — floored at `ground + minAltitude`.
   *
   * The window reaching FORWARD is the whole point: without it the camera
   * only starts climbing once it is already inside the facade. Unsampled
   * indices are simply skipped, so a cold profile degrades to the floor
   * rather than to a wrong (too low) altitude.
   */
  private desiredAltitude(distance: number): number {
    const cfg = this.cfg;
    const ground = this.groundAt(distance);
    const floor = ground !== null ? ground + cfg.minAltitude : -Infinity;

    const from = Math.max(0, this.distanceToIndex(distance - cfg.dilationWindow));
    const to = Math.min(
      this.profile.length - 1,
      this.distanceToIndex(distance + cfg.dilationWindow),
    );

    let maxSkyline = -Infinity;
    for (let i = from; i <= to; i++) {
      const v = this.profile[i];
      if (!Number.isNaN(v) && v > maxSkyline) maxSkyline = v;
    }

    if (maxSkyline === -Infinity) return floor === -Infinity ? this.currentY : floor;
    return Math.max(floor, maxSkyline + cfg.clearance);
  }

  /**
   * Take up to `samplesPerFrame` new samples in the window around and ahead
   * of the camera. Failed samples (tile not loaded yet) are left as NaN and
   * retried on a later frame — same self-healing shape as the route grid's
   * cell sampling. The attempt still costs budget so a persistently cold
   * region cannot spin the loop.
   */
  private sampleProfileAhead(): void {
    if (!this.engine || !this.curve) return;
    const cfg = this.cfg;

    const from = Math.max(0, this.distanceToIndex(this.distance - cfg.dilationWindow));
    const to = Math.min(
      this.profile.length - 1,
      this.distanceToIndex(this.distance + cfg.dilationWindow + cfg.lookAhead),
    );

    let budget = cfg.samplesPerFrame;
    for (let i = from; i <= to && budget > 0; i++) {
      if (!Number.isNaN(this.profile[i]) && !Number.isNaN(this.groundProfile[i])) continue;
      this.sampleIndex(i);
      budget--;
    }
  }

  /** Synchronous burst so the opening frames already have a profile. */
  private prewarmProfile(): void {
    const limit = Math.min(this.profile.length, PREWARM_SAMPLES);
    for (let i = 0; i < limit; i++) {
      if (Number.isNaN(this.profile[i]) || Number.isNaN(this.groundProfile[i])) {
        this.sampleIndex(i);
      }
    }
  }

  /**
   * One profile sample: a single column probe yields both the top surface
   * (for obstacle clearance) and the bare ground (for the aim and the floor).
   *
   * Altitudes come from these samples rather than from the curve's own Y so
   * the flight stays independent of how the route line happens to be built.
   */
  private sampleIndex(i: number): void {
    const engine = this.engine;
    if (!engine) return;
    if (!this.pointAtDistance(this.indexToDistance(i), this.samplePoint)) return;

    const column = engine.sampleColumn(this.samplePoint.x, this.samplePoint.z);
    if (column !== null) {
      this.profile[i] = column.topY;
      this.groundProfile[i] = column.groundY;
    }

    this.applyMarkerObstacles(i);
  }

  /**
   * Fold the HQ / spawn markers into the skyline profile at index `i`.
   *
   * They are overlay-group objects and therefore invisible to every raycast
   * the profile is built from, but they are large and float 30 m up — the
   * camera flew straight through the HQ diamond before this. Treating them as
   * skyline means the existing dilation lifts the camera well before it
   * arrives and the rate limiter brings it back down afterwards, no
   * special-casing in the flight logic.
   *
   * Needs the ground sample: marker heights are relative to the ground below
   * them. If the ground is still cold this is a no-op and gets retried with
   * the rest of the sample.
   */
  private applyMarkerObstacles(i: number): void {
    const ground = this.groundProfile[i];
    if (Number.isNaN(ground)) return;

    for (const m of this.markers) {
      const dx = this.samplePoint.x - m.x;
      const dz = this.samplePoint.z - m.z;
      if (dx * dx + dz * dz > m.radiusSq) continue;

      // Raw marker top — the normal `clearance` is added later by
      // desiredAltitude, same as for any building.
      const top = ground + m.topAboveGround;
      const current = this.profile[i];
      if (Number.isNaN(current) || top > current) this.profile[i] = top;
    }
  }

  /**
   * Bare terrain Y at a distance along the path, in scene space. Walks
   * outward from the nearest index so a single cold sample does not fall
   * back all the way. Returns null when nothing nearby is sampled yet.
   */
  private groundAt(distance: number): number | null {
    const centre = this.distanceToIndex(distance);
    const span = 6;
    for (let d = 0; d <= span; d++) {
      for (const i of d === 0 ? [centre] : [centre - d, centre + d]) {
        if (i < 0 || i >= this.groundProfile.length) continue;
        const v = this.groundProfile[i];
        if (!Number.isNaN(v)) return v;
      }
    }

    // Nothing sampled anywhere near: pay for one live raycast rather than
    // report "unknown". Callers fall back to the camera's current Y, which is
    // 0 on the very first tick — that would put the camera ~165 m below the
    // terrain and then have the rate limiter crawl back up for seconds.
    if (this.engine && this.pointAtDistance(distance, this.fallbackPoint)) {
      return this.engine.getTerrainHeightAtLocal(this.fallbackPoint.x, this.fallbackPoint.z);
    }
    return null;
  }

  // ========================================
  // HELPERS
  // ========================================

  /**
   * Longest of the cached routes, converted to local points and **reversed**
   * so the flight runs HQ → spawn.
   *
   * `PathRouteService` builds every route with A* from the spawn to the base
   * (`findPath(spawn → baseCoords)`), so `path[0]` is the spawn. The intro
   * traces the route the other way — outward from what the player defends to
   * where the threat comes from.
   *
   * The demo flies one route; the remaining spawns get coarse tile coverage
   * from the outro overview anyway.
   */
  private pickLongestRoute(
    engine: ThreeTilesEngine,
    cachedPaths: Map<string, GeoPosition[]>,
  ): Vector3[] | null {
    let best: Vector3[] | null = null;
    let bestLength = 0;

    for (const path of cachedPaths.values()) {
      if (path.length < 2) continue;
      const points = routePathToLocalPoints(engine, path, PATH_HEIGHT_OFFSET);
      if (points.length < 2) continue;

      let length = 0;
      for (let i = 1; i < points.length; i++) length += points[i].distanceTo(points[i - 1]);

      if (length > bestLength) {
        bestLength = length;
        best = points;
      }
    }

    best?.reverse();
    return best;
  }

  // ========================================
  // INPUT CANCEL
  // ========================================

  /**
   * Any deliberate camera input cancels the flight. The controls are disabled
   * during the flight, so their own 'start' event never fires — listen on the
   * canvas directly.
   */
  private attachCancelHandlers(): void {
    const dom = this.engine?.getRenderer().domElement;
    if (!dom || this.cancelHandler) return;

    const onInput = () => this.cancel();
    // Any key skips, except while the user is typing somewhere (the header's
    // location field is editable during the intro).
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.isContentEditable || t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) {
        return;
      }
      this.cancel();
    };

    dom.addEventListener('pointerdown', onInput);
    dom.addEventListener('wheel', onInput, { passive: true });
    window.addEventListener('keydown', onKey);

    this.cancelHandler = () => {
      dom.removeEventListener('pointerdown', onInput);
      dom.removeEventListener('wheel', onInput);
      window.removeEventListener('keydown', onKey);
    };
  }

  private detachCancelHandlers(): void {
    this.cancelHandler?.();
    this.cancelHandler = null;
  }
}
