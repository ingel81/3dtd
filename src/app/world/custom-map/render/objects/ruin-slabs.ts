import { BoxGeometry, DoubleSide, InstancedBufferAttribute, InstancedMesh, Matrix4, MeshStandardMaterial } from 'three';
import type { RubbleMaterial } from '../../rubble-material';
import { addDamage, damageDepthMaterial, writeDamage, type DamageArrays, type RuinFrame, type RuinShape } from './ruin-damage';

/**
 * The insides of the ruins (docs/DESTRUCTION_PLAN.md, Z2): a floor slab
 * every storey (3 m) across the building's ground rectangle and inner walls
 * that split it into rooms, all in one instanced mesh for every ruin of the
 * map. They are cut by the same damage as the outer walls (ruin-damage.ts)
 * with a smaller bite, so floors and walls jut into the hole a little, and
 * fall with what stands above the break line. A whole building hides its
 * insides behind its walls, so only ruins from stage 2 have any, and intact
 * buildings pay nothing for them.
 */

/** Storey height and slab thickness, m */
const STOREY = 3;
const THICKNESS = 0.24;
/** The slabs stop short of the walls and of the bite's edge */
const INSET = 0.94;
const BITE = 0.82;
/** Inner walls: their thickness, and the shortest side of the rectangle (half of it, m) that gets one across */
const WALL = 0.18;
const ROOM_HALF = 2.5;
/** Inner walls in plaster, lighter than the floors (linear) */
const WALL_COLOUR: readonly [number, number, number] = [0.24, 0.22, 0.2];
/** Inner walls reach this share of the building's height: below the eaves of a pitched roof, never through it */
const WALL_TOP = 0.62;

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
  colours: Float32Array;
}

export class RuinSlabs {
  readonly mesh: InstancedMesh;
  private readonly ruins = new Map<string, RuinFloors>();
  private readonly matrix = new Matrix4();
  private capacity = 0;

  constructor() {
    // Inside, out of the sky's light: little of the environment
    const material = new MeshStandardMaterial({ roughness: 0.95, metalness: 0, side: DoubleSide, envMapIntensity: 0.3 });
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

  /** Ruin `id`'s floors and inner walls anew: none below stage 2, a fallen one's floors those well inside its stump */
  set(id: string, frame: RuinFrame, shape: RuinShape, stage: number, fallStart: number, material: RubbleMaterial): void {
    if (stage < 2) {
      this.delete(id);
      return;
    }
    const top = stage >= 3 ? shape.breakY - frame.seatY - 1 : frame.height - 1.2;
    const floors = Math.max(0, Math.floor(top / STOREY));
    // A wall across each side long enough for two rooms, off the middle by the ruin's roll (its heading)
    const lenA = Math.hypot(frame.ax, frame.az);
    const lenB = Math.hypot(frame.bx, frame.bz);
    const walls: { across: 'a' | 'b'; at: number }[] = [];
    if (lenA > ROOM_HALF) walls.push({ across: 'a', at: (fract(shape.heading * 7.31) - 0.5) * 0.6 });
    if (lenB > ROOM_HALF) walls.push({ across: 'b', at: (fract(shape.heading * 3.17) - 0.5) * 0.6 });
    const count = floors + walls.length;
    if (!count) {
      this.delete(id);
      return;
    }
    const matrices = new Float32Array(count * 16);
    const damage: DamageArrays = [new Float32Array(count * 4), new Float32Array(count * 4), new Float32Array(count * 4)];
    const colours = new Float32Array(count * 3);
    const bitten = { ...shape, biteR: shape.biteR * BITE };
    const floor = SLAB_COLOURS[material];
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
      colours.set(floor, k * 3);
    }
    const height = frame.height * WALL_TOP;
    walls.forEach((w, n) => {
      const k = floors + n;
      // The wall's normal along the side it crosses, its length along the other, from the seat up the building
      const [nx, nz, len] = w.across === 'a' ? [frame.ax / lenA, frame.az / lenA, lenA] : [frame.bx / lenB, frame.bz / lenB, lenB];
      const [sx, sz] = w.across === 'a' ? [frame.bx, frame.bz] : [frame.ax, frame.az];
      this.matrix.set(
        nx * WALL, 0, sx * 2 * INSET, frame.cx + nx * len * w.at,
        0, height, 0, frame.seatY + height / 2,
        nz * WALL, 0, sz * 2 * INSET, frame.cz + nz * len * w.at,
        0, 0, 0, 1,
      );
      this.matrix.toArray(matrices, k * 16);
      writeDamage(damage, k, stage, fallStart, bitten);
      colours.set(WALL_COLOUR, k * 3);
    });
    this.ruins.set(id, { count, matrices, damage, colours });
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
    let n = 0;
    for (const r of this.ruins.values()) {
      m.set(r.matrices, n * 16);
      for (let k = 0; k < 3; k++) (attrs[k].array as Float32Array).set(r.damage[k], n * 4);
      colours.set(r.colours, n * 3);
      n += r.count;
    }
    this.mesh.count = Math.max(1, n);
    this.mesh.visible = n > 0;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor!.needsUpdate = true;
    for (const a of attrs) a.needsUpdate = true;
  }
}

function fract(v: number): number {
  return v - Math.floor(v);
}
