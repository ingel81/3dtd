import { MathUtils, Matrix4, Vector3 } from 'three';
import { GlobeView, type ScreenSpot } from './globe-view';
import type { GlobeQuality } from './globe-textures';
import { ecefOf, subsolarPoint, sweptSun, type LatLon } from './globe-geo';
import { IDLE_TURN_RATE, blendShot, easeInOut, shotPose, type GlobeShot } from './globe-flight';
import { altitudeAt, divePoseAt, easeIn, easeOut, type DivePlan } from './dive-path';

/**
 * The menu globe's own loop (docs/GLOBE_PLAN.md, Architektur): view, camera
 * moves, sun, clouds and the marks' screen spots. It runs in a worker on an
 * OffscreenCanvas where the browser can, so the place loading on the main
 * thread (streets, routes, corridor) does not stall the earth; elsewhere the
 * same class runs on the main thread (globe-host.ts). It only takes commands
 * and says what happened; the phases are GlobeDirectorService's.
 *
 * Times cross the threads as epoch milliseconds (performance.timeOrigin +
 * performance.now()): a path the game camera flies from a start time is
 * flown here from the same instant.
 */

/** The sun's run (D2): from where to where (null: where it stands now), over how long */
export interface SunRun {
  from: LatLon | null;
  to: LatLon | null;
  startEpoch: number;
  durationMs: number;
}

/** The game camera's dive or rise, flown here too while the two cross-fade (DiveFlightService) */
export interface FollowPath {
  start: number[];
  end: number[];
  startAltitude: number;
  endAltitude: number;
  /** Scene frame to ECEF at the start (ThreeTilesEngine.sceneToEcef) */
  toEcef: number[];
  startEpoch: number;
  durationMs: number;
  /** Down eases out from the start, up eases in from the end (dive-path.ts) */
  down: boolean;
  fov: number;
}

export type GlobeCommand =
  | {
      type: 'init';
      canvas: OffscreenCanvas | HTMLCanvasElement;
      quality: GlobeQuality;
      width: number;
      height: number;
      pixelRatio: number;
      baseUrl: string;
      shot: GlobeShot;
    }
  | { type: 'resize'; width: number; height: number }
  /** Jump to a shot; `heading` (ECEF) is where `roll` turns the screen's top */
  | { type: 'shot'; shot: GlobeShot; heading: [number, number, number] | null }
  | { type: 'animate'; id: number; to: GlobeShot; durationMs: number; ease: 'inOut' | 'in'; heading: [number, number, number] | null }
  /** The whole earth turns slowly while nothing else moves */
  | { type: 'idle'; on: boolean }
  | { type: 'sun'; run: SunRun | null }
  /** Clouds part around `place`, growing to `radius` (radians) over `durationMs` */
  | { type: 'hole'; place: LatLon | null; radius: number; durationMs: number }
  | { type: 'region'; place: LatLon }
  /** The marks to project, latitude and longitude pairs */
  | { type: 'marks'; points: number[] }
  | { type: 'follow'; path: FollowPath | null }
  /** Draw one frame now (a fresh context's first frame is slow), answered by 'primed' */
  | { type: 'prime' }
  | { type: 'debug'; shot: GlobeShot | null; sun: LatLon | null }
  | { type: 'timing' }
  | { type: 'dispose' };

export type GlobeEvent =
  /** The first textures are up: the earth can show */
  | { type: 'ready' }
  | { type: 'primed' }
  | { type: 'animDone'; id: number }
  /** Each drawn frame: the marks' spots (x, y, facing 0/1 per mark) and the camera's altitude */
  | { type: 'frame'; spots: Float32Array; altitude: number }
  | { type: 'lost' }
  | { type: 'failed'; message: string }
  | { type: 'timing'; timing: Record<string, number> };

/** Frames while nothing moves but the clouds and the idle turn: 30 a second */
const IDLE_FRAME_MS = 1000 / 30;
/** Cloud drift, texture widths per second */
const CLOUD_DRIFT = 1 / 2400;

/** Epoch milliseconds, the same clock on both threads */
export function epochNow(): number {
  return performance.timeOrigin + performance.now();
}

interface Animation {
  id: number;
  from: GlobeShot;
  to: GlobeShot;
  startEpoch: number;
  durationMs: number;
  ease: (t: number) => number;
}

