/**
 * Lightning Bolt Renderer
 *
 * Pool of jagged, glowing electric bolts between two world-space endpoints.
 * Used by the Lightning Tower for both chain-hit visuals and the continuous
 * idle-crackle at the tower's tip.
 *
 * Every bolt is one instance of a single static quad strip: one Mesh over an
 * InstancedBufferGeometry, one ShaderMaterial, one draw call for the whole
 * pool. The vertex shader builds each bolt from its per-instance data
 * (endpoints, spawn time, lifetime, seed, width, jaggedness, intensity) and
 * the shared uTime clock, so per-frame work is one uniform write plus, when
 * bolts spawned, one upload of the drawn slice.
 *
 * A plain Mesh, not an InstancedMesh: the shader never reads instanceMatrix
 * (same reasoning as HealthBarInstanceManager). Slots come from the
 * InstanceSlotAllocator, geometry.instanceCount is the draw count.
 */

import {
  AdditiveBlending,
  BufferAttribute,
  CanvasTexture,
  Color,
  DoubleSide,
  InstancedBufferGeometry,
  InstancedInterleavedBuffer,
  InterleavedBufferAttribute,
  Mesh,
  Scene,
  ShaderMaterial,
  Sprite,
  SpriteMaterial,
  Vector3,
} from 'three';
import { LIGHTNING_BOLT_VERTEX, LIGHTNING_BOLT_FRAGMENT } from './lightning-bolt-shaders';
import { InstanceSlotAllocator } from './instance-slot-allocator';
import { DrawGate } from './draw-gate';

// ─── Bolt spawn options ─────────────────────────────────────────────

export interface BoltOptions {
  /** Visible lifetime in seconds (default 0.25). */
  lifetime?: number;
  /** Half-width at the spine (default 0.45). */
  width?: number;
  /** Perpendicular noise amplitude in meters (default 0.9). */
  jaggedness?: number;
  /** Overall brightness multiplier (default 1.0). */
  intensity?: number;
  /**
   * If true, attach a pooled additive billboard halo at the bolt's end. The
   * halo paints brightness on top of whatever is behind it (tiles, buildings,
   * ground, enemies) regardless of material. Google Photorealistic 3D Tiles
   * ignore dynamic Three.js lights, so an additive overlay is the only way
   * to brighten the local environment at the impact point.
   */
  attachLight?: boolean;
  /** Peak halo opacity at spawn (default 1.2, additive, can exceed 1). */
  lightIntensity?: number;
  /** Halo diameter in meters (default 22). */
  lightDistance?: number;
}

// ─── Constants ──────────────────────────────────────────────────────

const SEGMENTS = 28;          // 28 quads, fine subdivision for the high-frequency jagged noise
const SPINE_POINTS = SEGMENTS + 1;
const VERT_COUNT = SPINE_POINTS * 2;
const INDEX_COUNT = SEGMENTS * 6;

/**
 * Per-instance layout of the interleaved buffer, in floats. A bolt's fields
 * are all written together on spawn, so they share one GPU buffer and one
 * upload range.
 */
const STRIDE = 12;
const OFFSET_START = 0;   // aStart  vec3
const OFFSET_END = 3;     // aEnd    vec3
const OFFSET_TIMING = 6;  // aTiming vec2: spawn time, lifetime
const OFFSET_SHAPE = 8;   // aShape  vec4: seed, half-width, jaggedness, intensity

const COLOR_CORE = new Color(0.78, 0.92, 1.0);   // slightly blue-tinted white core
const COLOR_OUTER = new Color(0.18, 0.42, 1.0);  // deep saturated electric blue
const HALO_COLOR = 0xb8d8ff;                     // electric blue-white tint for impact halos
const HALO_POOL_SIZE = 16;

/**
 * Build a 128×128 radial-gradient texture used as the halo sprite map.
 * Center is fully white, fading to fully transparent at the edge with a
 * slight cyan bias mid-gradient for an "electric" feel.
 */
function createHaloTexture(): CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0.00, 'rgba(255, 255, 255, 1.0)');
    grad.addColorStop(0.25, 'rgba(200, 230, 255, 0.55)');
    grad.addColorStop(0.60, 'rgba(120, 170, 255, 0.18)');
    grad.addColorStop(1.00, 'rgba(60,  100, 255, 0.0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
  }
  const tex = new CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

/**
 * The static quad strip every bolt is an instance of. Positions are dummies
 * because the vertex shader computes them from the instance endpoints, but
 * the attribute still needs to exist for WebGL.
 */
