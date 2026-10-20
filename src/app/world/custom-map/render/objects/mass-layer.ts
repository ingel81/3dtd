import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshDepthMaterial,
  Quaternion,
  RGBADepthPacking,
  ShapeUtils,
  Vector2,
  Vector3,
  type Material,
  type MeshStandardMaterial,
  type Object3D,
  type Ray,
  type Raycaster,
  type Texture,
} from 'three';
import { MAP_MASS_FACADES, MASS_ASSET, type MapMass, type MapMassFacade, type MapObject } from '../../map-document';
import { MASS_PARAPET, massBounds, massContains, massInset, massPitched, massRadius, massRoof, massTop } from '../../object-mass';
import type { HeightField } from '../height-field';
import type { MapAssetLibrary, ObjectModel } from '../map-asset-library';
import { addHeightFog } from '../environment/height-fog';
import { mapToScene } from '../map-coords';
import { NIGHT_WINDOW_UNIFORMS } from './night-windows';
import { seatHeight, type ObjectFooting } from './object-seat';
import { rubbleMaterialOf } from '../../rubble-material';
import type { RuinFootprint, RuinSlabs } from './ruin-slabs';
import { addDamage, collapseCuts, RUIN_HOLES, DAMAGE_ATTRIBUTES, DAMAGE_LOS, damageArrays, damageDepthMaterial, emberPoint, FELL_LONG_AGO, ruinSeed, ruinShape, writeDamage, type DamageArrays, type RuinFrame, type RuinShape } from './ruin-damage';

/**
 * The buildings a map raises from their own footprint (MapObject.mass,
 * object-mass.ts), drawn as a few instanced primitives for the whole map:
 * every wall is one instance of a unit quad (its instance matrix stretches
 * it along the wall and up to the eaves, its third column is the wall's
 * outward normal), every triangle of a roof one instance of a unit triangle
 * (an affine instance matrix, its second column the roof's normal), every
 * side of a flat roof's parapet a wall turned inward and a coping on top.
 * A map of 2 000 such buildings draws in about ten calls (one per facade,
 * the coping, one per roof covering), as many again for the sun's shadow.
 *
 * The facades come from the shader, not from the model: storeys and bays
 * laid out in metres per wall (centred, with a margin at the corners),
 * windows with frames, sills, reveals and blinds, a plinth and a cornice,
 * grime above the plinth and under the sills, lit windows at night; their
 * detail fades into the mean colour where a window is a few pixels. The
 * surfaces (plaster, concrete panels, metal sheet, brick, sandstone,
 * bitumen, roof tiles) are the textures of the catalogue's `building-mass`
 * (tools/map-assets/build_modern2.py, mass_kit), one square per surface as
 * wide as one repeat of its texture.
 *
 * A damaged building (setDamage) leaves those batches (its instances
 * shrink to nothing there) for the ruins': the same pieces with the damage
 * in the shader (ruin-damage.ts) and both sides drawn, a fallen one's walls
 * split at its break line so what stands above it falls whole. Only the
 * ruins are built anew on a change, a handful of buildings, not the map.
 */

/** Metres the walls reach below the seat: the ground under a building on a slope (object-seat.ts) */
const FOUNDATION = 1.5;
/** Thickness of a flat roof's parapet, m */
const PARAPET_THICKNESS = 0.3;
/** How far a pitched roof reaches past the walls, m */
const EAVES = 0.4;

/** Facade index of each look, the shader's MASS_FACADE */
const FACADE_INDEX: Readonly<Record<MapMassFacade, number>> = Object.fromEntries(MAP_MASS_FACADES.map((f, i) => [f, i])) as Record<MapMassFacade, number>;
/** Kit material of each facade */
const FACADE_SURFACE: Readonly<Record<MapMassFacade, string>> = {
  plaster: 'mass-plaster',
  concrete: 'mass-concrete',
  metal: 'mass-metal',
  brick: 'mass-brick',
  stone: 'mass-stone',
  timber: 'mass-plaster',
};
/** Roof coverings: a flat roof's, and a pitched one's by facade (tiles on homes, sheet on halls) */
type Covering = 'flat' | 'red' | 'grey' | 'metal';

/**
 * What a wall instance is: a facade with windows, a plain face (a parapet's
 * inside), a gable (its top drawn in to a point), a facade with a shop's
 * display windows on the ground floor (MapMass.shop)
 */
const WALL_FACADE = 0;
const WALL_PLAIN = 1;
const WALL_GABLE = 2;
const WALL_SHOP = 3;

/** The kind of the facade wall `edge` of the outline (ring 0), else of a courtyard's */
function facadeKind(m: MapMass, ring: number, edge: number): number {
  return ring === 0 && m.shop?.includes(edge) ? WALL_SHOP : WALL_FACADE;
}

/** One wall in the building's own frame at scale 1 */
interface WallPiece {
  /** Start on the ground line (x, z), unit direction along it, length, outward normal */
  sx: number;
  sz: number;
  ax: number;
  az: number;
  length: number;
  nx: number;
  nz: number;
  /** Bottom and top over the seat, m (the bottom below 0 for the foundation) */
  bottom: number;
  top: number;
  kind: number;
  /** Metres at the top without windows: the cornice, the parapet */
  band: number;
  /** A piece of a split wall (splitWalls): the whole wall's top, and minus the metres its bottom stands over the seat */
  wallTop?: number;
  lift?: number;
}

/** A roof triangle in the building's own frame: corners a, b, c (x, y, z) with their texture places in metres */
interface RoofPiece {
  p: number[];
  uv: number[];
}

