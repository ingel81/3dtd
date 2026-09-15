import { MathUtils, type PerspectiveCamera, Vector3 } from 'three';

/**
 * Camera timeline for bug hunts around the intro flight, the overview frame
 * and camera resets.
 *
 * Every camera setter outside the controls, every save of the initial view,
 * every framing computation, the height cycles and the intro phases land here
 * with a timestamp and the camera pose at that moment. Setters also carry
 * their call site. The state dump (Dev → Dump) writes the whole list; each
 * event is logged to the console as `[Camera]` as it happens.
 *
 * Only rare events belong here, nothing per frame (the intro keeps its own
 * per-frame trace, see IntroCameraFlightService.traceCsv()).
 */

export interface CameraPose {
  x: number;
  y: number;
  z: number;
  /** Heading of the view direction, degrees from +Z towards +X. */
  yaw: number;
  /** Degrees above the horizon, negative looking down. */
  pitch: number;
}

export interface CameraLens {
  fov: number;
  aspect: number;
  near: number;
  far: number;
}

export interface CameraTimelineEntry {
  /** Milliseconds since page load (performance.now()). */
  t: number;
  kind: string;
  /** Camera pose when the event was recorded; setters record after setting. */
  cam: CameraPose | null;
  data?: Record<string, unknown>;
  /** Nearest stack frames of the call site, for setters. */
  from?: string[];
}

/** Oldest entries drop out beyond this. */
const MAX_ENTRIES = 2000;

const round1 = (v: number): number => Math.round(v * 10) / 10;

/** Function names of the frames above the recording setter. */
function callerFrames(): string[] {
  const stack = new Error().stack ?? '';
  // 0 "Error", 1 callerFrames, 2 record, 3 the setter that records.
  return stack
    .split('\n')
    .slice(3, 9)
    .map((line) => line.trim().replace(/^at /, '').replace(/ \(.*\)$/, '').replace(/https?:\/\/[^/]+\//, ''));
}

class CameraTimeline {
  private camera: PerspectiveCamera | null = null;
  private readonly entries: CameraTimelineEntry[] = [];
  private readonly dir = new Vector3();
  private readonly listeners: ((kind: string, data?: Record<string, unknown>) => void)[] = [];

  /** Called once by CameraRig with the engine camera. */
  attach(camera: PerspectiveCamera): void {
    this.camera = camera;
  }

  /** Also tell `listener` about every event; the corridor trace follows the intro and the height cycles. */
  listen(listener: (kind: string, data?: Record<string, unknown>) => void): void {
    this.listeners.push(listener);
  }

  /**
   * @param withCaller Add the call site; for camera setters, where the
   *   question is usually who moved the camera.
   */
  record(kind: string, data?: Record<string, unknown>, withCaller = false): void {
    if (this.entries.length >= MAX_ENTRIES) this.entries.shift();
    const entry: CameraTimelineEntry = { t: Math.round(performance.now()), kind, cam: this.pose() };
    if (data) entry.data = data;
    if (withCaller) entry.from = callerFrames();
    this.entries.push(entry);
    console.log('[Camera]', entry.t, kind, data ?? '', entry.cam ?? '');
    for (const listener of this.listeners) listener(kind, data);
  }

  pose(): CameraPose | null {
    const c = this.camera;
    if (!c) return null;
    const dir = this.dir.set(0, 0, -1).applyQuaternion(c.quaternion);
    return {
      x: round1(c.position.x),
      y: round1(c.position.y),
      z: round1(c.position.z),
      yaw: round1(MathUtils.radToDeg(Math.atan2(dir.x, dir.z))),
      pitch: round1(MathUtils.radToDeg(Math.asin(MathUtils.clamp(dir.y, -1, 1)))),
    };
  }

  lens(): CameraLens | null {
    const c = this.camera;
    return c ? { fov: c.fov, aspect: Math.round(c.aspect * 1e4) / 1e4, near: c.near, far: c.far } : null;
  }

  list(): readonly CameraTimelineEntry[] {
    return this.entries;
  }
}

export const cameraTimeline = new CameraTimeline();
