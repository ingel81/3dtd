import {
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
  Scene,
  Vector3,
  type Object3D,
} from 'three';
import type { AssetManagerService } from '../../services/infrastructure/asset-manager.service';
import type { HeroPresentation, HeroView } from '../../managers/hero.manager';
import { HERO_MODEL, HeroModel, HeroModelConfig, loadHeroModel } from './hero-model';

/** Ground under a local position: the route grid, like the enemies' feet. */
export interface HeroGround {
  getGroundLocalYAt(localX: number, localZ: number): number | null;
}

/** Geo to scene coordinates. */
export interface HeroCoordinates {
  geoToLocalSimpleInto(lat: number, lon: number, height: number, target: Vector3): Vector3;
}

/** Ring colours, td-theme tokens as hex */
const RING_COLOR = 0xc2a055;    // --td-gold: selection, his post, a valid move target
const REFUSED_COLOR = 0xb83e32; // --td-health-red: no route in reach

/** Ring radii, metres */
const SELECTION_RADIUS_M = 2.6;
/** A partner's hero wears a ring in his lane colour, a little smaller than the selection ring */
const OWNER_RADIUS_M = 2.2;
const MARKER_RADIUS_M = 1.8;
/** Lift above the ground so the flat rings clear small bumps, m */
const LIFT_M = 0.4;
/** Drawn after the tiles, like the ability markers */
const RENDER_ORDER = 950;
/** Height of the level-up text above his head, m */
const HEAD_CLEARANCE_M = 1.5;

/**
 * The hero on the map: his model (the GLB, see hero-model.ts; none until it
 * has loaded or when it fails),
 * and while he is selected a gold ring under his feet, a smaller one on the
 * spot he holds and the move ring under the cursor.
 *
 * A coop partner's hero has a renderer of his own with a ring in his lane
 * colour instead (setOwnerColor); he is never selected here.
 *
 * The HeroManager hands him over once per rendered frame (present), in scene
 * coordinates on the route grid's ground. The animation runs in game time,
 * so a pause holds it; the ring pulse in real time. The rings are flat
 * meshes with built-in materials and depth test off, like the ability
 * markers: readable between buildings.
 */
export class HeroRenderer implements HeroView {
  private readonly root = new Group();
  private model: HeroModel | null = null;
  private loading = false;
  private disposed = false;
  private ground: HeroGround | null = null;
  private groundY = 0;
  private visible = false;
  private selected = false;
  private pulseMs = 0;
  /** A coop partner's hero: his lane colour, always shown; null for the own hero */
  private ownerColor: number | null = null;

  private readonly ringGeometry = new RingGeometry(0.82, 1, 64);
  private readonly selectionRing: Mesh;
  private readonly postRing: Mesh;
  private readonly aimRing: Mesh;
  private readonly aimMaterial: MeshBasicMaterial;
  private readonly ownerRing: Mesh;

  private readonly scratch = new Vector3();

  constructor(
    private readonly scene: Scene,
    private readonly coordinates: HeroCoordinates,
    private readonly assets: AssetManagerService | null,
    private readonly config: HeroModelConfig = HERO_MODEL,
  ) {
    this.root.name = 'hero';
    this.root.visible = false;
    this.scene.add(this.root);

    this.selectionRing = this.ring(this.material(RING_COLOR, 0.9), SELECTION_RADIUS_M);
    this.postRing = this.ring(this.material(RING_COLOR, 0.6), MARKER_RADIUS_M);
    this.aimMaterial = this.material(RING_COLOR, 0.85);
    this.aimRing = this.ring(this.aimMaterial, MARKER_RADIUS_M);
    this.ownerRing = this.ring(this.material(RING_COLOR, 0.75), OWNER_RADIUS_M);
  }

  /** Mark him as a coop partner's in his lane colour (review R15); null for none */
  setOwnerColor(color: number | null): void {
    this.ownerColor = color;
    if (color !== null) (this.ownerRing.material as MeshBasicMaterial).color.setHex(color);
    this.syncRings();
  }

  /** Where his feet stand: the route grid (GlobalRouteGridService). */
  setGround(ground: HeroGround | null): void {
    this.ground = ground;
  }

  // ==================== HeroView ====================

