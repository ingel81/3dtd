import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshDepthMaterial,
  Quaternion,
  RGBADepthPacking,
  Vector3,
  type Material,
  type MeshStandardMaterial,
  type Object3D,
  type Ray,
  type Raycaster,
  type Texture,
} from 'three';
import { MASS_ASSET, type MapMassFacade, type MapObject } from '../../map-document';
import { cellarDepth, cellarFrame, cellarOf } from '../../object-cellar';
import {
  massBodies,
  massBounds,
  massDistance,
  massRadius,
  massRoof,
  massTop,
  type MassBody,
} from '../../object-mass';
import { toModel } from '../../object-ground';
import type { HeightField } from '../height-field';
import type { MapAssetLibrary, ObjectModel } from '../map-asset-library';
import { addHeightFog } from '../environment/height-fog';
import { mapToScene } from '../map-coords';
import { NIGHT_WINDOW_UNIFORMS } from './night-windows';
import { seatHeight, type ObjectFooting } from './object-seat';
import { rubbleMaterialOf } from '../../rubble-material';
import type { RuinFootprint, RuinSlabs } from './ruin-slabs';
import { WALL_FACADE, WALL_GABLE, WALL_PLAIN, WALL_SHOP, type WallPiece } from './mass-openings';
import { asRuin, collapseCuts, DAMAGE_ATTRIBUTES, DAMAGE_LOS, damageArrays, type DamageArrays, damageDepthMaterial, emberPoint, FELL_LONG_AGO, RUIN_HOLES, type RuinFrame, ruinSeed, ruinShape, type RuinShape, writeDamage } from './ruin-damage';
import { seedOf } from '../../../../utils/seeded-random';
import { FLAT_ROOF_FRAGMENT, GABLE_GLSL, GABLE_PARS, ROOF_UV_VERTEX, WALL_COLOR_FRAGMENT, WALL_FRAGMENT_PARS, WALL_NIGHT_FRAGMENT, WALL_SHINE_FRAGMENT, WALL_UV_VERTEX, WALL_VERTEX_PARS } from './mass-shaders';
import { cellarBodies, type Covering, FACADE_INDEX, FACADE_SURFACE, type MassShape, massShape, PARAPET_THICKNESS, roofTintFactor, splitWalls } from './mass-shape';

// ---- Drawing ----

/** One drawn primitive of the layer: its mesh and per instance the object it belongs to */
interface Batch {
  mesh: InstancedMesh;
  owners: MapObject[];
  /** What it draws: a facade's walls, a covering's roofs or the caps (partsOf) */
  part: string;
}

/** The batches a building is drawn with, as Batch.part: its bodies' facades' walls, their coverings' roofs, the caps */
function partsOf(o: MapObject): string[] {
  const seed = massSeed(o.id);
  return [...new Set(cellarBodies(massBodies(o.mass!), o).flatMap((b) => [`walls:${b.facade}`, `roof:${massShape(b, seed).covering}`])), 'caps'];
}

/** What the mass layer does with damage (ObjectLayerOptions): ruins built with the map, the ground buildings stand on */
interface MassDamageOptions {
  ruins?: boolean;
  standingAt?: (x: number, y: number) => number;
  /** The ruins' floors (ruin-slabs.ts), shared with the object layer */
  slabs?: RuinSlabs | null;
}

/** Gap between a fallen wall's stump and the piece that falls, m: the stump stays, the piece goes whole */
const SPLIT_GAP = 0.01;

/** Metres a wall may stand off a building's door (MapMass.door) and still take it */
const DOOR_REACH = 1;

/**
 * The wall a building's door (MapMass.door) is on, of all its bodies' walls
 * standing on the ground with windows (a facade or a shop's): the nearest
 * within DOOR_REACH, and the metres along the whole wall to the door; null
 * for none. Only that wall's ground floor shows a door (WALL_COLOR_FRAGMENT)
 */
function doorWall(door: readonly [number, number], bodyWalls: readonly (readonly WallPiece[])[]): { piece: WallPiece; u: number } | null {
  let best: { piece: WallPiece; u: number; d: number } | null = null;
  for (const walls of bodyWalls) {
    for (const p of walls) {
      if (p.corner || p.bottom > 0.5 || (p.kind !== WALL_FACADE && p.kind !== WALL_SHOP)) continue;
      const t = Math.max(0, Math.min(p.length, (door[0] - p.sx) * p.ax + (door[1] - p.sz) * p.az));
      const d = Math.hypot(p.sx + p.ax * t - door[0], p.sz + p.az * t - door[1]);
      if (d <= DOOR_REACH && (!best || d < best.d)) best = { piece: p, u: (p.u0 ?? 0) + t, d };
    }
  }
  return best && { piece: best.piece, u: best.u };
}

/** The surfaces of the kit (catalogue `building-mass`) by material name, with their repeat in metres */
interface Surface {
  material: MeshStandardMaterial;
  tile: number;
}

const UNIT_QUAD = (() => {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
})();

/** A unit quad lying flat (x along, z across), facing up */
const UNIT_FLAT = (() => {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1]), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));
  g.setIndex([0, 2, 1, 0, 3, 2]);
  return g;
})();

/** A unit triangle lying flat: corners (0, 0, 0), (1, 0, 0), (0, 0, 1), facing up */
const UNIT_TRIANGLE = (() => {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1]), 2));
  g.setIndex([0, 2, 1]);
  return g;
})();

interface MassHit {
  object: MapObject;
  point: Vector3;
  distance: number;
}

