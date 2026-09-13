import {
  Box3,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  PlaneGeometry,
  Vector3,
  type Object3D,
  type PerspectiveCamera,
  type Scene,
  type ShaderMaterial,
} from 'three';
import { DrawGate } from '../draw-gate';
import { InstanceSlotAllocator } from '../instance-slot-allocator';
import { veteranRank } from '../../../configs/veteran-ranks.config';
import { createBadgeMaterial } from './tower-badge-shaders';

/** Far more badges than towers a run builds */
const MAX_BADGES = 512;

/** Over the tiles and tower models, under the enemy health bars (999) */
const RENDER_ORDER = 998;

interface Badge {
  /** Rank level, 1 or higher */
  level: number;
  slot: number;
  /** Anchor written: the tower's model was there */
  anchored: boolean;
}

/**
 * Insignia of a rank level for the shader: chevrons, star (0/1), gold (0/1).
 * All zero for no rank.
 */
export function badgeStyle(level: number): [number, number, number] {
  const rank = veteranRank(level);
  if (!rank) return [0, 0, 0];
  return [rank.chevrons, rank.star ? 1 : 0, rank.metal === 'gold' ? 1 : 0];
}

/**
 * TowerBadgeRenderer: the veteran insignia above towers with a rank
 * (veteran-ranks.config.ts), all in one draw call. Built like the enemy
 * health bars: one InstancedBufferGeometry under a plain Mesh, the billboard
 * turned to the camera in the vertex shader, the chevrons and the star drawn
 * as distance fields in the fragment shader.
 *
 * A tower below the first rank takes no slot. The anchor is the top of the
 * tower model's bounding box, which stands on the plinth and heightOffset,
 * measured once when the badge first shows; a model still loading is
 * measured on a later frame. Per frame only the two camera axes and the
 * pixel scale change.
 *
 * Kept apart from ThreeTowerRenderer, which it only asks for a tower's
 * model. The TowerManager hands it every tower's rank each frame
 * (syncVeteranBadges) and removes the badge with the tower; photo mode hides
 * all of them (setVisible).
 */
export class TowerBadgeRenderer {
  private readonly geometry: InstancedBufferGeometry;
  private readonly material: ShaderMaterial;
  private readonly mesh: Mesh;
  /** Keeps the mesh out of the render list while no badge is shown; setVisible() goes through it */
  private readonly gate: DrawGate;
  private readonly slots = new InstanceSlotAllocator(MAX_BADGES);
  private readonly anchorAttribute: InstancedBufferAttribute;
  private readonly styleAttribute: InstancedBufferAttribute;

  private readonly badges = new Map<string, Badge>();
  /** Badges whose tower model was not in the scene yet */
  private readonly unanchored = new Set<string>();

  // Billboard axes, shared by reference with the material's uniforms
  private readonly cameraRight = new Vector3(1, 0, 0);
  private readonly cameraUp = new Vector3(0, 1, 0);
  private readonly box = new Box3();

  constructor(
    private readonly scene: Scene,
    /** A tower's model in the scene, null while it loads */
    private readonly towerModel: (id: string) => Object3D | null,
  ) {
    // Unit quad; the shaders read only its position
    const plane = new PlaneGeometry(1, 1);
    const geometry = new InstancedBufferGeometry();
    geometry.setIndex(plane.getIndex());
    geometry.setAttribute('position', plane.getAttribute('position'));
    geometry.instanceCount = 0;

    // A zero style marks a free slot, so fresh and released slots draw nothing
    this.anchorAttribute = new InstancedBufferAttribute(new Float32Array(MAX_BADGES * 3), 3);
    this.styleAttribute = new InstancedBufferAttribute(new Float32Array(MAX_BADGES * 3), 3);
    geometry.setAttribute('aAnchor', this.anchorAttribute);
    geometry.setAttribute('aStyle', this.styleAttribute);
    this.geometry = geometry;

    this.material = createBadgeMaterial(this.cameraRight, this.cameraUp);
    this.mesh = new Mesh(geometry, this.material);
    this.mesh.name = 'tower-badges';
    // The geometry's bounding sphere is the unit quad at the origin, not where the badges are
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = RENDER_ORDER;
    // At the identity origin for good, the positions come from aAnchor
    this.mesh.matrixAutoUpdate = false;
    this.mesh.matrixWorldAutoUpdate = false;
    this.mesh.updateMatrix();

    this.gate = new DrawGate([this.mesh]);
    this.scene.add(this.mesh);
  }

