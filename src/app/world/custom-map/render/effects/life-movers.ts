import { Group, InstancedMesh, type Material, Matrix4, Quaternion, Vector3 } from 'three';
import type { MapLifeArea } from '../../map-document';
import { areaDensity, centroid, DEFAULT_BOAT, lifeSeed, lifeRandom, loopInside } from '../../map-life';
import { addHeightFog } from '../environment/height-fog';
import type { HeightField } from '../height-field';
import type { MapAssetLibrary } from '../map-asset-library';
import { mapToScene } from '../map-coords';
import { routeLoop } from './life-areas';

/**
 * Things of the life areas (map-life.ts) that go round: boats (kind `boats`)
 * drifting on the water with the rocking of floating objects, and movers
 * (kind `movers`: a rover, a cart, grazing animals) going over the ground,
 * pitched with it, or with a `height` hanging from a straight line (a
 * gondola on its cable). Each goes round a loop of its own inside an area's
 * outline, or up a route on one side and back on the other, front ahead. One
 * instanced mesh per part of each model; the CPU moves a few dozen matrices
 * a frame. Drawn only: they block neither sight nor building nor the
 * enemies' way, and cast no shadow (the map's sun shadow is cached and would
 * not follow them).
 */

/** Per kind: how many an area and a route hold at density 1, the most of one area, speeds (m/s, times a mover's own speed share), how far a route's two lanes lie apart */
const KINDS = {
  boats: { area: 4, route: 3, most: 24, areaSpeed: [0.5, 1.2], routeSpeed: [1.5, 2.5], lane: 4 },
  movers: { area: 3, route: 2, most: 16, areaSpeed: [0.8, 1.2], routeSpeed: [0.9, 1.1], lane: 2.5 },
} as const;
/** Points of each loop */
const LOOP_SAMPLES = 64;
/** A mover's speed when its area names none, m/s */
export const MOVER_SPEED = 1.5;

interface Mover {
  /** Scene points of its loop (on the water or the ground), and the running length to each */
  loop: Vector3[];
  along: number[];
  /** m/s, with the way round */
  speed: number;
  phase: number;
  /** Rocks like a boat */
  floats: boolean;
  /** Tilts with the ground it goes over (not a boat, not hanging from a line) */
  pitched: boolean;
}

interface Fleet {
  meshes: InstancedMesh[];
  movers: Mover[];
}

export class LifeMovers {
  readonly group = new Group();
  private fleets: Fleet[] = [];
  private time = 0;
  /** Materials by source, kept so a fleet set anew finds its programs */
  private readonly materials = new Map<Material, Material>();
  private generation = 0;
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly tilt = new Quaternion();
  private readonly p = new Vector3();
  private readonly s = new Vector3(1, 1, 1);
  private readonly up = new Vector3(0, 1, 0);
  private readonly axis = new Vector3();

  constructor(
    private readonly assets: MapAssetLibrary,
    private readonly field: HeightField,
    private readonly waterLevelAt: (x: number, y: number) => number | null,
  ) {
    this.group.name = 'custom-map-life-movers';
    this.group.userData['losTransparent'] = true;
  }

  /** What goes round in these areas (those of kind boats and movers), `factor` the map's density; a later call wins over one still loading */
  async set(areas: readonly MapLifeArea[], factor: number): Promise<void> {
    const generation = ++this.generation;
    const fleets: Fleet[] = [];
    for (const area of areas) {
      if (area.kind !== 'boats' && area.kind !== 'movers') continue;
      const asset = area.asset ?? (area.kind === 'boats' ? DEFAULT_BOAT : null);
      if (!asset) continue;
      const model = await this.assets.model(asset).catch(() => null);
      if (generation !== this.generation) return;
      if (!model || model.placeholder) continue;
      const movers = this.moversOf(area, factor);
      if (!movers.length) continue;
      const meshes = model.parts.map((part) => {
        const mesh = new InstancedMesh(part.geometry, this.material(part.material), movers.length);
        mesh.name = `custom-map-life-${area.kind}-${asset}`;
        mesh.frustumCulled = false;
        mesh.receiveShadow = true;
        mesh.userData['losTransparent'] = true;
        return mesh;
      });
      fleets.push({ meshes, movers });
    }
    if (generation !== this.generation) return;
    this.clear();
    this.fleets = fleets;
    for (const f of fleets) this.group.add(...f.meshes);
    this.update(0);
  }