export class GlobeRuntime {
  private view: GlobeView | null = null;
  private shot: GlobeShot | null = null;
  private heading: Vector3 | null = null;
  private anim: Animation | null = null;
  private idle = false;
  private sunRun: SunRun | null = null;
  private hole = { place: null as LatLon | null, from: 0, to: 0, startEpoch: 0, durationMs: 0 };
  private follow: { path: FollowPath; plan: DivePlan; toEcef: Matrix4 } | null = null;
  private debugShot: GlobeShot | null = null;
  private debugSun: LatLon | null = null;
  private markPoints: Vector3[] = [];
  private spots: ScreenSpot[] = [];
  private raf: number | null = null;
  private lastFrame = 0;
  private disposed = false;
  private readonly pose = { position: new Vector3(), target: new Vector3(), up: new Vector3() };
  private readonly matrix = new Matrix4();
  private readonly ecef = new Matrix4();

  constructor(
    private readonly emit: (event: GlobeEvent, transfer?: Transferable[]) => void,
    private readonly requestFrame: (callback: (now: number) => void) => number,
    private readonly cancelFrame: (handle: number) => void,
  ) {}

  handle(command: GlobeCommand): void {
    if (this.disposed) return;
    switch (command.type) {
      case 'init':
        return this.init(command);
      case 'resize':
        this.view?.resize(command.width, command.height);
        return;
      case 'shot':
        this.anim = null;
        this.shot = { ...command.shot, over: { ...command.shot.over } };
        this.heading = command.heading ? new Vector3(...command.heading) : null;
        return;
      case 'animate': {
        const from = this.shot ?? command.to;
        if (command.heading) this.heading = new Vector3(...command.heading);
        this.anim = {
          id: command.id,
          from: { ...from, over: { ...from.over } },
          to: command.to,
          startEpoch: epochNow(),
          durationMs: command.durationMs,
          ease: command.ease === 'in' ? easeIn : easeInOut,
        };
        return;
      }
      case 'idle':
        this.idle = command.on;
        return;
      case 'sun':
        this.sunRun = command.run;
        return;
      case 'hole': {
        const now = epochNow();
        this.hole = { place: command.place, from: this.holeRadius(now), to: command.radius, startEpoch: now, durationMs: command.durationMs };
        return;
      }
      case 'region':
        void this.view?.focusRegion(command.place);
        return;
      case 'marks':
        this.markPoints = [];
        for (let i = 0; i + 1 < command.points.length; i += 2) {
          this.markPoints.push(ecefOf(command.points[i], command.points[i + 1], 0, new Vector3()));
        }
        this.spots = this.markPoints.map(() => ({ x: 0, y: 0, facing: false }));
        return;
      case 'follow':
        this.follow = command.path
          ? {
              path: command.path,
              plan: {
                start: new Matrix4().fromArray(command.path.start),
                end: new Matrix4().fromArray(command.path.end),
                startAltitude: command.path.startAltitude,
                endAltitude: command.path.endAltitude,
                heading: new Vector3(),
              },
              toEcef: new Matrix4().fromArray(command.path.toEcef),
            }
          : null;
        return;
      case 'prime':
        this.draw(epochNow());
        this.emit({ type: 'primed' });
        return;
      case 'debug':
        this.debugShot = command.shot;
        this.debugSun = command.sun;
        return;
      case 'timing':
        this.emit({ type: 'timing', timing: { ...GlobeView.timing } });
        return;
      case 'dispose':
        this.dispose();
        return;
    }
  }

  private init(command: Extract<GlobeCommand, { type: 'init' }>): void {
    try {
      const t0 = performance.now();
      const view = new GlobeView(command.canvas, command.quality, { pixelRatio: command.pixelRatio, baseUrl: command.baseUrl });
      GlobeView.timing['create'] = Math.max(GlobeView.timing['create'] ?? 0, performance.now() - t0);
      this.view = view;
      this.shot = command.shot;
      view.resize(command.width, command.height);
      command.canvas.addEventListener('webglcontextlost', () => {
        if (!this.disposed) this.emit({ type: 'lost' });
      });
      void view.ready.then(() => {
        if (!this.disposed) this.emit({ type: 'ready' });
      });
      this.loop();
    } catch (err) {
      this.emit({ type: 'failed', message: err instanceof Error ? err.message : String(err) });
    }
  }