function createStripGeometry(): InstancedBufferGeometry {
  const positions = new Float32Array(VERT_COUNT * 3);
  const segmentT = new Float32Array(VERT_COUNT);
  const side = new Float32Array(VERT_COUNT);
  const indices = new Uint16Array(INDEX_COUNT);

  for (let i = 0; i < SPINE_POINTS; i++) {
    const t = i / SEGMENTS;
    segmentT[i * 2] = t;
    segmentT[i * 2 + 1] = t;
    side[i * 2] = +1;
    side[i * 2 + 1] = -1;
  }

  for (let q = 0; q < SEGMENTS; q++) {
    const base = q * 2;
    const off = q * 6;
    indices[off + 0] = base + 0;
    indices[off + 1] = base + 1;
    indices[off + 2] = base + 2;
    indices[off + 3] = base + 1;
    indices[off + 4] = base + 3;
    indices[off + 5] = base + 2;
  }

  const geometry = new InstancedBufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('aSegmentT', new BufferAttribute(segmentT, 1));
  geometry.setAttribute('aSide', new BufferAttribute(side, 1));
  geometry.setIndex(new BufferAttribute(indices, 1));
  geometry.instanceCount = 0;
  return geometry;
}

// ─── Idle-crackle emitter (per tower) ───────────────────────────────

interface IdleEmitter {
  tipPos: Vector3;
  nextSpawnTime: number;
  scratchStart: Vector3;
  scratchEnd: Vector3;
}

const IDLE_OPTS: BoltOptions = {
  lifetime: 0.18,
  width: 0.18,
  jaggedness: 0.55,    // up from 0.18: visibly crackly micro-bolts
  intensity: 1.8,      // up from 0.55: clearly bright against sky
};
const IDLE_MIN_INTERVAL = 0.025;   // up to 40 Hz spawn rate (was ~5-12 Hz)
const IDLE_MAX_INTERVAL = 0.06;
const IDLE_JITTER_INNER = 0.6;     // larger inner cloud
const IDLE_JITTER_OUTER = 1.6;     // bigger reach beyond tip
const IDLE_BOLTS_PER_TICK = 2;     // spawn 2 micro-bolts each interval, denser crackle

// ─── Renderer / Pool ────────────────────────────────────────────────

export class LightningBoltRenderer {
  private readonly scene: Scene;
  private readonly mesh: Mesh;
  private readonly geometry: InstancedBufferGeometry;
  private readonly material: ShaderMaterial;
  private readonly slots: InstanceSlotAllocator;
  /** Hides the mesh while no bolt is alive (R6). */
  private readonly gate: DrawGate;

  /** Per-instance data of all slots, STRIDE floats each (see OFFSET_*). */
  private readonly data: Float32Array;
  /** GPU buffer over `data`, read by aStart / aEnd / aTiming / aShape. */
  private readonly instanceData: InstancedInterleavedBuffer;
  /** Bolt data written since the last flush. */
  private dirty = false;

  // CPU copy of each slot's timing in double precision. Drives expiry and
  // the halo fade exactly as the old per-bolt uniforms did.
  private readonly spawnTimes: Float64Array;
  private readonly lifetimes: Float64Array;
  // Pooled halo following the slot's bolt, -1 = none attached.
  private readonly haloIndices: Int32Array;
  private readonly haloPeaks: Float64Array;

  /**
   * Slots holding a live bolt. A Set iterates in insertion order and a slot
   * is added on every spawn, so the first entry is always the oldest bolt
   * (the one stolen when the pool is exhausted).
   */
  private readonly activeSlots = new Set<number>();
  private readonly idleEmitters = new Map<string, IdleEmitter>();

  private readonly uniforms = {
    uTime: { value: 0 },
    uColorCore: { value: COLOR_CORE.clone() },
    uColorOuter: { value: COLOR_OUTER.clone() },
  };

  // Local-scope halo sprite pool. Additive-blended billboards that paint
  // brightness on top of whatever the camera sees behind them; works on
  // Photorealistic 3D Tiles where dynamic lights have no visible effect.
  private readonly haloTexture: CanvasTexture;
  private readonly haloPool: Sprite[] = [];
  private readonly haloFreeIndices: number[] = [];