  present(hero: HeroPresentation): void {
    if (this.disposed) return;
    if (!this.loading) this.loadModel();

    const at = this.onGround(hero.lat, hero.lon);
    this.root.position.copy(at);
    this.root.rotation.y = hero.heading + this.config.yawOffset;
    this.root.visible = true;
    this.visible = true;
    this.model?.setPose(hero.pose);

    this.selectionRing.position.set(at.x, at.y + LIFT_M, at.z);
    this.ownerRing.position.set(at.x, at.y + LIFT_M, at.z);
    const post = this.onGround(hero.anchor.lat, hero.anchor.lon);
    this.postRing.position.set(post.x, post.y + LIFT_M, post.z);
    this.syncRings();
  }

  clear(): void {
    this.visible = false;
    this.root.visible = false;
    this.hideMoveTarget();
    this.syncRings();
  }

  // ==================== Selection ====================

  /** Rings under him and on his post while he is selected. */
  setSelected(selected: boolean): void {
    this.selected = selected;
    if (!selected) this.hideMoveTarget();
    this.syncRings();
  }

  /** Move ring under the cursor: gold on the route point he would go to, red where no route is in reach. */
  showMoveTarget(center: Vector3, valid: boolean): void {
    this.aimMaterial.color.setHex(valid ? RING_COLOR : REFUSED_COLOR);
    this.aimRing.position.set(center.x, center.y + LIFT_M, center.z);
    this.aimRing.visible = true;
  }

  hideMoveTarget(): void {
    this.aimRing.visible = false;
  }

  /** What a click has to hit to select him, null while he is not on the map. */
  pickTarget(): Object3D | null {
    return this.visible ? this.root : null;
  }

  /** Scene position a little above his head, null while he is not on the map. */
  headPosition(out: Vector3): Vector3 | null {
    if (!this.visible) return null;
    return out.copy(this.root.position).setY(this.root.position.y + this.config.heightM + HEAD_CLEARANCE_M);
  }

  // ==================== Frame ====================

  /**
   * Once per rendered frame.
   * @param realDeltaMs - wall-clock frame time, drives the ring pulse
   * @param gameDeltaMs - the same frame in game time, drives the animation
   */
  update(realDeltaMs: number, gameDeltaMs: number): void {
    if (!this.visible) return;
    this.model?.update(gameDeltaMs);
    if (this.selected) {
      this.pulseMs += realDeltaMs;
      const pulse = 1 + 0.06 * Math.sin(this.pulseMs * 0.008);
      this.selectionRing.scale.setScalar(SELECTION_RADIUS_M * pulse);
    }
  }

  dispose(): void {
    this.disposed = true;
    this.model?.dispose();
    this.model = null;
    this.scene.remove(this.root, this.selectionRing, this.postRing, this.aimRing, this.ownerRing);
    for (const ring of [this.selectionRing, this.postRing, this.aimRing, this.ownerRing]) {
      (ring.material as MeshBasicMaterial).dispose();
    }
    this.ringGeometry.dispose();
  }

  // ==================== Internals ====================

  /** Load the GLB once, on his first frame. Until it arrives, and if it fails, only his rings show. */
  private loadModel(): void {
    this.loading = true;
    if (!this.assets) return;
    loadHeroModel(this.assets, this.config)
      .then((model) => {
        if (this.disposed) {
          model.dispose();
          return;
        }
        this.model = model;
        this.root.add(model.root);
      })
      .catch((error: unknown) => {
        console.warn('[HeroRenderer] Hero model did not load', error);
      });
  }

  /** Scene position of a geo position on the route grid's ground; the last ground where the grid has none. */
  private onGround(lat: number, lon: number): Vector3 {
    const p = this.coordinates.geoToLocalSimpleInto(lat, lon, 0, this.scratch);
    const y = this.ground?.getGroundLocalYAt(p.x, p.z);
    if (y !== null && y !== undefined) this.groundY = y;
    return p.setY(this.groundY);
  }

  private syncRings(): void {
    const on = this.visible && this.selected;
    this.selectionRing.visible = on;
    this.postRing.visible = on;
    if (!on) this.aimRing.visible = false;
    this.ownerRing.visible = this.visible && this.ownerColor !== null;
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

  /** A flat ring on the ground, hidden until shown. */
  private ring(material: MeshBasicMaterial, radiusM: number): Mesh {
    const ring = new Mesh(this.ringGeometry, material);
    ring.rotation.x = -Math.PI / 2;
    ring.scale.setScalar(radiusM);
    ring.renderOrder = RENDER_ORDER;
    ring.visible = false;
    this.scene.add(ring);
    return ring;
  }
}