  /** Moves them on; `dt` 0 holds them (a still frame) */
  update(dt: number): void {
    this.time += dt;
    for (const f of this.fleets) {
      f.movers.forEach((b, k) => {
        this.place(b);
        for (const mesh of f.meshes) mesh.setMatrixAt(k, this.m);
      });
      for (const mesh of f.meshes) mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /** The area's movers on their loops: boats on the water (over land at the level of the water they last crossed), movers on the ground */
  private moversOf(area: MapLifeArea, factor: number): Mover[] {
    const kind = KINDS[area.kind as keyof typeof KINDS];
    const floats = area.kind === 'boats';
    const onArea = area.shape === 'area';
    const count = Math.min(kind.most, Math.round((onArea ? kind.area : kind.route) * areaDensity(area) * factor));
    const seed = lifeSeed(area.id);
    const random = lifeRandom(seed);
    const [slow, fast] = onArea ? kind.areaSpeed : kind.routeSpeed;
    const own = floats ? 1 : (area.speed ?? MOVER_SPEED) / MOVER_SPEED;
    const out: Mover[] = [];
    for (let k = 0; k < count; k++) {
      const flat = onArea ? loopInside(area.points, seed + k * 7919, LOOP_SAMPLES, 0.35 + random() * 0.5) : routeLoop(area.points, kind.lane);
      let level: number | null = null;
      const first = floats ? (flat.map((p) => this.waterLevelAt(p.x, p.y)).find((l) => l !== null) ?? null) : null;
      const aloft = !floats && area.height !== undefined ? this.cable(area) : null;
      const loop = flat.map((p) => {
        const h = floats
          ? (level = this.waterLevelAt(p.x, p.y) ?? level ?? first ?? this.field.heightAt(p.x, p.y))
          : aloft
            ? aloft(p.x, p.y)
            : this.field.heightAt(p.x, p.y);
        return mapToScene(p.x, p.y, h, new Vector3());
      });
      const along = [0];
      for (let i = 1; i <= loop.length; i++) along.push(along[i - 1] + loop[i - 1].distanceTo(loop[i % loop.length]));
      // In an area each goes its own way round; on a route all keep to their lane
      const way = onArea && random() < 0.5 ? -1 : 1;
      const speed = (slow + random() * (fast - slow)) * (floats ? 1 : MOVER_SPEED) * own;
      out.push({ loop, along, speed: speed * way, phase: random(), floats, pitched: !floats && !aloft });
    }
    return out;
  }

  /**
   * A mover with a height hangs from a line instead of going over the ground
   * (a gondola on its cable): along a route straight from `height` over the
   * ground at its start to `height` over the ground at its end, over an
   * outline `height` over the ground at its middle
   */
  private cable(area: MapLifeArea): (x: number, y: number) => number {
    const h = area.height ?? 0;
    const pts = area.points;
    if (area.shape === 'area') {
      const c = centroid(pts);
      const top = this.field.heightAt(c.x, c.y) + h;
      return () => top;
    }
    const a = pts[0];
    const b = pts[pts.length - 1];
    const ha = this.field.heightAt(a.x, a.y) + h;
    const hb = this.field.heightAt(b.x, b.y) + h;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy || 1;
    return (x, y) => ha + (hb - ha) * Math.min(1, Math.max(0, ((x - a.x) * dx + (y - a.y) * dy) / len2));
  }

  /** The mover's matrix now into `m`: on its loop, front ahead, a boat rocking, a mover pitched with the ground */
  private place(b: Mover): void {
    const length = b.along[b.along.length - 1];
    if (length <= 0) return;
    const d = (((b.phase * length + this.time * b.speed) % length) + length) % length;
    let i = 0;
    while (i < b.loop.length - 1 && b.along[i + 1] < d) i++;
    const a = b.loop[i];
    const c = b.loop[(i + 1) % b.loop.length];
    const t = (d - b.along[i]) / Math.max(1e-6, b.along[i + 1] - b.along[i]);
    this.p.lerpVectors(a, c, t);
    // Front ahead (+z of the model), the way it goes
    const dir = Math.sign(b.speed);
    this.q.setFromAxisAngle(this.up, Math.atan2((c.x - a.x) * dir, (c.z - a.z) * dir));
    if (b.floats) {
      const w = this.time + b.phase * 40;
      this.p.y += Math.sin(w * 0.9) * 0.06;
      this.tilt.setFromAxisAngle(this.axis.set(0, 0, 1), Math.sin(w * 0.7) * 0.035);
      this.q.multiply(this.tilt);
      this.tilt.setFromAxisAngle(this.axis.set(1, 0, 0), Math.sin(w * 0.55) * 0.025);
      this.q.multiply(this.tilt);
    } else if (b.pitched) {
      const run = Math.hypot(c.x - a.x, c.z - a.z);
      if (run > 1e-3) {
        this.tilt.setFromAxisAngle(this.axis.set(1, 0, 0), -Math.atan2((c.y - a.y) * dir, run));
        this.q.multiply(this.tilt);
      }
    }
    this.m.compose(this.p, this.q, this.s);
  }

  private material(source: Material): Material {
    let m = this.materials.get(source);
    if (!m) {
      m = source.clone();
      addHeightFog(m);
      this.materials.set(source, m);
    }
    return m;
  }

  private clear(): void {
    for (const f of this.fleets) for (const mesh of f.meshes) {
      mesh.removeFromParent();
      mesh.dispose();
    }
    this.fleets = [];
  }

  dispose(): void {
    this.generation++;
    this.clear();
    for (const m of this.materials.values()) m.dispose();
    this.materials.clear();
    this.group.removeFromParent();
  }
}
