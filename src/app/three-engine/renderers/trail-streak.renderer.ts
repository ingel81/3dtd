import {
  BufferGeometry,
  BufferAttribute,
  Mesh,
  ShaderMaterial,
  Vector3,
  Color,
  AdditiveBlending,
  DoubleSide,
  Scene,
} from 'three';
import { ProjectileVisualType } from '../../configs/projectile-types.config';

// ─── Trail Style Configs ────────────────────────────────────────────

export interface TrailStreakStyle {
  /** Maximum positions stored in ring buffer */
  maxPoints: number;
  /** Width at head (world units) */
  widthHead: number;
  /** Width at tail (world units) */
  widthTail: number;
  /** Alpha at head (0-1) */
  alphaHead: number;
  /** Alpha at tail (0-1) */
  alphaTail: number;
  /** Primary colour (head) */
  colorHead: Color;
  /** Secondary colour (tail) */
  colorTail: Color;
  /** Emissive intensity multiplier for additive glow */
  emissiveIntensity: number;
  /** Minimum distance² between recorded positions (avoids clumping) */
  minSegmentDistSq: number;
}

const TRAIL_STYLES: Record<string, TrailStreakStyle> = {
  rocket: {
    maxPoints: 16,
    widthHead: 1.8,
    widthTail: 0.2,
    alphaHead: 0.95,
    alphaTail: 0.0,
    colorHead: new Color(1.0, 0.6, 0.15),   // bright orange
    colorTail: new Color(0.8, 0.15, 0.02),   // dark red
    emissiveIntensity: 2.5,
    minSegmentDistSq: 0.5,
  },
  arrow: {
    maxPoints: 10,
    widthHead: 0.5,
    widthTail: 0.05,
    alphaHead: 0.85,
    alphaTail: 0.0,
    colorHead: new Color(1.0, 1.0, 0.8),     // white-yellow
    colorTail: new Color(1.0, 0.9, 0.4),     // warm yellow
    emissiveIntensity: 1.5,
    minSegmentDistSq: 0.3,
  },
  magic: {
    maxPoints: 14,
    widthHead: 1.2,
    widthTail: 0.1,
    alphaHead: 0.9,
    alphaTail: 0.0,
    colorHead: new Color(0.7, 0.2, 1.0),     // purple
    colorTail: new Color(0.2, 0.05, 0.6),    // deep blue-purple
    emissiveIntensity: 2.0,
    minSegmentDistSq: 0.3,
  },
  ice: {
    maxPoints: 12,
    widthHead: 0.9,
    widthTail: 0.08,
    alphaHead: 0.85,
    alphaTail: 0.0,
    colorHead: new Color(0.6, 0.95, 1.0),    // bright cyan
    colorTail: new Color(0.15, 0.4, 0.8),    // deep blue
    emissiveIntensity: 1.8,
    minSegmentDistSq: 0.3,
  },
  cannonball: {
    maxPoints: 8,
    widthHead: 0.7,
    widthTail: 0.1,
    alphaHead: 0.5,
    alphaTail: 0.0,
    colorHead: new Color(0.35, 0.35, 0.35),  // grey
    colorTail: new Color(0.15, 0.15, 0.15),  // dark grey
    emissiveIntensity: 0.3,
    minSegmentDistSq: 0.5,
  },
  bullet: {
    maxPoints: 6,
    widthHead: 0.25,
    widthTail: 0.02,
    alphaHead: 0.9,
    alphaTail: 0.0,
    colorHead: new Color(1.0, 0.95, 0.5),    // bright yellow
    colorTail: new Color(1.0, 0.7, 0.2),     // orange-yellow
    emissiveIntensity: 2.0,
    minSegmentDistSq: 0.1,
  },
};

/**
 * Get trail style for a visual type. Falls back to arrow style.
 */
export function getTrailStyle(visualType: ProjectileVisualType): TrailStreakStyle {
  return TRAIL_STYLES[visualType] ?? TRAIL_STYLES['arrow'];
}

// ─── Shaders ────────────────────────────────────────────────────────

