import {
  Scene,
  Vector3,
  Mesh,
  BufferGeometry,
  BufferAttribute,
  ShaderMaterial,
  FrontSide,
} from 'three';
import { TENTACLE_VERTEX, TENTACLE_FRAGMENT } from '../../game/tower-defense/shaders/tentacle.shaders';

/** Tube topology */
const SEGMENTS = 32;
const RADIAL = 12;
const RING_SIZE = RADIAL + 1; // +1 for UV seam

/** Tentacle length (vertical extent above tower) */
const TENTACLE_LENGTH = 12;

/** Lower 3/4 acts as rigid trunk — only upper quarter bends during strike */
const TRUNK_HEIGHT = TENTACLE_LENGTH * 0.75;

/** Strike/retract animation speed */
const STRIKE_SPEED = 6.0;
const RETRACT_SPEED = 3.0;

/**
 * State of a single tentacle.
 * No position buffer — all vertex computation happens on GPU.
 */
interface TentacleState {
  towerId: string;
  mesh: Mesh;
  material: ShaderMaterial;
  basePos: Vector3;         // Tower shoot position (fixed)
  state: 'idle' | 'striking' | 'retracting';
  strikeTarget: Vector3;    // Current strike target position
  strikeProgress: number;   // 0→1 for strike, 1→0 for retract
  time: number;             // Accumulated time for idle sway
  idleTipPos: Vector3;      // Where the tip rests during idle
}

/**
 * ThreeTentacleRenderer — GPU Bezier tentacles for melee towers
 *
 * All Bezier evaluation, Frenet frame computation, and taper happen on the GPU
 * vertex shader. CPU only computes 4 Bezier control points per tentacle per
 * frame and sets them as vec3 uniforms. Template geometry is a static unit-circle
 * tube shared across all tentacles (never modified).
 *
 * Per tentacle: ~225 vertices, 1 draw call, 4 vec3 uniform updates/frame.
 */
export class ThreeTentacleRenderer {
  private readonly scene: Scene;
  private readonly tentacles = new Map<string, TentacleState>();
  private sharedGeometry: BufferGeometry | null = null;

  // Reusable vectors for control-point computation (zero alloc per frame)
  private readonly _tipPos = new Vector3();
  private readonly _idleTip = new Vector3();
  private readonly _cp2a = new Vector3();
  private readonly _cp2b = new Vector3();

  constructor(scene: Scene) {
    this.scene = scene;
  }

  // =====================================================
  // TEMPLATE GEOMETRY (created once, shared by all)
  // =====================================================

  /**
   * Get or create the shared template geometry.
   * position.xz = unit-circle radial offset, uv.y = Bezier parameter t.
   * Never modified after creation — all deformation is in vertex shader.
   */
  private getSharedGeometry(): BufferGeometry {
    if (this.sharedGeometry) return this.sharedGeometry;

    // +1 for tip cap center vertex
    const tubeVerts = (SEGMENTS + 1) * RING_SIZE;
    const vertexCount = tubeVerts + 1;
    const positions = new Float32Array(vertexCount * 3);
    const uvs = new Float32Array(vertexCount * 2);
    const indices: number[] = [];

    // Tube vertices
    for (let i = 0; i <= SEGMENTS; i++) {
      const t = i / SEGMENTS;
      for (let j = 0; j < RING_SIZE; j++) {
        const idx = i * RING_SIZE + j;
        const angle = (j / RADIAL) * Math.PI * 2;
        positions[idx * 3]     = Math.cos(angle); // Unit circle X
        positions[idx * 3 + 1] = 0;               // Unused
        positions[idx * 3 + 2] = Math.sin(angle); // Unit circle Z
        uvs[idx * 2]     = j / RADIAL;
        uvs[idx * 2 + 1] = t;
      }
    }

    // Tip cap center vertex: radial (0,0) at t=1, shader places it on curve center
    positions[tubeVerts * 3]     = 0;
    positions[tubeVerts * 3 + 1] = 0;
    positions[tubeVerts * 3 + 2] = 0;
    uvs[tubeVerts * 2]     = 0.5;
    uvs[tubeVerts * 2 + 1] = 1.0;

    // Tube faces
    for (let i = 0; i < SEGMENTS; i++) {
      for (let j = 0; j < RADIAL; j++) {
        const a = i * RING_SIZE + j;
        const b = i * RING_SIZE + j + 1;
        const c = (i + 1) * RING_SIZE + j + 1;
        const d = (i + 1) * RING_SIZE + j;
        indices.push(a, b, d, b, c, d);
      }
    }

    // Tip cap faces: connect last ring to center vertex (flipped winding for outward normal)
    const lastRing = SEGMENTS * RING_SIZE;
    const capCenter = tubeVerts;
    for (let j = 0; j < RADIAL; j++) {
      indices.push(lastRing + j + 1, capCenter, lastRing + j);
    }

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new BufferAttribute(uvs, 2));
    geometry.setIndex(indices);

