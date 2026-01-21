/**
 * Runtime Street Generator for DevWorld
 *
 * Generates organic street networks at runtime using seeded randomness.
 * No more fixed grid patterns - streets follow terrain and branch naturally.
 *
 * Features:
 * - 3-level hierarchy: Arterial → Collector → Residential
 * - Terrain-following paths with max 15% slope
 * - Catmull-Rom splines for smooth curves
 * - L-System branching for collectors
 * - Union-Find connectivity validation
 * - Min 30m intersection spacing
 */

import { mulberry32, createSeededNoise, hashSeed, SeededNoiseCollection } from '../utils/seeded-random';

// ========================================
// Types
// ========================================

export type StreetType = 'primary' | 'secondary' | 'residential';

export interface StreetSegment {
  id: string;
  from: [number, number]; // [x, z] in meters
  to: [number, number];
  type: StreetType;
}

export interface SpawnPoint {
  id: string;
  name: string;
  position: { x: number; z: number };
  description: string;
}

export interface StreetGeneratorConfig {
  /** Master seed for reproducibility */
  seed: number;
  /** World size in meters (default: 1000) */
  worldSize?: number;
  /** HQ position (enemy target) */
  hqPosition?: { x: number; z: number };
  /** Function to sample terrain height at position */
  terrainSampler?: (x: number, z: number) => number;
  /** Minimum spawn distance from HQ (default: 300) */
  minSpawnDistance?: number;
  /** Maximum spawn distance from HQ (default: 450) */
  maxSpawnDistance?: number;
}

export interface StreetGeneratorResult {
  segments: StreetSegment[];
  spawns: SpawnPoint[];
}

interface Vec2 {
  x: number;
  z: number;
}

// ========================================
// Vector Utilities
// ========================================

function vec2(x: number, z: number): Vec2 {
  return { x, z };
}

function add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, z: a.z + b.z };
}

function sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, z: a.z - b.z };
}

function scale(v: Vec2, s: number): Vec2 {
  return { x: v.x * s, z: v.z * s };
}

function length(v: Vec2): number {
  return Math.sqrt(v.x * v.x + v.z * v.z);
}

function normalize(v: Vec2): Vec2 {
  const len = length(v);
  if (len < 0.0001) return { x: 0, z: 0 };
  return { x: v.x / len, z: v.z / len };
}

function distance(a: Vec2, b: Vec2): number {
  return length(sub(b, a));
}

function rotate(v: Vec2, angle: number): Vec2 {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: v.x * cos - v.z * sin,
    z: v.x * sin + v.z * cos,
  };
}

function lerp(a: Vec2, b: Vec2, t: number): Vec2 {
  return {
    x: a.x + (b.x - a.x) * t,
    z: a.z + (b.z - a.z) * t,
  };
}

// ========================================
// Catmull-Rom Spline
// ========================================

/**
 * Evaluate Catmull-Rom spline at parameter t.
 * p0, p1, p2, p3 are control points, t is in [0, 1] between p1 and p2.
 */