const TRAIL_VERTEX = /* glsl */ `
  attribute float alpha;
  attribute vec3 trailColor;

  varying float vAlpha;
  varying vec3 vColor;

  #include <common>
  #include <logdepthbuf_pars_vertex>

  void main() {
    vAlpha = alpha;
    vColor = trailColor;

    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;

    #include <logdepthbuf_vertex>
  }
`;

const TRAIL_FRAGMENT = /* glsl */ `
  precision highp float;

  varying float vAlpha;
  varying vec3 vColor;

  uniform float uEmissiveIntensity;

  #include <logdepthbuf_pars_fragment>

  void main() {
    if (vAlpha < 0.005) discard;
    gl_FragColor = vec4(vColor * uEmissiveIntensity, vAlpha);

    #include <logdepthbuf_fragment>
  }
`;

// ─── Single Trail Instance ──────────────────────────────────────────

/**
 * A single projectile trail — ring buffer of positions rendered as a
 * camera-facing quad-strip with alpha + width tapering.
 *
 * Geometry is a pre-allocated BufferGeometry that gets updated in-place
 * every frame.  No new objects are allocated during runtime.
 */
class TrailStreak {
  /** Owning projectile id (empty string = pooled / free) */
  projectileId = '';
  readonly style: TrailStreakStyle;
  readonly mesh: Mesh;

  // Ring buffer of world positions (head = newest)
  private ring: Vector3[];
  private head = 0;   // write cursor
  private count = 0;  // how many valid entries

  // Pre-allocated geometry
  private posAttr: BufferAttribute;
  private alphaAttr: BufferAttribute;
  private colorAttr: BufferAttribute;
  private indexAttr: BufferAttribute;

  // Reusable temp vectors
  private static _forward = new Vector3();
  private static _side = new Vector3();
  private static _up = new Vector3(0, 1, 0);
  private static _prev = new Vector3();
  private static _next = new Vector3();
  private static _tangent = new Vector3();

