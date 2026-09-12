import {
  CircleGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
  Scene,
  type BufferGeometry,
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

interface StrikeMarker {
  group: Group;
  fill: MeshBasicMaterial;
  countdown: Mesh;
  radiusM: number;
  warningMs: number;
  remainingMs: number;
}

interface AimRing {
  group: Group;
  edge: MeshBasicMaterial;
  fill: MeshBasicMaterial;
  radiusM: number;
}

/**
 * Ground markers of player abilities.
 *
 * The strike marker stands on the impact point while a strike is on its way:
 * the strike radius as an orange ring over a faint pulsing disc, and a gold
 * ring that closes from the radius onto the centre as the warning runs out,
 * in game time, so it lands with the impact at every timescale. The aiming
 * ring follows the cursor in the targeting mode: gold where a strike would
 * land, red where it would be refused.
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

  constructor(private readonly scene: Scene) {}

  /** Mark the impact point of strike `id`: `center` in local coordinates, on the ground. */
  showStrike(id: number, center: Vector3, radiusM: number, warningMs: number): void {
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

    this.strikes.set(id, { group, fill, countdown, radiusM, warningMs, remainingMs: warningMs });
  }

  removeStrike(id: number): void {
    const marker = this.strikes.get(id);
    if (!marker) return;
    this.scene.remove(marker.group);
    for (const child of marker.group.children) {
      ((child as Mesh).material as MeshBasicMaterial).dispose();
    }
    this.strikes.delete(id);
  }

  /**
   * Aiming ring of the targeting mode: the strike radius around `center`
   * (local coordinates, on the ground), gold where a strike would land, red
   * where it would be refused.
   */
  showAim(center: Vector3, radiusM: number, valid: boolean): void {
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
  }

  hideAim(): void {
    if (this.aim) this.aim.group.visible = false;
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
    if (!this.aim) return;
    this.scene.remove(this.aim.group);
    this.aim.edge.dispose();
    this.aim.fill.dispose();
    this.aim = null;
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
