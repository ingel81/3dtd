import { BufferAttribute, Matrix4, Vector3, type Mesh, type Object3D } from 'three';
import type { EnemyTurret } from '../../../configs/enemy-types.config';

/**
 * Turret joints of a VAT (EnemyTypeConfig.turret): a part of the model that
 * turns apart from the rest per instance, in the vertex shader, on top of
 * what the clip does to it. The clip still moves it (the body's dip and roll
 * carry the turret, a death clip may tilt the guns down); the instance adds
 * its own turn and tilt about axes that move with the clip.
 *
 * The bake (vat-baker.ts) writes four points per frame behind the model's
 * vertices, TURRET_MARKERS texels: the yaw pivot (origin of the yaw node), a
 * point up its axis, the pitch pivot (origin of the pitch node) and a point
 * along its axis. The shader reads them for the frame it shows, so the axes
 * are where the clip put them. Each vertex says which part it belongs to
 * (aTurretPart: 0 the body, 1 the turret, 2 the guns), from the node it hangs
 * under. The guns tilt about the pitch axis first, then the turret turns
 * about the yaw axis; the pitch axis is set so that cross(yaw axis, pitch
 * axis) points along the barrels and a positive tilt lifts the muzzles. The
 * instance's angles come in aTurret: yaw, pitch, the yaw still to slide
 * (StateLerp, like aPrevOffset) and the recoil (0 to 1), which slides the
 * guns back along their barrels by `recoil` model units.
 *
 * Only rigid parts take joints: a model whose clips move nodes, or a static
 * one. The rest pose is kept for the CPU (turretPoint): where the muzzles
 * are, for the flash of a shot.
 */

/** Texels per frame behind the model's vertices: yaw pivot, yaw axis point, pitch pivot, pitch axis point */
export const TURRET_MARKERS = 4;

/** The turret's frame at rest in the model root's space, unscaled */
export interface TurretPose {
  yawPivot: Vector3;
  /** Unit vector */
  yawAxis: Vector3;
  pitchPivot: Vector3;
  /** Unit vector, cross(yawAxis, pitchAxis) along the barrels */
  pitchAxis: Vector3;
  muzzles: Vector3[];
}

/** What a VAT keeps of its turret joints */
export interface VATTurret {
  /** Index of the first marker texel of a frame (the model's vertex count) */
  marker: number;
  rest: TurretPose;
  /** How far the guns slide back at full recoil, model units */
  recoil: number;
}

/** Length of the axis markers, as a share of the way from the pitch pivot to the muzzles */
const AXIS_MARKER_SHARE = 0.25;

/**
 * The joints of a model as its nodes say: which mesh belongs to which part,
 * and the four markers for the pose the model stands in now.
 */
export class TurretRig {
  /** Axis of the pitch node in its own frame: the one across the barrels at rest */
  private readonly pitchLocal: Vector3;
  private readonly markerLength: number;
  private readonly m = new Matrix4();
  private readonly v = new Vector3();
  private readonly w = new Vector3();

  private constructor(
    private readonly yaw: Object3D,
    private readonly pitch: Object3D,
    private readonly muzzles: Object3D[],
    readonly config: EnemyTurret,
    root: Object3D,
  ) {
    root.updateMatrixWorld(true);
    const rootInverse = new Matrix4().copy(root.matrixWorld).invert();
    const pose = this.pose(rootInverse, null);
    this.markerLength = Math.max(1e-4, pose.pitchPivot.distanceTo(meanOf(pose.muzzles)) * AXIS_MARKER_SHARE);
    // The pitch axis in the pitch node's frame, so the clip carries it
    const toNode = new Matrix4().copy(pitch.matrixWorld).invert().multiply(root.matrixWorld);
    this.pitchLocal = pose.pitchAxis.clone().transformDirection(toNode);
  }

  /** The rig of `root` for `config`, null (with a warning) when a node is missing */
  static find(root: Object3D, config: EnemyTurret): TurretRig | null {
    const yaw = root.getObjectByName(config.yawNode);
    const pitch = root.getObjectByName(config.pitchNode);
    const muzzles = config.muzzleNodes.map((name) => root.getObjectByName(name));
    if (!yaw || !pitch || muzzles.length === 0 || muzzles.some((m) => !m)) {
      console.warn(`[VATTurret] turret nodes missing (${config.yawNode}, ${config.pitchNode}, ${config.muzzleNodes.join(', ')}): no turret`);
      return null;
    }
    return new TurretRig(yaw, pitch, muzzles as Object3D[], config, root);
  }

