import { Injectable, NgZone, inject, signal } from '@angular/core';
import { type CatmullRomCurve3, MathUtils, Matrix4, type PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { ThreeTilesEngine } from '../../three-engine';
import type { ColumnSample } from '../../three-engine/column-sample';
import { GeoPosition } from '../../models/game.types';
import { buildFlightPath } from '../../utils/flight-path';
import {
  HQ_MARKER_SCALE,
  MARKER_CORE_RADIUS,
  MARKER_FLOAT_HEIGHT,
  MARKER_LABEL_TOP,
  MARKER_RING_RADIUS,
  MARKER_Y_STRETCH,
  PORTAL_LABEL_TOP,
  PORTAL_MAX_RADIUS,
  PORTAL_MAX_TOP,
} from '../../configs/marker-geometry.config';
import { cameraTimeline } from '../../utils/camera-timeline';
import { ownsKey } from '../../utils/keyboard-target';
import { raycastStats } from '../../utils/raycast-stats';
import { routePathToLocalPoints } from '../../utils/route-path.util';
import {
  type FlightProfile,
  clearFlightProfile,
  countReliable,
  createFlightProfile,
  pickSamples,
  safeGround,
  skylineMax,
  stepAltitude,
} from '../../utils/flight-altitude';
import { CameraControlService } from '../camera-control.service';
import { RouteAnimationService } from './route-animation.service';

/**
 * Phases of the intro sequence, in order. Each runs to its own timer except
 * `travel`, which runs until the path is used up.
 */
type FlightPhase = 'enter' | 'hold-start' | 'travel' | 'hold-end' | 'outro';

/**
 * Live-tunable parameters. Mutated from DevTools via `__flight.cfg` so the
 * flight can be tuned without a rebuild — this is a spike, the numbers are
 * expected to move a lot before any of them is worth freezing.
 */
interface FlightConfig {
  /**
   * Seconds of the swing from the view the flight starts in (the overview)
   * into the hold over the HQ. 0 cuts straight to the hold.
   */
  enterSec: number;
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

  /**
   * Geometric error (m) up to which a profile sample counts as reliable.
   * Coarser samples come from ancestor tiles that can sit far off the real
   * surface (a cold-cache intro flew at -3154 m); they are re-sampled and never
   * taken as ground on their own, see utils/flight-altitude.ts. The route
   * corridor refines to 5 m, the camera's own budget reaches ~9 m at 400 m.
   */
  maxSampleError: number;
  /** Hard floor above the known ground (m), applied every frame without rate limit. */
  hardClearance: number;
}

const DEFAULT_CONFIG: FlightConfig = {
  enterSec: 3,
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

  maxSampleError: 20,
  hardClearance: 5,
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

/** Snapshot of the flight for `__flight.state()` and the state dump. */
export interface FlightDebugState {
  running: boolean;
  enabled: boolean;
  phase: FlightPhase;
  phaseElapsed: number;
  skipReason: string | null;
  distance: number;
  totalLength: number;
  speed: number;
  currentY: number;
  sampled: number;
  reliable: number;
  samples: number;
}

/**
 * A marker treated as an obstacle in the altitude profile and as a subject to
 * frame: the HQ diamond or a spawn portal. Markers are overlay-group objects,
 * so no raycast against the tiles ever reports them; the flight takes their
 * extents from the marker config. The label is the part that has to stay in
 * frame for a hold to be readable, it is the highest part of either marker.
 */
interface MarkerObstacle {
  x: number;
  z: number;
  radiusSq: number;
  /** Top of the solid part, relative to the ground beneath it (m). */
  topAboveGround: number;
  /** Half the height of what must be framed (body + label). */
  subjectHalfHeight: number;
  /** Centre of the framed subject above the ground (m). */
  subjectCentreAboveGround: number;
}

function hqObstacle(x: number, z: number): MarkerObstacle {
  const radius = MARKER_RING_RADIUS * HQ_MARKER_SCALE;
  const coreHalf = MARKER_CORE_RADIUS * HQ_MARKER_SCALE * MARKER_Y_STRETCH;
  // Subject spans the core's bottom up to the label's top, asymmetric about
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
    subjectCentreAboveGround: MARKER_FLOAT_HEIGHT + (MARKER_LABEL_TOP - coreHalf) / 2,
  };
}

/**
 * A spawn portal stands on the ground; the subject runs from its foot up to
 * the label above the crown. Sized for the largest portal, the flight does
 * not know the corridor at the spawn.
 */
function portalObstacle(x: number, z: number): MarkerObstacle {
  return {
    x,
    z,
    radiusSq: PORTAL_MAX_RADIUS * PORTAL_MAX_RADIUS,
    topAboveGround: PORTAL_MAX_TOP,
    subjectHalfHeight: PORTAL_LABEL_TOP / 2,
    subjectCentreAboveGround: PORTAL_LABEL_TOP / 2,
  };
}

/** Profile samples taken synchronously in start() so frame 1 is not blind. */
const PREWARM_SAMPLES = 40;

/** Flight seconds between two rows of `__flight.trace()`. */
const TRACE_INTERVAL_SEC = 0.1;
/** Enough for any intro (about 40 s); a replay loop cannot grow it further. */
const TRACE_MAX_ROWS = 1000;
const TRACE_HEADER = 't,phase,distance,x,y,z,yaw,pitch,currentY,desiredY,groundY';

/**
 * IntroCameraFlightService
 *
 * Scripted camera move from the HQ out to the spawn, played once after
 * loading completes. Two jobs:
 *
 *  1. Intro — trace the enemy route back to its source, at street level:
 *     swing in from the overview to the HQ, hold over it, fly out along the
 *     route, hold over the spawn, then pull back into the normal game view.
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
  /** Horizontal (y = 0), see utils/flight-path.ts. */
  private curve: CatmullRomCurve3 | null = null;
  private totalLength = 0;
  /** Scene Y of the route points at a distance along the curve, see routeGroundAt. */
  private routeYAt: (distance: number) => number = () => 0;
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

  // ── Profile (scene space, see the note on sampleIndex) ──────────────
  /** Skyline, ground and tile error per index; NaN = no hit yet. */
  private profile: FlightProfile = createFlightProfile(0);
  /** Round-robin position of the per-frame sampling, see pickSamples. */
  private sampleCursor = 0;
  private readonly pickedSamples: number[] = [];

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
  private readonly orientMatrix = new Matrix4();
  private readonly targetQuat = new Quaternion();

  /**
   * First tick of the hold snaps instead of easing. Only a cut when there is
   * no enter swing (enterSec 0); the swing ends exactly on the hold's pose.
   */
  private firstTick = true;

  // ── Enter swing ─────────────────────────────────────────────────────
  /** Camera position when the run began. */
  private readonly enterFromPos = new Vector3();
  /** Point the camera looked at when the run began, as far out as the HQ. */
  private readonly enterFromLook = new Vector3();
  private readonly enterLook = new Vector3();

  // ── Trace (`__flight.trace()`) ──────────────────────────────────────
  /** Flight seconds since the run began. */
  private traceClock = 0;
  private nextTraceAt = 0;
  /** CSV rows of the last run, see recordTrace(). */
  private readonly traceRows: string[] = [];
  private readonly traceDir = new Vector3();

  /**
   * True while the intro is playing. Drives the Skip button in the UI.
   * Signal rather than a plain flag so the template reacts without a manual
   * change-detection poke — `update()` runs outside the Angular zone.
   */
  readonly active = signal(false);

  private cancelHandler: (() => void) | null = null;

  /** Why the last start() bailed — surfaced via `__flight.state()`. */
  private skipReason: string | null = null;

  /** Built by prepare() and not flown yet; start() flies it with the samples gathered so far. */
  private prepared = false;

  /** Record why a start attempt did nothing. Silent; read from DevTools. */
  private skip(reason: string): false {
    this.skipReason = reason;
    cameraTimeline.record('intro.skip', { reason });
    return false;
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
      state: () => this.debugState(),
      // CSV of the last run, one row per 0.1 s: `copy(__flight.trace())`
      trace: () => this.traceCsv(),
    };
  }

  /** What `__flight.state()` shows; the state dump (Dev → Dump) carries it too. */
  debugState(): FlightDebugState {
    return {
      running: this.running,
      enabled: this.enabled,
      phase: this.phase,
      phaseElapsed: +this.phaseElapsed.toFixed(2),
      skipReason: this.skipReason,
      distance: Math.round(this.distance),
      totalLength: Math.round(this.totalLength),
      speed: +this.speed.toFixed(1),
      currentY: +this.currentY.toFixed(1),
      sampled: this.profile.ground.reduce((n, v) => (Number.isNaN(v) ? n : n + 1), 0),
      reliable: countReliable(this.profile, this.cfg.maxSampleError),
      samples: this.profile.ground.length,
    };
  }

  /** CSV of the last run, one row per TRACE_INTERVAL_SEC, see recordTrace(). */
  traceCsv(): string {
    return [TRACE_HEADER, ...this.traceRows].join('\n');
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
    if (!this.prepared && !this.prepare(cachedPaths)) return;
    this.prepared = false;

    // The view the flight lands in, computed now: the ground under it is
    // better than during loading (a cold cache has none there at all).
    const initialView = this.cameraControl.getOverview();
    this.endPos = initialView ? new Vector3(initialView.position.x, initialView.position.y, initialView.position.z) : null;
    this.endTarget = initialView ? new Vector3(initialView.target.x, initialView.target.y, initialView.target.z) : null;
    cameraTimeline.record('intro.start', {
      endPos: initialView?.position ?? null,
      endTarget: initialView?.target ?? null,
      travelStart: Math.round(this.travelStart),
      travelEnd: Math.round(this.travelEnd),
      speed: +this.speed.toFixed(1),
    });

    this.beginRun();
  }

  /**
   * Build the flight along the longest cached route without taking the
   * camera: curve, markers, standoffs, speed and an empty profile. The boot
   * gate calls this early and samples through prepareTick() while the
   * loading screen is up; start() then flies what was prepared.
   *
   * @returns false if there is nothing to fly (reason in `__flight.state()`)
   */
  prepare(cachedPaths: Map<string, GeoPosition[]>): boolean {
    const engine = this.engine;
    if (!this.enabled) return this.skip('disabled');
    if (!engine) return this.skip('no-engine');
    if (cachedPaths.size === 0) return this.skip('no-paths');

    this.stop();

    const points = this.pickLongestRoute(engine, cachedPaths);
    if (!points || points.length < 2) return this.skip('route-too-short');

    // Horizontal curve: the route heights are cell heights at build time,
    // on a cold cache often from coarse tiles, and must not bend the path.
    const path = buildFlightPath(points);
    const curve = path.curve;
    const totalLength = path.length;
    // Too short to be worth a cinematic
    if (totalLength < 50) return this.skip('path-under-50m');

    this.skipReason = null;
    this.curve = curve;
    this.totalLength = totalLength;
    this.routeYAt = path.routeYAt;

    // HQ is the local origin (ReorientationPlugin recenters on it); the spawn
    // portal stands on the path's own end (MarkerVisualizationService.placeSpawnPortal).
    curve.getPointAt(1, this.samplePoint);
    this.markers = [
      hqObstacle(0, 0),
      portalObstacle(this.samplePoint.x, this.samplePoint.z),
    ];

    // Back off far enough that each marker (body + label) fits the frame
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
    this.profile = createFlightProfile(sampleCount);
    this.sampleCursor = 0;
    this.prepared = true;
    cameraTimeline.record('intro.prepare', { points: points.length, totalLength: Math.round(totalLength) });
    return true;
  }

  /**
   * Budgeted sampling over the whole route while the loading screen waits
   * (boot gate). Same round robin as in flight, so coarse samples are
   * refined as the corridor tiles stream in.
   */
  prepareTick(budget: number): void {
    if (!this.prepared) return;
    this.sampleCursor = pickSamples(
      this.profile,
      0,
      this.profile.ground.length - 1,
      budget,
      this.sampleCursor,
      this.cfg.maxSampleError,
      this.pickedSamples,
    );
    for (const i of this.pickedSamples) this.sampleIndex(i);
  }

  /**
   * Share of reliable samples on the route itself, 0..1 (boot gate). The
   * standoff before the HQ is left out: it lies off the route corridor, the
   * part that streams fine tiles during loading. 1 without a route.
   */
  readiness(): number {
    const from = Math.max(0, this.distanceToIndex(0));
    const count = this.profile.ground.length - from;
    if (!this.curve || count <= 0) return 1;
    return countReliable(this.profile, this.cfg.maxSampleError, from) / count;
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
    cameraTimeline.record('intro.stop', { phase: this.phase });
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
   * Called by the Skip button, by the canvas input handlers and by Esc
   * (handleKeyDown) — in each case the player asked for control, so hand it
   * over immediately rather than playing out the remaining phases.
   */
  cancel(reason = 'api'): void {
    if (!this.running) return;
    cameraTimeline.record('intro.cancel', { reason, phase: this.phase, phaseElapsed: +this.phaseElapsed.toFixed(2) });
    this.stop();
    this.cameraControl.resetCamera();
  }

  /**
   * Window keydown, asked by the game component before its own handlers.
   * While the flight plays, Esc skips it and every other game key is held
   * back: the camera belongs to the flight, so a jump (Home, N) could not
   * follow, and a key that cut the flight short without doing its own job
   * read as broken. Typing in a field (the header's location search works
   * during the intro) and an Esc a dialog already took stay theirs.
   *
   * @returns true when the game must leave the key alone
   */
  handleKeyDown(event: KeyboardEvent): boolean {
    if (!this.running) return false;
    if (event.defaultPrevented || ownsKey(event.target, event.key)) return false;
    if (event.key === 'Escape') {
      event.preventDefault();
      this.cancel('key Escape');
    }
    return true;
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
    clearFlightProfile(this.profile);
    this.sampleCursor = 0;
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

    this.phaseElapsed = 0;
    this.distance = this.travelStart;
    this.firstTick = true;
    this.traceRows.length = 0;
    this.traceClock = 0;
    this.nextTraceAt = 0;

    // Frame 1 must not be blind — sample the opening window synchronously.
    this.prewarmProfile();

    this.currentY = this.desiredAltitude(this.travelStart);

    // Swing in from wherever the camera is (the overview after loading).
    // The look point sits on the current view axis as far out as the HQ, so
    // the swing starts on exactly the current orientation.
    const camera = this.engine?.getCamera();
    if (camera && this.cfg.enterSec > 0 && this.markerAim(0, this.aimPoint)) {
      this.enterFromPos.copy(camera.position);
      const reach = camera.position.distanceTo(this.aimPoint);
      this.enterFromLook.set(0, 0, -1).applyQuaternion(camera.quaternion).multiplyScalar(reach).add(camera.position);
      this.phase = 'enter';
    } else {
      this.phase = 'hold-start';
    }

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
    this.traceClock += dt;

    this.sampleProfileAhead();
    this.phaseElapsed += dt;

    // Advance the phase machine. Falls through deliberately: a phase that
    // ends mid-frame hands the remainder to the next one on the next tick.
    switch (this.phase) {
      case 'enter':
        if (this.phaseElapsed >= cfg.enterSec) this.enterPhase('hold-start');
        break;

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
      this.recordTrace(camera);
      return;
    }

    // hold-start / travel / hold-end all fly the same way — only `distance`
    // differs (frozen at `travelStart` resp. `travelEnd` during the holds).
    // Keeping the altitude loop live during the holds matters: tiles stream
    // in and the profile improves, so the camera settles instead of sitting
    // on a stale guess.
    this.pointAtDistance(this.distance, this.pathPoint);

    // Rate-limited toward the target altitude, but never below the known
    // ground plus hardClearance, not even for a frame when a late sample
    // lifts the ground.
    const floorY = this.groundAt(this.distance) + cfg.hardClearance;
    this.currentY = stepAltitude(
      this.currentY,
      this.desiredAltitude(this.distance),
      floorY,
      dt,
      cfg.maxClimbRate,
      cfg.maxDescendRate,
    );

    this.rawPos.set(this.pathPoint.x, this.currentY, this.pathPoint.z);

    // During the holds the shot is *of* the marker, so aim at it rather than
    // at a point on the road ahead. Aiming ahead put the diamond and its label
    // near the top edge of the frame — the marker floats 30 m up while the
    // generic aim sits at ground + lookAtLift.
    const holdMarker =
      this.phase === 'enter' || this.phase === 'hold-start' ? 0 : this.phase === 'hold-end' ? 1 : -1;
    if (holdMarker < 0 || !this.markerAim(holdMarker, this.aimPoint)) {
      this.computeAim(this.distance + cfg.lookAhead);
    }

    if (this.phase === 'enter') {
      this.applyEnterSwing(camera, floorY);
      return;
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

    // The positional smoothing lags a little; it must not drag the camera
    // under the floor either.
    if (this.camPos.y < floorY) this.camPos.y = floorY;
    camera.position.copy(this.camPos);
    this.recordTrace(camera);
  }

  /**
   * One row every TRACE_INTERVAL_SEC for `__flight.trace()`: where the camera
   * is, where it looks (yaw from +Z towards +X, pitch positive upward) and
   * what the altitude loop wants there. For reading a wobble off numbers.
   */
  private recordTrace(camera: PerspectiveCamera): void {
    if (this.traceClock < this.nextTraceAt || this.traceRows.length >= TRACE_MAX_ROWS) return;
    this.nextTraceAt = this.traceClock + TRACE_INTERVAL_SEC;

    const dir = this.traceDir.set(0, 0, -1).applyQuaternion(camera.quaternion);
    const f1 = (v: number) => v.toFixed(1);
    this.traceRows.push([
      this.traceClock.toFixed(2),
      this.phase,
      f1(this.distance),
      f1(camera.position.x),
      f1(camera.position.y),
      f1(camera.position.z),
      f1(MathUtils.radToDeg(Math.atan2(dir.x, dir.z))),
      f1(MathUtils.radToDeg(Math.asin(MathUtils.clamp(dir.y, -1, 1)))),
      f1(this.currentY),
      this.phase === 'outro' ? '' : f1(this.desiredAltitude(this.distance)),
      f1(this.groundAt(this.distance)),
    ].join(','));
  }

  /**
   * One frame of the enter swing: position and look point both ease
   * (smoothstep) from where the run began to the hold's live pose, which
   * keeps settling as the profile fills. The camera always looks at the
   * blended point, so the HQ drifts into the centre instead of being
   * rotated past. Ends exactly on the hold's pose, the hold then continues
   * without a snap.
   */
  private applyEnterSwing(camera: PerspectiveCamera, floorY: number): void {
    const raw = MathUtils.clamp(this.phaseElapsed / Math.max(0.001, this.cfg.enterSec), 0, 1);
    const eased = raw * raw * (3 - 2 * raw);

    this.camPos.copy(this.enterFromPos).lerp(this.rawPos, eased);
    if (this.camPos.y < floorY) this.camPos.y = floorY;
    this.enterLook.copy(this.enterFromLook).lerp(this.aimPoint, eased);

    camera.position.copy(this.camPos);
    this.orientMatrix.lookAt(this.camPos, this.enterLook, camera.up);
    camera.quaternion.setFromRotationMatrix(this.orientMatrix);
    this.firstTick = false;
    this.recordTrace(camera);
  }

  private enterPhase(phase: FlightPhase): void {
    this.phase = phase;
    this.phaseElapsed = 0;
    cameraTimeline.record('intro.phase', { phase, distance: Math.round(this.distance) });
  }

  private finish(): void {
    cameraTimeline.record('intro.finish');
    const camera = this.engine?.getCamera();
    if (camera && this.endPos && this.endTarget) {
      camera.position.copy(this.endPos);
      camera.lookAt(this.endTarget);
    }
    this.stop();
  }

  /**
   * Centre of the framed subject for marker `i` (0 = HQ, 1 = spawn), written
   * to `out`. Returns false when there is no such marker.
   *
   * Aims at the middle of the subject (see MarkerObstacle): for the HQ the
   * midpoint between the diamond's lower tip and the label's top, for a
   * portal the midpoint between its foot and the label. The label reaches
   * further up than the body, so centring on the body alone crops it.
   */
  private markerAim(i: number, out: Vector3): boolean {
    const m = this.markers[i];
    if (!m) return false;
    const ground = this.groundAt(i === 0 ? 0 : this.totalLength);

    out.set(m.x, ground + m.subjectCentreAboveGround, m.z);
    return true;
  }

  /**
   * Generic look-at target: `aimDistance` metres along the path, at ground
   * level plus `lookAtLift`. Written to `aimPoint`. Used while travelling;
   * the holds aim at their marker instead. Follows groundAt, so a late,
   * higher sample lifts the aim as well, eased by the orientation slerp.
   */
  private computeAim(aimDistance: number): void {
    if (!this.pointAtDistance(aimDistance, this.aimPoint)) return;
    this.aimPoint.y = this.groundAt(aimDistance) + this.cfg.lookAtLift;
  }

  /**
   * Point on the path at `d` metres, written to `out`, at y = 0 (the curve is
   * horizontal; heights come from the profile). Returns false if there is no
   * curve.
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
   * Highest skyline sample within ±dilationWindow of `distance`, plus
   * clearance, floored at `ground + minAltitude`.
   *
   * The window reaching FORWARD is the whole point: without it the camera
   * only starts climbing once it is already inside the facade. The ground
   * comes from groundAt and is never below a plausible value, so a cold
   * profile flies at the floor over the route heights instead of following a
   * coarse tile far below the surface.
   */
  private desiredAltitude(distance: number): number {
    const cfg = this.cfg;
    const floor = this.groundAt(distance) + cfg.minAltitude;
    const skyline = skylineMax(
      this.profile,
      this.distanceToIndex(distance - cfg.dilationWindow),
      this.distanceToIndex(distance + cfg.dilationWindow),
    );
    return Math.max(floor, skyline + cfg.clearance);
  }

  /**
   * Take up to `samplesPerFrame` samples in the window around and ahead of
   * the camera: indices without a hit and indices with only a coarse sample,
   * round robin (see pickSamples). A coarse index is re-sampled until finer
   * tiles arrive; the engine's column cache answers from memory until the
   * tile set changes, so the retries are cheap. The attempt still costs
   * budget so a persistently cold region cannot spin the loop.
   */
  private sampleProfileAhead(): void {
    if (!this.engine || !this.curve) return;
    const cfg = this.cfg;

    this.sampleCursor = pickSamples(
      this.profile,
      this.distanceToIndex(this.distance - cfg.dilationWindow),
      this.distanceToIndex(this.distance + cfg.dilationWindow + cfg.lookAhead),
      cfg.samplesPerFrame,
      this.sampleCursor,
      cfg.maxSampleError,
      this.pickedSamples,
    );
    for (const i of this.pickedSamples) this.sampleIndex(i);
  }

  /** Synchronous burst so the opening frames already have a profile. */
  private prewarmProfile(): void {
    const limit = Math.min(this.profile.ground.length, PREWARM_SAMPLES);
    pickSamples(this.profile, 0, limit - 1, limit, 0, this.cfg.maxSampleError, this.pickedSamples);
    for (const i of this.pickedSamples) this.sampleIndex(i);
  }

  /**
   * One profile sample: a single column probe yields both the top surface
   * (for obstacle clearance) and the bare ground (for the aim and the floor),
   * plus the tile error that decides whether the sample counts as reliable.
   *
   * Altitudes come from these samples; the curve itself is horizontal, and
   * the route's own heights only serve as groundAt's fallback. Those heights
   * ARE the frozen route cells (routePathToLocalPoints over the cached path);
   * the column stays because a cell carries no top and because the profile
   * reaches back past the HQ, off the corridor. See docs/ROUTE_CORRIDOR.md,
   * "Warum das Overlay seine eigenen Säulen behält".
   */
  private sampleIndex(i: number): void {
    const engine = this.engine;
    if (!engine) return;
    const distance = this.indexToDistance(i);
    if (!this.pointAtDistance(distance, this.samplePoint)) return;

    const scope = raycastStats.enter('intro');
    let column: ColumnSample | null;
    try {
      column = engine.terrain.sampleColumn(this.samplePoint.x, this.samplePoint.z);
    } finally {
      raycastStats.exit(scope);
    }
    if (column !== null) {
      this.profile.top[i] = column.topY;
      this.profile.ground[i] = column.groundY;
      this.profile.error[i] = column.tileGeometricError;
    }

    this.applyMarkerObstacles(i, distance);
  }

  /**
   * Fold the HQ diamond and the spawn portal into the skyline profile at
   * index `i`.
   *
   * They are overlay-group objects and therefore invisible to every raycast
   * the profile is built from, but they are large (the diamond floats 30 m
   * up, a portal stands up to PORTAL_MAX_TOP tall): the camera flew
   * straight through the HQ diamond before this. Treating them as
   * skyline means the existing dilation lifts the camera well before it
   * arrives and the rate limiter brings it back down afterwards, no
   * special-casing in the flight logic.
   *
   * Marker heights are relative to the ground below them, taken from
   * groundAt so a coarse sample cannot sink the marker with it.
   */
  private applyMarkerObstacles(i: number, distance: number): void {
    let ground = NaN;
    for (const m of this.markers) {
      const dx = this.samplePoint.x - m.x;
      const dz = this.samplePoint.z - m.z;
      if (dx * dx + dz * dz > m.radiusSq) continue;

      if (Number.isNaN(ground)) ground = this.groundAt(distance);
      // Raw marker top, the normal `clearance` is added later by
      // desiredAltitude, same as for any building.
      const top = ground + m.topAboveGround;
      const current = this.profile.top[i];
      if (Number.isNaN(current) || top > current) this.profile.top[i] = top;
    }
  }

  /**
   * Bare terrain Y at a distance along the path, in scene space. Never null
   * and never taken from a coarse sample alone: a reliable sample within ±6
   * indices, otherwise the highest of the nearest reliable sample anywhere,
   * a nearby coarse one and the route's own height (see safeGround).
   */
  private groundAt(distance: number): number {
    return safeGround(
      this.profile,
      this.distanceToIndex(distance),
      6,
      this.cfg.maxSampleError,
      this.routeGroundAt(distance),
    );
  }

  /** Ground the route was built on (cell heights at build time). */
  private routeGroundAt(distance: number): number {
    return this.routeYAt(distance);
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
      // On the ground: the curve is flat, and the route height is only the
      // ground to fall back on (routeGroundAt), whatever the red line's lift
      const points = routePathToLocalPoints(engine, path, 0);
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
   * A click or the wheel on the canvas cancels the flight. The controls are
   * disabled during the flight, so their own 'start' event never fires —
   * listen on the canvas directly. Of the keys only Esc cancels, see
   * handleKeyDown.
   */
  private attachCancelHandlers(): void {
    const dom = this.engine?.getRenderer().domElement;
    if (!dom || this.cancelHandler) return;

    const onInput = (e: Event) => this.cancel(e.type);

    dom.addEventListener('pointerdown', onInput);
    dom.addEventListener('wheel', onInput, { passive: true });

    this.cancelHandler = () => {
      dom.removeEventListener('pointerdown', onInput);
      dom.removeEventListener('wheel', onInput);
    };
  }

  private detachCancelHandlers(): void {
    this.cancelHandler?.();
    this.cancelHandler = null;
  }
}