  constructor(style: TrailStreakStyle) {
    this.style = style;
    const n = style.maxPoints;

    // Ring buffer
    this.ring = [];
    for (let i = 0; i < n; i++) this.ring.push(new Vector3());

    // Quad-strip: 2 vertices per point, (n-1) quads → 2*(n-1)*3 indices
    const vertCount = n * 2;
    const positions = new Float32Array(vertCount * 3);
    const alphas = new Float32Array(vertCount);
    const colors = new Float32Array(vertCount * 3);
    const maxQuads = (n - 1);
    const indices = new Uint16Array(maxQuads * 6);

    const geom = new BufferGeometry();
    this.posAttr = new BufferAttribute(positions, 3);
    this.posAttr.setUsage(35048); // DYNAMIC_DRAW
    this.alphaAttr = new BufferAttribute(alphas, 1);
    this.alphaAttr.setUsage(35048);
    this.colorAttr = new BufferAttribute(colors, 3);
    this.colorAttr.setUsage(35048);
    this.indexAttr = new BufferAttribute(indices, 1);

    geom.setAttribute('position', this.posAttr);
    geom.setAttribute('alpha', this.alphaAttr);
    geom.setAttribute('trailColor', this.colorAttr);
    geom.setIndex(this.indexAttr);

    // Build index buffer once (always the same pattern)
    for (let i = 0; i < maxQuads; i++) {
      const base = i * 2;
      const off = i * 6;
      indices[off] = base;
      indices[off + 1] = base + 1;
      indices[off + 2] = base + 2;
      indices[off + 3] = base + 1;
      indices[off + 4] = base + 3;
      indices[off + 5] = base + 2;
    }
    this.indexAttr.needsUpdate = true;

    const mat = new ShaderMaterial({
      vertexShader: TRAIL_VERTEX,
      fragmentShader: TRAIL_FRAGMENT,
      uniforms: {
        uEmissiveIntensity: { value: style.emissiveIntensity },
      },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
    });

    this.mesh = new Mesh(geom, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 998; // Just below particle effects
    this.mesh.visible = false;
  }

  // ── Public API ──

  /** Attach to a projectile */
  acquire(projectileId: string): void {
    this.projectileId = projectileId;
    this.head = 0;
    this.count = 0;
    this.mesh.visible = true;
  }

  /** Detach and hide */
  release(): void {
    this.projectileId = '';
    this.count = 0;
    this.mesh.visible = false;
    // Zero-out draw range so nothing is rendered while pooled
    this.mesh.geometry.setDrawRange(0, 0);
  }

  /** Push a new world-space position (call once per frame per projectile) */
  pushPosition(pos: Vector3): void {
    // Skip if too close to last position (avoid degenerate segments)
    if (this.count > 0) {
      const last = this.ring[(this.head - 1 + this.style.maxPoints) % this.style.maxPoints];
      if (pos.distanceToSquared(last) < this.style.minSegmentDistSq) return;
    }

    this.ring[this.head].copy(pos);
    this.head = (this.head + 1) % this.style.maxPoints;
    if (this.count < this.style.maxPoints) this.count++;
  }

  /** Rebuild mesh geometry from current ring buffer. Call once per frame. */
  updateGeometry(): void {
    if (this.count < 2) {
      this.mesh.geometry.setDrawRange(0, 0);
      return;
    }

    const n = this.count;
    const positions = this.posAttr.array as Float32Array;
    const alphas = this.alphaAttr.array as Float32Array;
    const colors = this.colorAttr.array as Float32Array;

    const { widthHead, widthTail, alphaHead, alphaTail, colorHead, colorTail } = this.style;

    // Iterate from tail (oldest) to head (newest)
    for (let i = 0; i < n; i++) {
      // ring index: oldest first
      const ringIdx = (this.head - n + i + this.style.maxPoints) % this.style.maxPoints;
      const pt = this.ring[ringIdx];

      // t: 0 = tail (oldest), 1 = head (newest)
      const t = n > 1 ? i / (n - 1) : 1;

      // Compute tangent
      const _prevIdx = (ringIdx - 1 + this.style.maxPoints) % this.style.maxPoints;
      const _nextIdx = (ringIdx + 1) % this.style.maxPoints;

      if (i === 0 && n > 1) {
        // First point — forward direction only
        const next = this.ring[(this.head - n + 1 + this.style.maxPoints) % this.style.maxPoints];
        TrailStreak._tangent.subVectors(next, pt).normalize();
      } else if (i === n - 1 && n > 1) {
        // Last point — backward direction only
        const prevRing = (this.head - n + i - 1 + this.style.maxPoints) % this.style.maxPoints;
        const prev = this.ring[prevRing];
        TrailStreak._tangent.subVectors(pt, prev).normalize();
      } else {
        // Middle — average of neighbours
        const pRing = (this.head - n + i - 1 + this.style.maxPoints) % this.style.maxPoints;
        const nRing = (this.head - n + i + 1 + this.style.maxPoints) % this.style.maxPoints;
        TrailStreak._prev.copy(this.ring[pRing]);
        TrailStreak._next.copy(this.ring[nRing]);
        TrailStreak._tangent.subVectors(TrailStreak._next, TrailStreak._prev).normalize();
      }

      // Side vector = cross(tangent, up), fallback if nearly parallel
      TrailStreak._side.crossVectors(TrailStreak._tangent, TrailStreak._up);
      if (TrailStreak._side.lengthSq() < 0.001) {
        // Tangent nearly vertical — use world X as fallback up
        TrailStreak._side.crossVectors(TrailStreak._tangent, new Vector3(1, 0, 0));
      }
      TrailStreak._side.normalize();

      // Interpolate width and alpha
      const w = widthTail + (widthHead - widthTail) * t;
      const a = alphaTail + (alphaHead - alphaTail) * t;

      // Two vertices: left and right of center
      const vi = i * 2;
      const p3 = vi * 3;

      positions[p3]     = pt.x + TrailStreak._side.x * w;
      positions[p3 + 1] = pt.y + TrailStreak._side.y * w;
      positions[p3 + 2] = pt.z + TrailStreak._side.z * w;

      positions[p3 + 3] = pt.x - TrailStreak._side.x * w;
      positions[p3 + 4] = pt.y - TrailStreak._side.y * w;
      positions[p3 + 5] = pt.z - TrailStreak._side.z * w;

      alphas[vi] = a;
      alphas[vi + 1] = a;

      // Interpolate colour
      const cr = colorTail.r + (colorHead.r - colorTail.r) * t;
      const cg = colorTail.g + (colorHead.g - colorTail.g) * t;
      const cb = colorTail.b + (colorHead.b - colorTail.b) * t;

      const c3 = vi * 3;
      colors[c3]     = cr;
      colors[c3 + 1] = cg;
      colors[c3 + 2] = cb;
      colors[c3 + 3] = cr;
      colors[c3 + 4] = cg;
      colors[c3 + 5] = cb;
    }

    this.posAttr.needsUpdate = true;
    this.alphaAttr.needsUpdate = true;
    this.colorAttr.needsUpdate = true;

    // Draw only active quads
    const quadCount = n - 1;
    this.mesh.geometry.setDrawRange(0, quadCount * 6);
  }

  get isActive(): boolean {
    return this.projectileId !== '';
  }
}

// ─── Pool / Manager ─────────────────────────────────────────────────

/**
 * TrailStreakRenderer
 *
 * Manages a pool of TrailStreak instances — one per active projectile.
 * Call `create()` when a projectile spawns, `pushPosition()` each frame,
 * `remove()` when it dies, and `updateAll()` once per frame to rebuild geometry.
 */
export class TrailStreakRenderer {
  private scene: Scene;