export class MassLayer {
  /** Raised buildings that block no sight; those that do go into the LOS group */
  readonly group = new Group();
  private objects: MapObject[] = [];
  private readonly ids = new Set<string>();
  /** Where each building stands (its seat plus its own z), by id: a change of the ground moves its instances up or down */
  private readonly seats = new Map<string, number>();
  private batches: Batch[] = [];
  /** The ruins' batches (also in `batches`), built anew on each change of damage */
  private ruinBatches: Batch[] = [];
  /** Each building's instances in the intact batches, which a damaged one leaves */
  private readonly ranges = new Map<string, { batch: Batch; start: number; count: number }[]>();
  /** Damaged buildings by id (setDamage) */
  private readonly damaged = new Map<string, { stage: number; fallStart: number; heading: number | null }>();
  /** The ruins as last built, with their seats */
  private readonly ruinShapes = new Map<string, { shape: RuinShape; seat: number }>();
  private ruinDepth: MeshDepthMaterial | null = null;
  private ruinWallDepth: MeshDepthMaterial | null = null;
  private surfaces: Map<string, Surface> | null = null;
  private loading: Promise<Map<string, Surface> | null> | null = null;
  private readonly materials = new Map<string, Material>();
  private readonly depthMaterial: MeshDepthMaterial;
  private generation = 0;
  /** The generation whose build stands (rebuild) */
  private built = -1;
  private readonly m = new Matrix4();
  private readonly local = new Matrix4();
  private readonly q = new Quaternion();
  private readonly up = new Vector3(0, 1, 0);
  private readonly v = new Vector3();
  private readonly s = new Vector3();
  /** Counts every change the sun's shadow map shows */
  version = 0;

