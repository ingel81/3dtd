/**
 * Lightning Bolt Renderer
 *
 * Pool of jagged, glowing electric bolts between two world-space endpoints.
 * Used by the Lightning Tower for both chain-hit visuals and the continuous
 * idle-crackle at the tower's tip.
 *
 * Architecture mirrors TrailStreakRenderer: each bolt owns a small static
 * BufferGeometry; per-frame work is just one uniform write per active bolt
 * (the vertex shader computes everything from uStart / uEnd / uTime). A
 * free-list pool tracks which bolts are available.
 */

import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Mesh,
  Scene,
  ShaderMaterial,
  Vector3,
  AdditiveBlending,
  DoubleSide,
} from 'three';
import { LIGHTNING_BOLT_VERTEX, LIGHTNING_BOLT_FRAGMENT } from './lightning-bolt-shaders';

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
}

// ─── Constants ──────────────────────────────────────────────────────

const SEGMENTS = 28;          // 28 quads — finer subdivision for the higher-freq jagged noise
const SPINE_POINTS = SEGMENTS + 1;
const VERT_COUNT = SPINE_POINTS * 2;
const INDEX_COUNT = SEGMENTS * 6;

const COLOR_CORE = new Color(0.78, 0.92, 1.0);   // slightly blue-tinted white core
const COLOR_OUTER = new Color(0.18, 0.42, 1.0);  // deep saturated electric blue

// ─── Single Bolt ────────────────────────────────────────────────────

class LightningBolt {
  readonly mesh: Mesh;
  active = false;
  spawnTime = 0;

  // Sort key — older bolts get stolen first when the pool is exhausted.
  acquireCounter = 0;

  readonly uniforms = {
    uStart: { value: new Vector3() },
    uEnd: { value: new Vector3() },
    uTime: { value: 0 },
    uSpawnTime: { value: 0 },
    uLifetime: { value: 0.28 },
    uSeed: { value: 0 },
    uWidth: { value: 0.45 },
    uJaggedness: { value: 1.6 },     // up from 0.9 — much zigzag
    uIntensity: { value: 2.4 },      // up from 1.0 — bolts pop without global bloom
    uColorCore: { value: COLOR_CORE.clone() },
    uColorOuter: { value: COLOR_OUTER.clone() },
  };

  constructor() {
    // Build the static quad-strip geometry. Positions are dummy because the
    // vertex shader recomputes them from uStart/uEnd — but the attribute
    // still needs to exist for WebGL.
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

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    geometry.setAttribute('aSegmentT', new BufferAttribute(segmentT, 1));
    geometry.setAttribute('aSide', new BufferAttribute(side, 1));
    geometry.setIndex(new BufferAttribute(indices, 1));

    const material = new ShaderMaterial({
      vertexShader: LIGHTNING_BOLT_VERTEX,
      fragmentShader: LIGHTNING_BOLT_FRAGMENT,
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
    });

    this.mesh = new Mesh(geometry, material);
    this.mesh.frustumCulled = false; // verts come from shader, bounds are wrong
    this.mesh.renderOrder = 1001;
    this.mesh.visible = false;
  }

  acquire(
    start: Vector3,
    end: Vector3,
    now: number,
    opts: BoltOptions,
    counter: number,
  ): void {
    this.uniforms.uStart.value.copy(start);
    this.uniforms.uEnd.value.copy(end);
    this.uniforms.uTime.value = now;
    this.uniforms.uSpawnTime.value = now;
    this.uniforms.uLifetime.value = opts.lifetime ?? 0.25;
    this.uniforms.uWidth.value = opts.width ?? 0.45;
    this.uniforms.uJaggedness.value = opts.jaggedness ?? 0.9;
    this.uniforms.uIntensity.value = opts.intensity ?? 1.0;
    this.uniforms.uSeed.value = Math.random() * 100;
    this.spawnTime = now;
    this.acquireCounter = counter;
    this.active = true;
    this.mesh.visible = true;
  }