  /** 2 for a mesh under the pitch node, 1 under the yaw node, 0 for the body */
  partOf(mesh: Mesh): number {
    for (let node: Object3D | null = mesh; node; node = node.parent) {
      if (node === this.pitch) return 2;
      if (node === this.yaw) return 1;
    }
    return 0;
  }

  /** aTurretPart for a merged geometry of `meshes` laid out at their offsets */
  partAttribute(meshes: readonly { mesh: Mesh; vertexOffset: number; vertexCount: number }[], vertices: number): BufferAttribute {
    const parts = new Float32Array(vertices);
    for (const info of meshes) parts.fill(this.partOf(info.mesh), info.vertexOffset, info.vertexOffset + info.vertexCount);
    return new BufferAttribute(parts, 1);
  }

  /**
   * The four markers of the pose the model stands in now (after
   * updateMatrixWorld), in the root's space: `set(i, point)` for i 0 to 3
   */
  markers(rootInverse: Matrix4, set: (i: number, point: Vector3) => void): void {
    const yawAt = this.v.setFromMatrixPosition(this.m.multiplyMatrices(rootInverse, this.yaw.matrixWorld));
    set(0, yawAt);
    this.w.set(0, 1, 0).transformDirection(this.m).multiplyScalar(this.markerLength).add(yawAt);
    set(1, this.w);
    const pitchAt = this.v.setFromMatrixPosition(this.m.multiplyMatrices(rootInverse, this.pitch.matrixWorld));
    set(2, pitchAt);
    this.w.copy(this.pitchLocal).transformDirection(this.m).multiplyScalar(this.markerLength).add(pitchAt);
    set(3, this.w);
  }

  /** The VAT's record of the rig: markers from `marker` on, the rest pose of the model as it stands now */
  vatTurret(root: Object3D, marker: number): VATTurret {
    root.updateMatrixWorld(true);
    const rootInverse = new Matrix4().copy(root.matrixWorld).invert();
    return { marker, rest: this.pose(rootInverse, this.pitchLocal), recoil: this.config.recoil };
  }

  /** The pose in the root's space; the pitch axis from `pitchLocal`, or at rest across the barrels */
  private pose(rootInverse: Matrix4, pitchLocal: Vector3 | null): TurretPose {
    const yawFrame = new Matrix4().multiplyMatrices(rootInverse, this.yaw.matrixWorld);
    const pitchFrame = new Matrix4().multiplyMatrices(rootInverse, this.pitch.matrixWorld);
    const yawPivot = new Vector3().setFromMatrixPosition(yawFrame);
    const yawAxis = new Vector3(0, 1, 0).transformDirection(yawFrame);
    const pitchPivot = new Vector3().setFromMatrixPosition(pitchFrame);
    const muzzles = this.muzzles.map((m) => new Vector3().setFromMatrixPosition(new Matrix4().multiplyMatrices(rootInverse, m.matrixWorld)));
    let pitchAxis: Vector3;
    if (pitchLocal) {
      pitchAxis = pitchLocal.clone().transformDirection(pitchFrame);
    } else {
      // Along the barrels, level with the turret: the axis across them is forward × up
      const forward = meanOf(muzzles).sub(pitchPivot);
      forward.addScaledVector(yawAxis, -forward.dot(yawAxis)).normalize();
      pitchAxis = new Vector3().crossVectors(forward, yawAxis).normalize();
    }
    return { yawPivot, yawAxis, pitchPivot, pitchAxis, muzzles };
  }
}

function meanOf(points: readonly Vector3[]): Vector3 {
  const out = new Vector3();
  for (const p of points) out.add(p);
  return out.multiplyScalar(1 / Math.max(1, points.length));
}

