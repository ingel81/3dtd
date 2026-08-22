import {
  InstancedMesh,
  InstancedBufferAttribute,
  OctahedronGeometry,
  TorusGeometry,
  PlaneGeometry,
  ShaderMaterial,
  Matrix4,
  Vector3,
  Color,
  Camera,
  Group,
} from 'three';
import { createDiamondMaterial, createRingMaterial, createGroundGlowMaterial } from './marker-shaders';

const MAX_MARKERS = 8;
const MAX_RINGS = 8; // 2 per HQ marker, up to 4 HQs during transitions

interface MarkerEntry {
  id: string;
  type: 'hq' | 'spawn';
  diamondIndex: number;
  groundIndex: number;
  ringIndices: number[]; // 0 for spawn, 2 for HQ
  proxy: Group;
  position: Vector3;
  phaseOffset: number;
}

/**
 * GPU-instanced marker renderer.
 *
 * Manages 3 InstancedMesh objects for all HQ/spawn markers:
 * - Diamond bodies (holographic octahedron with Fresnel/scan line shader)
 * - Rings (torus with glow, HQ only)
 * - Ground glow discs (radial pulse projection)
 *
 * Produces 3 draw calls total (or fewer if no rings/ground needed).
 * Each marker also maintains a lightweight proxy Group for backward
 * compatibility with PathRouteService (reads marker.position.x/z).
 */
export class MarkerInstanceManager {
  // InstancedMesh objects
  private readonly diamondMesh: InstancedMesh;
  private readonly ringMesh: InstancedMesh;
  private readonly groundMesh: InstancedMesh;

  // Materials
  private readonly diamondMat: ShaderMaterial;
  private readonly ringMat: ShaderMaterial;
  private readonly groundMat: ShaderMaterial;

  // Diamond per-instance attributes
  private readonly dColorAttr: InstancedBufferAttribute;
  private readonly dGlowAttr: InstancedBufferAttribute;
  private readonly dRotSpeedAttr: InstancedBufferAttribute;
  private readonly dPhaseAttr: InstancedBufferAttribute;

  // Ring per-instance attributes
  private readonly rColorAttr: InstancedBufferAttribute;
  private readonly rTiltAttr: InstancedBufferAttribute;
  private readonly rRotSpeedAttr: InstancedBufferAttribute;
  private readonly rPhaseAttr: InstancedBufferAttribute;

  // Ground per-instance attributes
  private readonly gColorAttr: InstancedBufferAttribute;
  private readonly gPhaseAttr: InstancedBufferAttribute;

  // Tracking
  private markers = new Map<string, MarkerEntry>();
  private diamondFree: number[] = [];
  private ringFree: number[] = [];
  private groundFree: number[] = [];
  private diamondCount = 0;
  private ringCount = 0;
  private groundCount = 0;

  // Reusable temp objects
  private readonly tmpMatrix = new Matrix4();
  private readonly tmpVec = new Vector3();
  private readonly tmpColor = new Color();