  constructor(scene: Scene, poolSize = 192) {
    this.scene = scene;
    this.slots = new InstanceSlotAllocator(poolSize);
    this.spawnTimes = new Float64Array(poolSize);
    this.lifetimes = new Float64Array(poolSize);
    this.haloIndices = new Int32Array(poolSize).fill(-1);
    this.haloPeaks = new Float64Array(poolSize);

    this.geometry = createStripGeometry();
    this.data = new Float32Array(poolSize * STRIDE);
    this.instanceData = new InstancedInterleavedBuffer(this.data, STRIDE);
    this.geometry.setAttribute('aStart', new InterleavedBufferAttribute(this.instanceData, 3, OFFSET_START));
    this.geometry.setAttribute('aEnd', new InterleavedBufferAttribute(this.instanceData, 3, OFFSET_END));
    this.geometry.setAttribute('aTiming', new InterleavedBufferAttribute(this.instanceData, 2, OFFSET_TIMING));
    this.geometry.setAttribute('aShape', new InterleavedBufferAttribute(this.instanceData, 4, OFFSET_SHAPE));

    this.material = new ShaderMaterial({
      vertexShader: LIGHTNING_BOLT_VERTEX,
      fragmentShader: LIGHTNING_BOLT_FRAGMENT,
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
    });

    this.mesh = new Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false; // verts come from the shader, the geometry bounds are the origin
    this.mesh.renderOrder = 1001;
    // R1: the geometry is generated in the vertex shader from the instance
    // endpoints, the mesh root never moves (stays at identity). Compute the
    // world matrix once and opt out of the per-frame matrix pass.
    this.mesh.updateMatrix();
    this.mesh.updateMatrixWorld(true);
    this.mesh.matrixAutoUpdate = false;
    this.mesh.matrixWorldAutoUpdate = false;
    this.gate = new DrawGate([this.mesh]);
    scene.add(this.mesh);

    this.haloTexture = createHaloTexture();
    for (let i = 0; i < HALO_POOL_SIZE; i++) {
      const mat = new SpriteMaterial({
        map: this.haloTexture,
        color: HALO_COLOR,
        blending: AdditiveBlending,
        depthWrite: false,
        transparent: true,
        opacity: 0,
      });
      const sprite = new Sprite(mat);
      sprite.scale.set(22, 22, 1);
      sprite.visible = false;
      sprite.renderOrder = 1000;
      scene.add(sprite);
      this.haloPool.push(sprite);
      this.haloFreeIndices.push(i);
    }
  }

  /**
   * Spawn a one-shot bolt between two world-space points.
   * Falls back to stealing the oldest active bolt if the pool is exhausted.
   */
  spawnBolt(start: Vector3, end: Vector3, now: number, opts: BoltOptions = {}): void {
    let slot = this.slots.alloc();
    if (slot < 0) {
      const oldest = this.activeSlots.values().next();
      if (oldest.done) return;
      this.releaseBolt(oldest.value);
      slot = this.slots.alloc();
    }

    const lifetime = opts.lifetime ?? 0.25;
    const data = this.data;
    const o = slot * STRIDE;
    data[o + OFFSET_START] = start.x;
    data[o + OFFSET_START + 1] = start.y;
    data[o + OFFSET_START + 2] = start.z;
    data[o + OFFSET_END] = end.x;
    data[o + OFFSET_END + 1] = end.y;
    data[o + OFFSET_END + 2] = end.z;
    data[o + OFFSET_TIMING] = now;
    data[o + OFFSET_TIMING + 1] = lifetime;
    data[o + OFFSET_SHAPE] = Math.random() * 100;
    data[o + OFFSET_SHAPE + 1] = opts.width ?? 0.45;
    data[o + OFFSET_SHAPE + 2] = opts.jaggedness ?? 0.9;
    data[o + OFFSET_SHAPE + 3] = opts.intensity ?? 1.0;
    // Uploaded by the flush at the end of update(). A per-slot range here
    // would pile up while nothing renders (headless training keeps firing).
    this.dirty = true;

    this.spawnTimes[slot] = now;
    this.lifetimes[slot] = lifetime;
    this.activeSlots.add(slot);
    this.syncDrawCount();

    if (opts.attachLight) {
      const haloIdx = this.haloFreeIndices.pop();
      if (haloIdx !== undefined) {
        const halo = this.haloPool[haloIdx];
        const diameter = opts.lightDistance ?? 22;
        const peak = opts.lightIntensity ?? 1.2;
        halo.position.copy(end);
        halo.scale.set(diameter, diameter, 1);
        (halo.material as SpriteMaterial).opacity = peak;
        halo.visible = true;
        this.haloIndices[slot] = haloIdx;
        this.haloPeaks[slot] = peak;
      }
    }
  }

  /**
   * Register a lightning tower's tip for continuous idle-crackle. Mikro-bolts
   * spawn around the tip at random intervals while the tower is alive.
   */
  registerIdleCrackle(towerId: string, tipPos: Vector3, now: number): void {
    this.idleEmitters.set(towerId, {
      tipPos: tipPos.clone(),
      nextSpawnTime: now + Math.random() * IDLE_MAX_INTERVAL,
      scratchStart: new Vector3(),
      scratchEnd: new Vector3(),
    });
  }

  /** Stop idle-crackle for a tower (call on sell/dispose). */
  deregisterIdleCrackle(towerId: string): void {
    this.idleEmitters.delete(towerId);
  }