/** A coping on a parapet: start (x, z) on the inner line, direction along, length, the outward normal, height */
interface CapPiece {
  sx: number;
  sz: number;
  ax: number;
  az: number;
  length: number;
  nx: number;
  nz: number;
  y: number;
}

interface MassShape {
  walls: WallPiece[];
  roof: RoofPiece[];
  covering: Covering;
  caps: CapPiece[];
}

const shapes = new WeakMap<MapMass, MassShape>();

/** A building's walls, roof and parapet at scale 1 in its own frame (model x, height y, model z), worked out once */
export function massShape(m: MapMass, seed = 0): MassShape {
  let shape = shapes.get(m);
  if (shape) return shape;
  const pitched = massPitched(m);
  const inset = massInset(m);
  shape = pitched ? pitchedShape(m) : inset ? mansardShape(m, inset.ring) : flatShape(m);
  shape.covering = !pitched && !inset ? 'flat' : m.facade === 'metal' ? 'metal' : seed % 3 === 0 ? 'grey' : 'red';
  shapes.set(m, shape);
  return shape;
}

/** Walls up every ring with windows, a parapet round a flat roof over the outline less its courtyards */
function flatShape(m: MapMass): MassShape {
  const walls: WallPiece[] = [];
  const caps: CapPiece[] = [];
  const roofY = m.height - MASS_PARAPET;
  m.rings.forEach((ring, k) => {
    for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
      const e = edge(m, ring[j], ring[j + 1], ring[i], ring[i + 1]);
      if (!e) continue;
      walls.push({ ...e, bottom: -FOUNDATION, top: m.height, kind: facadeKind(m, k, j / 2), band: MASS_PARAPET + 0.25 });
      // The parapet's inside: a plain wall a parapet's thickness in, facing in; the coping across both
      const t = PARAPET_THICKNESS;
      const inner = { sx: e.sx - e.nx * t + e.ax * e.length, sz: e.sz - e.nz * t + e.az * e.length, ax: -e.ax, az: -e.az, length: e.length, nx: -e.nx, nz: -e.nz };
      walls.push({ ...inner, bottom: roofY, top: m.height, kind: WALL_PLAIN, band: 0 });
      caps.push({ sx: e.sx - e.nx * t, sz: e.sz - e.nz * t, ax: e.ax, az: e.az, length: e.length, nx: e.nx, nz: e.nz, y: m.height });
    }
  });
  const roof: RoofPiece[] = [];
  const contour = toPoints(m.rings[0]);
  const holes = m.rings.slice(1).map(toPoints);
  const all = [contour, ...holes].flat();
  for (const [a, b, c] of ShapeUtils.triangulateShape(contour, holes)) {
    const pa = all[a];
    const pb = all[b];
    const pc = all[c];
    roof.push({ p: [pa.x, roofY, pa.y, pb.x, roofY, pb.y, pc.x, roofY, pc.y], uv: [pa.x, pa.y, pb.x, pb.y, pc.x, pc.y] });
  }
  return { walls, roof, covering: 'flat', caps };
}

/** Walls to the eaves, slopes from every wall up to the drawn-in top, the top flat over them */
function mansardShape(m: MapMass, inner: readonly number[]): MassShape {
  const walls: WallPiece[] = [];
  const roof: RoofPiece[] = [];
  const r = m.rings[0];
  const h = m.height;
  const top = h + (m.ridge ?? 0);
  const n = r.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const e = edge(m, r[2 * i], r[2 * i + 1], r[2 * j], r[2 * j + 1]);
    if (e) walls.push({ ...e, bottom: -FOUNDATION, top: h, kind: facadeKind(m, 0, i), band: 0.3 });
    // The slope over this wall: a quad from the eaves to the top's edge, its texture along the wall and up the slope
    const a = [r[2 * i], h, r[2 * i + 1]];
    const b = [r[2 * j], h, r[2 * j + 1]];
    const c = [inner[2 * j], top, inner[2 * j + 1]];
    const d = [inner[2 * i], top, inner[2 * i + 1]];
    const len = Math.hypot(b[0] - a[0], b[2] - a[2]);
    const up = Math.hypot(d[0] - a[0], d[1] - a[1], d[2] - a[2]);
    roof.push({ p: [...a, ...b, ...c], uv: [0, up, len, up, len, 0] });
    roof.push({ p: [...a, ...c, ...d], uv: [0, up, len, 0, 0, 0] });
  }
  const contour = toPoints(inner);
  for (const [ia, ib, ic] of ShapeUtils.triangulateShape(contour, [])) {
    const pa = contour[ia];
    const pb = contour[ib];
    const pc = contour[ic];
    roof.push({ p: [pa.x, top, pa.y, pb.x, top, pb.y, pc.x, top, pc.y], uv: [pa.x, pa.y, pb.x, pb.y, pc.x, pc.y] });
  }
  return { walls, roof, covering: 'red', caps: [] };
}

