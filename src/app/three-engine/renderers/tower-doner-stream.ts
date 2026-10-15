import {
  InstancedMesh,
  Matrix4,
  Quaternion,
  Vector3,
  type BufferGeometry,
  type Material,
  type Mesh,
  type Object3D,
} from 'three';
import type { TowerTypeConfig } from '../../configs/tower-types.config';

/** Turns of the spit a second at full drive, about -y (clockwise from above) */
const SPIT_RPS = 1.5;
/** Strokes of the cutting arm a second at full drive, and how far it swings */
const STROKE_HZ = 6;
const STROKE_RAD = (8 * Math.PI) / 180;
/** Pieces cut per stroke: about 72 a second at full drive */
const PIECES_PER_STROKE = 12;
/** Flight speed of a piece, m/s, and the most of them in the air per kind */
const PIECE_SPEED_MPS = 40;
const POOL = 48;
/** A piece's size against the cut pieces in the model */
const PIECE_SCALE = 0.9;
/** Spread across the line, model units, and the height of the arc as a share of the distance */
const SPREAD = 0.06;
const ARC = 0.05;

const DOWN = new Vector3(0, -1, 0);
const STROKE_AXIS = new Vector3(0, 0, -1);

interface Piece {
  born: number;
  flight: number;
  from: Vector3;
  to: Vector3;
  spin: Vector3;
  alive: boolean;
}

/**
 * The Shawarma Slicer at work (TowerTypeConfig.stream), under the tower's
 * turret part in its frame (model units): the spit turns and the cutting arm
 * strokes with the drive the simulation sends (`towers.setStream`), and with
 * a target the cut pieces fly from the muzzle to it in a dense stream, copies
 * of the model's two loose pieces (slice_a, slice_b, hidden in place) in one
 * InstancedMesh each. Purely visual: the damage is the simulation's
 * (TowerCombatService.updateStreamTowers).
 */
export class DonerStream {
  private readonly spit: Object3D | null;
  private readonly arm: Object3D | null;
  private readonly armRest: Quaternion;
  private readonly meshes: InstancedMesh[] = [];
  private readonly pieces: Piece[][] = [];
  private readonly muzzle: Vector3;
  private readonly target = new Vector3();
  private hasTarget = false;
  private drive = 0;
  private time = 0;
  private strokePhase = 0;
  /** Pieces owed by the cutting so far, the fraction carried to the next frame */
  private owed = 0;
  private next = 0;
  private readonly matrix = new Matrix4();
  private readonly inverse = new Matrix4();
  private readonly q = new Quaternion();
  private readonly qSpin = new Quaternion();
  private readonly p = new Vector3();
  private readonly s = new Vector3();

  /** `unitsPerMetre`: model units in a metre of the world, 1 / the tower's scale */
  constructor(config: TowerTypeConfig, private readonly turret: Object3D, private readonly unitsPerMetre: number) {
    this.spit = turret.getObjectByName('spit') ?? null;
    this.arm = turret.getObjectByName('arm') ?? null;
    this.armRest = this.arm ? this.arm.quaternion.clone() : new Quaternion();
    this.muzzle = new Vector3(...(config.stream?.muzzle ?? [0, 0, 0]));
    for (const name of ['slice_a', 'slice_b']) {
      const source = turret.getObjectByName(name) as Mesh | undefined;
      if (!source?.geometry) continue;
      source.visible = false;
      // Centred on itself, so a piece turns about its middle
      const geometry = (source.geometry as BufferGeometry).clone();
      geometry.computeBoundingBox();
      const centre = geometry.boundingBox!.getCenter(new Vector3());
      geometry.translate(-centre.x, -centre.y, -centre.z);
      const mesh = new InstancedMesh(geometry, source.material as Material, POOL);
      mesh.name = `${name}_stream`;
      mesh.count = 0;
      mesh.frustumCulled = false;
      turret.add(mesh);
      this.meshes.push(mesh);
      this.pieces.push(Array.from({ length: POOL }, () => ({
        born: 0, flight: 0, from: new Vector3(), to: new Vector3(), spin: new Vector3(), alive: false,
      })));
    }
  }

  /** The stream of this frame: where it goes (world, null: it spins without one) and the drive, 0 to 1. */
  setStream(target: Vector3 | null, drive: number): void {
    this.drive = drive;
    this.hasTarget = target !== null;
    if (target) {
      this.turret.updateWorldMatrix(true, false);
      this.target.copy(target).applyMatrix4(this.inverse.copy(this.turret.matrixWorld).invert());
    }
  }

  /** Once per render frame: the spit and the arm turn with the drive, pieces are cut and fly. */
  update(deltaSeconds: number): void {
    this.time += deltaSeconds;
    const drive = this.drive;
    if (this.spit) this.spit.rotateOnAxis(DOWN, 2 * Math.PI * SPIT_RPS * drive * deltaSeconds);
    this.strokePhase += 2 * Math.PI * STROKE_HZ * drive * deltaSeconds;
    if (this.arm) {
      this.arm.quaternion.copy(this.armRest).multiply(this.q.setFromAxisAngle(STROKE_AXIS, STROKE_RAD * Math.sin(this.strokePhase)));
    }
    if (this.hasTarget && drive > 0 && this.meshes.length > 0) {
      this.owed += STROKE_HZ * PIECES_PER_STROKE * drive * deltaSeconds;
      while (this.owed >= 1) {
        this.owed -= 1;
        this.cut();
      }
    } else {
      this.owed = 0;
    }
    this.draw();
  }

  dispose(): void {
    for (const mesh of this.meshes) {
      mesh.removeFromParent();
      mesh.geometry.dispose();
      mesh.dispose();
    }
  }

  /** A new piece from the muzzle to the target, from the pools in turn */
  private cut(): void {
    const kind = this.next % this.meshes.length;
    const pool = this.pieces[kind];
    const piece = pool.find((p) => !p.alive) ?? pool[(this.next >> 1) % POOL];
    this.next++;
    piece.alive = true;
    piece.born = this.time;
    piece.from.copy(this.muzzle);
    piece.to.set(
      this.target.x + (Math.random() - 0.5) * 2 * SPREAD,
      this.target.y + (Math.random() - 0.5) * 2 * SPREAD,
      this.target.z + (Math.random() - 0.5) * 2 * SPREAD,
    );
    piece.flight = Math.max(0.05, (piece.from.distanceTo(piece.to) / this.unitsPerMetre) / PIECE_SPEED_MPS);
    piece.spin.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
  }

  private draw(): void {
    for (let k = 0; k < this.meshes.length; k++) {
      const mesh = this.meshes[k];
      let n = 0;
      for (const piece of this.pieces[k]) {
        if (!piece.alive) continue;
        const t = (this.time - piece.born) / piece.flight;
        if (t >= 1) {
          piece.alive = false;
          continue;
        }
        this.p.lerpVectors(piece.from, piece.to, t);
        this.p.y += ARC * piece.from.distanceTo(piece.to) * 4 * t * (1 - t);
        this.qSpin.setFromAxisAngle(piece.spin, (this.time - piece.born) * 25);
        this.s.setScalar(PIECE_SCALE);
        this.matrix.compose(this.p, this.qSpin, this.s);
        mesh.setMatrixAt(n++, this.matrix);
      }
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
    }
  }
}