  constructor(
    private readonly field: HeightField,
    private readonly assets: MapAssetLibrary,
    private readonly losGroup: Group,
    private readonly waterLevelAt: (x: number, y: number) => number | null = () => null,
    /** Hears every change the sun's shadow map shows */
    private readonly onChange: () => void = () => undefined,
    private readonly damageOptions: MassDamageOptions = {},
  ) {
    this.group.name = 'custom-map-masses';
    this.group.userData['losTransparent'] = true;
    // The sun's shadow sees a gable drawn in to its point as the wall does
    this.depthMaterial = new MeshDepthMaterial({ depthPacking: RGBADepthPacking });
    this.depthMaterial.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${GABLE_PARS}`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>\n${GABLE_GLSL}`);
    };
    this.depthMaterial.customProgramCacheKey = () => 'mass-depth';
  }

  /** Whether an object is drawn here */
  static owns(o: MapObject): boolean {
    return o.asset === MASS_ASSET && !!o.mass;
  }

  /** Replaces every raised building (MassLayer.owns); resolves when they show */
  async setObjects(objects: readonly MapObject[]): Promise<void> {
    this.objects = [...objects];
    this.ids.clear();
    for (const o of objects) this.ids.add(o.id);
    await this.rebuild();
  }

  /** Adds, replaces (by id) or removes raised buildings; resolves when they show */
  async change(added: readonly MapObject[], removed: readonly string[]): Promise<void> {
    if (!added.length && !removed.length) return;
    const gone = new Set([...removed, ...added.map((o) => o.id)]);
    this.objects = this.objects.filter((o) => !gone.has(o.id)).concat(added);
    for (const id of gone) this.ids.delete(id);
    for (const o of added) this.ids.add(o.id);
    await this.rebuild();
  }

  /**
   * Takes raised buildings away. Ruins only (what a crater wiped out,
   * crater-obliteration.ts) leave with their ruins' batches built anew, not
   * every building's; anything else as change does
   */
  remove(ids: readonly string[]): Promise<void> {
    if (!ids.length) return Promise.resolve();
    if (!this.surfaces || this.generation !== this.built || ids.some((id) => !this.damaged.has(id))) return this.change([], ids);
    const gone = new Set(ids);
    this.objects = this.objects.filter((o) => !gone.has(o.id));
    for (const id of ids) {
      this.ids.delete(id);
      this.seats.delete(id);
      this.damageOptions.slabs?.delete(id);
    }
    this.rebuildRuins(this.surfaces);
    this.version++;
    this.onChange();
    return Promise.resolve();
  }

  /** Whether a raised building with this id is drawn here (its damage, its holes) */
  has(id: string): boolean {
    return this.ids.has(id);
  }

  /**
   * The buildings stand on the terrain: after heights changed (in `rect`,
   * map metres) those whose seat moved go up or down with all their
   * instances, nothing is built anew (a brush stroke beside a town)
   */
  refreshHeights(rect?: { minX: number; minY: number; maxX: number; maxY: number }): void {
    const moved = new Map<MapObject, number>();
    for (const o of this.objects) {
      const r = massRadius(o.mass!) * (o.scale || 1) + 2;
      if (rect && (o.x + r < rect.minX || o.x - r > rect.maxX || o.y + r < rect.minY || o.y - r > rect.maxY)) continue;
      const was = this.seats.get(o.id);
      if (was === undefined) continue;
      const now = this.seatOf(o);
      if (Math.abs(now - was) < 1e-4) continue;
      moved.set(o, now - was);
      this.seats.set(o.id, now);
    }
    if (!moved.size) return;
    // A ruin's damage holds its heights: one that sank (a crater at its rim) takes its break line, bite and floors along
    if (this.surfaces && this.generation === this.built && [...moved.keys()].some((o) => this.damaged.has(o.id))) {
      for (const o of moved.keys()) moved.set(o, this.damaged.has(o.id) ? NaN : moved.get(o)!);
      this.rebuildRuins(this.surfaces);
    }
    for (const b of this.batches) {
      const m = b.mesh.instanceMatrix.array as Float32Array;
      let touched = false;
      for (let i = 0; i < b.owners.length; i++) {
        const dy = moved.get(b.owners[i]);
        // A ruin built anew above stands where it is
        if (dy === undefined || dy !== dy) continue;
        m[i * 16 + 13] += dy;
        touched = true;
      }
      if (!touched) continue;
      b.mesh.instanceMatrix.needsUpdate = true;
      b.mesh.computeBoundingSphere();
      b.mesh.computeBoundingBox();
    }
    this.version++;
    this.onChange();
  }

  /** What raised building `o` is drawn as here: its bodies over its cellar */
  private bodiesOf(o: MapObject, ruin: boolean): readonly MassBody[] {
    return cellarBodies(massBodies(o.mass!), o, ruin);
  }

  /** Metres from the floor of building `o` (`seat`, scene y) down to the ground just outside the middle of its wall `p` */
  private groundUnder(o: MapObject, p: WallPiece, seat: number): number {
    const s = o.scale || 1;
    const mx = p.sx + p.ax * p.length * 0.5 + p.nx * 0.6;
    const mz = p.sz + p.az * p.length * 0.5 + p.nz * 0.6;
    // Model x and z in map space (object-seat.ts wallShear)
    const cos = Math.cos(o.rotation);
    const sin = Math.sin(o.rotation);
    const x = o.x + (-mx * cos - mz * sin) * s;
    const y = o.y + (-mx * sin + mz * cos) * s;
    return Math.max(0, seat - (this.damageOptions.standingAt ?? ((gx, gy) => this.field.heightAt(gx, gy)))(x, y));
  }

  /** Where a building stands: on its outline's rectangle like any building (object-seat.ts), on the map's own ground, plus its own z */
  private seatOf(o: MapObject): number {
    const footing: ObjectFooting = { category: 'building', footprint: 1, height: o.mass!.height };
    return seatHeight(footing, o, this.damageOptions.standingAt ?? ((x, y) => this.field.heightAt(x, y)), this.waterLevelAt) + o.z;
  }

  /**
   * Damage of raised buildings (ObjectMapLayer.setDamage): a building
   * from stage 1 leaves the intact batches for the ruins'; one that stands
   * whole again builds everything anew (a new run, a seek back)
   */
  setDamage(changes: readonly { id: string; stage: number; fallStart: number; heading?: number | null }[]): void {
    let healed = false;
    const hide: string[] = [];
    for (const c of changes) {
      const was = this.damaged.has(c.id);
      if (c.stage > 0) this.damaged.set(c.id, { stage: c.stage, fallStart: c.fallStart, heading: c.heading ?? null });
      else {
        this.damaged.delete(c.id);
        this.damageOptions.slabs?.delete(c.id);
      }
      if (was && c.stage <= 0) healed = true;
      else if (!was && c.stage > 0) hide.push(c.id);
    }
    if (healed) {
      void this.rebuild();
      return;
    }
    // Not built yet: the build to come takes the damage
    if (!this.surfaces || this.generation !== this.built) return;
    for (const id of hide) {
      for (const r of this.ranges.get(id) ?? []) {
        (r.batch.mesh.instanceMatrix.array as Float32Array).fill(0, r.start * 16, (r.start + r.count) * 16);
        r.batch.mesh.instanceMatrix.needsUpdate = true;
      }
    }
    this.rebuildRuins(this.surfaces);
    this.version++;
    this.onChange();
  }

  /** The first raised building a scene-space ray hits */
  raycast(raycaster: Raycaster, ray: Ray): MassHit | null {
    raycaster.ray.copy(ray);
    const hits = raycaster.intersectObjects(
      this.batches.map((b) => b.mesh),
      false,
    );
    for (const hit of hits) {
      const batch = this.batches.find((b) => b.mesh === hit.object);
      if (!batch || hit.instanceId === undefined) continue;
      return { object: batch.owners[hit.instanceId], point: hit.point, distance: hit.distance };
    }
    return null;
  }

  dispose(): void {
    this.generation++;
    this.clear();
    for (const m of this.materials.values()) m.dispose();
    this.materials.clear();
    this.depthMaterial.dispose();
    this.ruinDepth?.dispose();
    this.ruinWallDepth?.dispose();
    this.group.removeFromParent();
  }

  private clear(): void {
    for (const b of this.batches) disposeBatch(b);
    this.batches = [];
    this.ruinBatches = [];
    this.ranges.clear();
  }

  /** The kit's surfaces, loaded once */
  private loadSurfaces(): Promise<Map<string, Surface> | null> {
    this.loading ??= this.assets.model(MASS_ASSET).then(
      (model) => (this.surfaces = kitSurfaces(model)),
      (err) => {
        console.warn('[MassLayer] no surfaces for raised buildings', err);
        return null;
      },
    );
    return this.loading;
  }

  /** All instances written anew */
  private async rebuild(): Promise<void> {
    const generation = ++this.generation;
    const surfaces = this.surfaces ?? (this.objects.length ? await this.loadSurfaces() : null);
    if (generation !== this.generation) return;
    this.clear();
    this.seats.clear();
    this.built = generation;
    this.version++;
    this.onChange();
    if (!surfaces || !this.objects.length) return;
    for (const blocks of [true, false]) {
      const list = this.objects.filter((o) => (o.blocksLos ?? true) === blocks && !this.damaged.has(o.id));
      if (list.length) this.batches.push(...this.build(list, surfaces, blocks ? this.losGroup : this.group));
    }
    if (this.damageOptions.ruins) this.batches.push(...(this.warmBatches = this.warmRuins(surfaces)));
    this.rebuildRuins(surfaces);
  }

  /** Where raised building `id` stands for its holes: its map point and its seat (scene y), null for one not here */
  /**
   * The floor (scene y) of the raised building whose body holds scene point `at` (from a pick): within its outline
   * a little round it, between its cellar's foot and its top; null for none
   */
  floorUnder(at: Vector3): number | null {
    const x = -at.x;
    const y = at.z;
    for (const o of this.objects) {
      const mass = o.mass;
      if (!mass) continue;
      const scale = o.scale || 1;
      if (Math.hypot(x - o.x, y - o.y) > massRadius(mass) * scale + 1) continue;
      const m = toModel(x - o.x, y - o.y, Math.cos(o.rotation), Math.sin(o.rotation));
      if (massDistance(mass, m.x / scale, m.z / scale) * scale > 0.4) continue;
      const seat = this.seats.get(o.id) ?? this.seatOf(o);
      if (at.y < seat - Math.max(cellarDepth(cellarOf(o, true)), 1) - 0.4 || at.y > seat + massTop(mass) * scale + 0.4) continue;
      return seat;
    }
    return null;
  }

  holeFrame(id: string): { x: number; y: number; seat: number } | null {
    const o = this.objects.find((m) => m.id === id);
    return o ? { x: o.x, y: o.y, seat: this.seatOf(o) } : null;
  }

  /** A ruin's shape as drawn here (ruinOf), null for one not drawn as a ruin here */
  ruinShapeOf(id: string): RuinShape | null {
    return this.ruinShapes.get(id)?.shape ?? null;
  }

  /** The hidden ruin batches made for the warm-up (warmRuins): their meshes, never drawn */
  warmStandIns(): Object3D[] {
    return this.warmBatches.filter((b) => this.batches.includes(b)).map((b) => b.mesh);
  }

  /** Of those, the meshes buildings `ids` draw with as ruins: their facades' walls, their coverings' roofs, the caps */
  warmStandInsFor(ids: readonly string[]): Object3D[] {
    const parts = new Set<string>();
    for (const o of this.objects) if (o.mass && ids.includes(o.id)) for (const part of partsOf(o)) parts.add(part);
    return this.warmBatches.filter((b) => parts.has(b.part) && this.batches.includes(b)).map((b) => b.mesh);
  }

  private warmBatches: Batch[] = [];

  /** Where a ruin smoulders (emberPoint), null for one not drawn as a ruin here */
  emberOf<T extends { x: number; y: number; z: number }>(id: string, fallen: boolean, out: T): T | null {
    const r = this.ruinShapes.get(id);
    return r ? emberPoint(r.shape, r.seat, fallen, out) : null;
  }

  /** The damaged buildings' batches anew */
  private rebuildRuins(surfaces: Map<string, Surface>): void {
    this.ruinShapes.clear();
    for (const b of this.ruinBatches) disposeBatch(b);
    const gone = new Set(this.ruinBatches);
    this.batches = this.batches.filter((b) => !gone.has(b));
    this.ruinBatches = [];
    for (const blocks of [true, false]) {
      const list = this.objects.filter((o) => (o.blocksLos ?? true) === blocks && this.damaged.has(o.id));
      if (list.length) this.ruinBatches.push(...this.build(list, surfaces, blocks ? this.losGroup : this.group, true));
    }
    this.batches.push(...this.ruinBatches);
  }

  /**
   * Hidden ruin batches of one building per facade and covering the map
   * has: the warm-up shows them (CustomMapView.withAllShown), so the ruins'
   * programs are built with the map's, not at the first damage
   */
  private warmRuins(surfaces: Map<string, Surface>): Batch[] {
    const facades = new Set<MapMassFacade>();
    const coverings = new Set<Covering>();
    const picked: MapObject[] = [];
    for (const o of this.objects) {
      if (!o.mass) continue;
      const seed = massSeed(o.id);
      const bodies = massBodies(o.mass);
      if (bodies.every((b) => facades.has(b.facade) && coverings.has(massShape(b, seed).covering))) continue;
      for (const b of bodies) {
        facades.add(b.facade);
        coverings.add(massShape(b, seed).covering);
      }
      picked.push(o);
    }
    const batches = this.build(picked, surfaces, this.losGroup, true);
    for (const b of batches) b.mesh.visible = false;
    return batches;
  }

  /**
   * The batches of these buildings, intact or as ruins (`ruin`: damage per
   * instance, a fallen one's walls split at its break line)
   */
  private build(objects: readonly MapObject[], surfaces: Map<string, Surface>, parent: Group, ruin = false): Batch[] {
    const ruins = ruin ? this.ruinsOf(objects) : new Map<MapObject, BuiltRuin>();
    // Count the instances per batch first: one allocation each
    const wallCount = new Map<MapMassFacade, number>();
    const roofCount = new Map<Covering, number>();
    let capCount = 0;
    for (const o of objects) {
      const seed = massSeed(o.id);
      for (const body of this.bodiesOf(o, ruin)) {
        const shape = massShape(body, seed);
        wallCount.set(body.facade, (wallCount.get(body.facade) ?? 0) + this.wallsOf(o, shape, ruins).length);
        roofCount.set(shape.covering, (roofCount.get(shape.covering) ?? 0) + shape.roof.length);
        capCount += shape.caps.length;
      }
    }
    const { walls, roofs, caps } = this.batchesFor(wallCount, roofCount, capCount, surfaces, ruin);
    // Every batch's count before a building: its ranges are what it added
    const counters: { batch: Batch; n: () => number }[] = [
      ...[...walls.values()].map((w) => ({ batch: w.batch, n: () => w.n })),
      ...[...roofs.values()].map((rf) => ({ batch: rf.batch, n: () => rf.n })),
      ...(caps ? [{ batch: caps.batch, n: () => caps!.n }] : []),
    ];
    const starts = new Array<number>(counters.length);

    for (const o of objects) {
      const seed = massSeed(o.id);
      const scale = o.scale || 1;
      const r = ruins.get(o);
      // Where its instances start in each batch, for the ranges a damaged building leaves
      for (let k = 0; k < counters.length; k++) starts[k] = counters[k].n();
      // The object's own frame: seated like a building on its outline's rectangle (object-seat.ts), turned and scaled
      const seat = this.seatOf(o);
      this.seats.set(o.id, seat);
      mapToScene(o.x, o.y, seat, this.v);
      this.q.setFromAxisAngle(this.up, o.rotation);
      this.s.setScalar(scale);
      this.m.compose(this.v, this.q, this.s);
      // Its parts (or itself), each with its own walls, roof and colours: one building, one owner of them all
      const bodies = this.bodiesOf(o, ruin);
      const bodyWalls = bodies.map((body) => this.wallsOf(o, massShape(body, seed), ruins));
      // The wall its door is on (MapMass.door), of all its bodies'
      const door = o.mass?.door ? doorWall(o.mass.door, bodyWalls) : null;
      for (const [b, body] of bodies.entries()) {
        const shape = massShape(body, seed);
        const w = walls.get(body.facade);
        const rf = roofs.get(shape.covering);
        if (w) this.writeWalls(w, o, body, bodyWalls[b], door, seat, seed, r);
        if (rf) this.writeRoof(rf, o, body, shape, seed, r);
        if (caps) this.writeCaps(caps, o, shape, r);
      }
      if (!ruin) {
        const ranges: { batch: Batch; start: number; count: number }[] = [];
        counters.forEach((c, k) => {
          const n = c.n();
          if (n > starts[k]) ranges.push({ batch: c.batch, start: starts[k], count: n - starts[k] });
        });
        this.ranges.set(o.id, ranges);
      }
    }
    return finishBatches(walls, roofs, caps, parent, ruin);
  }

  /** The ruins' shapes and stages, once per building: the slabs of the damaged ones set */
  private ruinsOf(objects: readonly MapObject[]): Map<MapObject, BuiltRuin> {
    const ruins = new Map<MapObject, BuiltRuin>();
    for (const o of objects) {
      const d = this.damaged.get(o.id);
      const { frame, shape, footprint } = this.ruinOf(o, d?.heading ?? null);
      if (d) shape.holeRow = RUIN_HOLES.rowOf(o.id);
      ruins.set(o, { shape, stage: d?.stage ?? 0, fallStart: d?.fallStart ?? FELL_LONG_AGO });
      if (!d) continue;
      this.ruinShapes.set(o.id, { shape, seat: frame.seatY });
      this.damageOptions.slabs?.set(o.id, frame, shape, d.stage, d.fallStart, rubbleMaterialOf(o), footprint);
    }
    return ruins;
  }

  /** A building's walls as drawn: a fallen ruin's split at its break line and where its collapse parts the upper part */
  private wallsOf(o: MapObject, shape: MassShape, ruins: ReadonlyMap<MapObject, BuiltRuin>): readonly WallPiece[] {
    const r = ruins.get(o);
    if (!r || r.stage < 3) return shape.walls;
    // At the break line, and where the collapse variants part the upper part across (collapseCuts)
    const seat = this.seatOf(o);
    const scale = o.scale || 1;
    let walls = shape.walls;
    for (const y of [r.shape.breakY, ...collapseCuts(r.shape)]) walls = splitWalls(walls, (y - seat) / scale, SPLIT_GAP / scale);
    return walls;
  }

  /** One batch per facade, roof covering and the caps, sized for the instances counted */
  private batchesFor(
    wallCount: ReadonlyMap<MapMassFacade, number>,
    roofCount: ReadonlyMap<Covering, number>,
    capCount: number,
    surfaces: Map<string, Surface>,
    ruin: boolean,
  ): { walls: Map<MapMassFacade, WallBatch>; roofs: Map<Covering, RoofBatch>; caps: CapBatch | null } {
    const walls = new Map<MapMassFacade, WallBatch>();
    for (const [facade, count] of wallCount) {
      const surface = surfaces.get(FACADE_SURFACE[facade]);
      if (!surface || !count) continue;
      // Own geometry per mesh: its instance attributes ride on it
      const geometry = UNIT_QUAD.clone();
      const a = new Float32Array(count * 4);
      const b = new Float32Array(count * 4);
      const c = new Float32Array(count * 4);
      const d = new Float32Array(count * 4);
      geometry.setAttribute('aWall', new InstancedBufferAttribute(a, 4));
      geometry.setAttribute('aWallB', new InstancedBufferAttribute(b, 4));
      geometry.setAttribute('aWallC', new InstancedBufferAttribute(c, 4));
      geometry.setAttribute('aWallD', new InstancedBufferAttribute(d, 4));
      geometry.userData['owned'] = true;
      const mesh = new InstancedMesh(geometry, this.wallMaterial(facade, surface, surfaces.get('mass-plinth'), ruin), count);
      mesh.customDepthMaterial = ruin ? (this.ruinWallDepth ??= damageDepthMaterial('mass-wall', GABLE_PARS, GABLE_GLSL)) : this.depthMaterial;
      walls.set(facade, { batch: { mesh, owners: [], part: `walls:${facade}` }, a, b, c, d, damage: damageOf(mesh, count, ruin), n: 0 });
    }
    const roofs = new Map<Covering, RoofBatch>();
    for (const [covering, count] of roofCount) {
      const surface = surfaces.get(`mass-roof-${covering}`);
      if (!surface || !count) continue;
      const geometry = UNIT_TRIANGLE.clone();
      geometry.userData['owned'] = true;
      const mesh = new InstancedMesh(geometry, this.roofMaterial(covering, surface, ruin), count);
      if (ruin) mesh.customDepthMaterial = this.ruinDepth ??= damageDepthMaterial('mass');
      const uv = new Float32Array(count * 6);
      roofs.set(covering, { batch: { mesh, owners: [], part: `roof:${covering}` }, uv, damage: damageOf(mesh, count, ruin), n: 0 });
    }
    const plinth = surfaces.get('mass-plinth');
    let caps: CapBatch | null = null;
    if (plinth && capCount) {
      // A ruin's caps have attributes of their own: their geometry is a copy
      const geometry = ruin ? UNIT_FLAT.clone() : UNIT_FLAT;
      if (ruin) geometry.userData['owned'] = true;
      const mesh = new InstancedMesh(geometry, this.capMaterial(plinth, ruin), capCount);
      if (ruin) mesh.customDepthMaterial = this.ruinDepth ??= damageDepthMaterial('mass');
      caps = { batch: { mesh, owners: [], part: 'caps' }, damage: damageOf(mesh, capCount, ruin), n: 0 };
    }
    return { walls, roofs, caps };
  }

  /** A body's wall pieces into its facade's batch: matrix, colour and the four attributes (storeys, cuts, gable, cellar, door) */
  private writeWalls(
    w: WallBatch,
    o: MapObject,
    body: MassBody,
    pieces: readonly WallPiece[],
    door: { piece: WallPiece; u: number } | null,
    seat: number,
    seed: number,
    r: BuiltRuin | undefined,
  ): void {
    const scale = o.scale || 1;
    const tint = TINT.set(body.tint ?? o.tint ?? '#ffffff');
    for (const p of pieces) {
      const height = p.top - p.bottom;
      if (p.corner) {
        // A wedge or a vault's facet: its corner and edges, the normal square to them
        const [ox, oy, oz] = p.corner;
        const [ux, uy, uz] = p.e1!;
        const [vx, vy, vz] = p.e2!;
        this.local.set(ux, vx, p.nx, ox, uy, vy, p.ny ?? 0, oy, uz, vz, p.nz, oz, 0, 0, 0, 1);
      } else {
        this.local.set(p.ax * p.length, 0, p.nx, p.sx, 0, height, 0, p.bottom, p.az * p.length, 0, p.nz, p.sz, 0, 0, 0, 1);
      }
      this.local.premultiply(this.m);
      w.batch.mesh.setMatrixAt(w.n, this.local);
      w.batch.mesh.setColorAt(w.n, p.shade === undefined ? tint : SHADED.copy(tint).multiplyScalar(p.shade));
      // Length and height in metres (scaled), the foundation below the seat (a part's floor over it), the storeys
      w.a.set([p.length * scale, height * scale, (p.lift ?? Math.max(0, -p.bottom)) * scale, body.floors], w.n * 4);
      w.b.set([seed, p.kind, p.band * scale, p.kind === WALL_PLAIN ? 0 : Math.max(0, p.wallTop ?? p.top) * scale], w.n * 4);
      // A wall in pieces: where along the whole wall it starts and how long that is; the opening beside it (mass-openings.ts)
      const cut = p.cut;
      w.c.set([(p.u0 ?? 0) * scale, (p.wallLength ?? 0) * scale, (cut?.mid ?? 0) * scale, (cut?.half ?? 0) * scale], w.n * 4);
      // Beside an opening its frame; a gable where its top is (GABLE_GLSL); over a cellar the ground under the
      // wall's middle, metres down from the floor (its windows and door); the building's door on it, metres
      // along the whole wall plus one (0: none here); the cellar's storeys open to the slope, -1 buried, 0 none
      const cellar = p.corner ? undefined : body.cellar;
      const doorAt = door?.piece === p ? door.u * scale + 1 : 0;
      const storeys = cellar ? (cellar.buried ? -1 : cellar.storeys) : 0;
      w.d.set(cut ? [cut.top * scale, cut.rise * scale, cut.style, cut.floor * scale] : [p.kind === WALL_GABLE ? (p.apex ?? 0.5) : 0, storeys > 0 ? this.groundUnder(o, p, seat) : 0, doorAt, storeys], w.n * 4);
      if (r && w.damage) writeDamage(w.damage, w.n, r.stage, r.fallStart, r.shape);
      w.batch.owners.push(o);
      w.n++;
    }
  }

  /** A body's roof triangles into its covering's batch, the covering varied a little per building */
  private writeRoof(rf: RoofBatch, o: MapObject, body: MassBody, shape: MassShape, seed: number, r: BuiltRuin | undefined): void {
    const scale = o.scale || 1;
    const color = COLOR;
    // The covering varies a little per building, the same way round as its tiles; in the roof's own colour where OSM gives one
    color.setHSL(0, 0, 0.92 + (seed % 7) * 0.02);
    if (body.roofTint) color.multiply(roofTintFactor(shape.covering, body.roofTint, ROOF_TINT));
    for (const t of shape.roof) {
      const [ax, ay, az, bx, by, bz, cx, cy, cz] = t.p;
      // Columns: a to b, the normal, a to c; b and c swapped where (c - a) x (b - a) points down
      let ux = bx - ax;
      let uy = by - ay;
      let uz = bz - az;
      let wx = cx - ax;
      let wy = cy - ay;
      let wz = cz - az;
      let uvB = [t.uv[2], t.uv[3]];
      let uvC = [t.uv[4], t.uv[5]];
      let ny = wz * ux - wx * uz;
      if (ny < 0) {
        [ux, wx] = [wx, ux];
        [uy, wy] = [wy, uy];
        [uz, wz] = [wz, uz];
        [uvB, uvC] = [uvC, uvB];
        ny = -ny;
      }
      const nx = wy * uz - wz * uy;
      const nz = wx * uy - wy * ux;
      const nl = Math.hypot(nx, ny, nz) || 1;
      this.local.set(ux, nx / nl, wx, ax, uy, ny / nl, wy, ay, uz, nz / nl, wz, az, 0, 0, 0, 1);
      this.local.premultiply(this.m);
      rf.batch.mesh.setMatrixAt(rf.n, this.local);
      rf.batch.mesh.setColorAt(rf.n, color);
      rf.uv.set([t.uv[0] * scale, t.uv[1] * scale, uvB[0] * scale, uvB[1] * scale, uvC[0] * scale, uvC[1] * scale], rf.n * 6);
      if (r && rf.damage) writeDamage(rf.damage, rf.n, r.stage, r.fallStart, r.shape);
      rf.batch.owners.push(o);
      rf.n++;
    }
  }

  /** A body's parapet caps into the caps' batch */
  private writeCaps(caps: CapBatch, o: MapObject, shape: MassShape, r: BuiltRuin | undefined): void {
    for (const c of shape.caps) {
      const t = PARAPET_THICKNESS;
      this.local.set(c.ax * c.length, 0, c.nx * t, c.sx, 0, 1, 0, c.y, c.az * c.length, 0, c.nz * t, c.sz, 0, 0, 0, 1);
      this.local.premultiply(this.m);
      caps.batch.mesh.setMatrixAt(caps.n, this.local);
      if (r && caps.damage) writeDamage(caps.damage, caps.n, r.stage, r.fallStart, r.shape);
      caps.batch.owners.push(o);
      caps.n++;
    }
  }

  /**
   * A raised building's ruin: its outline's rectangle in the frame `build`
   * set up (this.m), rolled from its id, and its outline's top grid for the
   * floors inside (massRoof)
   */
  private ruinOf(o: MapObject, heading: number | null): { frame: RuinFrame; shape: RuinShape; footprint: RuinFootprint } {
    const mass = o.mass!;
    const scale = o.scale || 1;
    mapToScene(o.x, o.y, this.seatOf(o), this.v);
    this.q.setFromAxisAngle(this.up, o.rotation);
    this.s.setScalar(scale);
    const e = this.m.compose(this.v, this.q, this.s).elements;
    const b = massBounds(mass);
    const mx = (b.minX + b.maxX) / 2;
    const mz = (b.minZ + b.maxZ) / 2;
    const hx = (b.maxX - b.minX) / 2;
    const hz = (b.maxZ - b.minZ) / 2;
    const frame: RuinFrame = {
      cx: e[12] + e[0] * mx + e[8] * mz,
      cz: e[14] + e[2] * mx + e[10] * mz,
      ax: e[0] * hx,
      az: e[2] * hx,
      bx: e[8] * hz,
      bz: e[10] * hz,
      seatY: e[13],
      height: massTop(mass) * scale,
      ...cellarFrame(cellarOf(o, true)),
    };
    const footprint: RuinFootprint = { roof: massRoof(mass), box: [mx, mz, hx, hz], ox: e[12], oz: e[14], ux: e[0], uz: e[2], vx: e[8], vz: e[10], sy: scale };
    return { frame, shape: ruinShape(ruinSeed(o), frame, heading), footprint };
  }

  /** The walls of one facade: its surface in metres, the plinth's below, the windows from the shader */
  private wallMaterial(facade: MapMassFacade, surface: Surface, plinth: Surface | undefined, ruin = false): Material {
    const key = `wall-${facade}${ruin ? '-ruin' : ''}`;
    const cached = this.materials.get(key);
    if (cached) return cached;
    const m = surface.material.clone();
    const uniforms = {
      // The facade's look: a uniform, not a define, so every facade draws with one program (E280)
      uFacade: { value: FACADE_INDEX[facade] },
      uTile: { value: surface.tile },
      uPlinthMap: { value: (plinth?.material.map ?? surface.material.map) as Texture | null },
      uPlinthTile: { value: plinth?.tile ?? surface.tile },
      uPlinthColor: { value: (plinth?.material.color ?? new Color(0.6, 0.6, 0.6)).clone() },
    };
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms, NIGHT_WINDOW_UNIFORMS);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${WALL_VERTEX_PARS}`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>\n${GABLE_GLSL}`)
        .replace('#include <uv_vertex>', WALL_UV_VERTEX);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${WALL_FRAGMENT_PARS}`)
        .replace('#include <color_fragment>', `#include <color_fragment>\n${WALL_COLOR_FRAGMENT}`)
        .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>\n${WALL_SHINE_FRAGMENT}`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\nnormal = normalize(mix(normal, nonPerturbedNormal, massWindow));`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${WALL_NIGHT_FRAGMENT}`);
    };
    m.customProgramCacheKey = () => 'mass-wall';
    addHeightFog(m);
    if (ruin) asRuin(m, facade === 'concrete' || facade === 'metal' ? 'concrete' : 'brick');
    this.materials.set(key, m);
    return m;
  }

  /** A roof covering: its surface in metres along the roof, a little variation per building */
  private roofMaterial(covering: Covering, surface: Surface, ruin = false): Material {
    const key = `roof-${covering}${ruin ? '-ruin' : ''}`;
    const cached = this.materials.get(key);
    if (cached) return cached;
    const m = surface.material.clone();
    // Flat or not a uniform, not a variant of the shader: every covering draws with one program (E280)
    const uniforms = { uTile: { value: surface.tile }, uFlatRoof: { value: covering === 'flat' ? 1 : 0 } };
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\nattribute vec3 aRoofUvA;\nattribute vec3 aRoofUv;\nuniform float uTile;\nvarying vec2 vRoofM;`)
        .replace('#include <uv_vertex>', ROOF_UV_VERTEX);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\nvarying vec2 vRoofM;\nuniform float uFlatRoof;`)
        .replace('#include <color_fragment>', `#include <color_fragment>\n${FLAT_ROOF_FRAGMENT}`);
    };
    m.customProgramCacheKey = () => 'mass-roof';
    addHeightFog(m);
    if (ruin) asRuin(m);
    this.materials.set(key, m);
    return m;
  }

  /** The parapet's coping: the plinth's concrete */
  private capMaterial(surface: Surface, ruin = false): Material {
    const key = ruin ? 'cap-ruin' : 'cap';
    const cached = this.materials.get(key);
    if (cached) return cached;
    const m = surface.material.clone();
    const uniforms = { uTile: { value: surface.tile } };
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\nuniform float uTile;`)
        .replace(
          '#include <uv_vertex>',
          `#include <uv_vertex>
          {
            vec2 capM = vec2(position.x * length(instanceMatrix[0].xyz), position.z * length(instanceMatrix[2].xyz)) / uTile;
            #ifdef USE_MAP
            vMapUv = capM;
            #endif
            #ifdef USE_NORMALMAP
            vNormalMapUv = capM;
            #endif
            #ifdef USE_ROUGHNESSMAP
            vRoughnessMapUv = capM;
            #endif
            #ifdef USE_METALNESSMAP
            vMetalnessMapUv = capM;
            #endif
          }`,
        );
    };
    m.customProgramCacheKey = () => 'mass-cap';
    addHeightFog(m);
    if (ruin) asRuin(m);
    this.materials.set(key, m);
    return m;
  }
}

/** A ruin's shape and stage as a batch is built (MassLayer.ruinsOf) */
interface BuiltRuin {
  shape: RuinShape;
  stage: number;
  fallStart: number;
}

/** A facade's walls as they are written: the batch, its four attributes and its damage, `n` written */
interface WallBatch {
  batch: Batch;
  a: Float32Array;
  b: Float32Array;
  c: Float32Array;
  d: Float32Array;
  damage: DamageArrays | null;
  n: number;
}

interface RoofBatch {
  batch: Batch;
  /** Six numbers per triangle: the UVs of its corners */
  uv: Float32Array;
  damage: DamageArrays | null;
  n: number;
}

interface CapBatch {
  batch: Batch;
  damage: DamageArrays | null;
  n: number;
}

/** Scratch colours of the writes */
const TINT = new Color();
const SHADED = new Color();
const COLOR = new Color();
const ROOF_TINT = new Color();

/** A ruin batch's damage attributes, four floats per instance each; none for an intact batch */
function damageOf(mesh: InstancedMesh, count: number, ruin: boolean): DamageArrays | null {
    if (!ruin) return null;
    const arrays = damageArrays(count);
    DAMAGE_ATTRIBUTES.forEach((name, k) => mesh.geometry.setAttribute(name, new InstancedBufferAttribute(arrays[k], 4)));
    return arrays;
}

/** The roofs' UVs as attributes, every batch's instances and bounds up to date, shadows on, under `parent` */
function finishBatches(
  walls: ReadonlyMap<MapMassFacade, WallBatch>,
  roofs: ReadonlyMap<Covering, RoofBatch>,
  caps: CapBatch | null,
  parent: Group,
  ruin: boolean,
): Batch[] {
  for (const r of roofs.values()) {
    // The six numbers per triangle as two attributes of three: (a.u, a.v, b.u) and (b.v, c.u, c.v)
    const n = r.n;
    const first = new Float32Array(n * 3);
    const second = new Float32Array(n * 3);
    for (let k = 0; k < n; k++) {
      first.set(r.uv.subarray(k * 6, k * 6 + 3), k * 3);
      second.set(r.uv.subarray(k * 6 + 3, k * 6 + 6), k * 3);
    }
    r.batch.mesh.geometry.setAttribute('aRoofUvA', new InstancedBufferAttribute(first, 3));
    r.batch.mesh.geometry.setAttribute('aRoofUv', new InstancedBufferAttribute(second, 3));
  }
  const all: Batch[] = [...[...walls.values()].map((w) => w.batch), ...[...roofs.values()].map((r) => r.batch), ...(caps ? [caps.batch] : [])];
  for (const b of all) {
    b.mesh.castShadow = true;
    b.mesh.receiveShadow = true;
    b.mesh.instanceMatrix.needsUpdate = true;
    if (b.mesh.instanceColor) b.mesh.instanceColor.needsUpdate = true;
    b.mesh.computeBoundingSphere();
    b.mesh.computeBoundingBox();
    // What is gone of a ruin does not block the towers' sight
    if (ruin) b.mesh.userData['losVertex'] = DAMAGE_LOS;
    parent.add(b.mesh);
  }
  return all;
}

function disposeBatch(b: Batch): void {
  b.mesh.removeFromParent();
  if (b.mesh.geometry.userData['owned']) b.mesh.geometry.dispose();
  b.mesh.dispose();
}

/** The kit's materials by name with the metres one repeat of each covers (its square's side) */
function kitSurfaces(model: ObjectModel): Map<string, Surface> {
  const out = new Map<string, Surface>();
  for (const part of model.parts) {
    const material = part.material as MeshStandardMaterial;
    if (!material.name?.startsWith('mass-')) continue;
    part.geometry.computeBoundingBox();
    const box = part.geometry.boundingBox!;
    const tile = Math.max(box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z) || 3;
    out.set(material.name, { material, tile });
  }
  return out;
}

/** A small number per object id for the shader's variation */
function massSeed(id: string): number {
  return seedOf(id) % 997;
}
