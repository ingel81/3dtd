import {
  InstancedMesh,
  InstancedBufferAttribute,
  ShaderMaterial,
  Matrix4,
  Vector3,
  Color,
  Group,
} from 'three';
import { createPortalEnergyMaterial, createPortalFrameMaterial } from './marker-shaders';
import {
  createPortalEnergyGeometry,
  createPortalFrameGeometry,
  PORTAL_ENERGY_LAYOUT,
} from './spawn-portal-geometry';
import type { SpawnPortalPose } from './spawn-portal-pose';
import { SPAWN_PORTAL_LOOK } from '../../../configs/visual-effects.config';

const MAX_PORTALS = 8;

interface PortalEntry {
  index: number;
  pose: SpawnPortalPose;
}

/**
 * GPU-instanced spawn portals: a stone gate on the route start, facing the
 * way the enemies walk, with a swirling surface in the spawn's colour.
 * Two draw calls for all portals:
 * - frame: opaque blocks with emissive runes and the portal's light on
 *   the faces around the opening
 * - energy: the swirling surface, whose dark void hides the street behind
 *   the portal, and the light it throws on the street in front
 *
 * Runs on wall time like the HQ marker, so the portal keeps swirling while
 * the game is paused. All glow is emissive: the Photorealistic Tiles take
 * no scene light.
 */
export class SpawnPortalManager {
  private readonly frameMesh: InstancedMesh;
  private readonly energyMesh: InstancedMesh;
  private readonly frameMat: ShaderMaterial;
  private readonly energyMat: ShaderMaterial;

  // Per-instance attributes, shared by both meshes
  private readonly colorAttr: InstancedBufferAttribute;
  private readonly phaseAttr: InstancedBufferAttribute;

  private readonly portals = new Map<string, PortalEntry>();
  private readonly freeIndices: number[] = [];

  private readonly tmpMatrix = new Matrix4();
  private readonly tmpScale = new Vector3();
  private readonly tmpColor = new Color();

  constructor(private readonly overlayGroup: Group) {
    this.colorAttr = new InstancedBufferAttribute(new Float32Array(MAX_PORTALS * 3), 3);
    this.phaseAttr = new InstancedBufferAttribute(new Float32Array(MAX_PORTALS), 1);

    const frameGeom = createPortalFrameGeometry();
    frameGeom.setAttribute('aColor', this.colorAttr);
    frameGeom.setAttribute('aPhase', this.phaseAttr);
    this.frameMat = createPortalFrameMaterial(PORTAL_ENERGY_LAYOUT, SPAWN_PORTAL_LOOK.idleEnergy);
    this.frameMesh = new InstancedMesh(frameGeom, this.frameMat, MAX_PORTALS);
    this.frameMesh.count = 0;
    this.frameMesh.frustumCulled = false;
    this.frameMesh.name = 'spawnPortalFrames';

    const energyGeom = createPortalEnergyGeometry();
    energyGeom.setAttribute('aColor', this.colorAttr);
    energyGeom.setAttribute('aPhase', this.phaseAttr);
    this.energyMat = createPortalEnergyMaterial(PORTAL_ENERGY_LAYOUT, SPAWN_PORTAL_LOOK.idleEnergy);
    this.energyMesh = new InstancedMesh(energyGeom, this.energyMat, MAX_PORTALS);
    this.energyMesh.count = 0;
    this.energyMesh.frustumCulled = false;
    this.energyMesh.renderOrder = 5;
    this.energyMesh.name = 'spawnPortalEnergy';

    for (let i = MAX_PORTALS - 1; i >= 0; i--) this.freeIndices.push(i);

    overlayGroup.add(this.frameMesh);
    overlayGroup.add(this.energyMesh);
  }

  /** Add a portal, or replace the one with the same id. */
  add(id: string, pose: SpawnPortalPose, color: number): void {
    if (this.portals.has(id)) this.remove(id);
    const index = this.freeIndices.pop();
    if (index === undefined) {
      console.warn(`[SpawnPortals] No free slot for ${id} (max ${MAX_PORTALS})`);
      return;
    }

    this.tmpColor.set(color);
    this.colorAttr.setXYZ(index, this.tmpColor.r, this.tmpColor.g, this.tmpColor.b);
    // Golden-angle spread: portals side by side do not swirl in step
    this.phaseAttr.setX(index, (index * 2.39996) % (Math.PI * 2));
    this.colorAttr.needsUpdate = true;
    this.phaseAttr.needsUpdate = true;

    this.portals.set(id, { index, pose: { ...pose } });
    this.writeMatrix(index, pose);
    this.recount();
  }

  /** Move a portal, e.g. onto the start of its freshly built route. */
  setPose(id: string, pose: SpawnPortalPose): void {
    const entry = this.portals.get(id);
    if (!entry) return;
    entry.pose = { ...pose };
    this.writeMatrix(entry.index, pose);
  }

  /** Current pose of a portal, or null if there is none with that id. */
  getPose(id: string): Readonly<SpawnPortalPose> | null {
    return this.portals.get(id)?.pose ?? null;
  }

  has(id: string): boolean {
    return this.portals.has(id);
  }

  /** Ids of all portals. */
  ids(): IterableIterator<string> {
    return this.portals.keys();
  }

  remove(id: string): void {
    const entry = this.portals.get(id);
    if (!entry) return;
    this.tmpMatrix.makeTranslation(0, -99999, 0);
    this.frameMesh.setMatrixAt(entry.index, this.tmpMatrix);
    this.energyMesh.setMatrixAt(entry.index, this.tmpMatrix);
    this.frameMesh.instanceMatrix.needsUpdate = true;
    this.energyMesh.instanceMatrix.needsUpdate = true;
    this.freeIndices.push(entry.index);
    this.portals.delete(id);
    this.recount();
  }

  clear(): void {
    for (const id of [...this.portals.keys()]) this.remove(id);
  }

  /** Per-frame update of the shader clock (wall time, ms). */
  update(nowMs: number): void {
    if (this.portals.size === 0) return;
    const time = nowMs / 1000;
    this.frameMat.uniforms['uTime'].value = time;
    this.energyMat.uniforms['uTime'].value = time;
  }

  dispose(): void {
    this.clear();
    this.overlayGroup.remove(this.frameMesh);
    this.overlayGroup.remove(this.energyMesh);
    this.frameMesh.geometry.dispose();
    this.energyMesh.geometry.dispose();
    this.frameMat.dispose();
    this.energyMat.dispose();
  }

  private writeMatrix(index: number, pose: SpawnPortalPose): void {
    this.tmpMatrix.makeRotationY(pose.heading);
    this.tmpMatrix.scale(this.tmpScale.setScalar(pose.scale));
    this.tmpMatrix.setPosition(pose.x, pose.y, pose.z);
    this.frameMesh.setMatrixAt(index, this.tmpMatrix);
    this.energyMesh.setMatrixAt(index, this.tmpMatrix);
    this.frameMesh.instanceMatrix.needsUpdate = true;
    this.energyMesh.instanceMatrix.needsUpdate = true;
  }

  private recount(): void {
    let count = 0;
    for (const entry of this.portals.values()) count = Math.max(count, entry.index + 1);
    this.frameMesh.count = count;
    this.energyMesh.count = count;
  }
}