  /**
   * Tick all active bolts and idle emitters. Call once per render frame with
   * a monotonic clock value (seconds), after this frame's spawns.
   */
  update(now: number): void {
    this.uniforms.uTime.value = now;

    // Spawn micro-bolts at idle emitters
    for (const emitter of this.idleEmitters.values()) {
      while (now >= emitter.nextSpawnTime) {
        for (let b = 0; b < IDLE_BOLTS_PER_TICK; b++) {
          emitter.scratchStart.set(
            emitter.tipPos.x + (Math.random() * 2 - 1) * IDLE_JITTER_INNER,
            emitter.tipPos.y + (Math.random() * 2 - 1) * IDLE_JITTER_INNER * 0.5,
            emitter.tipPos.z + (Math.random() * 2 - 1) * IDLE_JITTER_INNER,
          );
          emitter.scratchEnd.set(
            emitter.tipPos.x + (Math.random() * 2 - 1) * IDLE_JITTER_OUTER,
            emitter.tipPos.y + (Math.random() * 2 - 1) * IDLE_JITTER_OUTER * 0.5,
            emitter.tipPos.z + (Math.random() * 2 - 1) * IDLE_JITTER_OUTER,
          );
          this.spawnBolt(emitter.scratchStart, emitter.scratchEnd, now, IDLE_OPTS);
        }
        emitter.nextSpawnTime = now + IDLE_MIN_INTERVAL + Math.random() * (IDLE_MAX_INTERVAL - IDLE_MIN_INTERVAL);
      }
    }

    // Release expired bolts, fade the halos of the live ones with bolt age.
    // Deleting the entry being visited is safe while iterating a Set.
    for (const slot of this.activeSlots) {
      const age = (now - this.spawnTimes[slot]) / Math.max(this.lifetimes[slot], 0.0001);
      if (age >= 1.0) {
        this.releaseBolt(slot);
        continue;
      }
      const haloIdx = this.haloIndices[slot];
      if (haloIdx >= 0) {
        const k = 1 - age;
        (this.haloPool[haloIdx].material as SpriteMaterial).opacity = this.haloPeaks[slot] * k * k;
      }
    }

    this.flush();
  }

  /**
   * Upload the bolt data written since the last flush as one range over the
   * drawn slots, (0, activeCount * STRIDE). Slots at or above activeCount
   * are not drawn and get rewritten on spawn before the pool grows over them.
   */
  private flush(): void {
    if (!this.dirty) return;
    this.dirty = false;
    // activeCount 0: nothing is drawn, and (0, 0) would upload the whole
    // buffer (bufferSubData reads a length of 0 as "to the end").
    const activeCount = this.slots.activeCount;
    if (activeCount === 0) return;
    this.instanceData.clearUpdateRanges();
    this.instanceData.addUpdateRange(0, activeCount * STRIDE);
    this.instanceData.needsUpdate = true;
  }

  /**
   * Free a live bolt's slot. A slot below the draw count stays drawn as a
   * hole; the vertex shader collapses expired instances, and a bolt released
   * early (stolen) has its slot rewritten right away.
   */
  private releaseBolt(slot: number): void {
    this.detachHalo(slot);
    this.activeSlots.delete(slot);
    this.slots.release(slot);
    this.syncDrawCount();
  }

  /** Hide the slot's halo and return it to the pool. */
  private detachHalo(slot: number): void {
    const haloIdx = this.haloIndices[slot];
    if (haloIdx < 0) return;
    const halo = this.haloPool[haloIdx];
    (halo.material as SpriteMaterial).opacity = 0;
    halo.visible = false;
    this.haloFreeIndices.push(haloIdx);
    this.haloIndices[slot] = -1;
  }

  /** Active bolt count (for diagnostics). */
  get activeCount(): number {
    return this.activeSlots.size;
  }

  /** Release everything (e.g. on wave end). Idle emitters remain registered. */
  clear(): void {
    for (const slot of this.activeSlots) this.detachHalo(slot);
    this.activeSlots.clear();
    // No data writes needed: instanceCount 0 draws nothing, and spawnBolt()
    // rewrites a slot before the pool grows over it again.
    this.slots.reset();
    this.syncDrawCount();
    this.dirty = false;
  }

  /** Draw count follows the slot allocator; the gate hides an empty pool. */
  private syncDrawCount(): void {
    this.geometry.instanceCount = this.slots.activeCount;
    this.gate.setCount(this.slots.activeCount);
  }

  /** Dispose of all GPU resources. */
  dispose(): void {
    this.clear();
    this.idleEmitters.clear();
    this.scene.remove(this.mesh);
    this.geometry.dispose();
    this.material.dispose();
    for (const halo of this.haloPool) {
      this.scene.remove(halo);
      (halo.material as SpriteMaterial).dispose();
    }
    this.haloTexture.dispose();
    this.haloPool.length = 0;
    this.haloFreeIndices.length = 0;
  }
}