  /** Tick the shader clock. Returns false when the bolt has expired. */
  update(now: number): boolean {
    this.uniforms.uTime.value = now;
    const age = (now - this.spawnTime) / Math.max(this.uniforms.uLifetime.value, 0.0001);
    if (age >= 1.0) {
      this.release();
      return false;
    }
    return true;
  }

  release(): void {
    this.active = false;
    this.mesh.visible = false;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as ShaderMaterial).dispose();
  }
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
  jaggedness: 0.55,    // up from 0.18 — visibly crackly micro-bolts
  intensity: 1.8,      // up from 0.55 — clearly bright against sky
};
const IDLE_MIN_INTERVAL = 0.025;   // up to 40 Hz spawn rate (was ~5-12 Hz)
const IDLE_MAX_INTERVAL = 0.06;
const IDLE_JITTER_INNER = 0.6;     // larger inner cloud
const IDLE_JITTER_OUTER = 1.6;     // bigger reach beyond tip
const IDLE_BOLTS_PER_TICK = 2;     // spawn 2 micro-bolts each interval — denser crackle

// ─── Renderer / Pool ────────────────────────────────────────────────

export class LightningBoltRenderer {
  private readonly scene: Scene;
  private readonly pool: LightningBolt[] = [];
  private readonly freeIndices: number[] = [];
  private readonly activeIndices = new Set<number>();
  private readonly idleEmitters = new Map<string, IdleEmitter>();
  private counter = 0;

  constructor(scene: Scene, poolSize = 192) {
    this.scene = scene;
    for (let i = 0; i < poolSize; i++) {
      const bolt = new LightningBolt();
      scene.add(bolt.mesh);
      this.pool.push(bolt);
      this.freeIndices.push(i);
    }
  }

  /**
   * Spawn a one-shot bolt between two world-space points.
   * Falls back to stealing the oldest active bolt if the pool is exhausted.
   */
  spawnBolt(start: Vector3, end: Vector3, now: number, opts: BoltOptions = {}): void {
    let idx = this.freeIndices.pop();
    if (idx === undefined) {
      idx = this.stealOldest();
      if (idx === undefined) return;
    }
    this.pool[idx].acquire(start, end, now, opts, this.counter++);
    this.activeIndices.add(idx);
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
   * a monotonic clock value (seconds).
   */
  update(now: number): void {
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

    // Tick active bolts; release expired ones back to the free-list
    for (const idx of [...this.activeIndices]) {
      if (!this.pool[idx].update(now)) {
        this.activeIndices.delete(idx);
        this.freeIndices.push(idx);
      }
    }
  }

  /**
   * Find the active bolt with the smallest acquireCounter (oldest) and free
   * it. Returns the freed pool index or undefined if no active bolt exists.
   */
  private stealOldest(): number | undefined {
    let oldestIdx: number | undefined;
    let oldestCounter = Infinity;
    for (const idx of this.activeIndices) {
      const c = this.pool[idx].acquireCounter;
      if (c < oldestCounter) {
        oldestCounter = c;
        oldestIdx = idx;
      }
    }
    if (oldestIdx === undefined) return undefined;
    this.pool[oldestIdx].release();
    this.activeIndices.delete(oldestIdx);
    return oldestIdx;
  }

  /** Active bolt count (for diagnostics). */
  get activeCount(): number {
    return this.activeIndices.size;
  }

  /** Release everything (e.g. on wave end). Idle emitters remain registered. */
  clear(): void {
    for (const idx of this.activeIndices) {
      this.pool[idx].release();
      this.freeIndices.push(idx);
    }
    this.activeIndices.clear();
  }

  /** Dispose of all GPU resources. */
  dispose(): void {
    this.clear();
    this.idleEmitters.clear();
    for (const bolt of this.pool) {
      this.scene.remove(bolt.mesh);
      bolt.dispose();
    }
    this.pool.length = 0;
    this.freeIndices.length = 0;
  }
}
