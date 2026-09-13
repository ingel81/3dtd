import {
  BufferGeometry,
  InstancedMesh,
  InstancedBufferAttribute,
  ShaderMaterial,
  Matrix4,
  Vector3,
  Color,
  Group,
} from 'three';
import { createPortalGateMaterial, createPortalGlowMaterial, setPortalGateTextures } from './marker-shaders';
import {
  createPortalGateGeometry,
  createPortalGlowGeometry,
  PORTAL_SHADER_LAYOUT,
} from './spawn-portal-geometry';
import type { SpawnPortalFrame } from './spawn-portal-frame';
import type { SpawnPortalPose } from './spawn-portal-pose';
import { SPAWN_PORTAL_LOOK } from '../../../configs/visual-effects.config';
import { portalDepthScale } from '../../../configs/marker-geometry.config';

const MAX_PORTALS = 8;

/** Per-instance attributes both meshes share. */
const INSTANCE_ATTRIBUTES = ['aColor', 'aPhase', 'aRipple'] as const;

/** Ripple start far in the past: no ripple until the first burst. */
const NO_RIPPLE = -1e4;

interface PortalEntry {
  index: number;
  pose: SpawnPortalPose;
  /** Wall time (ms) from which the portal takes its next burst. */
  nextBurstMs: number;
}

/**
 * GPU-instanced spawn portals: a stone gate on the route start, facing the
 * way the enemies walk, with a swirling surface in the spawn's colour.
 * Two draw calls for all portals:
 * - gate: the stone frame (its asset, see setFrame) with the portal's
 *   light on the faces round the opening and its carved sigils glowing,
 *   and the void, a surface in front of the portal's volume and one behind
 *   it. The void writes depth: the enemies appear between the two and stay
 *   hidden until they step out through the front.
 * - glow: the light the portal throws on the street in front, and the
 *   summoning circle on it
 *
 * The energy (glow, swirl speed) follows the waves: idle between them, a
 * surge at wave start, the wave's level while it runs (startWave/endWave).
 * When enemies step through, a ripple runs over the surface and the
 * street, at most once per burst interval per portal (tryBurst).
 * Runs on wall time like the HQ marker, so the portal keeps swirling while
 * the game is paused. All glow is emissive: the Photorealistic Tiles take
 * no scene light.
 */
export class SpawnPortalManager {
  private readonly gateMesh: InstancedMesh;
  private readonly glowMesh: InstancedMesh;
  private readonly gateMat: ShaderMaterial;
  private readonly glowMat: ShaderMaterial;

  // Per-instance attributes, shared by both meshes
  private readonly colorAttr: InstancedBufferAttribute;
  private readonly phaseAttr: InstancedBufferAttribute;
  /** Wall time (s) of each portal's last spawn burst */
  private readonly rippleAttr: InstancedBufferAttribute;

  private readonly portals = new Map<string, PortalEntry>();
  private readonly freeIndices: number[] = [];
  private earliestBurstMs = Infinity;

  // Energy: idle between waves, higher while one runs, a surge at its start
  private waveActive = false;
  private settledEnergy: number = SPAWN_PORTAL_LOOK.idleEnergy;
  private energy: number = SPAWN_PORTAL_LOOK.idleEnergy;
  private surgeAtMs = -Infinity;
  private lastUpdateMs: number | null = null;

  private readonly tmpMatrix = new Matrix4();
  private readonly tmpScale = new Vector3();
  private readonly tmpColor = new Color();