  constructor(private readonly overlayGroup: Group) {
    // ── Diamond InstancedMesh ──
    const diamondGeom = new OctahedronGeometry(8, 0);
    diamondGeom.scale(1, 1.8, 1);
    this.diamondMat = createDiamondMaterial();

    this.dColorAttr = new InstancedBufferAttribute(new Float32Array(MAX_MARKERS * 3), 3);
    this.dGlowAttr = new InstancedBufferAttribute(new Float32Array(MAX_MARKERS), 1);
    this.dRotSpeedAttr = new InstancedBufferAttribute(new Float32Array(MAX_MARKERS), 1);
    this.dPhaseAttr = new InstancedBufferAttribute(new Float32Array(MAX_MARKERS), 1);

    diamondGeom.setAttribute('aColor', this.dColorAttr);
    diamondGeom.setAttribute('aGlowIntensity', this.dGlowAttr);
    diamondGeom.setAttribute('aRotationSpeed', this.dRotSpeedAttr);
    diamondGeom.setAttribute('aPhaseOffset', this.dPhaseAttr);

    this.diamondMesh = new InstancedMesh(diamondGeom, this.diamondMat, MAX_MARKERS);
    this.diamondMesh.count = 0;
    this.diamondMesh.frustumCulled = false;
    this.diamondMesh.renderOrder = 5;

    // ── Ring InstancedMesh ──
    const ringGeom = new TorusGeometry(14, 0.8, 8, 32);
    ringGeom.rotateX(Math.PI / 2); // Lay flat by default
    this.ringMat = createRingMaterial();

    this.rColorAttr = new InstancedBufferAttribute(new Float32Array(MAX_RINGS * 3), 3);
    this.rTiltAttr = new InstancedBufferAttribute(new Float32Array(MAX_RINGS), 1);
    this.rRotSpeedAttr = new InstancedBufferAttribute(new Float32Array(MAX_RINGS), 1);
    this.rPhaseAttr = new InstancedBufferAttribute(new Float32Array(MAX_RINGS), 1);

    ringGeom.setAttribute('aColor', this.rColorAttr);
    ringGeom.setAttribute('aTiltAngle', this.rTiltAttr);
    ringGeom.setAttribute('aRotationSpeed', this.rRotSpeedAttr);
    ringGeom.setAttribute('aPhaseOffset', this.rPhaseAttr);

    this.ringMesh = new InstancedMesh(ringGeom, this.ringMat, MAX_RINGS);
    this.ringMesh.count = 0;
    this.ringMesh.frustumCulled = false;
    this.ringMesh.renderOrder = 5;

    // ── Ground Glow InstancedMesh ──
    const groundGeom = new PlaneGeometry(30, 30);
    groundGeom.rotateX(-Math.PI / 2); // Lay flat
    this.groundMat = createGroundGlowMaterial();

    this.gColorAttr = new InstancedBufferAttribute(new Float32Array(MAX_MARKERS * 3), 3);
    this.gPhaseAttr = new InstancedBufferAttribute(new Float32Array(MAX_MARKERS), 1);

    groundGeom.setAttribute('aColor', this.gColorAttr);
    groundGeom.setAttribute('aPhaseOffset', this.gPhaseAttr);

    this.groundMesh = new InstancedMesh(groundGeom, this.groundMat, MAX_MARKERS);
    this.groundMesh.count = 0;
    this.groundMesh.frustumCulled = false;
    this.groundMesh.renderOrder = 4;

    // Init free indices (reversed for pop)
    for (let i = MAX_MARKERS - 1; i >= 0; i--) this.diamondFree.push(i);
    for (let i = MAX_RINGS - 1; i >= 0; i--) this.ringFree.push(i);
    for (let i = MAX_MARKERS - 1; i >= 0; i--) this.groundFree.push(i);

    // Zero out all rotation speeds so unused instances stay hidden at origin
    (this.dRotSpeedAttr.array as Float32Array).fill(0);
    (this.rRotSpeedAttr.array as Float32Array).fill(0);

    // Add to scene
    overlayGroup.add(this.diamondMesh);
    overlayGroup.add(this.ringMesh);
    overlayGroup.add(this.groundMesh);
  }

