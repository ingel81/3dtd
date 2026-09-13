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
  /** Length behind the head, metres. The streak is cut there. */
  length: number;
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

// Until 2026-09-12 a streak was its last `maxPoints` positions. Positions are
// pushed once per rendered frame, so the same flight left a longer streak
// the fewer frames it got: twice as long at 30 FPS or 2x game speed, four
// times at 4x. It is now cut at `length`. The lengths are what the point
// counts drew at 60 FPS and 1x, (maxPoints - 1) * speed / 60 with the speed
// of the one projectile type that uses the style.
const TRAIL_STYLES: Record<string, TrailStreakStyle> = {
  rocket: {
    // Playtest 2026-09-10: 22 points drew a ~40 m fire line behind the
    // rocket. Now it is only the nozzle glow: 6 m (4 points at 60 FPS),
    // hot yellow-white at the nozzle (PROJECTILE_TYPES.rocket.tailOffset)
    // fading through orange to nothing. The grey smoke particles carry the
    // trail.
    length: 6,
    widthHead: 0.35,
    widthTail: 0.08,
    alphaHead: 0.8,
    alphaTail: 0.0,
    colorHead: new Color(1.0, 0.8, 0.45),   // hot yellow-white
    colorTail: new Color(1.0, 0.35, 0.05),  // orange
    emissiveIntensity: 0.9,
    minSegmentDistSq: 0.25,
  },
  // Phase 5.16: arrow / magic / ice / cannonball got the rocket recipe of
  // that time: narrower head, thicker tail (no wedge), lower emissive (no white blowout),
  // more ring points (longer + smoother trail). Particle layer carries the
  // theme-specific volume (spiral arcs for magic, frost puffs for ice, smoke
  // for cannon). Pool budget audited: ~73% additive / ~15% normal at peak.
  arrow: {
    length: 17,
    widthHead: 0.2,
    widthTail: 0.15,
    alphaHead: 0.55,
    alphaTail: 0.0,
    colorHead: new Color(1.0, 1.0, 0.8),     // white-yellow
    colorTail: new Color(1.0, 0.9, 0.4),     // warm yellow
    emissiveIntensity: 0.7,
    minSegmentDistSq: 0.25,
  },
  magic: {
    length: 32,
    widthHead: 0.4,
    widthTail: 0.3,
    alphaHead: 0.55,
    alphaTail: 0.0,
    colorHead: new Color(0.6, 0.35, 1.0),    // lavender-violet
    colorTail: new Color(0.2, 0.05, 0.55),   // deep indigo
    emissiveIntensity: 0.7,
    minSegmentDistSq: 0.2,
  },
  ice: {
    length: 25.5,
    widthHead: 0.35,
    widthTail: 0.25,
    alphaHead: 0.55,
    alphaTail: 0.0,
    colorHead: new Color(0.6, 0.95, 1.0),    // bright cyan
    colorTail: new Color(0.15, 0.4, 0.8),    // deep blue
    emissiveIntensity: 0.65,
    minSegmentDistSq: 0.25,
  },
  cannonball: {
    length: 9,
    widthHead: 0.3,
    widthTail: 0.2,
    alphaHead: 0.45,
    alphaTail: 0.0,
    colorHead: new Color(0.35, 0.35, 0.35),  // grey
    colorTail: new Color(0.15, 0.15, 0.15),  // dark grey
    emissiveIntensity: 0.3,                  // already low — kept (smoke, not glow)
    minSegmentDistSq: 0.3,
  },
  bullet: {
    // Phase 5.16: was reading like a thin laser beam — pure-white blowout
    // through emissive 2.0 + 0.25/0.02 wedge. Tracer now has volume
    // (uniform thickness) and a warm orange fade so it feels like a
    // proper tracer round, not a sci-fi laser.
    length: 17.5,
    widthHead: 0.4,
    widthTail: 0.25,
    alphaHead: 0.55,
    alphaTail: 0.0,
    colorHead: new Color(1.0, 0.85, 0.35),   // warm yellow
    colorTail: new Color(1.0, 0.5, 0.1),     // orange fade
    emissiveIntensity: 0.8,
    minSegmentDistSq: 0.2,
  },
  // The hero's explosive round: the bullet tracer in orange-red, so the
  // three ammo types tell apart by colour (gold, orange-red, violet)
  shell: {
    length: 14,
    widthHead: 0.4,
    widthTail: 0.25,
    alphaHead: 0.6,
    alphaTail: 0.0,
    colorHead: new Color(1.0, 0.45, 0.15),   // hot orange
    colorTail: new Color(0.6, 0.12, 0.02),   // dark red fade
    emissiveIntensity: 0.8,
    minSegmentDistSq: 0.2,
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

  // Ring buffer of world positions (head = newest). Recorded positions are
  // at least sqrt(minSegmentDistSq) apart, so `capacity` of them always
  // reach `length`.
  private readonly capacity: number;
  private ring: Vector3[];
  private head = 0;   // write cursor
  private count = 0;  // how many valid entries

  // Pre-allocated geometry
  private posAttr: BufferAttribute;
  private alphaAttr: BufferAttribute;
  private colorAttr: BufferAttribute;
  private indexAttr: BufferAttribute;

  // Reusable temp vectors
  private static _side = new Vector3();
  private static _up = new Vector3(0, 1, 0);
  private static _xAxis = new Vector3(1, 0, 0);
  private static _tangent = new Vector3();
  // Drawn points of the trail being rebuilt, newest first, and their
  // distance from the head. Shared: trails rebuild one after another.
  private static _points: Vector3[] = [];
  private static _along: number[] = [];

  constructor(style: TrailStreakStyle, sharedMaterial: ShaderMaterial) {
    this.style = style;
    const n = Math.ceil(style.length / Math.sqrt(style.minSegmentDistSq)) + 1;
    this.capacity = n;
    while (TrailStreak._points.length < n) {
      TrailStreak._points.push(new Vector3());
      TrailStreak._along.push(0);
    }

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

    // Material is shared across all trails of the same visual type (its only
    // variation, uEmissiveIntensity, is constant per type) — created once by
    // the renderer instead of per trail (was 60×6 = 360 ShaderMaterials).
    this.mesh = new Mesh(geom, sharedMaterial);
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
    const cap = this.capacity;
    if (this.count > 0) {
      const last = this.ring[(this.head - 1 + cap) % cap];
      if (pos.distanceToSquared(last) < this.style.minSegmentDistSq) return;
    }

    this.ring[this.head].copy(pos);
    this.head = (this.head + 1) % cap;
    if (this.count < cap) this.count++;
  }

  /**
   * Rebuild mesh geometry from the ring buffer. Call once per frame.
   *
   * Walks back from the newest position and cuts the streak where it
   * reaches `style.length`, so the distance flown between two rendered
   * frames (frame rate, game speed) does not change how long it is.
   */
  updateGeometry(): void {
    if (this.count < 2) {
      this.mesh.geometry.setDrawRange(0, 0);
      return;
    }

    const cap = this.capacity;
    const maxLength = this.style.length;
    const points = TrailStreak._points;
    const along = TrailStreak._along;

    // Newest first; the oldest drawn point sits where the length runs out
    let ringIdx = (this.head - 1 + cap) % cap;
    points[0].copy(this.ring[ringIdx]);
    along[0] = 0;
    let n = 1;
    let total = 0;
    for (let k = 1; k < this.count && total < maxLength; k++) {
      ringIdx = (ringIdx - 1 + cap) % cap;
      const older = this.ring[ringIdx];
      const seg = points[n - 1].distanceTo(older);
      if (total + seg > maxLength) {
        points[n].lerpVectors(points[n - 1], older, (maxLength - total) / seg);
        total = maxLength;
      } else {
        points[n].copy(older);
        total += seg;
      }
      along[n++] = total;
    }

    const positions = this.posAttr.array as Float32Array;
    const alphas = this.alphaAttr.array as Float32Array;
    const colors = this.colorAttr.array as Float32Array;

    const { widthHead, widthTail, alphaHead, alphaTail, colorHead, colorTail } = this.style;

    for (let i = 0; i < n; i++) {
      const pt = points[i];

      // t: 1 = head (newest), 0 = tail end, by distance along the streak
      const t = 1 - along[i] / total;

      // Tangent towards the head, from the neighbours (one-sided at the ends)
      TrailStreak._tangent
        .subVectors(points[Math.max(i - 1, 0)], points[Math.min(i + 1, n - 1)])
        .normalize();

      // Side vector = cross(tangent, up), fallback if nearly parallel
      TrailStreak._side.crossVectors(TrailStreak._tangent, TrailStreak._up);
      if (TrailStreak._side.lengthSq() < 0.001) {
        // Tangent nearly vertical: use world X as fallback up
        TrailStreak._side.crossVectors(TrailStreak._tangent, TrailStreak._xAxis);
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

  /** One shared ShaderMaterial per visual type (disposed once in dispose()). */
  private materials = new Map<string, ShaderMaterial>();

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
      // One material per type, shared by all trails of that type.
      const material = new ShaderMaterial({
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
      this.materials.set(vt, material);
      const pool: TrailStreak[] = [];
      for (let i = 0; i < this.POOL_SIZE_PER_TYPE; i++) {
        const trail = new TrailStreak(style, material);
        this.scene.add(trail.mesh);
        pool.push(trail);
      }
      this.pools.set(vt, pool);
    }
  }

  /** VFX setting projectileTrails; while off no projectile gets a trail. */
  private enabled = true;

  /**
   * Switch the trails on or off (VFX setting projectileTrails). Off drops
   * the trails in flight: each one is a mesh and a draw call of its own,
   * and its geometry is rebuilt every frame.
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.clear();
  }

  /**
   * Acquire a trail for a new projectile.
   * @returns true if a trail was available (never while trails are off)
   */
  create(projectileId: string, visualType: ProjectileVisualType): boolean {
    if (!this.enabled) return false;
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
        // Material is shared per type — disposed once below, not per trail.
      }
    }
    for (const material of this.materials.values()) {
      material.dispose();
    }
    this.materials.clear();
    this.pools.clear();
  }

  /** Number of active trails */
  get count(): number {
    return this.active.size;
  }
}