function catmullRom(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, t: number): Vec2 {
  const t2 = t * t;
  const t3 = t2 * t;

  return {
    x: 0.5 * (
      2 * p1.x +
      (-p0.x + p2.x) * t +
      (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
      (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3
    ),
    z: 0.5 * (
      2 * p1.z +
      (-p0.z + p2.z) * t +
      (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * t2 +
      (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * t3
    ),
  };
}

/**
 * Sample points along a Catmull-Rom spline path.
 */
function sampleSplinePath(controlPoints: Vec2[], sampleDistance: number): Vec2[] {
  if (controlPoints.length < 2) return [...controlPoints];
  if (controlPoints.length === 2) {
    return sampleLinearPath(controlPoints[0], controlPoints[1], sampleDistance);
  }

  const result: Vec2[] = [];

  // For each segment between control points
  for (let i = 0; i < controlPoints.length - 1; i++) {
    const p0 = controlPoints[Math.max(0, i - 1)];
    const p1 = controlPoints[i];
    const p2 = controlPoints[i + 1];
    const p3 = controlPoints[Math.min(controlPoints.length - 1, i + 2)];

    // Estimate segment length
    const segmentLength = distance(p1, p2) * 1.2; // Approximate arc length
    const numSamples = Math.max(2, Math.ceil(segmentLength / sampleDistance));

    for (let j = 0; j < numSamples; j++) {
      const t = j / numSamples;
      result.push(catmullRom(p0, p1, p2, p3, t));
    }
  }

  // Add final point
  result.push(controlPoints[controlPoints.length - 1]);

  return result;
}

function sampleLinearPath(start: Vec2, end: Vec2, sampleDistance: number): Vec2[] {
  const result: Vec2[] = [];
  const dist = distance(start, end);
  const numSamples = Math.max(2, Math.ceil(dist / sampleDistance));

  for (let i = 0; i <= numSamples; i++) {
    result.push(lerp(start, end, i / numSamples));
  }

  return result;
}

// ========================================
// Union-Find for Connectivity
// ========================================

class UnionFind {
  private parent: Map<string, string>;
  private rank: Map<string, number>;

  constructor() {
    this.parent = new Map();
    this.rank = new Map();
  }

  private getKey(p: Vec2): string {
    return `${Math.round(p.x)}_${Math.round(p.z)}`;
  }

  add(p: Vec2): void {
    const key = this.getKey(p);
    if (!this.parent.has(key)) {
      this.parent.set(key, key);
      this.rank.set(key, 0);
    }
  }

  find(p: Vec2): string {
    const key = this.getKey(p);
    if (!this.parent.has(key)) {
      this.add(p);
      return key;
    }

    // Path compression
    let root = key;
    while (this.parent.get(root) !== root) {
      root = this.parent.get(root)!;
    }

    // Compress path
    let current = key;
    while (current !== root) {
      const next = this.parent.get(current)!;
      this.parent.set(current, root);
      current = next;
    }

    return root;
  }

  union(a: Vec2, b: Vec2): void {
    const rootA = this.find(a);
    const rootB = this.find(b);

    if (rootA === rootB) return;

    const rankA = this.rank.get(rootA) || 0;
    const rankB = this.rank.get(rootB) || 0;

    if (rankA < rankB) {
      this.parent.set(rootA, rootB);
    } else if (rankA > rankB) {
      this.parent.set(rootB, rootA);
    } else {
      this.parent.set(rootB, rootA);
      this.rank.set(rootA, rankA + 1);
    }
  }

  connected(a: Vec2, b: Vec2): boolean {
    return this.find(a) === this.find(b);
  }

  getComponents(): Vec2[][] {
    const components = new Map<string, Vec2[]>();

    for (const key of this.parent.keys()) {
      const [x, z] = key.split('_').map(Number);
      const root = this.find({ x, z });

      if (!components.has(root)) {
        components.set(root, []);
      }
      components.get(root)!.push({ x, z });
    }

    return Array.from(components.values());
  }
}

// ========================================
// Street Generator
// ========================================

export class StreetGenerator {
  private readonly config: Required<StreetGeneratorConfig>;
  private rng: () => number;
  private noise: SeededNoiseCollection;
  private segments: StreetSegment[] = [];
  private segmentIdCounter = 0;
  private intersections: Vec2[] = [];
  private unionFind: UnionFind;

  // Constants
  private readonly MAX_SLOPE = 0.15; // 15% max slope
  private readonly MIN_INTERSECTION_SPACING = 30; // meters
  private readonly SAMPLE_DISTANCE = 3; // meters between path samples (finer for terrain following)

  constructor(config: StreetGeneratorConfig) {
    this.config = {
      seed: config.seed,
      worldSize: config.worldSize ?? 1000,
      hqPosition: config.hqPosition ?? { x: 0, z: 0 },
      terrainSampler: config.terrainSampler ?? (() => 0),
      minSpawnDistance: config.minSpawnDistance ?? 300,
      maxSpawnDistance: config.maxSpawnDistance ?? 450,
    };

    // Initialize RNG with street-specific seed
    const streetSeed = hashSeed(this.config.seed, 31337);
    this.rng = mulberry32(streetSeed);
    this.noise = createSeededNoise(streetSeed);
    this.unionFind = new UnionFind();
  }

  /**
   * Generate complete street network.
   * Organic through-roads that cross the world - HQ is NOT the center.
   */
  generate(): StreetGeneratorResult {
    this.segments = [];
    this.intersections = [];
    this.unionFind = new UnionFind();
    this.segmentIdCounter = 0;

    const { hqPosition } = this.config;

    // Phase 1: Main through-roads (edge to edge, NOT centered on HQ)
    const roadEnds = this.generateThroughRoads();

    // Phase 2: Cross-connections between through-roads
    this.generateCrossConnections();

    // Phase 3: Short connector from HQ to nearest road
    this.connectHQ(hqPosition);

    // Phase 4: Ensure all roads connect
    this.ensureConnectivity();

    // Phase 5: Generate spawns at road endpoints
    const spawns = this.generateSpawnsAtEnds(roadEnds);

    console.log(
      `[StreetGen] Generated ${this.segments.length} segments, ` +
      `${this.intersections.length} intersections, ` +
      `${spawns.length} spawn points`
    );

    return { segments: this.segments, spawns };
  }

  /**
   * Generate main through-roads from edge to edge.
   * These are NOT centered on HQ - they just pass through the world.
   */
  private generateThroughRoads(): Vec2[] {
    const { worldSize } = this.config;
    const halfWorld = worldSize / 2;
    const roadEnds: Vec2[] = [];

    // 4-5 main roads crossing the map
    const numRoads = 4 + Math.floor(this.rng() * 2);

    for (let i = 0; i < numRoads; i++) {
      // Pick random start edge (0=S, 1=E, 2=N, 3=W)
      const startEdge = Math.floor(this.rng() * 4);
      // End on opposite-ish edge (not same edge)
      const endEdge = (startEdge + 1 + Math.floor(this.rng() * 2)) % 4;

      const start = this.getEdgePoint(startEdge, halfWorld);
      const end = this.getEdgePoint(endEdge, halfWorld);

      // Generate curved path between edges
      const path = this.generateCurvedPath(start, end);

      // Add as segments
      for (let j = 0; j < path.length - 1; j++) {
        this.segments.push({
          id: `road-${i}-${j}`,
          from: [path[j].x, path[j].z],
          to: [path[j + 1].x, path[j + 1].z],
          type: 'primary',
        });
        this.addIntersection(path[j]);
        this.unionFind.union(path[j], path[j + 1]);
      }
      this.addIntersection(path[path.length - 1]);

      roadEnds.push(start, end);
    }

    return roadEnds;
  }

  /**
   * Get a random point on a world edge.
   */
  private getEdgePoint(edge: number, halfWorld: number): Vec2 {
    const margin = 30;
    const randomOffset = (this.rng() - 0.5) * halfWorld * 1.2;

    switch (edge) {
      case 0: return { x: randomOffset, z: -halfWorld + margin }; // South
      case 1: return { x: halfWorld - margin, z: randomOffset };  // East
      case 2: return { x: randomOffset, z: halfWorld - margin };  // North
      case 3: return { x: -halfWorld + margin, z: randomOffset }; // West
      default: return { x: 0, z: -halfWorld + margin };
    }
  }

  /**
   * Generate a gently curved path between two points.
   * Uses 1-2 control points for smooth Bezier-like curves.
   */
  private generateCurvedPath(start: Vec2, end: Vec2): Vec2[] {
    const path: Vec2[] = [];
    const dist = distance(start, end);
    const numSegments = Math.max(3, Math.floor(dist / 80)); // ~80m per segment

    // 1-2 random control points for curve
    const numControls = 1 + Math.floor(this.rng() * 2);
    const controls: Vec2[] = [start];

    for (let i = 0; i < numControls; i++) {
      const t = (i + 1) / (numControls + 1);
      const basePoint = lerp(start, end, t);
      // Offset perpendicular to line
      const perpOffset = (this.rng() - 0.5) * dist * 0.3;
      const angle = Math.atan2(end.z - start.z, end.x - start.x) + Math.PI / 2;
      controls.push({
        x: basePoint.x + Math.cos(angle) * perpOffset,
        z: basePoint.z + Math.sin(angle) * perpOffset,
      });
    }
    controls.push(end);

    // Sample smooth curve through control points
    for (let i = 0; i <= numSegments; i++) {
      const t = i / numSegments;
      const point = this.sampleBezier(controls, t);
      path.push(point);
    }

    return path;
  }

  /**
   * Sample a point on a Bezier curve through control points.
   */
  private sampleBezier(controls: Vec2[], t: number): Vec2 {
    if (controls.length === 2) {
      return lerp(controls[0], controls[1], t);
    }

    // De Casteljau's algorithm
    const next: Vec2[] = [];
    for (let i = 0; i < controls.length - 1; i++) {
      next.push(lerp(controls[i], controls[i + 1], t));
    }
    return this.sampleBezier(next, t);
  }

  /**
   * Add cross-connections between existing roads where they come close.
   */
  private generateCrossConnections(): void {
    const intersectionPoints: Vec2[] = [...this.intersections];

    // Find pairs of intersections that are close but not connected
    for (let i = 0; i < intersectionPoints.length; i++) {
      for (let j = i + 1; j < intersectionPoints.length; j++) {
        const a = intersectionPoints[i];
        const b = intersectionPoints[j];
        const dist = distance(a, b);

        // Connect if 40-150m apart and not already connected
        if (dist > 40 && dist < 150 && !this.unionFind.connected(a, b)) {
          if (this.rng() < 0.4) { // 40% chance to connect
            this.segments.push({
              id: `cross-${this.segmentIdCounter++}`,
              from: [a.x, a.z],
              to: [b.x, b.z],
              type: 'secondary',
            });
            this.unionFind.union(a, b);
          }
        }
      }
    }
  }

  /**
   * Connect HQ to nearest road with a SHORT connector.
   */
  private connectHQ(hqPosition: Vec2): void {
    // Find closest point on any segment
    let nearest: Vec2 | null = null;
    let minDist = Infinity;

    for (const seg of this.segments) {
      const from: Vec2 = { x: seg.from[0], z: seg.from[1] };
      const to: Vec2 = { x: seg.to[0], z: seg.to[1] };
      const closest = this.closestPointOnSegment(hqPosition, from, to);
      const dist = distance(closest, hqPosition);

      if (dist < minDist) {
        minDist = dist;
        nearest = closest;
      }
    }

    // Only connect if HQ is not already on a road
    if (nearest && minDist > 5) {
      this.segments.push({
        id: `hq-connector`,
        from: [hqPosition.x, hqPosition.z],
        to: [nearest.x, nearest.z],
        type: 'residential',
      });
      this.addIntersection(hqPosition);
      this.addIntersection(nearest);
      this.unionFind.union(hqPosition, nearest);
    }
  }

  /**
   * Generate spawn points at road endpoints (far from HQ).
   */
  private generateSpawnsAtEnds(roadEnds: Vec2[]): SpawnPoint[] {
    const { hqPosition, minSpawnDistance } = this.config;
    const spawns: SpawnPoint[] = [];
    const directions = ['North', 'Northeast', 'East', 'Southeast', 'South', 'Southwest', 'West', 'Northwest'];
    const usedDirs = new Set<string>();

    // Sort by distance from HQ (farthest first)
    const sorted = roadEnds
      .map(pos => ({ pos, dist: distance(pos, hqPosition) }))
      .filter(p => p.dist >= minSpawnDistance * 0.7)
      .sort((a, b) => b.dist - a.dist);

    for (const { pos } of sorted) {
      if (spawns.length >= 4) break;

      const angle = Math.atan2(pos.z - hqPosition.z, pos.x - hqPosition.x);
      const dirIndex = Math.round((angle + Math.PI) / (Math.PI / 4)) % 8;
      const dir = directions[dirIndex];

      if (usedDirs.has(dir)) continue;
      usedDirs.add(dir);

      spawns.push({
        id: `spawn-${spawns.length}`,
        name: dir,
        position: { x: pos.x, z: pos.z },
        description: `Spawn from ${dir}`,
      });
    }

    return spawns;
  }

  /**
   * Convert path points to street segments.
   */
  private pathToSegments(path: Vec2[], type: StreetType, baseName: string): void {
    if (path.length < 2) return;

    // Simplify path - use larger epsilon for longer, more consistent segments
    // This helps building alignment (buildings align to segment direction)
    const simplified = this.simplifyPath(path, 8);

    for (let i = 0; i < simplified.length - 1; i++) {
      const from = simplified[i];
      const to = simplified[i + 1];

      // Skip very short segments
      if (distance(from, to) < 3) continue;

      this.segments.push({
        id: `${baseName}-${i}`,
        from: [from.x, from.z],
        to: [to.x, to.z],
        type,
      });

      // Add intersections and update Union-Find
      this.addIntersection(from);
      this.addIntersection(to);
      this.unionFind.union(from, to);
    }
  }

  /**
   * Simplify path using Ramer-Douglas-Peucker algorithm.
   */
  private simplifyPath(path: Vec2[], epsilon: number): Vec2[] {
    if (path.length <= 2) return path;

    // Find point with max distance from line
    const first = path[0];
    const last = path[path.length - 1];
    let maxDist = 0;
    let maxIndex = 0;

    for (let i = 1; i < path.length - 1; i++) {
      const dist = this.pointToLineDistance(path[i], first, last);
      if (dist > maxDist) {
        maxDist = dist;
        maxIndex = i;
      }
    }

    if (maxDist > epsilon) {
      // Recursively simplify
      const left = this.simplifyPath(path.slice(0, maxIndex + 1), epsilon);
      const right = this.simplifyPath(path.slice(maxIndex), epsilon);
      return [...left.slice(0, -1), ...right];
    }

    return [first, last];
  }

  private pointToLineDistance(p: Vec2, a: Vec2, b: Vec2): number {
    const ab = sub(b, a);
    const ap = sub(p, a);
    const abLen = length(ab);
    if (abLen < 0.001) return distance(p, a);

    const t = Math.max(0, Math.min(1, (ap.x * ab.x + ap.z * ab.z) / (abLen * abLen)));
    const closest = add(a, scale(ab, t));
    return distance(p, closest);
  }

  /**
   * Add intersection point (with spacing check).
   */
  private addIntersection(p: Vec2): void {
    // Check if already near existing intersection
    if (!this.nearExistingIntersection(p, this.MIN_INTERSECTION_SPACING * 0.5)) {
      this.intersections.push({ ...p });
      this.unionFind.add(p);
    }
  }

  /**
   * Check if point is near an existing intersection.
   */
  private nearExistingIntersection(p: Vec2, threshold: number): boolean {
    for (const intersection of this.intersections) {
      if (distance(p, intersection) < threshold) {
        return true;
      }
    }
    return false;
  }

  /**
   * Ensure all streets are connected to HQ.
   */
  private ensureConnectivity(): void {
    const { hqPosition } = this.config;
    const components = this.unionFind.getComponents();

    if (components.length <= 1) return;

    // Find component containing HQ
    const hqRoot = this.unionFind.find(hqPosition);
    let mainComponent: Vec2[] | null = null;
    const disconnected: Vec2[][] = [];

    for (const component of components) {
      if (component.length === 0) continue;
      const compRoot = this.unionFind.find(component[0]);
      if (compRoot === hqRoot) {
        mainComponent = component;
      } else {
        disconnected.push(component);
      }
    }

    if (!mainComponent || disconnected.length === 0) return;

    console.log(`[StreetGen] Connecting ${disconnected.length} disconnected components`);

    // Create bridge segments to connect disconnected components
    for (const component of disconnected) {
      // Find closest pair of points between main component and this one
      let minDist = Infinity;
      let bridgeFrom: Vec2 | null = null;
      let bridgeTo: Vec2 | null = null;

      for (const mainPoint of mainComponent) {
        for (const compPoint of component) {
          const d = distance(mainPoint, compPoint);
          if (d < minDist) {
            minDist = d;
            bridgeFrom = mainPoint;
            bridgeTo = compPoint;
          }
        }
      }

      if (bridgeFrom && bridgeTo) {
        // Create bridge segment
        const bridgePath = sampleLinearPath(bridgeFrom, bridgeTo, this.SAMPLE_DISTANCE);
        this.pathToSegments(bridgePath, 'secondary', `bridge-${this.segmentIdCounter}`);

        // Merge into main component
        mainComponent.push(...component);
        this.unionFind.union(bridgeFrom, bridgeTo);
      }
    }
  }

  /**
   * Find closest point on a line segment to a given point.
   */
  private closestPointOnSegment(p: Vec2, a: Vec2, b: Vec2): Vec2 {
    const ab: Vec2 = { x: b.x - a.x, z: b.z - a.z };
    const ap: Vec2 = { x: p.x - a.x, z: p.z - a.z };
    const abLen2 = ab.x * ab.x + ab.z * ab.z;

    if (abLen2 === 0) return a; // Segment is a point

    let t = (ap.x * ab.x + ap.z * ab.z) / abLen2;
    t = Math.max(0, Math.min(1, t));

    return {
      x: a.x + t * ab.x,
      z: a.z + t * ab.z,
    };
  }
}