  /**
   * Show rank `level` above tower `id`, 0 takes its badge down. A new rank
   * rewrites only the insignia, the anchor stays.
   */
  setRank(id: string, level: number): void {
    const badge = this.badges.get(id);
    if (level <= 0) {
      if (badge) this.remove(id);
      return;
    }
    if (badge) {
      if (badge.level === level) return;
      badge.level = level;
      if (badge.anchored) this.writeStyle(badge);
      return;
    }

    const slot = this.slots.alloc();
    if (slot < 0) return;
    const fresh: Badge = { level, slot, anchored: false };
    this.badges.set(id, fresh);
    this.syncDrawCount();
    this.anchor(id, fresh);
  }

  /** Take the badge of tower `id` down (sold), if it has one. */
  remove(id: string): void {
    const badge = this.badges.get(id);
    if (!badge) return;
    // Zero style before the release: uploadSlot wants a slot in use
    this.styleAttribute.setXYZ(badge.slot, 0, 0, 0);
    this.slots.uploadSlot(this.styleAttribute, badge.slot);
    this.slots.release(badge.slot);
    this.badges.delete(id);
    this.unanchored.delete(id);
    this.syncDrawCount();
  }

  /** Remove every badge. */
  clear(): void {
    this.badges.clear();
    this.unanchored.clear();
    this.slots.reset();
    this.syncDrawCount();
    // A full upload, so the per-slot ranges go first
    (this.styleAttribute.array as Float32Array).fill(0);
    this.styleAttribute.clearUpdateRanges();
    this.styleAttribute.needsUpdate = true;
  }

  /** Show or hide all badges (photo mode). Ranks keep updating while hidden. */
  setVisible(visible: boolean): void {
    this.gate.setShown(visible);
  }

  /**
   * Once per rendered frame: anchor badges whose tower model arrived since,
   * turn them to the camera and size them to BADGE_PX CSS pixels.
   * @param viewportHeight - height of the canvas in CSS pixels
   */
  update(camera: PerspectiveCamera, viewportHeight: number): void {
    if (this.badges.size === 0) return;

    for (const id of this.unanchored) {
      const badge = this.badges.get(id);
      if (badge) this.anchor(id, badge);
    }

    // Camera right (column 0) and up (column 1) from the world matrix
    const e = camera.matrixWorld.elements;
    this.cameraRight.set(e[0], e[1], e[2]);
    this.cameraUp.set(e[4], e[5], e[6]);

    if (viewportHeight > 0) {
      this.material.uniforms['uWorldPerPixel'].value =
        (2 * Math.tan((camera.fov * Math.PI) / 360)) / camera.zoom / viewportHeight;
    }
  }

  /** Towers with a badge */
  get count(): number {
    return this.badges.size;
  }

  dispose(): void {
    this.clear();
    this.scene.remove(this.mesh);
    this.geometry.dispose();
    this.material.dispose();
  }

  /**
   * Measure the tower's model and show the badge on top of it. Without a
   * model the badge waits in `unanchored`, with its slot drawing nothing.
   */
  private anchor(id: string, badge: Badge): void {
    const model = this.towerModel(id);
    if (!model) {
      this.unanchored.add(id);
      return;
    }
    // The whole subtree first: a skinned model's box is built from its bones'
    // world matrices, which a model not yet rendered has not got
    model.updateMatrixWorld(true);
    this.box.setFromObject(model);
    const top = this.box.isEmpty() ? model.position.y : this.box.max.y;
    // Over the tower's axis, not the centre of its box: turrets and banners stick out to one side
    this.anchorAttribute.setXYZ(badge.slot, model.position.x, top, model.position.z);
    this.slots.uploadSlot(this.anchorAttribute, badge.slot);
    badge.anchored = true;
    this.unanchored.delete(id);
    this.writeStyle(badge);
  }

  private writeStyle(badge: Badge): void {
    const [chevrons, star, gold] = badgeStyle(badge.level);
    this.styleAttribute.setXYZ(badge.slot, chevrons, star, gold);
    this.slots.uploadSlot(this.styleAttribute, badge.slot);
  }

  /** Draw count follows the slot allocator; the gate hides the mesh while it is empty. */
  private syncDrawCount(): void {
    this.geometry.instanceCount = this.slots.activeCount;
    this.gate.setCount(this.slots.activeCount);
  }
}
