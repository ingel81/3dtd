import {
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
  Scene,
  type Vector3,
} from 'three';

/** Marker colours, td-theme tokens as hex */
const STRIKE_COLOR = 0xc96a3a;    // --td-warn-orange: the zone about to be hit
const COUNTDOWN_COLOR = 0xd9bc68; // --td-gold-light: the ring closing in on the impact
const AIM_COLOR = 0xc2a055;       // --td-gold: where a strike would land
const REFUSED_COLOR = 0xb83e32;   // --td-health-red: no route cell in reach

/** Lift above the ground point so the flat marker clears small bumps, m */
const LIFT_M = 0.4;
/** Drawn after the tiles and the rest of the overlay */
const RENDER_ORDER = 950;
/** Points of a path strip at most; a longer path is cut off (a beam's sweep is some 70 m) */
const MAX_PATH_POINTS = 256;

interface StrikeMarker {
  group: Group;
  fill: MeshBasicMaterial;
  countdown: Mesh;
  radiusM: number;
  warningMs: number;
  remainingMs: number;
  /** The route stretch a beam will burn along, if it is one */
  path: PathStrip | null;
}

interface AimRing {
  group: Group;
  edge: MeshBasicMaterial;
  fill: MeshBasicMaterial;
  radiusM: number;
}

/**
 * A flat band along a path on the ground, `width` metres across, drawn in
 * one mesh. The geometry holds MAX_PATH_POINTS points and is rewritten in
 * place; the draw range covers the points in use.
 */
class PathStrip {
  readonly mesh: Mesh<BufferGeometry, MeshBasicMaterial>;
  private readonly position = new BufferAttribute(new Float32Array(MAX_PATH_POINTS * 2 * 3), 3);

