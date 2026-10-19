import { BoxGeometry, Color, DoubleSide, InstancedBufferAttribute, InstancedMesh, Matrix4, MeshStandardMaterial } from 'three';
import type { RubbleMaterial } from '../../rubble-material';
import { addDamage, damageDepthMaterial, writeDamage, type DamageArrays, type RuinFrame, type RuinShape } from './ruin-damage';

/**
 * The floors inside the ruins (docs/DESTRUCTION_PLAN.md, Z2): a slab every
 * storey (3 m) across the building's ground rectangle, in one instanced
 * mesh for every ruin of the map. They are cut by the same damage as the
 * walls (ruin-damage.ts) with a smaller bite, so a floor juts out into the
 * hole a little, and fall with what stands above the break line. A whole
 * building hides its floors behind its walls, so only ruins from stage 2
 * have any.
 */

/** Storey height and slab thickness, m */
const STOREY = 3;
const THICKNESS = 0.24;
/** The slabs stop short of the walls and of the bite's edge */
const INSET = 0.94;
const BITE = 0.82;

/** Slab colours by what the building is of (linear): concrete floors, timber in wood */
const SLAB_COLOURS: Record<RubbleMaterial, readonly [number, number, number]> = {
  plaster: [0.2, 0.18, 0.16],
  concrete: [0.21, 0.2, 0.19],
  metal: [0.17, 0.17, 0.17],
  brick: [0.2, 0.17, 0.15],
  stone: [0.21, 0.19, 0.17],
  wood: [0.16, 0.1, 0.06],
};

interface RuinFloors {
  count: number;
  matrices: Float32Array;
  damage: DamageArrays;
  colour: readonly [number, number, number];
}

export class RuinSlabs {
  readonly mesh: InstancedMesh;
  private readonly ruins = new Map<string, RuinFloors>();
  private readonly matrix = new Matrix4();
  private capacity = 0;

  constructor() {
    const material = new MeshStandardMaterial({ roughness: 0.95, metalness: 0, side: DoubleSide });
    addDamage(material);
    this.mesh = new InstancedMesh(new BoxGeometry(1, 1, 1), material, 1);
    this.mesh.name = 'ruin-slabs';
    this.mesh.customDepthMaterial = damageDepthMaterial('slab');
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.userData['losTransparent'] = true;
    this.grow(16);
    this.flush();
  }

  /** Ruin `id`'s floors anew: none below stage 2, a fallen one's those well inside its stump */
  set(id: string, frame: RuinFrame, shape: RuinShape, stage: number, fallStart: number, material: RubbleMaterial): void {
    const top = stage >= 3 ? shape.breakY - frame.seatY - 1 : frame.height - 1.2;
    const floors = stage >= 2 ? Math.max(0, Math.floor(top / STOREY)) : 0;
    if (!floors) {
      this.delete(id);
      return;
    }
    const matrices = new Float32Array(floors * 16);
    const damage: DamageArrays = [new Float32Array(floors * 4), new Float32Array(floors * 4), new Float32Array(floors * 4)];
    const bitten = { ...shape, biteR: shape.biteR * BITE };
    for (let k = 0; k < floors; k++) {
      const y = frame.seatY + (k + 1) * STOREY;
      this.matrix.set(
        frame.ax * 2 * INSET, 0, frame.bx * 2 * INSET, frame.cx,
        0, THICKNESS, 0, y,
        frame.az * 2 * INSET, 0, frame.bz * 2 * INSET, frame.cz,
        0, 0, 0, 1,
      );
      this.matrix.toArray(matrices, k * 16);
      writeDamage(damage, k, stage, fallStart, bitten);
    }
    this.ruins.set(id, { count: floors, matrices, damage, colour: SLAB_COLOURS[material] });
    this.flush();
  }

  delete(id: string): void {
    if (this.ruins.delete(id)) this.flush();
  }

  clear(): void {
    if (!this.ruins.size) return;
    this.ruins.clear();
    this.flush();
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    (this.mesh.material as MeshStandardMaterial).dispose();
    this.mesh.customDepthMaterial?.dispose();
    this.mesh.dispose();
  }

  /** Room for `n` slabs: the instance arrays anew */
  private grow(n: number): void {
    this.capacity = n;
    const g = this.mesh.geometry;
    this.mesh.instanceMatrix = new InstancedBufferAttribute(new Float32Array(n * 16), 16);
    this.mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(n * 3), 3);
    g.setAttribute('aDamage', new InstancedBufferAttribute(new Float32Array(n * 4), 4));
    g.setAttribute('aDamageB', new InstancedBufferAttribute(new Float32Array(n * 4), 4));
    g.setAttribute('aDamageC', new InstancedBufferAttribute(new Float32Array(n * 4), 4));
  }

  /**
   * Every ruin's slabs into the arrays. Without any the mesh hides with
   * one empty instance, which the warm-up shows to build its programs
   */
  private flush(): void {
    let total = 0;
    for (const r of this.ruins.values()) total += r.count;
    if (total > this.capacity) {
      // The arrays anew: three keeps the old buffers' GPU copies until they are disposed with the geometry's
      const old = this.mesh.geometry;
      this.mesh.geometry = old.clone();
      old.dispose();
      this.grow(Math.max(total, this.capacity * 2));
    }
    const g = this.mesh.geometry;
    const m = this.mesh.instanceMatrix.array as Float32Array;
    const colours = this.mesh.instanceColor!.array as Float32Array;
    const attrs = [g.getAttribute('aDamage'), g.getAttribute('aDamageB'), g.getAttribute('aDamageC')] as InstancedBufferAttribute[];
    const colour = new Color();
    let n = 0;
    for (const r of this.ruins.values()) {
      m.set(r.matrices, n * 16);
      for (let k = 0; k < 3; k++) (attrs[k].array as Float32Array).set(r.damage[k], n * 4);
      colour.setRGB(...r.colour);
      for (let k = 0; k < r.count; k++) colour.toArray(colours, (n + k) * 3);
      n += r.count;
    }
    this.mesh.count = Math.max(1, n);
    this.mesh.visible = n > 0;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor!.needsUpdate = true;
    for (const a of attrs) a.needsUpdate = true;
  }
}