  /**
   * Add a marker. Returns a lightweight proxy Group for backward compatibility.
   */
  add(
    id: string,
    type: 'hq' | 'spawn',
    position: Vector3,
    color: number,
    glowIntensity: number,
    rotationSpeed: number,
  ): Group {
    // Remove existing marker with same id
    if (this.markers.has(id)) this.remove(id);

    const phaseOffset = Math.random() * Math.PI * 2;
    this.tmpColor.set(color);

    // ── Diamond instance ──
    const di = this.diamondFree.pop()!;
    this.tmpMatrix.makeTranslation(position.x, position.y, position.z);
    this.diamondMesh.setMatrixAt(di, this.tmpMatrix);

    this.dColorAttr.setXYZ(di, this.tmpColor.r, this.tmpColor.g, this.tmpColor.b);
    this.dGlowAttr.setX(di, glowIntensity);
    this.dRotSpeedAttr.setX(di, rotationSpeed);
    this.dPhaseAttr.setX(di, phaseOffset);
    this.markDiamondDirty();
    this.diamondCount = Math.max(this.diamondCount, di + 1);
    this.diamondMesh.count = this.diamondCount;

    // ── Ground glow instance ──
    const gi = this.groundFree.pop()!;
    // Ground disc sits at terrain level (Y = marker position - 30 offset, but we place at markerY - 28 to be slightly above terrain)
    this.tmpMatrix.makeTranslation(position.x, position.y - 28, position.z);
    this.groundMesh.setMatrixAt(gi, this.tmpMatrix);

    this.gColorAttr.setXYZ(gi, this.tmpColor.r, this.tmpColor.g, this.tmpColor.b);
    this.gPhaseAttr.setX(gi, phaseOffset);
    this.markGroundDirty();
    this.groundCount = Math.max(this.groundCount, gi + 1);
    this.groundMesh.count = this.groundCount;

    // ── Ring instances (HQ only) ──
    const ringIndices: number[] = [];
    if (type === 'hq') {
      // Ring 1: horizontal, moderate speed
      const ri1 = this.ringFree.pop()!;
      this.tmpMatrix.makeTranslation(position.x, position.y, position.z);
      this.ringMesh.setMatrixAt(ri1, this.tmpMatrix);
      this.rColorAttr.setXYZ(ri1, this.tmpColor.r, this.tmpColor.g, this.tmpColor.b);
      this.rTiltAttr.setX(ri1, 0); // No additional tilt
      this.rRotSpeedAttr.setX(ri1, 0.0008);
      this.rPhaseAttr.setX(ri1, phaseOffset);
      ringIndices.push(ri1);

      // Ring 2: tilted 30°, slower, slightly larger handled by shader
      const ri2 = this.ringFree.pop()!;
      this.tmpMatrix.makeTranslation(position.x, position.y, position.z);
      this.ringMesh.setMatrixAt(ri2, this.tmpMatrix);
      this.rColorAttr.setXYZ(ri2, this.tmpColor.r, this.tmpColor.g, this.tmpColor.b);
      this.rTiltAttr.setX(ri2, Math.PI / 6); // 30° tilt
      this.rRotSpeedAttr.setX(ri2, -0.0006);
      this.rPhaseAttr.setX(ri2, phaseOffset);
      ringIndices.push(ri2);

      this.markRingDirty();
      this.ringCount = Math.max(this.ringCount, Math.max(ri1, ri2) + 1);
      this.ringMesh.count = this.ringCount;
    }

    // ── Proxy Group ──
    const proxy = new Group();
    proxy.name = type === 'hq' ? 'baseMarker' : `spawnMarker_${id}`;
    proxy.position.copy(position);

    const entry: MarkerEntry = {
      id,
      type,
      diamondIndex: di,
      groundIndex: gi,
      ringIndices,
      proxy,
      position: position.clone(),
      phaseOffset,
    };
    this.markers.set(id, entry);

    return proxy;
  }

  /**
   * Remove a marker by id.
   */
  remove(id: string): void {
    const entry = this.markers.get(id);
    if (!entry) return;

    // Free diamond
    this.diamondFree.push(entry.diamondIndex);
    this.hideInstance(this.diamondMesh, entry.diamondIndex);
    this.dRotSpeedAttr.setX(entry.diamondIndex, 0);

    // Free ground
    this.groundFree.push(entry.groundIndex);
    this.hideInstance(this.groundMesh, entry.groundIndex);

    // Free rings
    for (const ri of entry.ringIndices) {
      this.ringFree.push(ri);
      this.hideInstance(this.ringMesh, ri);
      this.rRotSpeedAttr.setX(ri, 0);
    }

    this.markers.delete(id);
    this.recomputeCounts();
    this.markDiamondDirty();
    this.markRingDirty();
    this.markGroundDirty();
  }

  /**
   * Current position of a marker, or null if it does not exist.
   * Lets callers keep a marker where it is when a fresh terrain sample is
   * not available instead of dropping it to a bare offset.
   */
  getPosition(id: string): Vector3 | null {
    return this.markers.get(id)?.position ?? null;
  }

  /**
   * Update position for a marker (e.g., terrain height change).
   */
  updatePosition(id: string, position: Vector3): void {
    const entry = this.markers.get(id);
    if (!entry) return;

    entry.position.copy(position);
    entry.proxy.position.copy(position);

    // Update diamond
    this.tmpMatrix.makeTranslation(position.x, position.y, position.z);
    this.diamondMesh.setMatrixAt(entry.diamondIndex, this.tmpMatrix);

    // Update ground (slightly below marker)
    this.tmpMatrix.makeTranslation(position.x, position.y - 28, position.z);
    this.groundMesh.setMatrixAt(entry.groundIndex, this.tmpMatrix);

    // Update rings
    this.tmpMatrix.makeTranslation(position.x, position.y, position.z);
    for (const ri of entry.ringIndices) {
      this.ringMesh.setMatrixAt(ri, this.tmpMatrix);
    }

    this.diamondMesh.instanceMatrix.needsUpdate = true;
    this.groundMesh.instanceMatrix.needsUpdate = true;
    if (entry.ringIndices.length > 0) {
      this.ringMesh.instanceMatrix.needsUpdate = true;
    }
  }