  private loop(): void {
    const tick = (now: number) => {
      if (this.disposed) return;
      this.raf = this.requestFrame(tick);
      const moving =
        this.anim !== null || this.follow !== null || this.debugShot !== null || this.sunRunning() || this.holeGrowing();
      if (!moving && now - this.lastFrame < IDLE_FRAME_MS) return;
      // The runtime's own smoothness, for __globe.timing(): gaps between frames while something moves
      const gap = now - (this.lastFrame || now);
      if (moving && this.lastFrame) {
        GlobeView.timing['frame gap max'] = Math.max(GlobeView.timing['frame gap max'] ?? 0, gap);
        if (gap > 50) GlobeView.timing['frames over 50 ms'] = (GlobeView.timing['frames over 50 ms'] ?? 0) + 1;
        GlobeView.timing['frames moving'] = (GlobeView.timing['frames moving'] ?? 0) + 1;
      }
      const dt = Math.min(0.1, gap / 1000);
      this.lastFrame = now;
      if (this.idle && this.shot && !this.anim) {
        const lon = ((this.shot.over.lon + IDLE_TURN_RATE * dt + 540) % 360) - 180;
        this.shot = { ...this.shot, over: { lat: this.shot.over.lat, lon } };
      }
      this.draw(epochNow());
    };
    this.raf = this.requestFrame(tick);
  }

  private sunRunning(): boolean {
    const run = this.sunRun;
    return run !== null && epochNow() - run.startEpoch < run.durationMs;
  }

  private holeGrowing(): boolean {
    return epochNow() - this.hole.startEpoch < this.hole.durationMs;
  }

  private holeRadius(now: number): number {
    const h = this.hole;
    const t = h.durationMs > 0 ? MathUtils.clamp((now - h.startEpoch) / h.durationMs, 0, 1) : 1;
    return MathUtils.lerp(h.from, h.to, t);
  }

  private draw(now: number): void {
    const view = this.view;
    if (!view) return;

    let altitude: number;
    const follow = this.follow;
    if (follow) {
      // The game camera's path, at the same instant it flies it
      const { path, plan } = follow;
      const t = MathUtils.clamp((now - path.startEpoch) / Math.max(1, path.durationMs), 0, 1);
      const s = path.down ? easeOut(t) : 1 - easeIn(t);
      divePoseAt(plan, s, this.matrix);
      view.followMatrix(this.ecef.multiplyMatrices(follow.toEcef, this.matrix), path.fov);
      view.setShift(0);
      altitude = altitudeAt(plan, s);
    } else {
      const anim = this.anim;
      if (anim) {
        const t = MathUtils.clamp((now - anim.startEpoch) / Math.max(1, anim.durationMs), 0, 1);
        this.shot = blendShot(anim.from, anim.to, anim.ease(t));
        if (t >= 1) {
          this.anim = null;
          this.emit({ type: 'animDone', id: anim.id });
        }
      }
      const shot = this.debugShot ?? this.shot;
      if (!shot) return;
      shotPose(shot, this.heading, this.pose);
      view.setShift(shot.shift);
      view.setPose(this.pose.position, this.pose.target, this.pose.up);
      altitude = view.altitude();
    }

    // Sun on its run (D2) or where it stands, clouds drifting and parting over the place
    const date = new Date(now);
    const real = subsolarPoint(date);
    const run = this.sunRun;
    const sun =
      this.debugSun ??
      (run ? sweptSun(run.from ?? real, run.to ?? real, MathUtils.smootherstep(now - run.startEpoch, 0, run.durationMs)) : real);
    // Wrapped: the epoch's seconds times the drift are far past float precision in the shader
    view.setSky(sun, date, ((now / 1000) * CLOUD_DRIFT) % 1);
    if (this.hole.place) view.setCloudHole(this.hole.place, this.holeRadius(now));
    view.render();

    const spots = new Float32Array(this.markPoints.length * 3);
    for (let i = 0; i < this.markPoints.length; i++) {
      const spot = view.project(this.markPoints[i], this.spots[i]);
      spots[i * 3] = spot.x;
      spots[i * 3 + 1] = spot.y;
      spots[i * 3 + 2] = spot.facing ? 1 : 0;
    }
    this.emit({ type: 'frame', spots, altitude }, [spots.buffer]);
  }

  private dispose(): void {
    this.disposed = true;
    if (this.raf !== null) this.cancelFrame(this.raf);
    this.raf = null;
    this.view?.dispose();
    this.view = null;
  }
}