  constructor(private readonly overlayGroup: Group) {
    this.colorAttr = new InstancedBufferAttribute(new Float32Array(MAX_PORTALS * 3), 3);
    this.phaseAttr = new InstancedBufferAttribute(new Float32Array(MAX_PORTALS), 1);
    this.rippleAttr = new InstancedBufferAttribute(new Float32Array(MAX_PORTALS).fill(NO_RIPPLE), 1);

    const look = SPAWN_PORTAL_LOOK;
    // The two void surfaces until the frame's asset arrives (setFrame)
    const gateGeom = createPortalGateGeometry(null);
    this.shareInstanceAttributes(gateGeom);
    this.gateMat = createPortalGateMaterial(
      PORTAL_SHADER_LAYOUT, look.palette, look.frameExposure, look.frameGlints, look.idleEnergy, look.rippleLife,
    );
    this.gateMesh = new InstancedMesh(gateGeom, this.gateMat, MAX_PORTALS);
    this.gateMesh.count = 0;
    this.gateMesh.frustumCulled = false;
    this.gateMesh.name = 'spawnPortalGates';

    const glowGeom = createPortalGlowGeometry();
    this.shareInstanceAttributes(glowGeom);
    this.glowMat = createPortalGlowMaterial(
      PORTAL_SHADER_LAYOUT, look.palette, look.idleEnergy, look.rippleLife, look.circle, look,
    );
    this.glowMesh = new InstancedMesh(glowGeom, this.glowMat, MAX_PORTALS);
    this.glowMesh.count = 0;
    this.glowMesh.frustumCulled = false;
    this.glowMesh.renderOrder = 5;
    this.glowMesh.name = 'spawnPortalGlow';

    for (let i = MAX_PORTALS - 1; i >= 0; i--) this.freeIndices.push(i);

    overlayGroup.add(this.gateMesh);
    overlayGroup.add(this.glowMesh);
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
    this.rippleAttr.setX(index, NO_RIPPLE);
    this.colorAttr.needsUpdate = true;
    this.phaseAttr.needsUpdate = true;
    this.rippleAttr.needsUpdate = true;

    this.portals.set(id, { index, pose: { ...pose }, nextBurstMs: 0 });
    this.writeMatrix(index, pose);
    this.recount();
    this.updateBurstReady();
  }

  /**
   * Give the gates their stone frame, from its asset (see
   * MarkerVisualizationService); until then they stand as the two void
   * surfaces. The frame stays the caller's: the gate takes a copy of its
   * geometry, and dispose() leaves its textures alone.
   */
  setFrame(frame: SpawnPortalFrame): void {
    const geometry = createPortalGateGeometry(frame.geometry);
    this.shareInstanceAttributes(geometry);
    const old = this.gateMesh.geometry;
    // Disposing frees the buffers of every attribute on the geometry: the
    // shared ones come off first, the glow still draws with them
    for (const name of INSTANCE_ATTRIBUTES) old.deleteAttribute(name);
    old.dispose();
    this.gateMesh.geometry = geometry;
    setPortalGateTextures(this.gateMat, frame);
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
    this.gateMesh.setMatrixAt(entry.index, this.tmpMatrix);
    this.glowMesh.setMatrixAt(entry.index, this.tmpMatrix);
    this.gateMesh.instanceMatrix.needsUpdate = true;
    this.glowMesh.instanceMatrix.needsUpdate = true;
    this.freeIndices.push(entry.index);
    this.portals.delete(id);
    this.recount();
    this.updateBurstReady();
  }

  clear(): void {
    for (const id of [...this.portals.keys()]) this.remove(id);
  }

  /** The portal whose centre lies nearest to (x, z) within `maxDistance`, or null. */
  portalNear(x: number, z: number, maxDistance: number): string | null {
    let nearest: string | null = null;
    let nearestSq = maxDistance * maxDistance;
    for (const [id, entry] of this.portals) {
      const dx = entry.pose.x - x;
      const dz = entry.pose.z - z;
      const distSq = dx * dx + dz * dz;
      if (distSq <= nearestSq) {
        nearest = id;
        nearestSq = distSq;
      }
    }
    return nearest;
  }