    this.sharedGeometry = geometry;
    return geometry;
  }

  // =====================================================
  // PUBLIC API
  // =====================================================

  /**
   * Create a tentacle for a tower
   */
  create(towerId: string, basePosition: Vector3): void {
    if (this.tentacles.has(towerId)) return;

    const basePos = basePosition.clone();
    const idleTipPos = new Vector3(basePos.x, basePos.y + TENTACLE_LENGTH, basePos.z);

    const material = new ShaderMaterial({
      vertexShader: TENTACLE_VERTEX,
      fragmentShader: TENTACLE_FRAGMENT,
      uniforms: {
        uCP0: { value: basePos.clone() },
        uCP1: { value: new Vector3() },
        uCP2: { value: new Vector3() },
        uCP3: { value: idleTipPos.clone() },
        uCameraPos: { value: new Vector3() },
      },
      side: FrontSide,
    });

    const mesh = new Mesh(this.getSharedGeometry(), material);
    mesh.frustumCulled = false;
    this.scene.add(mesh);

    const state: TentacleState = {
      towerId, mesh, material,
      basePos, idleTipPos,
      state: 'idle',
      strikeTarget: new Vector3(),
      strikeProgress: 0,
      time: 0,
    };

    this.tentacles.set(towerId, state);

    // Set initial control points
    this.computeIdleCurve(state);
  }

  /**
   * Start a strike animation toward a target position
   */
  startStrike(towerId: string, targetPos: Vector3): void {
    const s = this.tentacles.get(towerId);
    if (!s) return;
    s.state = 'striking';
    s.strikeTarget.copy(targetPos);
    s.strikeProgress = 0;
  }

  /**
   * Update all tentacles (called per frame).
   * Only computes 4 control points and sets uniforms — no geometry mutation.
   */
  update(deltaTime: number, cameraPos?: Vector3): void {
    const dt = deltaTime / 1000;

    for (const s of this.tentacles.values()) {
      s.time += dt;

      if (cameraPos) {
        s.material.uniforms['uCameraPos'].value.copy(cameraPos);
      }

      switch (s.state) {
        case 'idle':       this.computeIdleCurve(s); break;
        case 'striking':   this.computeStrikeCurve(s, dt); break;
        case 'retracting': this.computeRetractCurve(s, dt); break;
      }
    }
  }

  // =====================================================
  // CURVE COMPUTATION → writes directly to material uniforms
  // =====================================================

  private computeIdleCurve(s: TentacleState): void {
    const t = s.time;
    this._tipPos.copy(s.idleTipPos);
    // Sinuous writhing motion — wider, more complex sway
    this._tipPos.x += Math.sin(t * 0.9) * 2.2 + Math.sin(t * 2.3) * 0.7;
    this._tipPos.z += Math.cos(t * 0.7) * 1.8 + Math.cos(t * 1.9) * 0.5;
    this._tipPos.y += Math.sin(t * 0.5) * 0.5;

    this.buildIdleCurve(s, s.basePos, this._tipPos, t);
  }

  private computeStrikeCurve(s: TentacleState, dt: number): void {
    s.strikeProgress = Math.min(1, s.strikeProgress + dt * STRIKE_SPEED);
    const eased = 1 - Math.pow(1 - s.strikeProgress, 3);
    const t = s.time;
    const u = s.material.uniforms;

    // Trunk top: fixed point where the bending starts (1/3 up)
    const trunkTopY = s.basePos.y + TRUNK_HEIGHT;

    this._idleTip.copy(s.idleTipPos);
    this._idleTip.x += Math.sin(t * 0.9) * 1.5;
    this._idleTip.z += Math.cos(t * 0.7) * 1.2;

    this._tipPos.lerpVectors(this._idleTip, s.strikeTarget, eased);

    // CP0 = base (fixed)
    u['uCP0'].value.copy(s.basePos);

    // CP1 = trunk top — rigid, no lean
    u['uCP1'].value.set(
      s.basePos.x,
      trunkTopY,
      s.basePos.z
    );

    // CP2 = bend control — stays near trunk top, only leans toward target
    this._cp2a.set(
      s.basePos.x,
      trunkTopY + TENTACLE_LENGTH * 0.15,
      s.basePos.z
    );
    this._cp2b.set(
      s.basePos.x + (s.strikeTarget.x - s.basePos.x) * 0.4,
      Math.max(trunkTopY, s.strikeTarget.y + 3),
      s.basePos.z + (s.strikeTarget.z - s.basePos.z) * 0.4
    );
    u['uCP2'].value.lerpVectors(this._cp2a, this._cp2b, eased);

    // CP3 = tip → target
    u['uCP3'].value.copy(this._tipPos);

    if (s.strikeProgress >= 1) {
      s.state = 'retracting';
      s.strikeProgress = 1;
    }
  }

  private computeRetractCurve(s: TentacleState, dt: number): void {
    s.strikeProgress = Math.max(0, s.strikeProgress - dt * RETRACT_SPEED);
    const eased = Math.pow(s.strikeProgress, 2);
    const t = s.time;
    const u = s.material.uniforms;

    const trunkTopY = s.basePos.y + TRUNK_HEIGHT;

    this._idleTip.copy(s.idleTipPos);
    this._idleTip.x += Math.sin(t * 0.9) * 1.5;
    this._idleTip.z += Math.cos(t * 0.7) * 1.2;

    this._tipPos.lerpVectors(this._idleTip, s.strikeTarget, eased);

    // CP0 = base
    u['uCP0'].value.copy(s.basePos);

    // CP1 = trunk top — rigid, no lean
    u['uCP1'].value.set(
      s.basePos.x,
      trunkTopY,
      s.basePos.z
    );

    // CP2 = lerp back from strike arc to idle arc
    this._cp2a.set(
      this._tipPos.x + Math.sin(t * 1.7 + 2.0) * 1.0,
      trunkTopY + (this._tipPos.y - trunkTopY) * 0.5,
      this._tipPos.z + Math.cos(t * 1.5 + 1.5) * 0.8
    );
    u['uCP2'].value.copy(this._cp2a);

    // CP3 = tip returning to idle
    u['uCP3'].value.copy(this._tipPos);

    if (s.strikeProgress <= 0) {
      s.state = 'idle';
    }
  }

  /**
   * Set Bezier control points for idle sway directly on material uniforms.
   * CP1 stays at trunk top (rigid lower 1/3), sway only in upper 2/3.
   */
  private buildIdleCurve(s: TentacleState, base: Vector3, tip: Vector3, time: number): void {
    const u = s.material.uniforms;
    const trunkTopY = base.y + TRUNK_HEIGHT;

    // CP0 = base (fixed)
    u['uCP0'].value.copy(base);

    // CP1 = trunk top — no lateral sway, lower 1/3 stays perfectly rigid
    u['uCP1'].value.set(
      base.x,
      trunkTopY,
      base.z
    );

    // CP2 = mid-bend — independent motion creates sinuous S-curves
    u['uCP2'].value.set(
      base.x + (tip.x - base.x) * 0.3 + Math.sin(time * 1.3 + 3.14) * 1.8,
      trunkTopY + (tip.y - trunkTopY) * 0.4,
      base.z + (tip.z - base.z) * 0.3 + Math.cos(time * 1.1 + 2.5) * 1.5
    );

    // CP3 = tip
    u['uCP3'].value.copy(tip);
  }

  // =====================================================
  // LIFECYCLE
  // =====================================================

  remove(towerId: string): void {
    const s = this.tentacles.get(towerId);
    if (!s) return;
    this.scene.remove(s.mesh);
    s.material.dispose();
    this.tentacles.delete(towerId);
  }

  resetAllToIdle(): void {
    for (const s of this.tentacles.values()) {
      s.state = 'idle';
      s.strikeProgress = 0;
    }
  }

  clear(): void {
    for (const s of this.tentacles.values()) {
      this.scene.remove(s.mesh);
      s.material.dispose();
    }
    this.tentacles.clear();
  }

  dispose(): void {
    this.clear();
    if (this.sharedGeometry) {
      this.sharedGeometry.dispose();
      this.sharedGeometry = null;
    }
  }
}