  /** All pooled trail instances, keyed by visual type */
  private pools = new Map<string, TrailStreak[]>();

  /** Active projectile → trail mapping */
  private active = new Map<string, TrailStreak>();

  /** Total pool budget per visual type */
  private readonly POOL_SIZE_PER_TYPE = 60;

  constructor(scene: Scene) {
    this.scene = scene;
    this.initPools();
  }

  private initPools(): void {
    const types: ProjectileVisualType[] = ['rocket', 'arrow', 'magic', 'ice', 'cannonball', 'bullet'];
    for (const vt of types) {
      const style = getTrailStyle(vt);
      const pool: TrailStreak[] = [];
      for (let i = 0; i < this.POOL_SIZE_PER_TYPE; i++) {
        const trail = new TrailStreak(style);
        this.scene.add(trail.mesh);
        pool.push(trail);
      }
      this.pools.set(vt, pool);
    }
  }

  /**
   * Acquire a trail for a new projectile.
   * @returns true if a trail was available
   */
  create(projectileId: string, visualType: ProjectileVisualType): boolean {
    if (this.active.has(projectileId)) return true; // already exists

    const pool = this.pools.get(visualType);
    if (!pool) return false;

    // Find a free trail in the pool
    for (const trail of pool) {
      if (!trail.isActive) {
        trail.acquire(projectileId);
        this.active.set(projectileId, trail);
        return true;
      }
    }

    // Pool exhausted — steal oldest (first active in pool)
    // This keeps the system bounded; old trails just disappear
    for (const trail of pool) {
      if (trail.isActive) {
        this.active.delete(trail.projectileId);
        trail.release();
        trail.acquire(projectileId);
        this.active.set(projectileId, trail);
        return true;
      }
    }

    return false;
  }

  /**
   * Record a new position for an active projectile trail.
   */
  pushPosition(projectileId: string, worldPos: Vector3): void {
    const trail = this.active.get(projectileId);
    if (trail) {
      trail.pushPosition(worldPos);
    }
  }

  /**
   * Release a trail when the projectile dies or impacts.
   */
  remove(projectileId: string): void {
    const trail = this.active.get(projectileId);
    if (trail) {
      trail.release();
      this.active.delete(projectileId);
    }
  }

  /**
   * Rebuild all active trail geometries. Call once per frame.
   */
  updateAll(): void {
    for (const trail of this.active.values()) {
      trail.updateGeometry();
    }
  }

  /**
   * Remove all active trails.
   */
  clear(): void {
    for (const trail of this.active.values()) {
      trail.release();
    }
    this.active.clear();
  }

  /**
   * Dispose of all GPU resources.
   */
  dispose(): void {
    this.clear();
    for (const pool of this.pools.values()) {
      for (const trail of pool) {
        this.scene.remove(trail.mesh);
        trail.mesh.geometry.dispose();
        (trail.mesh.material as ShaderMaterial).dispose();
      }
    }
    this.pools.clear();
  }

  /** Number of active trails */
  get count(): number {
    return this.active.size;
  }
}