  /**
   * Ripple a portal's surface unless it burst within the last
   * SPAWN_PORTAL_LOOK.burstIntervalMs. Returns whether it did; the caller
   * throws the sparks only then.
   */
  tryBurst(id: string, nowMs: number): boolean {
    const entry = this.portals.get(id);
    if (!entry || nowMs < entry.nextBurstMs) return false;
    entry.nextBurstMs = nowMs + SPAWN_PORTAL_LOOK.burstIntervalMs;
    this.rippleAttr.setX(entry.index, nowMs / 1000);
    this.rippleAttr.needsUpdate = true;
    this.updateBurstReady();
    return true;
  }

  /**
   * Wall time (ms) before which no portal takes a burst, Infinity without
   * portals. Lets a caller skip everything else for the enemies of a wave
   * that come through while every portal is still waiting.
   */
  get burstReadyMs(): number {
    return this.earliestBurstMs;
  }

  /** A wave starts: surge, then hold the wave energy until endWave(). */
  startWave(nowMs: number): void {
    this.waveActive = true;
    this.surgeAtMs = nowMs;
  }

  /** The wave (or the game) is over: settle back to idle. */
  endWave(): void {
    this.waveActive = false;
  }

  /** Energy handed to the shaders by the last update. */
  get energyLevel(): number {
    return this.energy;
  }

  /** Per-frame update of the energy and the shader clock (wall time, ms). */
  update(nowMs: number): void {
    const look = SPAWN_PORTAL_LOOK;
    // A hitch or a hidden tab must not jump the settling
    const dt = this.lastUpdateMs === null ? 0 : Math.min(Math.max(nowMs - this.lastUpdateMs, 0), 250) / 1000;
    this.lastUpdateMs = nowMs;
    const target = this.waveActive ? look.waveEnergy : look.idleEnergy;
    this.settledEnergy += (target - this.settledEnergy) * (1 - Math.exp(-dt / look.settle));
    const sinceSurge = (nowMs - this.surgeAtMs) / 1000;
    const surge = sinceSurge >= 0 ? look.surge * Math.exp(-sinceSurge / look.surgeDecay) : 0;
    this.energy = this.settledEnergy + surge;

    if (this.portals.size === 0) return;
    const time = nowMs / 1000;
    this.gateMat.uniforms['uTime'].value = time;
    this.gateMat.uniforms['uEnergy'].value = this.energy;
    this.glowMat.uniforms['uTime'].value = time;
    this.glowMat.uniforms['uEnergy'].value = this.energy;
  }

  dispose(): void {
    this.clear();
    this.overlayGroup.remove(this.gateMesh);
    this.overlayGroup.remove(this.glowMesh);
    this.gateMesh.geometry.dispose();
    this.glowMesh.geometry.dispose();
    this.gateMat.dispose();
    this.glowMat.dispose();
  }

  private shareInstanceAttributes(geometry: BufferGeometry): void {
    geometry.setAttribute('aColor', this.colorAttr);
    geometry.setAttribute('aPhase', this.phaseAttr);
    geometry.setAttribute('aRipple', this.rippleAttr);
  }

  private writeMatrix(index: number, pose: SpawnPortalPose): void {
    this.tmpMatrix.makeRotationY(pose.heading);
    this.tmpMatrix.scale(this.tmpScale.set(pose.scale, pose.scale, portalDepthScale(pose.scale)));
    this.tmpMatrix.setPosition(pose.x, pose.y, pose.z);
    this.gateMesh.setMatrixAt(index, this.tmpMatrix);
    this.glowMesh.setMatrixAt(index, this.tmpMatrix);
    this.gateMesh.instanceMatrix.needsUpdate = true;
    this.glowMesh.instanceMatrix.needsUpdate = true;
  }

  private updateBurstReady(): void {
    let earliest = Infinity;
    for (const entry of this.portals.values()) earliest = Math.min(earliest, entry.nextBurstMs);
    this.earliestBurstMs = earliest;
  }

  private recount(): void {
    let count = 0;
    for (const entry of this.portals.values()) count = Math.max(count, entry.index + 1);
    this.gateMesh.count = count;
    this.glowMesh.count = count;
  }
}