  /**
   * Per-frame update: sync proxy positions, update shader uniforms.
   * Returns IDs of markers whose proxy position changed (for label sync).
   */
  update(camera: Camera): string[] {
    if (this.markers.size === 0) return [];

    const now = performance.now() / 1000;
    const changedIds: string[] = [];

    // Sync proxy positions → instance matrices (PathRouteService may have changed them)
    for (const entry of this.markers.values()) {
      const p = entry.proxy.position;
      if (p.x !== entry.position.x || p.y !== entry.position.y || p.z !== entry.position.z) {
        this.updatePosition(entry.id, p);
        changedIds.push(entry.id);
      }
    }

    // Update shared uniforms
    const camPos = camera.getWorldPosition(this.tmpVec);

    this.diamondMat.uniforms['uTime'].value = now;
    this.diamondMat.uniforms['uCameraPos'].value.copy(camPos);

    this.ringMat.uniforms['uTime'].value = now;
    this.ringMat.uniforms['uCameraPos'].value.copy(camPos);

    this.groundMat.uniforms['uTime'].value = now;

    return changedIds;
  }

  /**
   * Get proxy group for a specific marker.
   */
  getProxy(id: string): Group | null {
    return this.markers.get(id)?.proxy ?? null;
  }

  /**
   * Get all spawn marker proxy groups (excludes HQ).
   */
  getAllSpawnProxies(): Group[] {
    const result: Group[] = [];
    for (const entry of this.markers.values()) {
      if (entry.type === 'spawn') result.push(entry.proxy);
    }
    return result;
  }

  /**
   * Get base marker proxy.
   */
  getBaseProxy(): Group | null {
    for (const entry of this.markers.values()) {
      if (entry.type === 'hq') return entry.proxy;
    }
    return null;
  }

  /**
   * Clear all markers.
   */
  clear(): void {
    for (const id of [...this.markers.keys()]) {
      this.remove(id);
    }
  }

  /**
   * Dispose all GPU resources.
   */
  dispose(): void {
    this.clear();
    this.overlayGroup.remove(this.diamondMesh);
    this.overlayGroup.remove(this.ringMesh);
    this.overlayGroup.remove(this.groundMesh);
    this.diamondMesh.geometry.dispose();
    this.ringMesh.geometry.dispose();
    this.groundMesh.geometry.dispose();
    this.diamondMat.dispose();
    this.ringMat.dispose();
    this.groundMat.dispose();
  }

  // ── Private helpers ──

  private hideInstance(mesh: InstancedMesh, index: number): void {
    // Move to far away to hide
    this.tmpMatrix.makeTranslation(0, -99999, 0);
    mesh.setMatrixAt(index, this.tmpMatrix);
    mesh.instanceMatrix.needsUpdate = true;
  }

  private recomputeCounts(): void {
    this.diamondCount = 0;
    this.ringCount = 0;
    this.groundCount = 0;
    for (const entry of this.markers.values()) {
      this.diamondCount = Math.max(this.diamondCount, entry.diamondIndex + 1);
      this.groundCount = Math.max(this.groundCount, entry.groundIndex + 1);
      for (const ri of entry.ringIndices) {
        this.ringCount = Math.max(this.ringCount, ri + 1);
      }
    }
    this.diamondMesh.count = this.diamondCount;
    this.ringMesh.count = this.ringCount;
    this.groundMesh.count = this.groundCount;
  }

  private markDiamondDirty(): void {
    this.diamondMesh.instanceMatrix.needsUpdate = true;
    this.dColorAttr.needsUpdate = true;
    this.dGlowAttr.needsUpdate = true;
    this.dRotSpeedAttr.needsUpdate = true;
    this.dPhaseAttr.needsUpdate = true;
  }

  private markRingDirty(): void {
    this.ringMesh.instanceMatrix.needsUpdate = true;
    this.rColorAttr.needsUpdate = true;
    this.rTiltAttr.needsUpdate = true;
    this.rRotSpeedAttr.needsUpdate = true;
    this.rPhaseAttr.needsUpdate = true;
  }

  private markGroundDirty(): void {
    this.groundMesh.instanceMatrix.needsUpdate = true;
    this.gColorAttr.needsUpdate = true;
    this.gPhaseAttr.needsUpdate = true;
  }
}