/** `p` turned by `angle` about the axis through `pivot` along unit `axis` (Rodrigues), into `out` */
export function turnAbout(p: Vector3, pivot: Vector3, axis: Vector3, angle: number, out: Vector3): Vector3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const vx = p.x - pivot.x;
  const vy = p.y - pivot.y;
  const vz = p.z - pivot.z;
  const k = (axis.x * vx + axis.y * vy + axis.z * vz) * (1 - c);
  return out.set(
    pivot.x + vx * c + (axis.y * vz - axis.z * vy) * s + axis.x * k,
    pivot.y + vy * c + (axis.z * vx - axis.x * vz) * s + axis.y * k,
    pivot.z + vz * c + (axis.x * vy - axis.y * vx) * s + axis.z * k,
  );
}

/**
 * Where a point of the gun part (at rest, model root space) stands with the
 * guns tilted by `pitch` and the turret turned by `yaw`, as the shader puts
 * it (without the clip's motion and the recoil): the muzzles for a shot's flash
 */
export function turretPoint(rest: TurretPose, yaw: number, pitch: number, point: Vector3, out: Vector3): Vector3 {
  turnAbout(point, rest.pitchPivot, rest.pitchAxis, pitch, out);
  return turnAbout(out, rest.yawPivot, rest.yawAxis, yaw, out);
}

/** Vertex shader declarations of the turret joints (VAT_TURRET), after the VAT uniforms */
export const TURRET_VERTEX_GLSL = /* glsl */ `
  #ifdef VAT_TURRET
    attribute float aTurretPart;
    // yaw, pitch, the yaw still to slide (times 1 - uStateLerp), recoil 0..1
    attribute vec4 aTurret;
    uniform float turretMarker;
    uniform float turretRecoil;

    // A texel of the VAT (a vertex or a marker) in the frame the instance shows, decoded
    vec3 vatPoint(float index) {
      float u = (mod(index, vatWidth) + 0.5) / vatWidth;
      float row = floor(index / vatWidth);
      vec4 p = texture2D(vatTexture, vec2(u, (aAnimFrame.x * rowsPerFrame + row + 0.5) / vatHeight));
      if (aAnimFrame.z > 0.0) {
        vec4 q = texture2D(vatTexture, vec2(u, (aAnimFrame.y * rowsPerFrame + row + 0.5) / vatHeight));
        p = mix(p, q, aAnimFrame.z);
      }
      return p.xyz * vatExtent + vatOrigin;
    }

    // v turned by angle about the unit axis (Rodrigues)
    vec3 turnVector(vec3 v, vec3 axis, float angle) {
      float c = cos(angle);
      float s = sin(angle);
      return v * c + cross(axis, v) * s + axis * dot(axis, v) * (1.0 - c);
    }
  #endif
`;

/**
 * Vertex shader main of the turret joints: turns `animatedPosition` and
 * `objectNormal` of a turret vertex (both declared before)
 */
export const TURRET_VERTEX_MAIN_GLSL = /* glsl */ `
  #ifdef VAT_TURRET
    if (aTurretPart > 0.5) {
      vec3 yawPivot = vatPoint(turretMarker);
      vec3 yawAxis = normalize(vatPoint(turretMarker + 1.0) - yawPivot);
      if (aTurretPart > 1.5) {
        vec3 pitchPivot = vatPoint(turretMarker + 2.0);
        vec3 pitchAxis = normalize(vatPoint(turretMarker + 3.0) - pitchPivot);
        animatedPosition -= normalize(cross(yawAxis, pitchAxis)) * aTurret.w * turretRecoil;
        animatedPosition = pitchPivot + turnVector(animatedPosition - pitchPivot, pitchAxis, aTurret.y);
        objectNormal = turnVector(objectNormal, pitchAxis, aTurret.y);
      }
      float yaw = aTurret.x + aTurret.z * (1.0 - uStateLerp);
      animatedPosition = yawPivot + turnVector(animatedPosition - yawPivot, yawAxis, yaw);
      objectNormal = turnVector(objectNormal, yawAxis, yaw);
    }
  #endif
`;

/** Uniforms of the turret joints */
export function turretUniforms(turret: VATTurret): Record<string, { value: number }> {
  return { turretMarker: { value: turret.marker }, turretRecoil: { value: turret.recoil } };
}

