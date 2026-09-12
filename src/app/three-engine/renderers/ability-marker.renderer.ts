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

/**
 * Ground markers of player abilities.
 *
 * The strike marker stands on the impact point while a strike is on its way:
 * the strike radius as an orange ring over a faint pulsing disc, and a gold
 * ring that closes from the radius onto the centre as the warning runs out,
 * in game time, so it lands with the impact at every timescale.
 *
 * Flat meshes with built-in materials (logarithmic depth comes with them),
 * depth test off: the marker has to stay readable between buildings, and the
 * photorealistic tiles ignore lights anyway. The geometries are unit shapes,
 * scaled to the radius and shared by every marker.
 */
export class AbilityMarkerRenderer {
  private readonly ringGeometry = new RingGeometry(0.975, 1, 128);
  private readonly countdownGeometry = new RingGeometry(0.93, 1, 128);
  private readonly discGeometry = new CircleGeometry(1, 128);

  private readonly strikes = new Map<number, StrikeMarker>();
  /** Wall-clock time for the pulse, ms */
  private clockMs = 0;

  constructor(private readonly scene: Scene) {}

  /** Mark the impact point of strike `id`: `center` in local coordinates, on the ground. */
  showStrike(id: number, center: Vector3, radiusM: number, warningMs: number): void {
    this.removeStrike(id);

    const group = new Group();
    group.position.set(center.x, center.y + LIFT_M, center.z);
    // The shapes lie in the XY plane; turn them flat onto the ground
    group.rotation.x = -Math.PI / 2;

    const fill = this.material(STRIKE_COLOR, 0.12);
    const countdown = this.mesh(this.countdownGeometry, this.material(COUNTDOWN_COLOR, 0.95), radiusM);
    group.add(
      this.mesh(this.discGeometry, fill, radiusM),
      this.mesh(this.ringGeometry, this.material(STRIKE_COLOR, 0.9), radiusM),
      countdown,
    );
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

  clear(): void {
    for (const id of [...this.strikes.keys()]) {
      this.removeStrike(id);
    }
  }

  dispose(): void {
    this.clear();
    this.ringGeometry.dispose();
    this.countdownGeometry.dispose();
    this.discGeometry.dispose();
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
