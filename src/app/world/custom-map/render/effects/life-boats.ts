import { Group, InstancedMesh, type Material, Matrix4, Quaternion, Vector3 } from 'three';
import type { MapLifeArea } from '../../map-document';
import { areaDensity, DEFAULT_BOAT, lifeSeed, lifeRandom, loopInside } from '../../map-life';
import { addHeightFog } from '../environment/height-fog';
import type { HeightField } from '../height-field';
import type { MapAssetLibrary } from '../map-asset-library';
import { mapToScene } from '../map-coords';
import { routeLoop } from './life-areas';

/**
 * Boats of the life areas (map-life.ts, kind `boats`) drifting on the water:
 * each boat goes round a slow loop of its own inside an area's outline, or
 * up a route on one side and back on the other, on the water's level, with
 * the rocking of floating objects (object-layer.ts). One instanced mesh per
 * part of each boat model; the CPU moves a few dozen matrices a frame. Drawn
 * only: the boats block neither sight nor building, and cast no shadow (the
 * map's sun shadow is cached and would not follow them).
 */

/** Boats of an area and of a route at density 1, and the most of one area */
const AREA_BOATS = 4;
const ROUTE_BOATS = 3;
const MOST_BOATS = 24;
/** Points of each boat's loop */
const LOOP_SAMPLES = 64;

interface Boat {
  /** Scene points of its loop on the water, and the running length to each */
  loop: Vector3[];
  along: number[];
  speed: number;
  phase: number;
}

interface Fleet {
  meshes: InstancedMesh[];
  boats: Boat[];
}

export class LifeBoats {
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
    this.group.name = 'custom-map-life-boats';
    this.group.userData['losTransparent'] = true;
  }

  /** The boats of these areas (those of kind boats), `factor` the map's density; a later call wins over one still loading */
  async set(areas: readonly MapLifeArea[], factor: number): Promise<void> {
    const generation = ++this.generation;
    const wanted = areas.filter((a) => a.kind === 'boats');
    const fleets: Fleet[] = [];
    for (const area of wanted) {
      const asset = area.asset ?? DEFAULT_BOAT;
      const model = await this.assets.model(asset).catch(() => null);
      if (generation !== this.generation) return;
      if (!model || model.placeholder) continue;
      const boats = this.boatsOf(area, factor);
      if (!boats.length) continue;
      const meshes = model.parts.map((part) => {
        const mesh = new InstancedMesh(part.geometry, this.material(part.material), boats.length);
        mesh.name = `custom-map-life-boat-${asset}`;
        mesh.frustumCulled = false;
        mesh.receiveShadow = true;
        mesh.userData['losTransparent'] = true;
        return mesh;
      });
      fleets.push({ meshes, boats });
    }
    if (generation !== this.generation) return;
    this.clear();
    this.fleets = fleets;
    for (const f of fleets) this.group.add(...f.meshes);
    this.update(0);
  }

  /** Moves the boats on; `dt` 0 holds them (a still frame) */
  update(dt: number): void {
    this.time += dt;
    for (const f of this.fleets) {
      f.boats.forEach((b, k) => {
        this.place(b);
        for (const mesh of f.meshes) mesh.setMatrixAt(k, this.m);
      });
      for (const mesh of f.meshes) mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /** Boats on the area's loops; loops on dry land keep the level of the water before them */
  private boatsOf(area: MapLifeArea, factor: number): Boat[] {
    const density = areaDensity(area) * factor;
    const count = Math.min(MOST_BOATS, Math.round((area.shape === 'area' ? AREA_BOATS : ROUTE_BOATS) * density));
    const seed = lifeSeed(area.id);
    const random = lifeRandom(seed);
    const out: Boat[] = [];
    for (let k = 0; k < count; k++) {
      const flat = area.shape === 'area' ? loopInside(area.points, seed + k * 7919, LOOP_SAMPLES, 0.35 + random() * 0.5) : routeLoop(area.points, 4);
      let level: number | null = null;
      const first = flat.map((p) => this.waterLevelAt(p.x, p.y)).find((l) => l !== null) ?? null;
      const loop = flat.map((p) => {
        level = this.waterLevelAt(p.x, p.y) ?? level ?? first ?? this.field.heightAt(p.x, p.y);
        return mapToScene(p.x, p.y, level, new Vector3());
      });
      const along = [0];
      for (let i = 1; i <= loop.length; i++) along.push(along[i - 1] + loop[i - 1].distanceTo(loop[i % loop.length]));
      out.push({ loop, along, speed: (area.shape === 'area' ? 0.5 + random() * 0.7 : 1.5 + random()) * (random() < 0.5 ? 1 : -1), phase: random() });
    }
    return out;
  }

  /** The boat's matrix now into `m`: on its loop, heading along it, rocking */
  private place(b: Boat): void {
    const length = b.along[b.along.length - 1];
    if (length <= 0) return;
    const d = (((b.phase * length + this.time * b.speed) % length) + length) % length;
    let i = 0;
    while (i < b.loop.length - 1 && b.along[i + 1] < d) i++;
    const a = b.loop[i];
    const c = b.loop[(i + 1) % b.loop.length];
    const t = (d - b.along[i]) / Math.max(1e-6, b.along[i + 1] - b.along[i]);
    this.p.lerpVectors(a, c, t);
    // Bow ahead (+z of the model), the way it goes
    const dx = (c.x - a.x) * Math.sign(b.speed);
    const dz = (c.z - a.z) * Math.sign(b.speed);
    this.q.setFromAxisAngle(this.up, Math.atan2(dx, dz));
    const w = this.time + b.phase * 40;
    this.p.y += Math.sin(w * 0.9) * 0.06;
    this.tilt.setFromAxisAngle(this.axis.set(0, 0, 1), Math.sin(w * 0.7) * 0.035);
    this.q.multiply(this.tilt);
    this.tilt.setFromAxisAngle(this.axis.set(1, 0, 0), Math.sin(w * 0.55) * 0.025);
    this.q.multiply(this.tilt);
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
