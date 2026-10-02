import {
  Box3,
  BoxGeometry,
  BufferGeometry,
  CylinderGeometry,
  Group,
  Material,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Plane,
  Quaternion,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Height of one lift of the scaffold, m: a ledger ring and boards at each */
const LIFT_M = 2;
/** Widest gap between two standards along a side, m */
const STANDARD_SPACING_M = 2.6;
/** Share of a layer's slot of build time in which it rises; the rest of the slot it holds */
const LAYER_RISE = 0.35;
/** Game ms the scaffold takes to come down once the tower stands */
export const SCAFFOLD_DISMANTLE_MS = 600;

const TUBE_RADIUS = 0.05;
const BOARD_WIDTH = 0.45;
const BOARD_THICKNESS = 0.05;

/**
 * Height share of a build at `progress` (0 to 1): the tower grows layer by layer, each rising within the
 * first LAYER_RISE of its slot and then holding, so it reads as courses laid one after the other.
 */
export function layeredHeight(progress: number, layers: number): number {
  const p = Math.min(1, Math.max(0, progress));
  if (p >= 1) return 1;
  const x = p * layers;
  const layer = Math.floor(x);
  const t = Math.min(1, (x - layer) / LAYER_RISE);
  const rise = t * t * (3 - 2 * t);
  return (layer + rise) / layers;
}

/** Courses a tower of `heightM` is built in: one per 2.5 m, three at least */
export function layerCount(heightM: number): number {
  return Math.max(3, Math.round(heightM / 2.5));
}

let tubeMaterial: MeshStandardMaterial | null = null;
let boardMaterial: MeshStandardMaterial | null = null;
const geometries = new Map<string, { tubes: BufferGeometry; boards: BufferGeometry; users: number }>();

const up = new Vector3(0, 1, 0);

/** A tube from `a` to `b` */
function tube(a: Vector3, b: Vector3): BufferGeometry {
  const dir = b.clone().sub(a);
  const length = dir.length();
  const geometry = new CylinderGeometry(TUBE_RADIUS, TUBE_RADIUS, length, 6, 1, true);
  const matrix = new Matrix4().compose(
    a.clone().add(b).multiplyScalar(0.5),
    new Quaternion().setFromUnitVectors(up, dir.normalize()),
    new Vector3(1, 1, 1),
  );
  return geometry.applyMatrix4(matrix);
}

/** A board of `length` along the side from `a` to `b`, lying at their height */
function board(a: Vector3, b: Vector3, outward: Vector3): BufferGeometry {
  const along = b.clone().sub(a);
  const length = along.length();
  const geometry = new BoxGeometry(length, BOARD_THICKNESS, BOARD_WIDTH);
  const centre = a.clone().add(b).multiplyScalar(0.5).addScaledVector(outward, BOARD_WIDTH / 2);
  const matrix = new Matrix4().compose(
    centre,
    new Quaternion().setFromAxisAngle(up, -Math.atan2(along.z, along.x)),
    new Vector3(1, 1, 1),
  );
  return geometry.applyMatrix4(matrix);
}

/**
 * The tubes and boards of a square scaffold of half width `half` and height `height`, its foot at the
 * origin: standards at the corners and along the sides, a ledger ring and a ring of boards each lift,
 * a brace across each side and lift, every other one the other way.
 */
function buildGeometry(half: number, height: number): { tubes: BufferGeometry; boards: BufferGeometry } {
  const corners = [
    new Vector3(-half, 0, -half), new Vector3(half, 0, -half), new Vector3(half, 0, half), new Vector3(-half, 0, half),
  ];
  const segments = Math.max(1, Math.ceil((2 * half) / STANDARD_SPACING_M));
  const lifts = Math.max(1, Math.round(height / LIFT_M));
  const lift = height / lifts;
  const tubes: BufferGeometry[] = [];
  const boards: BufferGeometry[] = [];
  for (let side = 0; side < 4; side++) {
    const from = corners[side];
    const to = corners[(side + 1) % 4];
    const outward = from.clone().add(to).setY(0).normalize();
    for (let s = 0; s < segments; s++) {
      const a = from.clone().lerp(to, s / segments);
      const b = from.clone().lerp(to, (s + 1) / segments);
      tubes.push(tube(a, a.clone().setY(height)));
      for (let l = 0; l < lifts; l++) {
        const low = l * lift;
        const high = (l + 1) * lift;
        const flip = (l + s) % 2 === 0;
        tubes.push(tube(a.clone().setY(flip ? low : high), b.clone().setY(flip ? high : low)));
      }
    }
    for (let l = 1; l <= lifts; l++) {
      const y = l * lift;
      tubes.push(tube(from.clone().setY(y), to.clone().setY(y)));
      boards.push(board(from.clone().setY(y), to.clone().setY(y), outward));
    }
  }
  const merged = { tubes: mergeGeometries(tubes)!, boards: mergeGeometries(boards)! };
  for (const g of [...tubes, ...boards]) g.dispose();
  return merged;
}

function materials(): { tube: MeshStandardMaterial; board: MeshStandardMaterial } {
  tubeMaterial ??= new MeshStandardMaterial({ color: 0x8c9196, metalness: 0.6, roughness: 0.45 });
  boardMaterial ??= new MeshStandardMaterial({ color: 0x7a5d3e, metalness: 0, roughness: 0.9 });
  return { tube: tubeMaterial, board: boardMaterial };
}

/**
 * A tower being built (Tower.builtAtMs, TODO E104): a scaffold stands around its model, which grows from
 * its foot in courses, cut off above by a clipping plane on its own materials. Counts the build down in
 * game time between the simulation's word (TowerRenderer.setBuild); its end comes from the simulation,
 * then the scaffold comes down.
 */
export class TowerBuild {
  private readonly scaffold = new Group();
  private readonly plane = new Plane(new Vector3(0, -1, 0), 0);
  private readonly clipped: Material[] = [];
  private readonly key: string;
  private readonly footY: number;
  private readonly heightM: number;
  private readonly layers: number;
  private remainingMs: number;
  private totalMs: number;
  /** Game ms the scaffold has been coming down, null while the tower is built */
  private dismantleMs: number | null = null;

  constructor(
    private readonly parent: Object3D,
    model: Object3D,
    footprintRadius: number,
    remainingMs: number,
    totalMs: number,
  ) {
    this.remainingMs = remainingMs;
    this.totalMs = Math.max(1, totalMs);
    model.updateMatrixWorld(true);
    const box = new Box3().setFromObject(model);
    this.footY = box.min.y;
    this.heightM = Math.max(1, box.max.y - box.min.y);
    this.layers = layerCount(this.heightM);

    const half = Math.min(6, Math.max(1.5, footprintRadius * 0.75));
    const height = this.heightM + 0.8;
    this.key = `${half.toFixed(1)}|${height.toFixed(1)}`;
    let shared = geometries.get(this.key);
    if (!shared) {
      shared = { ...buildGeometry(half, height), users: 0 };
      geometries.set(this.key, shared);
    }
    shared.users++;
    const { tube: tubeMat, board: boardMat } = materials();
    this.scaffold.add(new Mesh(shared.tubes, tubeMat), new Mesh(shared.boards, boardMat));
    this.scaffold.position.set(model.position.x, this.footY, model.position.z);
    this.scaffold.rotation.y = model.rotation.y;
    parent.add(this.scaffold);

    // The model's materials are its own (AssetManager.cloneModel clones them)
    model.traverse((node) => {
      const mesh = node as Mesh;
      if (!mesh.isMesh) return;
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        material.clippingPlanes = [this.plane];
        this.clipped.push(material);
      }
    });
    this.applyHeight();
  }

  /** The simulation's word: `remainingMs` of `totalMs` left; 0 ends the build */
  set(remainingMs: number, totalMs: number): void {
    this.totalMs = Math.max(1, totalMs);
    this.remainingMs = remainingMs;
    if (remainingMs <= 0) this.finish();
    else this.applyHeight();
  }

  get finished(): boolean {
    return this.dismantleMs !== null && this.dismantleMs >= SCAFFOLD_DISMANTLE_MS;
  }

  /** One render frame of `gameDeltaMs` game time; the end waits for the simulation (set) */
  update(gameDeltaMs: number): void {
    if (this.dismantleMs !== null) {
      this.dismantleMs += gameDeltaMs;
      const t = Math.min(1, this.dismantleMs / SCAFFOLD_DISMANTLE_MS);
      this.scaffold.scale.y = Math.max(0.001, 1 - t * t);
      if (t >= 1) this.scaffold.visible = false;
      return;
    }
    // Held a little short of the top: the last course comes with the simulation's end
    this.remainingMs = Math.max(this.remainingMs - gameDeltaMs, Math.min(this.remainingMs, 1));
    this.applyHeight();
  }

  /** The whole model shows and the scaffold starts coming down */
  private finish(): void {
    if (this.dismantleMs !== null) return;
    this.dismantleMs = 0;
    this.unclip();
  }

  private applyHeight(): void {
    const progress = 1 - this.remainingMs / this.totalMs;
    this.plane.constant = this.footY + layeredHeight(progress, this.layers) * this.heightM;
  }

  private unclip(): void {
    for (const material of this.clipped) material.clippingPlanes = null;
    this.clipped.length = 0;
  }

  /** Take it all away: the model unclipped, the scaffold out of the scene */
  dispose(): void {
    this.unclip();
    this.parent.remove(this.scaffold);
    const shared = geometries.get(this.key);
    if (shared && --shared.users === 0) {
      shared.tubes.dispose();
      shared.boards.dispose();
      geometries.delete(this.key);
    }
  }
}