/** A rectangle's four walls to the eaves, a gable or hip roof along its longer side, the gables under it */
function pitchedShape(m: MapMass): MassShape {
  const b = massBounds(m);
  const alongX = b.maxX - b.minX >= b.maxZ - b.minZ;
  const ridge = m.ridge ?? 0;
  const h = m.height;
  const walls: WallPiece[] = [];
  const r = m.rings[0];
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
    const e = edge(m, r[j], r[j + 1], r[i], r[i + 1]);
    if (!e) continue;
    walls.push({ ...e, bottom: -FOUNDATION, top: h, kind: facadeKind(m, 0, j / 2), band: 0.3 });
    // The gable over an end wall (across the ridge)
    const end = alongX ? Math.abs(e.nx) > 0.5 : Math.abs(e.nz) > 0.5;
    if (end && m.roof === 'gable') walls.push({ ...e, bottom: h, top: h + ridge, kind: WALL_GABLE, band: 0 });
  }
  // In the frame of the ridge: s along it, t across, both from the middle
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minZ + b.maxZ) / 2;
  const halfS = (alongX ? b.maxX - b.minX : b.maxZ - b.minZ) / 2;
  const halfT = (alongX ? b.maxZ - b.minZ : b.maxX - b.minX) / 2;
  const at = (s: number, t: number, y: number): number[] => (alongX ? [cx + s, y, cz + t] : [cx + t, y, cz + s]);
  // The eaves reach past the walls and sink as the slope runs on
  const slope = ridge / Math.max(halfT, 0.1);
  const eaveY = h - EAVES * slope;
  const sE = halfS + EAVES;
  const tE = halfT + EAVES;
  const hip = m.roof === 'hip' ? Math.min(halfT, halfS) : 0;
  const roof: RoofPiece[] = [];
  const slopeLength = Math.hypot(tE, ridge + EAVES * slope);
  const tri = (p: number[][], uv: number[][]) => roof.push({ p: p.flat(), uv: uv.flat() });
  for (const side of [-1, 1]) {
    // A slope from the eaves up to the ridge (texture: s along, the way down the slope from the ridge)
    const e0 = at(-sE, side * tE, eaveY);
    const e1 = at(sE, side * tE, eaveY);
    const r0 = at(-sE + hip, 0, h + ridge);
    const r1 = at(sE - hip, 0, h + ridge);
    const uvE0 = [-sE, slopeLength];
    const uvE1 = [sE, slopeLength];
    const uvR0 = [-sE + hip, 0];
    const uvR1 = [sE - hip, 0];
    tri([e0, e1, r1], [uvE0, uvE1, uvR1]);
    tri([e0, r1, r0], [uvE0, uvR1, uvR0]);
    if (hip > 0) {
      // A hip at each end
      const a = at(side * sE, -tE, eaveY);
      const c = at(side * sE, tE, eaveY);
      const top = at(side * (sE - hip), 0, h + ridge);
      tri([a, c, top], [[-tE, slopeLength], [tE, slopeLength], [0, 0]]);
    }
  }
  return { walls, roof, covering: 'red', caps: [] };
}

/** One edge of a ring as a wall: its start, direction and length, its normal pointing off the building; null if too short */
function edge(m: MapMass, x0: number, z0: number, x1: number, z1: number): Omit<WallPiece, 'bottom' | 'top' | 'kind' | 'band'> | null {
  const dx = x1 - x0;
  const dz = z1 - z0;
  const length = Math.hypot(dx, dz);
  if (length < 0.05) return null;
  let nx = dz / length;
  let nz = -dx / length;
  // Off the building: a step out of the middle of the edge lands outside it (a courtyard counts as outside)
  const mx = (x0 + x1) / 2;
  const mz = (z0 + z1) / 2;
  if (massContains(m, mx + nx * 0.05, mz + nz * 0.05)) {
    nx = -nx;
    nz = -nz;
  }
  // Along: up x normal (model space, y up), so along x up = normal and the quad faces out
  const ax = nz;
  const az = -nx;
  const forward = dx * ax + dz * az > 0;
  return { sx: forward ? x0 : x1, sz: forward ? z0 : z1, ax, az, length, nx, nz };
}

function toPoints(ring: readonly number[]): Vector2[] {
  const out: Vector2[] = [];
  for (let i = 0; i < ring.length; i += 2) out.push(new Vector2(ring[i], ring[i + 1]));
  // Earcut takes the outline either way round; drop a repeated last point
  if (out.length > 1 && out[0].equals(out[out.length - 1])) out.pop();
  return out;
}

// ---- Drawing ----

/** One drawn primitive of the layer: its mesh and per instance the object it belongs to */
interface Batch {
  mesh: InstancedMesh;
  owners: MapObject[];
}

/** What the mass layer does with damage (ObjectLayerOptions): ruins built with the map, the ground buildings stand on */
export interface MassDamageOptions {
  ruins?: boolean;
  standingAt?: (x: number, y: number) => number;
  /** The ruins' floors (ruin-slabs.ts), shared with the object layer */
  slabs?: RuinSlabs | null;
}

/** Gap between a fallen wall's stump and the piece that falls, m: the stump stays, the piece goes whole */
const SPLIT_GAP = 0.01;

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