  constructor(color: number, opacity: number) {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', this.position);
    const index: number[] = [];
    for (let i = 0; i < MAX_PATH_POINTS - 1; i++) {
      const a = i * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    geometry.setIndex(index);
    geometry.setDrawRange(0, 0);
    this.mesh = new Mesh(geometry, new MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      side: DoubleSide,
      depthTest: false,
      depthWrite: false,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = RENDER_ORDER;
  }

  /** Lay the band along `points` (local coordinates, on the ground). */
  set(points: readonly Vector3[], width: number): void {
    const count = Math.min(points.length, MAX_PATH_POINTS);
    const array = this.position.array as Float32Array;
    const half = width / 2;
    for (let i = 0; i < count; i++) {
      // Across the band: perpendicular to the path in the ground plane,
      // along the mean of the segments meeting at the point
      const before = points[Math.max(0, i - 1)];
      const after = points[Math.min(count - 1, i + 1)];
      let dx = after.x - before.x;
      let dz = after.z - before.z;
      const length = Math.hypot(dx, dz);
      if (length > 0) {
        dx /= length;
        dz /= length;
      } else {
        dx = 1;
        dz = 0;
      }
      const p = points[i];
      const o = i * 6;
      array[o] = p.x - dz * half;
      array[o + 1] = p.y + LIFT_M;
      array[o + 2] = p.z + dx * half;
      array[o + 3] = p.x + dz * half;
      array[o + 4] = p.y + LIFT_M;
      array[o + 5] = p.z - dx * half;
    }
    this.position.needsUpdate = true;
    this.mesh.geometry.setDrawRange(0, count >= 2 ? (count - 1) * 6 : 0);
    this.mesh.visible = count >= 2;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}

/**
 * Ground markers of player abilities.
 *
 * The strike marker stands on the impact point while a strike is on its way:
 * the strike radius as an orange ring over a faint pulsing disc, and a gold
 * ring that closes from the radius onto the centre as the warning runs out,
 * in game time, so it lands with the impact at every timescale. A beam also
 * shows the route stretch it will burn along as an orange band. The aiming
 * ring follows the cursor in the targeting mode: gold where a strike would
 * land, red where it would be refused; for a beam with its band in gold.
 *
 * Flat meshes with built-in materials (logarithmic depth comes with them),
 * depth test off: the markers have to stay readable between buildings, and
 * the photorealistic tiles ignore lights anyway. The geometries are unit
 * shapes, scaled to the radius and shared by every marker.
 */
export class AbilityMarkerRenderer {
  private readonly ringGeometry = new RingGeometry(0.975, 1, 128);
  private readonly countdownGeometry = new RingGeometry(0.93, 1, 128);
  private readonly discGeometry = new CircleGeometry(1, 128);

  private readonly strikes = new Map<number, StrikeMarker>();
  /** Wall-clock time for the pulse, ms */
  private clockMs = 0;

  private aim: AimRing | null = null;
  private aimPath: PathStrip | null = null;

  constructor(private readonly scene: Scene) {}

  /**
   * Mark the impact point of strike `id`: `center` in local coordinates, on
   * the ground. `path` (local, on the ground) is the stretch a beam will
   * burn along, drawn as a band as wide as the beam.
   */
  showStrike(id: number, center: Vector3, radiusM: number, warningMs: number, path?: readonly Vector3[]): void {
    this.removeStrike(id);

    const fill = this.material(STRIKE_COLOR, 0.12);
    const countdown = this.mesh(this.countdownGeometry, this.material(COUNTDOWN_COLOR, 0.95), radiusM);
    const group = this.flatGroup(
      this.mesh(this.discGeometry, fill, radiusM),
      this.mesh(this.ringGeometry, this.material(STRIKE_COLOR, 0.9), radiusM),
      countdown,
    );
    group.position.set(center.x, center.y + LIFT_M, center.z);
    this.scene.add(group);

    let strip: PathStrip | null = null;
    if (path && path.length >= 2) {
      strip = new PathStrip(STRIKE_COLOR, 0.22);
      strip.set(path, radiusM * 2);
      this.scene.add(strip.mesh);
    }

    this.strikes.set(id, { group, fill, countdown, radiusM, warningMs, remainingMs: warningMs, path: strip });
  }

  removeStrike(id: number): void {
    const marker = this.strikes.get(id);
    if (!marker) return;
    this.scene.remove(marker.group);
    for (const child of marker.group.children) {
      ((child as Mesh).material as MeshBasicMaterial).dispose();
    }
    if (marker.path) {
      this.scene.remove(marker.path.mesh);
      marker.path.dispose();
    }
    this.strikes.delete(id);
  }

  /**
   * Aiming ring of the targeting mode: the strike radius around `center`
   * (local coordinates, on the ground), gold where a strike would land, red
   * where it would be refused. `path` is a beam's stretch, drawn as a gold
   * band; without one the band hides.
   */
  showAim(center: Vector3, radiusM: number, valid: boolean, path?: readonly Vector3[]): void {
    if (this.aim?.radiusM !== radiusM) {
      this.disposeAim();
      const fill = this.material(AIM_COLOR, 0.08);
      const edge = this.material(AIM_COLOR, 0.85);
      const group = this.flatGroup(
        this.mesh(this.discGeometry, fill, radiusM),
        this.mesh(this.ringGeometry, edge, radiusM),
      );
      this.scene.add(group);
      this.aim = { group, edge, fill, radiusM };
    }
    const aim = this.aim!;
    const color = valid ? AIM_COLOR : REFUSED_COLOR;
    aim.edge.color.setHex(color);
    aim.fill.color.setHex(color);
    aim.group.position.set(center.x, center.y + LIFT_M, center.z);
    aim.group.visible = true;

    if (path && path.length >= 2) {
      if (!this.aimPath) {
        this.aimPath = new PathStrip(AIM_COLOR, 0.2);
        this.scene.add(this.aimPath.mesh);
      }
      this.aimPath.set(path, radiusM * 2);
    } else if (this.aimPath) {
      this.aimPath.mesh.visible = false;
    }
  }

  hideAim(): void {
    if (this.aim) this.aim.group.visible = false;
    if (this.aimPath) this.aimPath.mesh.visible = false;
  }

  /**
   * Once per rendered frame.
   * @param realDeltaMs - wall-clock frame time, drives the pulse
   * @param gameDeltaMs - the same frame in game time, drives the countdown
   */
  update(realDeltaMs: number, gameDeltaMs: number): void {
    if (this.strikes.size === 0) return;
    this.clockMs += realDeltaMs;
    const pulse = 0.5 + 0.5 * Math.sin(this.clockMs * 0.012); // about 2 Hz

    for (const marker of this.strikes.values()) {
      marker.remainingMs = Math.max(0, marker.remainingMs - gameDeltaMs);
      const left = marker.warningMs > 0 ? marker.remainingMs / marker.warningMs : 0;
      marker.countdown.scale.setScalar(Math.max(0.04, left) * marker.radiusM);
      marker.fill.opacity = 0.08 + 0.1 * pulse;
    }
  }

  /** Drop every strike marker and hide the aiming ring (restart). */
  clear(): void {
    for (const id of [...this.strikes.keys()]) {
      this.removeStrike(id);
    }
    this.hideAim();
  }

  dispose(): void {
    this.clear();
    this.disposeAim();
    this.ringGeometry.dispose();
    this.countdownGeometry.dispose();
    this.discGeometry.dispose();
  }

  private disposeAim(): void {
    if (this.aim) {
      this.scene.remove(this.aim.group);
      this.aim.edge.dispose();
      this.aim.fill.dispose();
      this.aim = null;
    }
  }

  /** The shapes lie in the XY plane; the group turns them flat onto the ground. */
  private flatGroup(...meshes: Mesh[]): Group {
    const group = new Group();
    group.rotation.x = -Math.PI / 2;
    group.add(...meshes);
    return group;
  }

  private material(color: number, opacity: number): MeshBasicMaterial {
    return new MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      side: DoubleSide,
      depthTest: false,
      depthWrite: false,
    });
  }

  private mesh(geometry: BufferGeometry, material: MeshBasicMaterial, scale: number): Mesh {
    const mesh = new Mesh(geometry, material);
    mesh.scale.setScalar(scale);
    mesh.renderOrder = RENDER_ORDER;
    return mesh;
  }
}