export interface MassHit {
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
        .replace('#include <common>', '#include <common>\nattribute vec4 aWallB;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>\n${GABLE_GLSL}`);
    };
    this.depthMaterial.customProgramCacheKey = () => 'mass-depth';
  }

  /** Whether an object is drawn here */
  static owns(o: MapObject): boolean {
    return o.asset === MASS_ASSET && !!o.mass;
  }

  /** Replaces every raised building; resolves when they show */
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
    for (const id of removed) this.ids.delete(id);
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

  /** Whether an object with this id is drawn here */
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
      const shape = massShape(o.mass!, seedOf(o.id));
      if (facades.has(o.mass!.facade) && coverings.has(shape.covering)) continue;
      facades.add(o.mass!.facade);
      coverings.add(shape.covering);
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
    // A ruin's shape and stage, and its walls as drawn (split where it falls), once per building
    const ruins = new Map<MapObject, { shape: RuinShape; stage: number; fallStart: number }>();
    const wallsOf = (o: MapObject, shape: MassShape): readonly WallPiece[] => {
      const r = ruins.get(o);
      if (!r || r.stage < 3) return shape.walls;
      // At the break line, and where the collapse variants part the upper part across (collapseCuts)
      const seat = this.seatOf(o);
      const scale = o.scale || 1;
      let walls = shape.walls;
      for (const y of [r.shape.breakY, ...collapseCuts(r.shape)]) walls = splitWalls(walls, (y - seat) / scale, SPLIT_GAP / scale);
      return walls;
    };
    if (ruin) {
      for (const o of objects) {
        const d = this.damaged.get(o.id);
        const { frame, shape, footprint } = this.ruinOf(o, d?.heading ?? null);
        if (d) shape.holeRow = RUIN_HOLES.rowOf(o.id);
        ruins.set(o, { shape, stage: d?.stage ?? 0, fallStart: d?.fallStart ?? FELL_LONG_AGO });
        if (!d) continue;
        this.ruinShapes.set(o.id, { shape, seat: frame.seatY });
        this.damageOptions.slabs?.set(o.id, frame, shape, d.stage, d.fallStart, rubbleMaterialOf(o), footprint);
      }
    }
    // Count the instances per batch first: one allocation each
    const wallCount = new Map<MapMassFacade, number>();
    const roofCount = new Map<Covering, number>();
    let capCount = 0;
    for (const o of objects) {
      const shape = massShape(o.mass!, seedOf(o.id));
      wallCount.set(o.mass!.facade, (wallCount.get(o.mass!.facade) ?? 0) + wallsOf(o, shape).length);
      roofCount.set(shape.covering, (roofCount.get(shape.covering) ?? 0) + shape.roof.length);
      capCount += shape.caps.length;
    }
    /** A ruin batch's damage attributes, four floats per instance each */
    const damageOf = (mesh: InstancedMesh, count: number): DamageArrays | null => {
      if (!ruin) return null;
      const arrays = damageArrays(count);
      DAMAGE_ATTRIBUTES.forEach((name, k) => mesh.geometry.setAttribute(name, new InstancedBufferAttribute(arrays[k], 4)));
      return arrays;
    };
    const walls = new Map<MapMassFacade, { batch: Batch; a: Float32Array; b: Float32Array; damage: DamageArrays | null; n: number }>();
    for (const [facade, count] of wallCount) {
      const surface = surfaces.get(FACADE_SURFACE[facade]);
      if (!surface || !count) continue;
      // Own geometry per mesh: its instance attributes ride on it
      const geometry = UNIT_QUAD.clone();
      const a = new Float32Array(count * 4);
      const b = new Float32Array(count * 4);
      geometry.setAttribute('aWall', new InstancedBufferAttribute(a, 4));
      geometry.setAttribute('aWallB', new InstancedBufferAttribute(b, 4));
      geometry.userData['owned'] = true;
      const mesh = new InstancedMesh(geometry, this.wallMaterial(facade, surface, surfaces.get('mass-plinth'), ruin), count);
      mesh.customDepthMaterial = ruin ? (this.ruinWallDepth ??= damageDepthMaterial('mass-wall', 'attribute vec4 aWallB;', GABLE_GLSL)) : this.depthMaterial;
      walls.set(facade, { batch: { mesh, owners: [] }, a, b, damage: damageOf(mesh, count), n: 0 });
    }
    const roofs = new Map<Covering, { batch: Batch; uv: Float32Array; damage: DamageArrays | null; n: number }>();
    for (const [covering, count] of roofCount) {
      const surface = surfaces.get(`mass-roof-${covering}`);
      if (!surface || !count) continue;
      const geometry = UNIT_TRIANGLE.clone();
      geometry.userData['owned'] = true;
      const mesh = new InstancedMesh(geometry, this.roofMaterial(covering, surface, ruin), count);
      if (ruin) mesh.customDepthMaterial = this.ruinDepth ??= damageDepthMaterial('mass');
      const uv = new Float32Array(count * 6);
      roofs.set(covering, { batch: { mesh, owners: [] }, uv, damage: damageOf(mesh, count), n: 0 });
    }
    const plinth = surfaces.get('mass-plinth');
    let caps: { batch: Batch; damage: DamageArrays | null; n: number } | null = null;
    if (plinth && capCount) {
      // A ruin's caps have attributes of their own: their geometry is a copy
      const geometry = ruin ? UNIT_FLAT.clone() : UNIT_FLAT;
      if (ruin) geometry.userData['owned'] = true;
      const mesh = new InstancedMesh(geometry, this.capMaterial(plinth, ruin), capCount);
      if (ruin) mesh.customDepthMaterial = this.ruinDepth ??= damageDepthMaterial('mass');
      caps = { batch: { mesh, owners: [] }, damage: damageOf(mesh, capCount), n: 0 };
    }
    const color = new Color();
    const tint = new Color();

    for (const o of objects) {
      const mass = o.mass!;
      const seed = seedOf(o.id);
      const shape = massShape(mass, seed);
      const scale = o.scale || 1;
      const r = ruins.get(o);
      // Where its instances start in each batch, for the ranges a damaged building leaves
      const w = walls.get(mass.facade);
      const rf = roofs.get(shape.covering);
      const starts = [w?.n ?? 0, rf?.n ?? 0, caps?.n ?? 0];
      // The object's own frame: seated like a building on its outline's rectangle (object-seat.ts), turned and scaled
      const seat = this.seatOf(o);
      this.seats.set(o.id, seat);
      mapToScene(o.x, o.y, seat, this.v);
      this.q.setFromAxisAngle(this.up, o.rotation);
      this.s.setScalar(scale);
      this.m.compose(this.v, this.q, this.s);
      tint.set(o.tint ?? '#ffffff');
      if (w) {
        for (const p of wallsOf(o, shape)) {
          const height = p.top - p.bottom;
          this.local.set(p.ax * p.length, 0, p.nx, p.sx, 0, height, 0, p.bottom, p.az * p.length, 0, p.nz, p.sz, 0, 0, 0, 1);
          this.local.premultiply(this.m);
          w.batch.mesh.setMatrixAt(w.n, this.local);
          w.batch.mesh.setColorAt(w.n, tint);
          // Length and height in metres (scaled), the foundation below the seat, the storeys
          w.a.set([p.length * scale, height * scale, (p.lift ?? Math.max(0, -p.bottom)) * scale, mass.floors], w.n * 4);
          w.b.set([seed, p.kind, p.band * scale, p.kind === WALL_PLAIN ? 0 : Math.max(0, p.wallTop ?? p.top) * scale], w.n * 4);
          if (r && w.damage) writeDamage(w.damage, w.n, r.stage, r.fallStart, r.shape);
          w.batch.owners.push(o);
          w.n++;
        }
      }
      if (rf) {
        // The covering varies a little per building, the same way round as its tiles
        color.setHSL(0, 0, 0.92 + (seed % 7) * 0.02);
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
      if (caps) {
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
      if (!ruin) {
        const ranges: { batch: Batch; start: number; count: number }[] = [];
        if (w && w.n > starts[0]) ranges.push({ batch: w.batch, start: starts[0], count: w.n - starts[0] });
        if (rf && rf.n > starts[1]) ranges.push({ batch: rf.batch, start: starts[1], count: rf.n - starts[1] });
        if (caps && caps.n > starts[2]) ranges.push({ batch: caps.batch, start: starts[2], count: caps.n - starts[2] });
        this.ranges.set(o.id, ranges);
      }
    }
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
    m.defines = { ...(m.defines ?? {}), MASS_FACADE: FACADE_INDEX[facade] };
    const uniforms = {
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
    m.customProgramCacheKey = () => `mass-wall-${facade}`;
    addHeightFog(m);
    if (ruin) asRuin(m);
    this.materials.set(key, m);
    return m;
  }

  /** A roof covering: its surface in metres along the roof, a little variation per building */
  private roofMaterial(covering: Covering, surface: Surface, ruin = false): Material {
    const key = `roof-${covering}${ruin ? '-ruin' : ''}`;
    const cached = this.materials.get(key);
    if (cached) return cached;
    const m = surface.material.clone();
    const uniforms = { uTile: { value: surface.tile } };
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\nattribute vec3 aRoofUvA;\nattribute vec3 aRoofUv;\nuniform float uTile;\nvarying vec2 vRoofM;`)
        .replace('#include <uv_vertex>', ROOF_UV_VERTEX);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\nvarying vec2 vRoofM;`)
        .replace('#include <color_fragment>', `#include <color_fragment>\n${covering === 'flat' ? FLAT_ROOF_FRAGMENT : ''}`);
    };
    m.customProgramCacheKey = () => `mass-roof-${covering}`;
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

/** A ruin's material: the damage in its shader, its inside drawn (ruin-damage.ts) */
function asRuin(m: Material): void {
  addDamage(m);
  m.side = DoubleSide;
}

function disposeBatch(b: Batch): void {
  b.mesh.removeFromParent();
  if (b.mesh.geometry.userData['owned']) b.mesh.geometry.dispose();
  b.mesh.dispose();
}

/**
 * A fallen building's walls: each that crosses the break line `at` (over
 * the seat, the building's units) as its stump and the piece above, a
 * `gap` apart, so each piece lies wholly on one side of it; the same for a
 * cut above it (collapseCuts). Gables stay whole: they rise from the
 * eaves, above any break line but a low hut's
 */
export function splitWalls(walls: readonly WallPiece[], at: number, gap: number): WallPiece[] {
  const out: WallPiece[] = [];
  for (const p of walls) {
    if (p.kind === WALL_GABLE || p.bottom >= at - gap || p.top <= at + gap) {
      out.push(p);
      continue;
    }
    // Both keep the wall's top for its storeys and cornice; the upper one's metres start at its bottom
    out.push({ ...p, top: at - gap / 2, wallTop: p.wallTop ?? p.top }, { ...p, bottom: at + gap / 2, wallTop: p.wallTop ?? p.top, lift: -(at + gap / 2) });
  }
  return out;
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
function seedOf(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return (h >>> 0) % 997;
}

/** A gable's quad drawn in to a triangle: its top corners meet in the middle */
const GABLE_GLSL = /* glsl */ `
if (abs(aWallB.y - 2.0) < 0.5 && transformed.y > 0.5) transformed.x = 0.5;
`;

const WALL_VERTEX_PARS = /* glsl */ `
attribute vec4 aWall;
attribute vec4 aWallB;
uniform float uTile;
varying vec2 vWallM;
varying vec4 vWall;
varying vec4 vWallB;
`;

/** Metres along the wall and over the seat; the surfaces read them in their own repeat */
const WALL_UV_VERTEX = /* glsl */ `
#include <uv_vertex>
{
  // uv_vertex runs before begin_vertex: the gable's corners drawn in again here
  vec3 wallP = position;
  if (abs(aWallB.y - 2.0) < 0.5 && wallP.y > 0.5) wallP.x = 0.5;
  vWallM = vec2(wallP.x * aWall.x, wallP.y * aWall.y - aWall.z);
  vWall = aWall;
  vWallB = aWallB;
  vec2 wallUv = vec2(vWallM.x, vWallM.y + aWall.z) / uTile;
  #ifdef USE_MAP
  vMapUv = wallUv;
  #endif
  #ifdef USE_NORMALMAP
  vNormalMapUv = wallUv;
  #endif
  #ifdef USE_ROUGHNESSMAP
  vRoughnessMapUv = wallUv;
  #endif
  #ifdef USE_METALNESSMAP
  vMetalnessMapUv = wallUv;
  #endif
}
`;

const WALL_FRAGMENT_PARS = /* glsl */ `
#define MASS_FACADE_F float(MASS_FACADE)
varying vec2 vWallM;
varying vec4 vWall;
varying vec4 vWallB;
uniform sampler2D uPlinthMap;
uniform float uPlinthTile;
uniform vec3 uPlinthColor;
uniform float uNightWindows;
float massGlass = 0.0;
float massWindow = 0.0;
float massLit = 0.0;
vec3 massLight = vec3(0.0);

float massHash(vec3 p) {
  return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
}

// Smooth step over a pixel's width: inside 1, outside 0
float massBox(float x, float lo, float hi, float aa) {
  return smoothstep(lo - aa, lo + aa, x) * (1.0 - smoothstep(hi - aa, hi + aa, x));
}
`;

/**
 * The facade: the plinth, the cornice, then per storey and bay a window
 * with its frame, sill, reveal and blind; halls one high row. Laid out in
 * metres per wall (vWallM: along, over the seat), centred with a margin at
 * the corners. Far away the detail turns into its mean colour.
 */
const WALL_COLOR_FRAGMENT = /* glsl */ `
{
  float u = vWallM.x;
  float v = vWallM.y;
  float L = vWall.x;
  float floors = max(vWall.w, 1.0);
  // Whole numbers: an interpolated varying drifts in its last bits, and the hash would turn that into noise
  float seed = floor(vWallB.x + 0.5);
  float kind = vWallB.y;
  float band = vWallB.z;
  float top = vWallB.w;
  float aa = max(max(fwidth(u), fwidth(v)), 1e-4);
  // Per facade: plinth height, bay, window width and height, the sill over the storey's floor, frame colour
  #if MASS_FACADE == 0
  float plinthH = 0.45; float bay = 2.9; float winW = 1.25; float winH = 1.45; float sill = 0.9; vec3 frame = vec3(0.92, 0.92, 0.9);
  #elif MASS_FACADE == 1
  float plinthH = 0.6; float bay = 1.6; float winW = 1.36; float winH = 1.55; float sill = 0.85; vec3 frame = vec3(0.16, 0.17, 0.18);
  #elif MASS_FACADE == 2
  float plinthH = 1.0; float bay = 5.0; float winW = 4.2; float winH = 1.1; float sill = 0.0; vec3 frame = vec3(0.2, 0.21, 0.22);
  #elif MASS_FACADE == 3
  float plinthH = 0.5; float bay = 2.7; float winW = 1.1; float winH = 1.6; float sill = 0.85; vec3 frame = vec3(0.9, 0.9, 0.88);
  #elif MASS_FACADE == 4
  float plinthH = 0.6; float bay = 3.6; float winW = 1.05; float winH = 2.0; float sill = 1.1; vec3 frame = vec3(0.3, 0.27, 0.24);
  #else
  float plinthH = 0.5; float bay = 1.6; float winW = 0.85; float winH = 1.1; float sill = 0.85; vec3 frame = vec3(0.9, 0.88, 0.82);
  #endif
  vec3 base = diffuseColor.rgb;
  #if MASS_FACADE == 2 && defined(USE_COLOR)
  // Sheet metal takes its tint as paint: the sheet's own colour out, its light and shade kept
  base = vColor.rgb * dot(base / max(vColor.rgb, vec3(0.02)), vec3(0.299, 0.587, 0.114)) * 6.5;
  #endif
  // A broad, slow patchiness and grime above the plinth: no two walls alike
  float patchy = massHash(floor(vec3(u * 0.25, v * 0.35, seed)));
  base *= 0.95 + 0.07 * patchy;
  base *= 1.0 - 0.14 * exp(-max(v - plinthH, 0.0) / 0.7);
  float windows = 0.0;
  vec3 detail = base;
  // A shop's wall is a facade too, with display windows on its ground floor
  float shop = step(2.5, kind);
  float facadeWall = max(step(kind, 0.5), shop);
  if (facadeWall > 0.5 && v > plinthH) {
    float usable = max(top - plinthH - band, 0.5);
    float storey = usable / floors;
    float hall = step(4.6, storey);
    float k = floor((v - plinthH) / storey);
    float inStorey = v - plinthH - k * storey;
    float wb;
    float wh;
    if (hall > 0.5) {
      // A hall: one high row under the roof; stone walls tall windows from low down
      #if MASS_FACADE == 4
      wb = 2.2; wh = max(usable - 3.6, 1.5);
      #else
      wh = min(winH * 1.4, usable * 0.3); wb = usable - wh - 0.5;
      #endif
      inStorey = v - plinthH;
      k = 0.0;
    } else {
      wb = sill;
      wh = min(winH, storey - sill - 0.35);
    }
    float display = shop * step(k, 0.5) * step(hall, 0.5);
    if (display > 0.5) {
      // Display windows: wide, from just over the plinth to under the first floor
      bay = 3.2;
      winW = 2.7;
      wb = 0.3;
      wh = storey - 0.75;
    }
    float margin = 0.8;
    float n = floor((L - 2.0 * margin) / bay);
    float ww = winW * (hall > 0.5 ? 1.0 : 1.0);
    if (n < 1.0) { n = L > 2.0 ? 1.0 : 0.0; ww = min(ww, L - 1.0); }
    float u0 = (L - n * bay) * 0.5;
    float i = floor((u - u0) / bay);
    float lu = u - u0 - (i + 0.5) * bay;
    float inBay = step(0.0, i) * step(i, n - 1.0) * step(k, floors - 0.5);
    // An entrance on the ground floor of a long wall: the middle bay a door instead of a window
    float door = step(hall, 0.5) * step(k, 0.5) * step(10.0, L) * step(i, floor(n * 0.5)) * step(floor(n * 0.5), i)
      * step(0.45, massHash(vec3(floor(L * 10.0), seed, 3.0)));
    if (door > 0.5) {
      float dw = 1.4;
      float dh = min(2.5, storey - 0.3);
      float leaf = massBox(lu, -dw * 0.5, dw * 0.5, aa) * massBox(inStorey, 0.0, dh, aa);
      float glassDoor = massBox(lu, -dw * 0.5 + 0.1, dw * 0.5 - 0.1, aa) * massBox(inStorey, 0.15, dh - 0.12, aa);
      vec3 doorColor = mix(vec3(0.2, 0.13, 0.08), vec3(0.16, 0.17, 0.18), step(0.5, massHash(vec3(seed, 5.0, 1.0))));
      detail = mix(detail, frame, leaf);
      detail = mix(detail, mix(doorColor, vec3(0.06, 0.07, 0.08), 0.5 * step(MASS_FACADE_F, 0.5)), glassDoor);
      // A canopy's shadow over it
      detail *= 1.0 - 0.35 * massBox(lu, -dw * 0.5 - 0.3, dw * 0.5 + 0.3, aa) * massBox(inStorey, dh + 0.05, dh + 0.35, aa);
      massWindow = leaf;
      massGlass = glassDoor * 0.5;
      inBay = 0.0;
    }
    #if MASS_FACADE == 5
    // Half-timbered storeys over the ground floor: sill and head plates, a post at every bay line, rails over
    // and under the windows, braces crossing the bays that have none
    if (k > 0.5 && hall < 0.5 && wh > 0.3) {
      vec3 oak = vec3(0.16, 0.1, 0.065) * (0.8 + 0.4 * massHash(vec3(seed, 7.0, 2.0))) * (0.75 + 0.5 * dot(base, vec3(0.33)));
      float bw = 0.17;
      float lp = lu + bay * 0.5;
      float braced = step(0.66, massHash(vec3(i, k, seed + 3.0))) * inBay;
      float timber = max(massBox(inStorey, 0.0, bw, aa), massBox(inStorey, storey - bw, storey + 0.02, aa));
      timber = max(timber, step(0.0, i) * step(i, n) * max(massBox(lp, -bw * 0.5, bw * 0.5, aa), massBox(lp, bay - bw * 0.5, bay + bw * 0.5, aa)));
      float rails = max(massBox(inStorey, wb - bw, wb, aa), massBox(inStorey, wb + wh, wb + wh + bw * 0.8, aa));
      timber = max(timber, rails * inBay * (1.0 - braced));
      float d1 = abs(lp * storey - inStorey * bay) / length(vec2(bay, storey));
      float d2 = abs((bay - lp) * storey - inStorey * bay) / length(vec2(bay, storey));
      timber = max(timber, braced * (1.0 - smoothstep(bw * 0.4 - aa, bw * 0.4 + aa, min(d1, d2))));
      detail = mix(detail, oak, timber);
      inBay *= 1.0 - braced;
    }
    #endif
    if (inBay > 0.5 && wh > 0.3) {
      float h = massHash(vec3(i, k, seed));
      // The opening, its frame and the glass inside
      float open = massBox(lu, -ww * 0.5, ww * 0.5, aa) * massBox(inStorey, wb, wb + wh, aa);
      float fw = 0.07;
      float glass = massBox(lu, -ww * 0.5 + fw, ww * 0.5 - fw, aa) * massBox(inStorey, wb + fw, wb + wh - fw, aa);
      #if MASS_FACADE == 1 || MASS_FACADE == 2
      // Ribbon windows: mullions every bay, here across the whole bay
      #endif
      #if MASS_FACADE == 4
      // A round head on the tall windows of a stone wall
      float arch = length(vec2(lu, max(inStorey - (wb + wh - ww * 0.5), 0.0)));
      open *= 1.0 - smoothstep(ww * 0.5 - aa, ww * 0.5 + aa, arch);
      glass *= 1.0 - smoothstep(ww * 0.5 - fw - aa, ww * 0.5 - fw + aa, arch);
      #endif
      // Blinds part way down in some, the sky's sheen in the rest
      float blind = step(0.62, h) * massBox(inStorey, wb + wh - wh * (0.15 + 0.55 * fract(h * 13.7)), wb + wh + 1.0, aa);
      vec3 glassColor = mix(vec3(0.05, 0.065, 0.08), vec3(0.11, 0.12, 0.13), fract(h * 3.1));
      vec3 blindColor = mix(vec3(0.82, 0.8, 0.74), vec3(0.62, 0.6, 0.56), fract(h * 5.3));
      vec3 pane = mix(glassColor, blindColor, blind);
      // The reveal: the top of the opening in shade
      float reveal = massBox(inStorey, wb + wh - fw - 0.16, wb + wh - fw, aa) * glass;
      pane *= 1.0 - 0.45 * reveal;
      detail = mix(detail, frame, open);
      detail = mix(detail, pane, glass);
      // Window crosses on homes: a mullion and a transom at two thirds
      #if MASS_FACADE == 0 || MASS_FACADE == 3 || MASS_FACADE == 5
      float bar = max(massBox(lu, -0.035, 0.035, aa), massBox(inStorey, wb + wh * 0.66 - 0.035, wb + wh * 0.66 + 0.035, aa)) * step(hall, 0.5) * (1.0 - display);
      detail = mix(detail, frame, glass * bar);
      glass *= 1.0 - bar;
      #endif
      massGlass = glass * (1.0 - blind);
      massWindow = open;
      // The sill under the window, a streak of grime under the sill
      float sillBand = massBox(lu, -ww * 0.5 - 0.06, ww * 0.5 + 0.06, aa) * massBox(inStorey, wb - 0.07, wb, aa);
      detail = mix(detail, vec3(0.78, 0.78, 0.76), sillBand * step(0.1, sill));
      float streak = (1.0 - smoothstep(0.0, ww * 0.45, abs(lu))) * massBox(inStorey, wb - 1.3, wb - 0.07, aa) * (1.0 - (wb - inStorey) / 1.3);
      detail *= 1.0 - 0.1 * streak * step(0.1, sill) * fract(h * 7.7);
      windows = open;
      massLit = glass * step(0.45, fract(h * 19.3)) * (1.0 - blind * 0.6);
      massLight = mix(vec3(1.0, 0.62, 0.3), vec3(1.0, 0.85, 0.6), fract(h * 7.0));
    }
    // The cornice under the roof, a shadow line beneath it
    float cornice = massBox(v, top - band, top - band + 0.22, aa);
    detail = mix(detail, detail * 1.12, cornice * step(0.2, band));
    detail *= 1.0 - 0.18 * massBox(v, top - band - 0.12, top - band, aa) * step(0.2, band);
    // Corner pilasters on plaster
    #if MASS_FACADE == 0
    detail *= 1.0 + 0.05 * (massBox(u, -1.0, 0.32, aa) + massBox(u, L - 0.32, L + 1.0, aa));
    #endif
  }
  // The plinth below, in the plinth's concrete
  vec3 plinthColor = texture2D(uPlinthMap, vWallM / uPlinthTile).rgb * uPlinthColor;
  float plinth = 1.0 - smoothstep(plinthH - aa, plinthH + aa, v);
  plinth *= facadeWall;
  // Far off a window is a few pixels: the facade's mean instead of its shimmer
  float far = smoothstep(0.06, 0.3, aa);
  vec3 mean = mix(base, vec3(0.12, 0.13, 0.14), 0.22 * facadeWall * step(plinthH, v));
  diffuseColor.rgb = mix(mix(detail, mean, far), plinthColor, plinth);
  massGlass *= 1.0 - far;
  massWindow *= 1.0 - far;
  massLit *= 1.0 - plinth;
}
`;

const WALL_SHINE_FRAGMENT = /* glsl */ `
// Frames and blinds painted, the panes glass
roughnessFactor = mix(mix(roughnessFactor, 0.5, massWindow), 0.12, massGlass);
metalnessFactor = mix(mix(metalnessFactor, 0.0, massWindow), 0.55, massGlass);
`;

const WALL_NIGHT_FRAGMENT = /* glsl */ `
totalEmissiveRadiance += massLight * massLit * uNightWindows * 0.9;
`;

/** A roof triangle's corners carry their places in metres: between them by the unit triangle's corner */
const ROOF_UV_VERTEX = /* glsl */ `
#include <uv_vertex>
{
  vec2 a = aRoofUvA.xy;
  vec2 b = vec2(aRoofUvA.z, aRoofUv.x);
  vec2 c = aRoofUv.yz;
  vRoofM = a * (1.0 - position.x - position.z) + b * position.x + c * position.z;
  vec2 roofUv = vRoofM / uTile;
  #ifdef USE_MAP
  vMapUv = roofUv;
  #endif
  #ifdef USE_NORMALMAP
  vNormalMapUv = roofUv;
  #endif
  #ifdef USE_ROUGHNESSMAP
  vRoughnessMapUv = roofUv;
  #endif
  #ifdef USE_METALNESSMAP
  vMetalnessMapUv = roofUv;
  #endif
}
`;

/** A flat roof: its sheets in strips a metre wide, a few patched lighter */
const FLAT_ROOF_FRAGMENT = /* glsl */ `
{
  float strip = floor(vRoofM.x);
  float h = fract(sin(strip * 12.9898 + floor(vRoofM.y / 6.0) * 4.1414) * 43758.5453);
  diffuseColor.rgb *= 0.94 + 0.1 * h;
  float seam = 1.0 - smoothstep(0.0, 0.04, abs(fract(vRoofM.x) - 0.5) - 0.46);
  diffuseColor.rgb *= 1.0 - 0.12 * seam;
}
`;
