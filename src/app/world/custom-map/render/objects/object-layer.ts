import {
  Color,
  DoubleSide,
  Euler,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  PerspectiveCamera,
  Quaternion,
  Ray,
  Raycaster,
  Sphere,
  Vector2,
  Vector3,
  type BufferGeometry,
  type Camera,
  type Intersection,
  type Material,
  type Object3D,
  type Texture,
  type MeshStandardMaterial,
} from 'three';
import type { MapObject } from '../../map-document';
import { LOD_TAN_HALF_FOV, objectRadius, pixelDistance, screenDistance, type AssetCatalog, type CatalogObject, type StageTone } from '../asset-catalog';
import { QUALITY_TABLE } from '../../../../three-engine/render-quality';
import type { LosPrepare } from '../../../../three-engine/tower-shadow-mapper';
import type { HeightField } from '../height-field';
import type { LodModel, MapAssetLibrary, ModelPart, ObjectModel } from '../map-asset-library';
import { addHeightFog } from '../environment/height-fog';
import { WIND_GLSL, WIND_UNIFORMS, windSwayAtTop } from '../environment/wind';
import { mapToScene } from '../map-coords';
import { seatHeight, wallShear } from './object-seat';
import { addAtlasVariants } from './atlas-variants';
import { instanceVariation, rowLookKey } from './instance-variation';
import type { ImpostorCache } from './impostor-cache';
import { addVertexRoughMetal, mergeParts } from './merge-parts';
import { clothGeometry, isCloth } from './cloth';
import { DEFAULT_SPIN, SPIN_GLSL } from './spin';
import { addRotorTurn, DEFAULT_ROTOR, isRotor, rotorDepthMaterial, rotorGeometry, rotorHub } from './rotor';
import { addNightWindows, isWindowGlass } from './night-windows';
import { addLodFade, blendAt, disposeFadeGeometry, fadeGeometry, holdBlend, levelStart, REST_S, SETTLE_S, settleBlend, type LodBlend } from './lod-fade';
import { InstanceList, type InstanceSource } from './instance-list';
import { LineSpheres } from './line-spheres';
import { MassLayer } from './mass-layer';
import { FAR_BLOCKING, FAR_OPEN, FarBoxes } from './far-boxes';
import { ImpostorDraws } from './impostor-array';
import { BAND_BLOCKING, BAND_OPEN, BAND_SCREEN, hasBand, LineBands } from './line-bands';
import type { SharedDraws } from './shared-draws';
import { nextFrameOrTimeout } from '../../../../utils/next-frame';
import { DESTRUCTIBLE_CATEGORIES } from '../../custom-map-destruction';
import { rubbleMaterialOf } from '../../rubble-material';
import { RuinSlabs, type RuinFootprint } from './ruin-slabs';
import { HOLE_SLOTS, HOLE_STRIDE } from '../../../../configs/destruction.config';
import { modelSection } from './ruin-section';
import type { CatalogRoof } from '../../object-roof';
import { addDamage, DAMAGE_ATTRIBUTES, DAMAGE_LOS, damageArrays, damageDepthMaterial, emberPoint, fallImpact, FELL_LONG_AGO, readDamage, RUIN_EMBERS, RUIN_HOLES, ruinSeed, structureSeed, ruinShape, writeDamage, type DamageArrays } from './ruin-damage';

/**
 * The placed objects of a map, drawn instanced: per asset, detail level and
 * model part one InstancedMesh for the whole map, the parts of a level
 * sharing one list of instances (instance-list.ts). Each object shows the
 * level its own size on screen asks for: its bounding radius over its
 * distance against the screen share of the catalogue's `lod` models (a
 * garage takes its LOD model nearer than a school), an impostor for far
 * trees, nothing once its radius on screen falls under the quality level's
 * pixel limit (a piece of a line by the whole line's, line-spheres.ts).
 * Around each switch a band shows both levels dissolving into each other
 * (lod-fade.ts). A level
 * switch moves an instance or two in the level's list, never the list. The
 * 192 m cells this replaced drew a town of OSM in 8 900 meshes, each asset's
 * level and part once per cell, and switched whole cells at once.
 *
 * - an object is looked at again only once the camera (or its focus) has
 *   moved as far as the nearest band it could cross (`slack` of blendAt,
 *   `dueAt`): on a still camera with settled bands nothing runs, on a moving
 *   one a few objects near their bands, not the map
 * - each level's casters come first in its list: the shadow pass draws
 *   those, objects near the camera's focus (the sun's shadow box covers no
 *   more) with the level that covers more of their pixels in a band
 * - sight blockers (trees, big rocks, buildings) live in the LOS group and
 *   draw to High's pixel limit on every level. The towers' LOS cube does
 *   not see these levels (`losTransparent`): per blocking asset it draws
 *   its full model for every object within the cube's reach of the tower's
 *   tip (`losStage`, filled per cube render), so what a tower sees does not
 *   depend on the game camera, the quality level or the pixel limit
 *
 * Trees and plants sway in the wind, foliage cards keep their normals and
 * fade when seen edge-on or near their pixel limit, waterfall cards flow
 * and flames flicker (all in objectMaterial). Vegetation gets a brightness
 * hue and size per instance, trees also a lean, autumn foliage a wider
 * turn of colour (instance-variation.ts), so a forest of one model does
 * not look cloned. Plain-coloured model parts of one look are merged into
 * one (merge-parts.ts).
 *
 * The pieces of walls, fences and tracks end in a band far off: a box of six
 * triangles each, every asset's in one draw, so a line reads as one band to
 * the map's edge (line-bands.ts).
 *
 * Buildings raised from their own footprint (MapObject.mass) have no model
 * of their own: the mass layer draws them (mass-layer.ts), every object
 * call here hands them over.
 *
 * A damaged building (setDamage, docs/DESTRUCTION_PLAN.md) leaves its
 * asset's batch for the asset's ruin batch: the same models with the
 * damage in the shader (ruin-damage.ts), both sides drawn, its stage and
 * ruin per instance. Intact buildings keep their programs, front faces and
 * early depth; the ruins cost a draw call per asset and level, not per
 * ruin. A ruin shows its models to the pixel limit, no far box.
 */

/** Distance from the point at `at` in `xyz` to `p`; not Math.hypot, a builtin call whose result V8 boxes, per object and frame */
function distance(xyz: Float32Array, at: number, p: Vector3): number {
  const dx = xyz[at] - p.x;
  const dy = xyz[at + 1] - p.y;
  const dz = xyz[at + 2] - p.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** An object outside every band (AssetBatch.nextOf) */
/** Scratch colour for a detail stage's tone (objectMaterial) */
const STAGE_TONE = new Color();
const NO_NEXT = -2;
/** Milliseconds of batches built before setObjects gives the page a frame: a town's assets were built in one */
const BUILD_SLICE_MS = 8;
/** Milliseconds of ruin floors built a frame (buildSlabs): one building's took 3 to 5 */
const SLABS_MS = 4;
/** Strongest glow of an object surface (emissive colour times intensity, linear) */
const MAX_EMISSIVE = 0.55;

/**
 * A withered tree (a felled one, WitheredObject) carries this on its
 * instance colour's red: the shaders take it off again and brown its leaves
 * (WITHER_FRAGMENT), its trunk keeps its colour. No program more, no variant
 */
const WITHER_FLAG = 4;

/** An object drawn withered: the view's felled trees (CustomMapView.setFelled), not the document's */
export interface WitheredObject extends MapObject {
  withered: true;
}

const WITHER_VERTEX = /* glsl */ `#include <color_vertex>
vWither = 0.0;
#ifdef USE_INSTANCING_COLOR
if (instanceColor.r > ${(WITHER_FLAG - 1).toFixed(1)}) {
  vWither = 1.0;
  vColor.r *= (instanceColor.r - ${WITHER_FLAG.toFixed(1)}) / instanceColor.r;
}
#endif`;

/** Withered leaves: their shade in ochre and brown, a little of their green left, darker where they were dark */
const WITHER_FRAGMENT = /* glsl */ `#include <color_fragment>
if (vWither > 0.5) {
  float leaf = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));
  vec3 ochre = mix(vec3(0.48, 0.3, 0.12), vec3(0.72, 0.52, 0.22), smoothstep(0.08, 0.35, leaf)) * (0.55 + 1.6 * leaf);
  diffuseColor.rgb = mix(diffuseColor.rgb, ochre, 0.82);
}`;
/** Sight blockers draw to High's pixel limit on every level: what the towers' sight sees does not depend on it */
const LOS_DRAW_PIXELS = QUALITY_TABLE.high.customMaps.drawPixels;
/** Instances an asset's lists have room for: half again of its objects, at least 16, so a brush adds without building anew */
function listCapacity(n: number): number {
  return Math.max(16, Math.ceil(n * 1.5));
}

interface Level {
  /** Where the level starts: metres of distance per metre of the object's radius (lod-fade.ts FadeLevel) */
  from: number;
  /** `depthMaterial`: the part's own for the shadow pass (an impostor's card turned to the sun) */
  parts: { geometry: BufferGeometry; material: Material; depthMaterial?: Material }[];
  /** A far impostor: starts at the larger of `from` and the quality level's impostor distance */
  impostor?: boolean;
  /**
   * A level drawn with other assets' objects in one mesh (shared-draws.ts), no parts of its own: a building's far
   * box, a tree's impostor. `extras`: the per-instance values its objects bring besides matrix and colour
   */
  shared?: { draws: SharedDraws; key: string; extras: () => readonly ArrayLike<number>[] };
}

/** What draws one level of an asset: its instances and the meshes of its parts */
/** What the LOS cube draws of a blocking asset: its full model, for the objects in a cube's reach (prepareLos) */
interface LosDraw {
  list: InstanceList;
  /** Slot of each object in the list, -1 for none */
  slots: Int32Array;
  meshes: InstancedMesh[];
}

interface LevelDraw {
  list: InstanceList;
  /** Slot of each object in the list, -1 for none */
  slots: Int32Array;
  meshes: InstancedMesh[];
  /** Where its instances come from: the asset's matrices and colours, a far box's row or an impostor's layer too */
  source: InstanceSource;
  /** The shared draw and key whose list this level fills with other assets (shared-draws.ts); null for its own */
  shared: { draws: SharedDraws; key: string } | null;
}

interface AssetBatch {
  entry: CatalogObject;
  model: ObjectModel;
  /** The detail models it was built with, for its ruin batch */
  lods: LodModel[];
  blocksLos: boolean;
  /** The asset's damaged objects (setDamage): damage in the shader, both sides drawn */
  ruin: boolean;
  /** Its impostor's level, -1 without */
  impostorAt: number;
  /** A ruin batch's damage per object (writeDamage), its lists' extras */
  damage: DamageArrays | null;
  /** Plants of 0.8 m and less cast no shadow */
  casts: boolean;
  objects: MapObject[];
  levels: Level[];
  draws: LevelDraw[];
  /** The LOS cube's draw of a blocking asset; null for one that blocks nothing */
  los: LosDraw | null;
  /** Objects the lists have room for */
  capacity: number;
  /** Instance matrices of all objects (16 per object), colours (3) when tinted: the lists' source */
  source: InstanceSource;
  /** Bounding sphere centre and radius per object (4 per object) */
  spheres: Float32Array;
  /** The sphere of the line each object is a piece of (4 per object, line-spheres.ts), radius 0 for none */
  lines: Float32Array;
  /** Bounds of every object, the frustum test of each of the asset's meshes */
  bounds: Sphere;
  boundsStale: boolean;
  /** The level each object shows, -1 hidden; in a band the level it dissolves into (-1 none), NO_NEXT outside, and how far */
  levelOf: Int8Array;
  nextOf: Int8Array;
  fadeOf: Float32Array;
  /** The level each object casts its shadow with, -1 none */
  shadowOf: Int8Array;
  /**
   * Where each object settled in a band (lod-fade.ts holdBlend): the band (its next level, NO_NEXT for none),
   * its t then and the level it settled on (0 near, 1 far)
   */
  holdNext: Int8Array;
  holdAt: Float32Array;
  holdEnd: Int8Array;
  /** The camera travel (MapObjectLayer.travel) at which each object is looked at again */
  dueAt: Float64Array;
}

export interface ObjectHit {
  object: MapObject;
  point: Vector3;
  distance: number;
}

/**
 * A piece the view lays itself, not one of the document's objects (a
 * bridge's deck, paths/path-bridges.ts): its origin stands at the height
 * `at`, whatever the ground does, it is drawn `breadth` times wider along
 * model z and `stretch` times longer along model x, and the editor's pick
 * passes through it. Otherwise it is drawn like any object of its asset:
 * levels, pixel limit (by its `line`), shadow, LOS cube
 */
export interface LaidObject extends MapObject {
  at: number;
  breadth: number;
}

/** The height a laid piece stands at (LaidObject.at), null for an object of the document */
function laidAt(o: MapObject): number | null {
  return (o as Partial<LaidObject>).at ?? null;
}

/** Whether two laid pieces draw the same */
function sameLaid(a: LaidObject, b: LaidObject): boolean {
  return a.asset === b.asset && a.x === b.x && a.y === b.y && a.at === b.at && a.z === b.z && a.rotation === b.rotation
    && (a.roll ?? 0) === (b.roll ?? 0) && (a.pitch ?? 0) === (b.pitch ?? 0) && a.scale === b.scale
    && (a.stretch ?? 1) === (b.stretch ?? 1) && a.breadth === b.breadth && a.line === b.line && a.blocksLos === b.blocksLos;
}

export interface ObjectLayerOptions {
  /** The view's impostors (shared with its other object layers); without them far trees keep their model */
  impostors?: ImpostorCache;
  /** Level of the water at a map point, null on dry ground (floating objects) */
  waterLevelAt?: (x: number, y: number) => number | null;
  /**
   * Buildings can be damaged (a destructible map): their ruin batches are
   * made with the map, so the warm-up builds their programs
   */
  ruins?: boolean;
  /**
   * The ground as the map made it: buildings, walls and structures stand on
   * it, not on the craters and rubble of the fight (a stump stays where the
   * building stood)
   */
  standingAt?: (x: number, y: number) => number;
}

/**
 * A building's damage for setDamage: the simulation's stage, the view's
 * clock at which a fall began, the scene heading it gives way to (null: its
 * seed rolls one)
 */
export interface ObjectDamage {
  id: string;
  stage: number;
  fallStart: number;
  heading?: number | null;
}

export class MapObjectLayer {
  /** Non-blocking objects; blocking ones are added to the LOS group given to the constructor */
  readonly group = new Group();
  /**
   * Settles once the programs of assets new to the map are built (the editor compiles them off the main
   * thread): their first objects wait for it, instead of linking them in the frame they first draw
   */
  prepareAssets: ((assetIds: string[]) => Promise<unknown>) | null = null;
  private batches: AssetBatch[] = [];
  private readonly byId = new Map<string, { batch: AssetBatch; index: number }>();
  /** Damaged objects by id (setDamage), also those not built yet */
  private readonly damaged = new Map<string, { stage: number; fallStart: number; heading: number | null }>();
  /** The sun's shadow of every ruin (ruin-damage.ts) */
  private ruinDepth: Material | null = null;
  /** The floors inside the ruins, raised buildings' too (with options.ruins) */
  private readonly slabs: RuinSlabs | null;
  /**
   * Ruin floors to build (RuinSlabs.set), by object: the ones that came this frame and the ones due from the next
   * on, built SLABS_MS a frame (a building's floors took 3 to 5 ms; a nuclear strike's two in its impact frame, E271)
   */
  private slabsNow = new Map<string, Parameters<RuinSlabs['set']>>();
  private slabsDue = new Map<string, Parameters<RuinSlabs['set']>>();
  private readonly materials = new Map<string, Material>();
  /** Shadow materials of rotor parts by seconds a turn (rotorShadow) */
  private readonly rotorShadows = new Map<number, Material>();
  /** The buildings' far stage, once its atlas is in (ensureFarBoxes) */
  private farBoxes: FarBoxes | null = null;
  private farAtlas: Promise<Texture | null> | null = null;
  /** Every impostor of the layer in a draw per view size and sight flag, once one comes (impostor-array.ts) */
  private impostorDraws: ImpostorDraws | null = null;
  /** Every wall's, fence's and track's band in a draw per sight flag, once one comes (line-bands.ts) */
  private bands: LineBands | null = null;
  /** An asset's bounds changed: the shared draws' bounds follow */
  private sharedBoundsStale = false;
  private disposed = false;
  private generation = 0;
  /** While setObjects builds its batches over frames: settles when they are all in */
  private building: Promise<void> | null = null;
  /** Ids removed while setObjects builds, of objects not built yet: they go once the batches are in */
  private dropLater: Set<string> | null = null;
  private readonly camPos = new Vector3();
  private readonly focus = new Vector3();
  /** How far the bands have settled at rest (lod-fade.ts settleBlend): 0 while the camera moves, 1 at rest */
  private settle = 0;
  /** The camera's position at the last frame, and how long it has stood there, s */
  private readonly lastCamPos = new Vector3(Infinity, 0, 0);
  private readonly lastFocus = new Vector3(Infinity, 0, 0);
  private lastShadowRadius = 0;
  private restFor = 0;
  /** The levels were taken from a camera once (update): before, an object's level is no level to hold */
  private viewed = false;
  /**
   * How far camera and focus have moved since the layer began, the larger
   * of the two each frame, m: an object due at `dueAt` is looked at again
   * once this passes it
   */
  private travel = 0;
  /** Screen shares measure against a 60 degree view; a wider camera switches nearer (LOD_TAN_HALF_FOV) */
  private viewScale = 1;
  /** The levels being worked out for an object (blendAt, settleBlend), one object for all */
  private readonly blend: LodBlend = { level: 0, next: null, t: 0, slack: 0 };
  private readonly tmpMatrix = new Matrix4();
  private readonly shear = new Matrix4();
  private readonly tmpPos = new Vector3();
  /** Ground and water for seatHeight, bound once */
  private readonly seatGround = (x: number, y: number): number => this.field.heightAt(x, y);
  /** Buildings stand on the ground as the map made it (ObjectLayerOptions.standingAt) */
  private readonly standGround = (x: number, y: number): number => (this.options.standingAt ?? this.seatGround)(x, y);
  private readonly seatWater = (x: number, y: number): number | null => this.options.waterLevelAt?.(x, y) ?? null;
  private readonly tmpQuat = new Quaternion();
  private readonly tmpScale = new Vector3();
  private readonly up = new Vector3(0, 1, 0);
  private readonly leanAxis = new Vector3();
  private readonly tilt = new Quaternion();
  private readonly tiltEuler = new Euler();
  private readonly sphere = new Sphere();
  private readonly raycaster = new Raycaster();
  /** One mesh the editor's ray tests each candidate object's model with */
  private readonly pickMesh = new Mesh();
  private readonly pickHits: Intersection[] = [];
  private readonly tmpRay = new Ray();
  private readonly instanceMatrix = new Matrix4();
  /** Objects within this distance of the focus cast shadows */
  shadowRadius = 400;
  /**
   * The quality level's part (render-quality.ts): detail switches times
   * `lodBias`, impostors from `impostorFrom` m, objects that do not block
   * sight drawn down to `drawPixels` on screen. Sight blockers draw to
   * High's pixel limit (LOS_DRAW_PIXELS): what the line of sight sees does
   * not depend on the level
   */
  private detail = { lodBias: 1, impostorFrom: 380, drawPixels: QUALITY_TABLE.high.customMaps.drawPixels };
  /** Fade ranges of the card materials with the radius of the asset they were made for */
  private readonly fades: { range: Vector2; radius: number }[] = [];
  /** The lines the pieces name (MapObject.line) */
  private readonly lineSpheres = new LineSpheres();
  /** The blockers as the LOS cube draws them (LosDraw), shown in its render only (tower-shadow-mapper.ts losOnly) */
  private readonly losStage = new Group();
  /** The cube's tip in the LOS group's space and its reach: the bounds of every LosDraw mesh */
  private readonly losTip = new Vector3();
  private readonly losBounds = new Sphere();
  /** Counts every change the sun's shadow map shows: instances moved, casters switched */
  version = 0;
  /** The buildings raised from their footprint */
  private readonly masses: MassLayer;
  /** The pieces the view lays itself (setLaid), by who lays them: drawn beside the document's, kept over setObjects */
  private readonly laid = new Map<string, LaidObject[]>();
  /** The laid pieces in the batches now, by id */
  private laidDrawn = new Map<string, LaidObject>();
  /** Counts the setLaid calls; a setObjects in flight lays what came after its start once it is done */
  private laidVersion = 0;
  private setting = 0;

  constructor(
    private readonly field: HeightField,
    private readonly assets: MapAssetLibrary,
    private readonly losGroup: Group,
    private readonly options: ObjectLayerOptions = {},
  ) {
    this.group.name = 'custom-map-objects';
    this.group.userData['losTransparent'] = true;
    this.losStage.name = 'custom-map-objects-los';
    this.losStage.visible = false;
    this.losStage.userData['losOnly'] = true;
    this.losStage.userData['losPrepare'] = ((tip, far, warmUp) => this.prepareLos(tip, far, warmUp)) satisfies LosPrepare;
    losGroup.add(this.losStage);
    this.slabs = options.ruins ? new RuinSlabs() : null;
    if (this.slabs) this.group.add(this.slabs.mesh);
    this.masses = new MassLayer(field, assets, losGroup, options.waterLevelAt, () => this.version++, { ruins: !!options.ruins, standingAt: options.standingAt, slabs: this.slabs });
    this.group.add(this.masses.group);
  }

  /** Replaces every object of the document (the laid pieces stay, setLaid); resolves when the models are in */
  async setObjects(objects: MapObject[]): Promise<void> {
    this.setting++;
    const version = this.laidVersion;
    const laid = this.allLaid();
    try {
      await this.replaceObjects([...objects, ...laid.values()], laid);
    } finally {
      this.setting--;
    }
    // Pieces laid while it built: in now, as setLaid would have put them
    if (this.setting === 0 && version !== this.laidVersion && !this.disposed) await this.syncLaid();
  }

  /**
   * The pieces `key` lays (a bridge layer's decks), in place of the ones it
   * laid before: those that moved are written anew, new ones come in, gone
   * ones go. Resolves when they show
   */
  async setLaid(key: string, pieces: LaidObject[]): Promise<void> {
    if (this.disposed) return;
    if (pieces.length) this.laid.set(key, pieces);
    else this.laid.delete(key);
    this.laidVersion++;
    // A setObjects under way takes them along when it is done
    if (this.setting === 0) await this.syncLaid();
  }

  private allLaid(): Map<string, LaidObject> {
    const all = new Map<string, LaidObject>();
    for (const list of this.laid.values()) for (const o of list) all.set(o.id, o);
    return all;
  }

  /** The batches brought to the laid pieces as they are now */
  private async syncLaid(): Promise<void> {
    const want = this.allLaid();
    const drawn = this.laidDrawn;
    this.laidDrawn = want;
    const gone: string[] = [];
    const moved: LaidObject[] = [];
    const added: LaidObject[] = [];
    for (const id of drawn.keys()) if (!want.has(id)) gone.push(id);
    for (const [id, o] of want) {
      const was = drawn.get(id);
      if (!was) added.push(o);
      else if (!sameLaid(was, o)) moved.push(o);
    }
    // Another asset or LOS flag: out and in again
    const rest = moved.length ? this.updateObjects(moved) : [];
    gone.push(...rest.map((o) => o.id));
    if (gone.length) this.removeObjects(gone);
    added.push(...(rest as LaidObject[]));
    if (added.length) await this.addObjects(added);
  }

  private async replaceObjects(objects: MapObject[], laid: Map<string, LaidObject>): Promise<void> {
    const generation = ++this.generation;
    this.laidDrawn = laid;
    const masses = objects.filter(MassLayer.owns);
    // Raised buildings damaged before they were built take their damage along
    const hurt = masses.filter((o) => this.damaged.has(o.id)).map((o) => ({ id: o.id, ...this.damaged.get(o.id)! }));
    if (hurt.length) this.masses.setDamage(hurt);
    // The basements under catalogue models draw there too, the models here
    const shown = this.masses.setObjects(objects.filter(MassLayer.draws));
    if (masses.length) objects = objects.filter((o) => !MassLayer.owns(o));
    const catalog = await this.assets.catalog();
    const groups = groupByAsset(catalog, objects, this.damaged);
    const far = this.ensureFarBoxes(catalog, objects);
    // Every asset's model and detail models at once: one after the other, a town waited for 49 loads in a row
    const loaded = await Promise.all(
      [...groups].map(async ([key, list]) => ({
        key,
        list,
        parts: await Promise.all([this.assets.model(list[0].asset), this.assets.lodModels(list[0].asset)]).then(async (parts) => {
          await this.prepareImpostor(parts[0]);
          return parts;
        }),
      })),
    );
    await far;
    if (generation !== this.generation) return;
    this.clear();
    const dropped = new Set<string>();
    let built = (): void => undefined;
    const building = new Promise<void>((resolve) => (built = resolve));
    this.building = building;
    this.dropLater = dropped;
    try {
      // One after the other into the layer: a building's far boxes make room for those before it (sharedDraw). A
      // frame for the page every BUILD_SLICE_MS; a newer setObjects (generation) drops this one there
      let slice = performance.now();
      for (let k = 0; k < loaded.length; k++) {
        const { key, list, parts: [model, lods] } = loaded[k];
        const b = this.buildBatch(model, lods, keyBlocks(key), list, keyRuin(key));
        this.batches.push(b);
        b.objects.forEach((o, index) => this.byId.set(o.id, { batch: b, index }));
        this.ensureRuinBatch(b);
        if (k < loaded.length - 1 && performance.now() - slice > BUILD_SLICE_MS) {
          await nextFrameOrTimeout();
          if (generation !== this.generation) return;
          slice = performance.now();
        }
      }
      this.dropLater = null;
      if (dropped.size) this.removeObjects([...dropped]);
      this.applyLevels(true);
    } finally {
      if (this.dropLater === dropped) this.dropLater = null;
      if (this.building === building) this.building = null;
      built();
    }
    await shown;
  }

  /**
   * Moves, turns or scales objects in place. Returns the ones it could not:
   * unknown, another asset or LOS flag; the caller moves those out and in
   * again.
   */
  updateObjects(objects: readonly MapObject[]): MapObject[] {
    const rest: MapObject[] = [];
    const cellars: MapObject[] = [];
    const cellarsGone: string[] = [];
    let changed = false;
    for (const o of objects) {
      const slot = this.byId.get(o.id);
      const b = slot?.batch;
      // A raised building goes out and in again (mass-layer.ts writes all of them anew)
      if (!slot || !b || MassLayer.owns(o) || o.asset !== b.objects[slot.index].asset || (o.blocksLos ?? b.entry.blocksLos) !== b.blocksLos) {
        rest.push(o);
        continue;
      }
      if (o.tint && !b.source.colors) {
        // A first tint: the asset needs colours, which addObjects gives it
        rest.push(o);
        continue;
      }
      // Its basement (MapObject.basement) moves with it in the mass layer
      if (MassLayer.cellar(o)) cellars.push(o);
      else if (this.masses.hasCellar(o.id)) cellarsGone.push(o.id);
      b.objects[slot.index] = o;
      this.writeInstance(b, slot.index);
      this.rewrite(b, slot.index);
      changed = true;
    }
    if (cellars.length || cellarsGone.length) void this.masses.change(cellars, cellarsGone);
    if (changed) {
      this.version++;
      this.applyLevels(false);
    }
    return rest;
  }

  /** Adds objects (an asset new to the map loads its model first). Resolves when they show. */
  async addObjects(objects: MapObject[]): Promise<void> {
    if (!objects.length) return;
    // Raised buildings and the basements under catalogue models (MapObject.basement) to the mass layer, the models here
    const masses = objects.filter(MassLayer.draws);
    await Promise.all([masses.length ? this.masses.change(masses, []) : null, this.addCatalogued(objects.filter((o) => !MassLayer.owns(o)))]);
  }

  /** Adds catalogue models (not raised buildings) to their batches */
  private async addCatalogued(objects: MapObject[]): Promise<void> {
    if (!objects.length) return;
    // New ones after the batches setObjects is building: an asset it has not built yet would get a second batch
    while (this.building) await this.building;
    const generation = this.generation;
    const catalog = await this.assets.catalog();
    await this.ensureFarBoxes(catalog, objects);
    for (const [key, list] of groupByAsset(catalog, objects, this.damaged)) {
      const blocks = keyBlocks(key);
      const ruin = keyRuin(key);
      const find = (): AssetBatch | undefined => this.batches.find((x) => x.model.id === list[0].asset && x.blocksLos === blocks && x.ruin === ruin);
      let b = find();
      if (!b) {
        // An asset new to the map: its programs built before its first objects draw (prepareAssets)
        const [model, lods] = await Promise.all([this.assets.model(list[0].asset), this.assets.lodModels(list[0].asset), this.prepareAssets?.([list[0].asset])]);
        await this.prepareImpostor(model);
        // A setObjects in between replaced everything
        if (generation !== this.generation) return;
        // Another call may have made the batch meanwhile
        b = find();
        if (!b) {
          const built = this.buildBatch(model, lods, blocks, list, ruin);
          this.batches.push(built);
          built.objects.forEach((o, index) => this.byId.set(o.id, { batch: built, index }));
          this.ensureRuinBatch(built);
          continue;
        }
      }
      this.append(b, list);
    }
    this.version++;
    this.applyLevels(false);
  }

  /** Objects into a batch that is there: room made, their instances written; the next pass shows them */
  private append(b: AssetBatch, list: readonly MapObject[]): void {
    const start = b.objects.length;
    const n = start + list.length;
    // A first tinted object gives the asset colours: its lists are built anew with them, as when it outgrows them
    const newColors = !b.source.colors && list.some((o) => o.tint);
    if (newColors) b.source.colors = new Float32Array(b.capacity * 3);
    if (n > b.capacity || newColors) this.resize(b, Math.max(b.capacity, listCapacity(n)));
    b.objects.push(...list);
    for (let i = newColors ? 0 : start; i < n; i++) this.writeInstance(b, i);
    for (let i = start; i < n; i++) this.byId.set(b.objects[i].id, { batch: b, index: i });
    // Shown by the pass below, as an object moving into view
    b.boundsStale = true;
  }

  /**
   * Damage of buildings, walls and structures (the simulation's stages,
   * docs/DESTRUCTION_PLAN.md): from stage 1 an object draws in its asset's
   * ruin batch, at 0 in its own again; a stage-3 one falls from `fallStart`
   * (DAMAGE_UNIFORMS' clock; FELL_LONG_AGO lies fallen). Objects not built
   * yet come with their damage. Raised buildings go to the mass layer
   */
  setDamage(changes: readonly ObjectDamage[]): void {
    const masses: ObjectDamage[] = [];
    let changed = false;
    for (const c of changes) {
      // The latest damage last: the smouldering nests are the newest ruins' (embers)
      this.damaged.delete(c.id);
      if (c.stage > 0) this.damaged.set(c.id, { stage: c.stage, fallStart: c.fallStart, heading: c.heading ?? null });
      else this.dropSlabs(c.id);
      if (this.masses.has(c.id)) {
        masses.push(c);
        continue;
      }
      const slot = this.byId.get(c.id);
      if (!slot) continue;
      const ruin = c.stage > 0;
      if (slot.batch.ruin === ruin) {
        if (!ruin) continue;
        this.writeDamageOf(slot.batch, slot.index);
        this.rewrite(slot.batch, slot.index);
      } else {
        this.moveTo(slot.batch, slot.index, ruin);
      }
      changed = true;
    }
    if (masses.length) this.masses.setDamage(masses);
    if (changed) {
      this.dropEmpty();
      this.version++;
      this.applyLevels(false);
    }
  }

  /** Where the newest ruins from stage 2 smoulder, a dozen at most (group space) */
  /**
   * Object `id`'s holes (HOLE_SLOTS of HOLE_STRIDE whole numbers, as the
   * simulation keeps them: offset from its point in map dm, height over its
   * seat in dm, radius in dm, order) into RUIN_HOLES in the group frame;
   * one new or grown since `was` opens at `now` (the damage clock), the
   * others keep their time
   */
  setHoles(id: string, holes: Int32Array, was: Int32Array | null, now: number): void {
    for (let s = 0; s < HOLE_SLOTS; s++) {
      const k = s * HOLE_STRIDE;
      const same = was !== null && was[k + 3] > 0 && was[k] === holes[k] && was[k + 1] === holes[k + 1] && was[k + 2] === holes[k + 2];
      if (!same || !this.holeTimes.has(`${id}#${s}`)) this.holeTimes.set(`${id}#${s}`, same ? FELL_LONG_AGO : now);
    }
    this.holeSets.set(id, holes);
    this.placeHoles(id);
    // A battered building shows its storeys through its holes (raised ones too: the slabs are shared)
    let holed = false;
    for (let s = 0; s < HOLE_SLOTS && !holed; s++) holed = holes[s * HOLE_STRIDE + 3] > 0;
    this.slabs?.setHoled(id, holed);
  }

  /** Object `id`'s holes into RUIN_HOLES where it stands now; one not built yet waits for writeDamageOf */
  private placeHoles(id: string): void {
    const holes = this.holeSets.get(id);
    if (!holes) return;
    let at: { x: number; y: number; seat: number } | null = this.masses.holeFrame(id);
    if (!at) {
      const slot = this.byId.get(id);
      if (!slot) return;
      const o = slot.batch.objects[slot.index];
      at = { x: o.x, y: o.y, seat: slot.batch.source.matrices[slot.index * 16 + 13] };
    }
    const rim = (structureSeed(id) % 97) * 0.37;
    const list: [number, number, number, number, number, number, number][] = [];
    for (let s = 0; s < HOLE_SLOTS; s++) {
      const k = s * HOLE_STRIDE;
      if (holes[k + 3] <= 0) continue;
      const opened = this.holeTimes.get(`${id}#${s}`) ?? FELL_LONG_AGO;
      list.push([-(at.x + holes[k] / 10), at.seat + holes[k + 2] / 10, at.y + holes[k + 1] / 10, holes[k + 3] / 10, opened, rim + s * 3.1, holes[k + 4]]);
    }
    RUIN_HOLES.set(id, list);
  }

  /** Each object's holes as last set (setHoles) */
  private readonly holeSets = new Map<string, Int32Array>();

  /** When each hole of a ruin opened (`id#slot`, the damage clock): a grown one keeps it */
  private readonly holeTimes = new Map<string, number>();

  /**
   * The meshes of the ruins no building is in yet: each destructible
   * asset's empty ruin batch, the raised buildings' hidden ones, the floors
   * without a ruin. A map's warm-up leaves them for later (CustomMapView
   * .warmLater): needed at a building's first hit, not to start
   */
  ruinStandIns(): Object3D[] {
    const out: Object3D[] = [];
    for (const b of this.batches) {
      if (!b.ruin || b.objects.length > 0) continue;
      for (const d of b.draws) out.push(...d.meshes);
    }
    out.push(...this.masses.warmStandIns());
    if (this.slabs && !this.slabs.mesh.visible) out.push(this.slabs.mesh);
    return out;
  }

  /**
   * Of those, what objects `ids` draw with as ruins: their assets' ruin
   * batches, the raised buildings' (MassLayer.warmStandInsFor) and the
   * floors where a building is among them. A building's first hit builds
   * these before the rest (CustomMapView.whenRuinsReady)
   */
  ruinStandInsFor(ids: readonly string[]): Object3D[] {
    const out: Object3D[] = [];
    let floors = false;
    for (const id of ids) {
      if (this.masses.has(id)) {
        floors = true;
        continue;
      }
      const from = this.byId.get(id)?.batch;
      const b = from && this.batches.find((x) => x.ruin && x.model.id === from.model.id && x.blocksLos === from.blocksLos);
      if (!b) continue;
      for (const d of b.draws) out.push(...d.meshes);
      if (b.entry.category === 'building') floors = true;
    }
    out.push(...this.masses.warmStandInsFor(ids));
    if (floors && this.slabs) out.push(this.slabs.mesh);
    return out;
  }

  /** Where and when ruin `id` comes down as it falls now (fallImpact, group frame), null for one not drawn as a ruin */
  impactOf(id: string): ReturnType<typeof fallImpact> | null {
    const raised = this.masses.ruinShapeOf(id);
    if (raised) return fallImpact(raised);
    const slot = this.byId.get(id);
    return slot?.batch.damage ? fallImpact(readDamage(slot.batch.damage, slot.index)) : null;
  }

  embers(max = RUIN_EMBERS): Vector3[] {
    const out: Vector3[] = [];
    // The newest first, of those drawn: one a crater wiped out has none
    const ids = [...this.damaged].filter(([, d]) => d.stage >= 2);
    for (let k = ids.length - 1; k >= 0 && out.length < max; k--) {
      const [id, d] = ids[k];
      const fallen = d.stage >= 3;
      const p = this.masses.emberOf(id, fallen, new Vector3());
      if (p) {
        out.push(p);
        continue;
      }
      const slot = this.byId.get(id);
      if (!slot?.batch.damage) continue;
      out.push(emberPoint(readDamage(slot.batch.damage, slot.index), slot.batch.source.matrices[slot.index * 16 + 13], fallen, new Vector3()));
    }
    return out;
  }

  /** Object i of batch `from` into the asset's ruin batch or back into its own */
  private moveTo(from: AssetBatch, i: number, ruin: boolean): void {
    const o = from.objects[i];
    this.dropOne(o.id);
    const to = this.batches.find((x) => x.model.id === from.model.id && x.blocksLos === from.blocksLos && x.ruin === ruin);
    if (to) {
      this.append(to, [o]);
      return;
    }
    const built = this.buildBatch(from.model, from.lods, from.blocksLos, [o], ruin);
    this.batches.push(built);
    this.byId.set(o.id, { batch: built, index: 0 });
  }

  /** A destructible asset's ruin batch, empty, beside its batch: its programs are built with the map's */
  private ensureRuinBatch(b: AssetBatch): void {
    if (!this.options.ruins || b.ruin || !DESTRUCTIBLE_CATEGORIES.has(b.entry.category) || b.model.placeholder) return;
    if (this.batches.some((x) => x.ruin && x.model.id === b.model.id && x.blocksLos === b.blocksLos)) return;
    const ruin = this.buildBatch(b.model, b.lods, b.blocksLos, [], true);
    // Tinted like the asset's intact ones: the warm-up builds the programs with instance colours its ruins will draw
    // with (the shadow's too), not the first fall after a Continue (a tinted house's depth program, 0.7 to 1.5 s)
    if (b.source.colors) {
      ruin.source.colors = new Float32Array(ruin.capacity * 3);
      this.resize(ruin, ruin.capacity);
    }
    this.batches.push(ruin);
  }

  /** Removes objects by id: each leaves the lists it is in, the asset's last object fills its place */
  removeObjects(ids: string[]): void {
    const masses = ids.filter((id) => this.masses.has(id) || this.masses.hasCellar(id));
    if (masses.length) void this.masses.remove(masses);
    for (const id of ids) {
      this.dropSlabs(id);
      // Not built yet: setObjects takes it out once its batch is in
      if (!this.dropOne(id)) this.dropLater?.add(id);
    }
    this.dropEmpty();
    this.version++;
    this.applyLevels(false);
  }

  /** Object `id` out of its batch (the asset's last object fills its place); false for one not built */
  private dropOne(id: string): boolean {
    const slot = this.byId.get(id);
    if (!slot) return false;
    const b = slot.batch;
    const i = slot.index;
    this.byId.delete(id);
    this.lineSpheres.remove(id);
    this.leaveLevels(b, i);
    const los = b.los;
    if (los && los.slots[i] >= 0) los.list.remove(los.slots, i);
    const last = b.objects.length - 1;
    if (i !== last) {
      // The asset's last object moves into the gap; its slots in the lists now name index i
      b.objects[i] = b.objects[last];
      b.source.matrices.copyWithin(i * 16, last * 16, last * 16 + 16);
      b.source.colors?.copyWithin(i * 3, last * 3, last * 3 + 3);
      if (b.damage) for (const a of b.damage) a.copyWithin(i * 4, last * 4, last * 4 + 4);
      b.spheres.copyWithin(i * 4, last * 4, last * 4 + 4);
      b.lines.copyWithin(i * 4, last * 4, last * 4 + 4);
      b.levelOf[i] = b.levelOf[last];
      b.nextOf[i] = b.nextOf[last];
      b.fadeOf[i] = b.fadeOf[last];
      b.shadowOf[i] = b.shadowOf[last];
      b.holdNext[i] = b.holdNext[last];
      b.holdAt[i] = b.holdAt[last];
      b.holdEnd[i] = b.holdEnd[last];
      b.dueAt[i] = b.dueAt[last];
      for (const d of b.draws) if (d.slots[last] >= 0) d.list.rename(d.slots, last, i);
      if (los && los.slots[last] >= 0) los.list.rename(los.slots, last, i);
      this.byId.set(b.objects[i].id, { batch: b, index: i });
      // The freed index shows nothing: an object added there later is placed anew, not taken as placed
      b.levelOf[last] = -1;
      b.nextOf[last] = NO_NEXT;
      b.shadowOf[last] = -1;
      b.holdNext[last] = NO_NEXT;
    }
    b.objects.length = last;
    b.boundsStale = true;
    return true;
  }

  /** Batches left without objects go; ruin batches stay, built for the warm-up */
  private dropEmpty(): void {
    const empty = this.batches.filter((b) => b.objects.length === 0 && !b.ruin);
    for (const b of empty) this.disposeBatch(b);
    if (empty.length) this.batches = this.batches.filter((b) => !empty.includes(b));
  }

  /**
   * Objects stand on the terrain: call after heights changed, with the
   * changed rectangle in map metres to touch only the objects on it
   */
  refreshHeights(rect?: { minX: number; minY: number; maxX: number; maxY: number }, floatingOnly = false): void {
    if (!floatingOnly) this.masses.refreshHeights(rect);
    let changed = false;
    for (const b of this.batches) {
      if (floatingOnly && !b.entry.float) continue;
      const reach = b.entry.footprint * 3 + 2;
      for (let i = 0; i < b.objects.length; i++) {
        const o = b.objects[i];
        if (rect && (o.x < rect.minX - reach || o.x > rect.maxX + reach || o.y < rect.minY - reach || o.y > rect.maxY + reach)) continue;
        if (!this.reseat(b, i)) continue;
        this.rewrite(b, i);
        changed = true;
      }
    }
    if (changed) {
      this.version++;
      this.applyLevels(false);
    }
  }

  /** Detail level per object, shadows near `focus` (group space); the wind's clock runs in the environment */
  update(dt: number, camera: Camera, focus?: Vector3): void {
    this.buildSlabs();
    camera.getWorldPosition(this.camPos);
    this.group.worldToLocal(this.camPos);
    this.focus.copy(focus ?? this.camPos);
    // A camera wider than the catalogue's 60 degrees shows each object smaller: every object takes its levels anew
    const viewScale = camera instanceof PerspectiveCamera ? LOD_TAN_HALF_FOV / Math.tan((camera.fov * Math.PI) / 360) : 1;
    const reframed = Math.abs(viewScale - this.viewScale) > 1e-6 || this.shadowRadius !== this.lastShadowRadius;
    this.viewScale = viewScale;
    this.lastShadowRadius = this.shadowRadius;
    // At rest the bands settle (settleBlend); moving, a settled object keeps its level until it goes on through its band (holdBlend)
    const step = this.lastCamPos.x === Infinity ? 0 : Math.max(this.camPos.distanceTo(this.lastCamPos), this.focus.distanceTo(this.lastFocus));
    const moved = this.camPos.distanceToSquared(this.lastCamPos) > 1e-6;
    this.lastCamPos.copy(this.camPos);
    this.lastFocus.copy(this.focus);
    this.travel += step;
    this.restFor = moved ? 0 : this.restFor + dt;
    // The bands open only in frames the camera moves: a zoom by a notch moves it in one frame, and the band opened on
    // over the rest's first REST_S, so a building showed its other level for a moment and went back (E268)
    const settle = Math.min(1, Math.max(0, this.settle + (moved ? -dt : this.restFor >= REST_S ? dt : 0) / SETTLE_S));
    const settling = settle !== this.settle;
    this.settle = settle;
    // A camera and focus at rest with settled bands change nothing
    if (reframed) this.applyLevels(true);
    else if (step > 1e-3 || settling) this.applyLevels(false);
    this.viewed = true;
  }

  /**
   * Shows every level of every asset with shadows on, at least one instance
   * each (or puts the normal choice back): a single render then compiles
   * every program the objects can need, shadow depth variants included
   */
  showAllForWarmUp(on: boolean): void {
    for (const b of this.batches) {
      for (const d of b.draws) {
        // An empty level shows the asset's first object, written into its first slot for the one render
        if (on && d.list.count === 0 && (b.objects.length || b.ruin)) d.list.placeholder(b.source, 0);
        d.list.flush();
        for (const m of d.meshes) {
          m.count = on ? Math.max(1, d.list.count) : d.list.count;
          m.visible = on || d.list.count > 0;
          m.castShadow = on || (b.casts && d.list.casters > 0);
          m.frustumCulled = !on;
        }
      }
    }
    for (const draws of this.sharedDraws()) draws.sync(on);
  }

  /**
   * One instance of every detail level of these assets, with the same
   * materials and instance attributes the map's lists would get, for
   * compiling their programs before the first one is placed. Bakes the
   * impostors too. The caller disposes the meshes (not their geometry or
   * materials, which the layer shares).
   */
  async warmUpMeshes(ids: string[]): Promise<InstancedMesh[]> {
    const out: InstancedMesh[] = [];
    const identity = new Matrix4();
    const white = new Color(1, 1, 1);
    for (const id of new Set(ids)) {
      const [model, lods] = await Promise.all([this.assets.model(id), this.assets.lodModels(id)]);
      await this.prepareImpostor(model);
      const vegetation = model.entry.category === 'tree' || model.entry.category === 'plant';
      for (const level of this.levelsFor(model, lods, model.entry.blocksLos)) {
        for (const part of level.parts) {
          // Vegetation always has instance colours; other assets only when tinted, so both variants
          for (const colored of vegetation ? [true] : [false, true]) {
            const mesh = new InstancedMesh(part.geometry, part.material, 1);
            if (part.depthMaterial) mesh.customDepthMaterial = part.depthMaterial;
            mesh.setMatrixAt(0, identity);
            if (colored) mesh.setColorAt(0, white);
            mesh.frustumCulled = false;
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            out.push(mesh);
          }
        }
      }
    }
    return out;
  }

  /**
   * First object a scene-space ray hits: the objects whose bounds it
   * crosses, then their full models (the level the camera shows does not
   * matter to the editor's pick)
   */
  raycast(ray: Ray): ObjectHit | null {
    this.raycaster.ray.copy(ray);
    let best: ObjectHit | null = null;
    const pick = this.pickMesh;
    const hits = this.pickHits;
    for (const b of this.batches) {
      const parent = b.blocksLos ? this.losGroup : this.group;
      // The ray in the parent's frame for the bounds test
      const local = this.tmpRay.copy(ray).applyMatrix4(this.tmpMatrix.copy(parent.matrixWorld).invert());
      const ox = local.origin.x, oy = local.origin.y, oz = local.origin.z;
      const dx = local.direction.x, dy = local.direction.y, dz = local.direction.z;
      const sp = b.spheres;
      for (let i = 0; i < b.objects.length; i++) {
        const s = i * 4;
        const cx = sp[s] - ox, cy = sp[s + 1] - oy, cz = sp[s + 2] - oz;
        const along = cx * dx + cy * dy + cz * dz;
        const r = sp[s + 3];
        if (along < -r || cx * cx + cy * cy + cz * cz - along * along > r * r) continue;
        // A laid piece is not the document's: the editor picks what it was laid from (a bridge's path edge)
        if (laidAt(b.objects[i]) !== null) continue;
        for (const part of b.levels[0].parts) {
          pick.geometry = part.geometry;
          pick.material = part.material;
          pick.matrixWorld.multiplyMatrices(parent.matrixWorld, this.instanceMatrix.fromArray(b.source.matrices, i * 16));
          hits.length = 0;
          pick.raycast(this.raycaster, hits);
          for (const hit of hits) {
            if (!best || hit.distance < best.distance) best = { object: b.objects[i], point: hit.point.clone(), distance: hit.distance };
          }
        }
      }
    }
    hits.length = 0;
    const mass = this.masses.raycast(this.raycaster, ray);
    return mass && (!best || mass.distance < best.distance) ? mass : best;
  }

  /**
   * While `on`, every mesh draws only its first instances, those near the
   * focus (the shadow's casters): a pass that reaches no farther, the water's
   * mirror, does without the rest of the map. Off puts the counts back
   */
  nearOnly(on: boolean): void {
    for (const b of this.batches) for (const d of b.draws) for (const m of d.meshes) m.count = on ? Math.min(d.list.count, d.list.casters) : d.list.count;
    for (const draws of this.sharedDraws()) draws.nearOnly(on);
  }

  /** Meshes of objects that block no sight (scatter, props, small plants): what a water reflection leaves out */
  decorMeshes(): Object3D[] {
    const out: Object3D[] = [];
    for (const b of this.batches) if (!b.blocksLos) for (const d of b.draws) out.push(...d.meshes);
    for (const draws of this.sharedDraws()) out.push(...draws.openMeshes());
    return out;
  }

  dispose(): void {
    this.disposed = true;
    this.generation++;
    this.clear();
    this.masses.dispose();
    for (const m of this.materials.values()) m.dispose();
    for (const m of this.rotorShadows.values()) m.dispose();
    this.ruinDepth?.dispose();
    this.slabs?.dispose();
    this.materials.clear();
    this.fades.length = 0;
    for (const draws of this.sharedDraws()) draws.dispose();
    this.farBoxes = null;
    this.impostorDraws = null;
    this.bands = null;
    this.group.removeFromParent();
    this.losStage.removeFromParent();
  }

  /** The quality level's detail (see `detail`); every object takes its level again */
  setDetail(detail: { lodBias: number; impostorFrom: number; drawPixels: number }): void {
    const now = this.detail;
    if (detail.lodBias === now.lodBias && detail.impostorFrom === now.impostorFrom && detail.drawPixels === now.drawPixels) return;
    this.detail = { ...detail };
    for (const f of this.fades) this.setFadeRange(f.range, f.radius);
    this.applyLevels(true);
  }

  /** A card material's fade: from 0.55 of the distance where an object of `radius` reaches the pixel limit to there */
  private setFadeRange(range: Vector2, radius: number): Vector2 {
    const end = pixelDistance(radius, this.detail.drawPixels);
    return range.set(end * 0.55, end);
  }

  private clear(): void {
    for (const b of this.batches) this.disposeBatch(b);
    this.batches = [];
    this.byId.clear();
    this.lineSpheres.clear();
  }

  /** The shadow material of every ruin mesh, made with the first */
  private ruinDepthMaterial(): Material {
    return (this.ruinDepth ??= damageDepthMaterial('object'));
  }

  private disposeBatch(b: AssetBatch): void {
    for (const d of b.draws) {
      // Its objects leave a shared list, which stays for the other assets
      if (d.shared) for (let i = 0; i < b.objects.length; i++) if (d.slots[i] >= 0) d.list.remove(d.slots, i);
      for (const m of d.meshes) {
        m.removeFromParent();
        m.dispose();
        disposeFadeGeometry(m.geometry);
      }
    }
    b.draws = [];
    for (const m of b.los?.meshes ?? []) {
      m.removeFromParent();
      m.dispose();
      disposeFadeGeometry(m.geometry);
    }
    b.los = null;
  }

  /** Bakes an asset's impostor ahead (ImpostorCache.prepare), when the layer draws impostors */
  private prepareImpostor(model: ObjectModel): Promise<void> {
    return this.options.impostors?.prepare(model) ?? Promise.resolve();
  }

  /**
   * Detail levels of an asset: its model, the catalogue's LOD models (each
   * from where an object fills its screen share), an impostor for far trees
   */
  private levelsFor(model: ObjectModel, lods: LodModel[], blocks: boolean, ruin = false): Level[] {
    const entry = model.entry;
    const drawn = (m: ObjectModel, tone?: StageTone) =>
      mergedParts(m).map((p) => ({
        geometry: p.geometry,
        material: this.objectMaterial(p.material, entry, ruin, tone),
        depthMaterial: ruin ? this.ruinDepthMaterial() : isRotor(p.material) ? this.rotorShadow(entry) : undefined,
      }));
    const levels: Level[] = [{ from: 0, parts: drawn(model) }];
    for (const lod of lods) levels.push({ from: screenDistance(1, lod.screen), parts: drawn(lod.model, lod.tone) });
    // A ruin keeps its models to its draw distance: no impostor or far box shows the damage
    if (ruin) return levels;
    const slot = this.options.impostors?.get(model);
    if (slot) {
      // Beyond the game camera's usual distance (200 to 300 m, impostorFrom in High), where a tree is a few
      // pixels wide: past its last LOD model, and no nearer than 25 heights of the model for its radius. Every
      // impostor of its view size in one draw (impostor-array.ts)
      const radius = Math.max(entry.footprint, model.height * 0.6);
      const from = Math.max(lods.length ? levels[levels.length - 1].from * 1.5 : 0, (entry.height * 25) / radius);
      this.impostorDraws ??= new ImpostorDraws({ blocking: this.losGroup, open: this.group });
      const key = ImpostorDraws.key(slot, blocks);
      this.impostorDraws.register(key, slot.set);
      const layer = [slot.layer];
      levels.push({ from, impostor: true, parts: [], shared: { draws: this.impostorDraws, key, extras: () => [layer] } });
    }
    // A building's box, drawn with every other's in one mesh, where the object fills its screen share
    if (entry.far && this.farBoxes && !model.placeholder) {
      const row = [this.farBoxes.row(entry)];
      levels.push({
        from: screenDistance(1, entry.far.screen),
        parts: [],
        shared: { draws: this.farBoxes, key: blocks ? FAR_BLOCKING : FAR_OPEN, extras: () => [row] },
      });
    }
    // A wall's, fence's, hedge's or track's piece: far off a band of six triangles, every asset's in one mesh
    // (line-bands.ts), after its last stage (its LOD model, whose tone it takes, or its far box or full model)
    if (hasBand(entry) && !model.placeholder) {
      this.bands ??= new LineBands({ blocking: this.losGroup, open: this.group });
      const r = this.bands.row(entry, model.height, lods[0]?.tone);
      if (r !== null) {
        const row = [r];
        levels.push({
          from: Math.max(screenDistance(1, BAND_SCREEN), levels[levels.length - 1].from * 1.2),
          parts: [],
          shared: { draws: this.bands, key: blocks ? BAND_BLOCKING : BAND_OPEN, extras: () => [row] },
        });
      }
    }
    return levels;
  }

  private buildBatch(model: ObjectModel, lods: LodModel[], blocksLos: boolean, objects: MapObject[], ruin = false): AssetBatch {
    const entry = model.entry;
    const n = objects.length;
    const capacity = listCapacity(n);
    const vegetation = entry.category === 'tree' || entry.category === 'plant';
    const tinted = vegetation || objects.some((o) => o.tint);
    const damage: DamageArrays | null = ruin ? damageArrays(capacity) : null;
    const levels = this.levelsFor(model, lods, blocksLos, ruin);
    const b: AssetBatch = {
      entry,
      model,
      lods,
      blocksLos,
      ruin,
      damage,
      casts: entry.category !== 'plant' || entry.height > 0.8,
      objects: objects.slice(),
      levels,
      impostorAt: levels.findIndex((l) => l.impostor),
      draws: [],
      los: null,
      capacity,
      source: { matrices: new Float32Array(capacity * 16), colors: tinted ? new Float32Array(capacity * 3) : null, ...(damage ? { extras: damage } : {}) },
      spheres: new Float32Array(capacity * 4),
      lines: new Float32Array(capacity * 4),
      bounds: new Sphere(),
      boundsStale: true,
      levelOf: new Int8Array(capacity).fill(-1),
      nextOf: new Int8Array(capacity).fill(NO_NEXT),
      fadeOf: new Float32Array(capacity),
      shadowOf: new Int8Array(capacity).fill(-1),
      holdNext: new Int8Array(capacity).fill(NO_NEXT),
      holdAt: new Float32Array(capacity),
      holdEnd: new Int8Array(capacity),
      dueAt: new Float64Array(capacity).fill(-Infinity),
    };
    for (let i = 0; i < n; i++) this.writeInstance(b, i);
    b.draws = b.levels.map((level, li) => this.buildDraw(b, level, li));
    b.los = this.buildLos(b);
    return b;
  }

  /** The list and part meshes of one level, empty: the next pass fills them */
  private buildDraw(b: AssetBatch, level: Level, li: number): LevelDraw {
    if (level.shared) return this.sharedDraw(b, level, li);
    const list = new InstanceList(b.capacity, !!b.source.colors, b.ruin ? DAMAGE_ATTRIBUTES.map(() => 4) : []);
    const parent = b.blocksLos ? this.losGroup : this.group;
    const meshes = level.parts.map((part) => {
      // Made empty: the level's list brings the instances (three's own would be thrown away at once)
      const geometry = fadeGeometry(part.geometry, list.fades);
      if (b.ruin) DAMAGE_ATTRIBUTES.forEach((name, k) => geometry.setAttribute(name, list.extras[k]));
      const mesh = new InstancedMesh(geometry, part.material, 0);
      if (part.depthMaterial) mesh.customDepthMaterial = part.depthMaterial;
      // What is gone of a ruin does not block the towers' sight
      if (b.ruin) mesh.userData['losVertex'] = DAMAGE_LOS;
      mesh.instanceMatrix = list.matrices;
      if (list.colors) mesh.instanceColor = list.colors;
      mesh.count = 0;
      mesh.name = `${b.entry.id}${b.blocksLos ? '' : '-decor'}${b.ruin ? '-damaged' : ''}${li ? `-lod${li}` : ''}`;
      mesh.boundingSphere = b.bounds;
      // The shadow pass draws the level's casters only, the first of its list
      let drawn = 0;
      mesh.onBeforeShadow = () => {
        drawn = mesh.count;
        mesh.count = Math.min(drawn, list.casters);
      };
      mesh.onAfterShadow = () => {
        mesh.count = drawn;
      };
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.visible = false;
      mesh.userData['batch'] = b;
      mesh.userData['list'] = list;
      // The LOS cube draws the asset's LosDraw instead: what the camera chose here must not change what a tower sees
      mesh.userData['losTransparent'] = true;
      parent.add(mesh);
      return mesh;
    });
    return { list, slots: new Int32Array(b.capacity).fill(-1), meshes, source: b.source, shared: null };
  }

  /**
   * The shared list of a level drawn with other assets (a far box, an
   * impostor), its own extras with the asset's matrices and colours. A list
   * too small for every object that may stand in it is made anew, and the
   * other assets' objects move over
   */
  private sharedDraw(b: AssetBatch, level: Level, li: number): LevelDraw {
    const { draws, key, extras } = level.shared!;
    const sharing = (other: AssetBatch) => other.draws.findIndex((d) => d.shared?.draws === draws && d.shared.key === key);
    let need = b.capacity;
    for (const other of this.batches) if (other !== b && sharing(other) >= 0) need += other.capacity;
    const { list, renewed } = draws.list(key, need);
    if (renewed) {
      for (const other of this.batches) {
        const oi = other === b ? -1 : sharing(other);
        if (oi < 0) continue;
        const d = other.draws[oi];
        d.list = list;
        d.slots.fill(-1);
        for (let i = 0; i < other.objects.length; i++) {
          const lv = other.levelOf[i];
          const next = other.nextOf[i];
          if (lv !== oi && next !== oi) continue;
          const fade = next === NO_NEXT ? 0 : lv === oi ? other.fadeOf[i] : other.fadeOf[i] - 1;
          list.insert(d.slots, i, d.source, other.shadowOf[i] === oi, fade);
        }
      }
    }
    void li;
    // The asset's arrays as they are when an object comes (resize replaces them)
    const source: InstanceSource = {
      get matrices() {
        return b.source.matrices;
      },
      get colors() {
        return b.source.colors;
      },
      get extras() {
        return extras();
      },
    };
    this.sharedBoundsStale = true;
    return { list, slots: new Int32Array(b.capacity).fill(-1), meshes: [], source, shared: { draws, key } };
  }

  /** The LOS cube's draw of a blocking asset, empty: its full model's parts on a list of their own (prepareLos fills it) */
  private buildLos(b: AssetBatch): LosDraw | null {
    if (!b.blocksLos) return null;
    const list = new InstanceList(b.capacity, false, b.ruin ? DAMAGE_ATTRIBUTES.map(() => 4) : []);
    const meshes = b.levels[0].parts.map((part) => {
      const geometry = fadeGeometry(part.geometry, list.fades);
      if (b.ruin) DAMAGE_ATTRIBUTES.forEach((name, k) => geometry.setAttribute(name, list.extras[k]));
      const mesh = new InstancedMesh(geometry, part.material, 0);
      // What is gone of a ruin does not block the towers' sight
      if (b.ruin) mesh.userData['losVertex'] = DAMAGE_LOS;
      mesh.instanceMatrix = list.matrices;
      mesh.count = 0;
      mesh.name = `${b.entry.id}${b.ruin ? '-damaged' : ''}-los`;
      mesh.boundingSphere = this.losBounds;
      mesh.matrixAutoUpdate = false;
      mesh.userData['batch'] = b;
      this.losStage.add(mesh);
      return mesh;
    });
    return { list, slots: new Int32Array(b.capacity).fill(-1), meshes };
  }

  /**
   * The LOS cube's blockers for a tip (world space) and its reach `far`: in each blocking asset's LosDraw the
   * objects whose bounds come within `far` of the tip, written anew. The warm-up's cube shows one of each asset
   */
  private prepareLos(tip: Vector3, far: number, warmUp: boolean): void {
    const at = this.losGroup.worldToLocal(this.losTip.copy(tip));
    this.losBounds.set(at, far);
    for (const b of this.batches) {
      const los = b.los;
      if (!los) continue;
      const sp = b.spheres;
      for (let i = 0; i < b.objects.length; i++) {
        if (los.slots[i] >= 0) los.list.remove(los.slots, i);
        if (!warmUp && distance(sp, i * 4, at) - sp[i * 4 + 3] <= far) los.list.insert(los.slots, i, b.source, false, 0);
      }
      if (warmUp && (b.objects.length || b.ruin)) los.list.placeholder(b.source, 0);
      los.list.flush();
      for (const m of los.meshes) {
        m.count = warmUp ? Math.max(1, los.list.count) : los.list.count;
        // An asset with nothing in reach costs the cube's six renders nothing
        m.visible = m.count > 0;
      }
    }
  }

  /** The draws other assets share: the far boxes, the impostors */
  private sharedDraws(): SharedDraws[] {
    const out: SharedDraws[] = [];
    if (this.farBoxes) out.push(this.farBoxes);
    if (this.impostorDraws) out.push(this.impostorDraws);
    if (this.bands) out.push(this.bands);
    return out;
  }

  /** The far boxes, made once a building with a far stage comes and its atlas is in */
  private async ensureFarBoxes(catalog: AssetCatalog, objects: readonly MapObject[]): Promise<void> {
    if (this.farBoxes) return;
    const entries = entriesOf(catalog);
    if (!objects.some((o) => entries.get(o.asset)?.far)) return;
    this.farAtlas ??= this.assets.farAtlas();
    const atlas = await this.farAtlas;
    if (atlas && !this.farBoxes && !this.disposed) this.farBoxes = new FarBoxes(atlas, { blocking: this.losGroup, open: this.group });
  }

  /** Room for `capacity` objects: the asset's arrays and lists anew, every object back into its levels */
  private resize(b: AssetBatch, capacity: number): void {
    const n = b.objects.length;
    const keep = <T extends Float32Array | Float64Array | Int8Array>(a: T, size: number, fill: number): T => {
      const out = new (a.constructor as new (n: number) => T)(capacity * size);
      out.fill(fill);
      out.set(a.subarray(0, n * size));
      return out;
    };
    b.source.matrices = keep(b.source.matrices, 16, 0);
    if (b.source.colors) b.source.colors = keep(b.source.colors, 3, 1);
    if (b.damage) {
      b.damage = [keep(b.damage[0], 4, 0), keep(b.damage[1], 4, 0), keep(b.damage[2], 4, 0)];
      b.source.extras = b.damage;
    }
    b.spheres = keep(b.spheres, 4, 0);
    b.lines = keep(b.lines, 4, 0);
    b.levelOf = keep(b.levelOf, 1, -1).fill(-1, 0, n);
    b.nextOf = keep(b.nextOf, 1, NO_NEXT).fill(NO_NEXT, 0, n);
    b.fadeOf = keep(b.fadeOf, 1, 0);
    b.shadowOf = keep(b.shadowOf, 1, -1).fill(-1, 0, n);
    b.holdNext = keep(b.holdNext, 1, NO_NEXT);
    b.holdAt = keep(b.holdAt, 1, 0);
    b.holdEnd = keep(b.holdEnd, 1, 0);
    b.dueAt = keep(b.dueAt, 1, -Infinity).fill(-Infinity, 0, n);
    b.capacity = capacity;
    this.disposeBatch(b);
    b.draws = b.levels.map((level, li) => this.buildDraw(b, level, li));
    b.los = this.buildLos(b);
  }

  /** Object i out of every list it is in */
  private leaveLevels(b: AssetBatch, i: number): void {
    const level = b.levelOf[i];
    const next = b.nextOf[i];
    if (level >= 0) b.draws[level].list.remove(b.draws[level].slots, i);
    if (next >= 0 && next !== level) b.draws[next].list.remove(b.draws[next].slots, i);
    b.levelOf[i] = -1;
    b.nextOf[i] = NO_NEXT;
    b.shadowOf[i] = -1;
  }

  /** Object i's instance anew in the lists it is in, and looked at again in the next pass */
  private rewrite(b: AssetBatch, i: number): void {
    for (const d of b.draws) if (d.slots[i] >= 0) d.list.rewrite(d.slots, i, d.source);
    b.dueAt[i] = -Infinity;
    b.boundsStale = true;
  }

  /**
   * Per object that is due (or every one, `force`): the level for its size
   * on screen, hidden under the pixel limit, shadows only near the focus.
   * Then the lists go up and the meshes draw what their lists hold
   */
  private applyLevels(force: boolean): void {
    if (force) this.version++;
    if (this.lineSpheres.due) this.refreshLines();
    const { lodBias, impostorFrom, drawPixels } = this.detail;
    const travel = this.travel;
    const blend = this.blend;
    for (const b of this.batches) {
      // Metres of camera distance per metre of radius where an object reaches the pixel limit
      const reach = pixelDistance(this.viewScale, b.blocksLos ? LOS_DRAW_PIXELS : drawPixels);
      const sp = b.spheres;
      const lines = b.lines;
      for (let i = 0; i < b.objects.length; i++) {
        if (!force && b.dueAt[i] > travel) continue;
        const s = i * 4;
        const r = sp[s + 3];
        const d = Math.max(0, distance(sp, s, this.camPos) - r);
        // A piece of a line draws as long as its line: the line's limit, counted from the piece
        const lr = lines[s + 3];
        let draw = lr > 0 ? d + lr * reach - Math.max(0, distance(lines, s, this.camPos) - lr) : r * reach;
        // A tilted object (a felled tree) goes where its impostor would come: that is the model upright
        const o = b.objects[i];
        if ((o.pitch || o.roll) && b.impostorAt >= 0) draw = Math.min(draw, levelStart(b.levels[b.impostorAt], r * this.viewScale, lodBias, impostorFrom));
        blendAt(b.levels, d, r * this.viewScale, draw, lodBias, impostorFrom, blend);
        // Held on the level it showed alone when it came into this band, or last settled on in it (holdBlend): a
        // zoom by a notch lands objects inside a band, which then showed the other level till the band settled back
        const band = blend.next ?? NO_NEXT;
        const at = blend.t;
        const was = b.levelOf[i];
        if (this.viewed && band !== NO_NEXT && b.holdNext[i] !== band && b.nextOf[i] === NO_NEXT && b.dueAt[i] !== -Infinity && (was === blend.level || was === band)) {
          b.holdNext[i] = band;
          b.holdAt[i] = at;
          b.holdEnd[i] = was === band ? 1 : 0;
        }
        if (band !== NO_NEXT && b.holdNext[i] === band) holdBlend(blend, b.holdAt[i], b.holdEnd[i]);
        settleBlend(blend, this.settle, blend);
        if (band === NO_NEXT) b.holdNext[i] = NO_NEXT;
        else if (this.settle >= 1) {
          b.holdNext[i] = band;
          b.holdAt[i] = at;
          b.holdEnd[i] = blend.level === band ? 1 : 0;
        }
        // In a band the level that covers more of the pixels casts, and only near the focus
        const toFocus = distance(sp, s, this.focus) - r;
        const next = blend.next ?? NO_NEXT;
        const caster = !b.casts || toFocus >= this.shadowRadius ? -1 : next >= 0 && blend.t >= 0.5 ? next : blend.level;
        b.dueAt[i] = travel + Math.min(blend.slack, Math.abs(toFocus - this.shadowRadius));
        this.place(b, i, blend.level, next, blend.t, caster);
      }
      if (b.boundsStale) {
        this.updateBounds(b);
        if (b.draws.some((d) => d.shared)) this.sharedBoundsStale = true;
      }
      for (const d of b.draws) {
        if (d.shared) continue;
        d.list.flush();
        const count = d.list.count;
        for (const m of d.meshes) {
          m.count = count;
          m.visible = count > 0;
          m.castShadow = d.list.casters > 0;
          m.frustumCulled = true;
        }
      }
    }
    if (this.sharedBoundsStale) this.updateSharedBounds();
    for (const draws of this.sharedDraws()) draws.sync();
  }

  /** The lines whose pieces changed take their spheres anew; their pieces are looked at again */
  private refreshLines(): void {
    this.lineSpheres.refresh(
      (id, out) => {
        const slot = this.byId.get(id);
        if (!slot) return false;
        out.set(slot.batch.spheres.subarray(slot.index * 4, slot.index * 4 + 4));
        return true;
      },
      (id, x, y, z, r) => {
        const slot = this.byId.get(id);
        if (!slot) return;
        const at = slot.index * 4;
        const lines = slot.batch.lines;
        lines[at] = x;
        lines[at + 1] = y;
        lines[at + 2] = z;
        lines[at + 3] = r;
        slot.batch.dueAt[slot.index] = -Infinity;
      },
    );
  }

  /** The shared draws' bounds: per list, those of every asset that fills it */
  private updateSharedBounds(): void {
    for (const draws of this.sharedDraws()) {
      const done = new Set<string>();
      for (const b of this.batches) {
        for (const d of b.draws) {
          if (d.shared?.draws !== draws) continue;
          const bounds = draws.bounds(d.shared.key);
          if (!done.has(d.shared.key)) {
            done.add(d.shared.key);
            bounds.makeEmpty();
          }
          if (b.bounds.isEmpty()) continue;
          if (bounds.isEmpty()) bounds.copy(b.bounds);
          else bounds.union(b.bounds);
        }
      }
    }
    this.sharedBoundsStale = false;
  }

  /** Object i into the lists of `level` and `next` (in a band, dissolving by t), casting with `caster` */
  private place(b: AssetBatch, i: number, level: number, next: number, t: number, caster: number): void {
    const was = b.levelOf[i];
    const wasNext = b.nextOf[i];
    const wasCaster = b.shadowOf[i];
    if (level === was && next === wasNext && caster === wasCaster && (next === NO_NEXT || t === b.fadeOf[i])) return;
    // Each level the object was or is in, once
    this.placeIn(b, i, was, level, next, t, caster);
    if (wasNext !== was) this.placeIn(b, i, wasNext, level, next, t, caster);
    if (level !== was && level !== wasNext) this.placeIn(b, i, level, level, next, t, caster);
    if (next !== was && next !== wasNext && next !== level) this.placeIn(b, i, next, level, next, t, caster);
    // The shadow map shows the casters: a change among them draws it anew
    if (caster !== wasCaster || (caster >= 0 && (level !== was || next !== wasNext))) this.version++;
    b.levelOf[i] = level;
    b.nextOf[i] = next;
    b.fadeOf[i] = t;
    b.shadowOf[i] = caster;
  }

  /** Object i in level l's list or not, as it shows `level` and `next` now, its fade and whether it casts there */
  private placeIn(b: AssetBatch, i: number, l: number, level: number, next: number, t: number, caster: number): void {
    if (l < 0) return;
    const d = b.draws[l];
    const isIn = l === level || l === next;
    const slot = d.slots[i];
    // Outgoing drops a share t of its pixels, incoming keeps a share t (lod-fade.ts)
    const fade = next === NO_NEXT ? 0 : l === level ? t : t - 1;
    if (!isIn) {
      if (slot >= 0) d.list.remove(d.slots, i);
    } else if (slot < 0) {
      d.list.insert(d.slots, i, d.source, l === caster, fade);
    } else {
      d.list.setCasting(d.slots, i, l === caster);
      d.list.setFade(d.slots, i, fade);
    }
  }

  /** The bounds of every object of the asset, which its meshes are culled by */
  private updateBounds(b: AssetBatch): void {
    b.bounds.makeEmpty();
    for (let i = 0; i < b.objects.length; i++) {
      this.sphere.set(this.tmpPos.fromArray(b.spheres, i * 4), b.spheres[i * 4 + 3]);
      if (b.bounds.isEmpty()) b.bounds.copy(this.sphere);
      else b.bounds.union(this.sphere);
    }
    b.boundsStale = false;
  }

  /**
   * Object i on the ground as it is now: only its height follows the ground
   * (its seat, writeInstance's), the matrix's translation and the sphere's
   * centre; turn, tilt and size are the document's. Whether it moved, so a
   * brush uploads only the objects whose ground changed, not every one in
   * its rectangle
   */
  private reseat(b: AssetBatch, i: number): boolean {
    const o = b.objects[i];
    // A laid piece keeps its height (a bridge's deck over a crater at its end)
    if (laidAt(o) !== null) return false;
    if (this.sheared(b)) {
      // A wall that follows the slope takes its shear anew with its height
      const at = i * 16;
      const before = b.source.matrices.slice(at, at + 16);
      this.writeInstance(b, i);
      return before.some((v, k) => v !== b.source.matrices[at + k]);
    }
    const y = Math.fround(seatHeight(b.entry, o, this.groundOf(b), this.seatWater) + o.z);
    const at = i * 16 + 13;
    const lift = y - b.source.matrices[at];
    if (lift === 0) return false;
    b.source.matrices[at] = y;
    b.spheres[i * 4 + 1] += lift;
    // Its line's sphere follows
    if (o.line) this.lineSpheres.set(o.id, o.line);
    // A ruin's damage holds its heights (break line, bite, top, floors): one that sank takes them along
    if (b.damage) this.writeDamageOf(b, i);
    return true;
  }

  /**
   * Whether an asset's objects follow the slope (wallShear): walls and fences that block no sight and carry no
   * tower; what the line of sight and the build rules see stays level
   */
  private sheared(b: AssetBatch): boolean {
    return (b.entry.category === 'wall' && !b.blocksLos && !b.entry.roof) || !!b.entry.row;
  }

  /** Instance matrix, bounding sphere and colour of object i from the document */
  private writeInstance(b: AssetBatch, i: number): void {
    const o = b.objects[i];
    const e = b.entry;
    // Vegetation varies in size and shade, trees also in lean (instance-variation.ts): in the matrix and colour only.
    // The pieces of a row share their row's shade and keep their size, so the row reads as one
    const look = instanceVariation(e.row ? rowLookKey(o) : o.id, e.category, e.tags);
    const s = (o.scale || 1) * (e.row ? 1 : look.size);
    // A laid piece stands where it was laid, as long and wide as its place (LaidObject)
    const at = laidAt(o);
    const stretch = e.row || at !== null ? o.stretch || 1 : 1;
    const breadth = at !== null ? (o as LaidObject).breadth : 1;
    const lean = at === null && this.sheared(b) ? wallShear(e, o, this.groundOf(b)) : null;
    const ground = at ?? (lean ? lean.height : seatHeight(e, o, this.groundOf(b), this.seatWater));
    mapToScene(o.x, o.y, ground + o.z, this.tmpPos);
    this.tmpQuat.setFromAxisAngle(this.up, o.rotation);
    if (o.pitch || o.roll) this.tmpQuat.multiply(this.tilt.setFromEuler(this.tiltEuler.set(o.pitch ?? 0, 0, o.roll ?? 0, 'XZY')));
    if (look.lean > 0) {
      // About a level axis across the lean's direction (scene x is map -x), in the scene's frame
      this.leanAxis.set(Math.sin(look.leanToward), 0, Math.cos(look.leanToward));
      this.tmpQuat.premultiply(this.tilt.setFromAxisAngle(this.leanAxis, look.lean));
    }
    this.tmpScale.set(s * look.widthX * stretch, s, s * look.widthZ * breadth);
    this.tmpMatrix.compose(this.tmpPos, this.tmpQuat, this.tmpScale);
    // Along a slope (wallShear): model y rises with model x, the posts stay upright
    if (lean) this.tmpMatrix.multiply(this.shear.set(1, 0, 0, 0, lean.shear, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1));
    this.tmpMatrix.toArray(b.source.matrices, i * 16);
    const reach = e.row
      ? Math.max(e.footprint, (e.row / 2) * stretch)
      : at !== null ? Math.hypot(e.footprint * stretch, breadth / 2) : e.footprint;
    // A tilted one (a felled tree) reaches its height out from its foot
    const radius = Math.max(reach, b.model.height * (o.pitch || o.roll ? 1.2 : 0.6)) * s * Math.max(1, look.widthX, look.widthZ);
    b.spheres[i * 4] = this.tmpPos.x;
    b.spheres[i * 4 + 1] = this.tmpPos.y + (b.model.height * s) / 2;
    b.spheres[i * 4 + 2] = this.tmpPos.z;
    b.spheres[i * 4 + 3] = radius;
    // A piece of a line: the line's sphere comes with the next pass (applyLevels)
    this.lineSpheres.set(o.id, o.line ?? null);
    if (!o.line) b.lines[i * 4 + 3] = 0;
    const colors = b.source.colors;
    if (colors) {
      const c = o.tint ? new Color(o.tint) : null;
      // Withered (a felled tree): flagged on the red where its materials read the flag (they sway: wind)
      const withered = (o as Partial<WitheredObject>).withered && e.wind > 0 ? WITHER_FLAG : 0;
      colors[i * 3] = (c?.r ?? 1) * look.r + withered;
      colors[i * 3 + 1] = (c?.g ?? 1) * look.g;
      colors[i * 3 + 2] = (c?.b ?? 1) * look.b;
    }
    if (b.damage) this.writeDamageOf(b, i);
    // Moved or new: no level held from where it stood
    b.holdNext[i] = NO_NEXT;
    b.dueAt[i] = -Infinity;
  }

  /** The ground an asset's objects stand on: buildings, walls and structures on the map's own (standingAt) */
  private groundOf(b: AssetBatch): (x: number, y: number) => number {
    return DESTRUCTIBLE_CATEGORIES.has(b.entry.category) ? this.standGround : this.seatGround;
  }

  /**
   * A ruin's damage from its instance: the ground rectangle (the catalogue's
   * box, else a square inside the footprint) and height as the matrix
   * places them, the ruin rolled from the object's id
   */
  private writeDamageOf(b: AssetBatch, i: number): void {
    const o = b.objects[i];
    const m = b.source.matrices;
    const at = i * 16;
    const half = b.entry.footprint * 0.7;
    const [mx, mz, hx, hz] = b.entry.box ?? [0, 0, half, half];
    const d = this.damaged.get(o.id);
    const frame = {
      cx: m[at + 12] + m[at] * mx + m[at + 8] * mz,
      cz: m[at + 14] + m[at + 2] * mx + m[at + 10] * mz,
      ax: m[at] * hx,
      az: m[at + 2] * hx,
      bx: m[at + 8] * hz,
      bz: m[at + 10] * hz,
      seatY: m[at + 13],
      height: b.model.height * Math.hypot(m[at + 4], m[at + 5], m[at + 6]),
    };
    const shape = ruinShape(ruinSeed(o), frame, d?.heading ?? null);
    if (d) shape.holeRow = RUIN_HOLES.rowOf(o.id);
    if (d) this.placeHoles(o.id);
    const stage = d?.stage ?? 0;
    const fallStart = d?.fallStart ?? FELL_LONG_AGO;
    writeDamage(b.damage!, i, stage, fallStart, shape);
    // Floors inside a building, not a wall's, over its top grid where the catalogue has one
    if (b.entry.category !== 'building' || !this.slabs) return;
    const roof = b.entry.roof;
    const footprint: RuinFootprint | null = roof
      ? {
        roof, box: [mx, mz, hx, hz], ox: m[at + 12], oz: m[at + 14], ux: m[at], uz: m[at + 2], vx: m[at + 8], vz: m[at + 10],
        sy: Math.hypot(m[at + 4], m[at + 5], m[at + 6]),
        section: (y) => sectionOf(b.model, roof, y),
      }
      : null;
    this.slabsDue.delete(o.id);
    this.slabsNow.set(o.id, [o.id, frame, shape, stage, fallStart, rubbleMaterialOf(o, b.entry.tags), footprint]);
  }

  /** Ruin floors due, SLABS_MS of them; the ones that came this frame are due from the next */
  private buildSlabs(): void {
    if (!this.slabs) return;
    const until = performance.now() + SLABS_MS;
    for (const [id, args] of this.slabsDue) {
      if (performance.now() >= until) break;
      this.slabsDue.delete(id);
      this.slabs.set(...args);
    }
    for (const [id, args] of this.slabsNow) this.slabsDue.set(id, args);
    this.slabsNow.clear();
  }

  /** Object `id`'s ruin floors gone, built or waiting */
  private dropSlabs(id: string): void {
    this.slabsNow.delete(id);
    this.slabsDue.delete(id);
    this.slabs?.delete(id);
  }

  /** The shadow pass's material for an asset's rotor parts, shared by assets turning as fast */
  private rotorShadow(entry: CatalogObject): Material {
    const period = Math.max(0.5, entry.rotor ?? DEFAULT_ROTOR);
    let m = this.rotorShadows.get(period);
    if (!m) this.rotorShadows.set(period, (m = rotorDepthMaterial({ value: period })));
    return m;
  }

  /**
   * The material an object part is drawn with: a copy of the model's,
   * shared by every asset with the same source material and look. Adds
   * wind sway (wind > 0), the foliage card fixes (materials `foliage-*`:
   * authored normals on both sides, fade when edge-on and towards the draw
   * distance), flowing waterfall cards (`foliage-waterfall*`) and flicker
   * for flames (foliage cards that glow). The per-asset numbers are
   * uniforms, so all of them share a handful of shader programs.
   */
  /** An object's material as the layer draws it; `tone` multiplies a detail stage's colour (CatalogObject `lod`) */
  private objectMaterial(source: Material, entry: CatalogObject, ruin = false, tone?: StageTone): Material {
    const m0 = source as MeshStandardMaterial;
    const card = m0.name.startsWith('foliage-');
    const waterfall = m0.name.startsWith('foliage-waterfall');
    const flame = card && !waterfall && !!m0.emissive && m0.emissive.getHex() !== 0;
    // Banner cloth waves where the map asks for it (cloth.ts, WIND_UNIFORMS.uClothWave)
    const cloth = isCloth(m0);
    // Parts that turn round the model's upright axis: a radar dish, a lighthouse's lens (catalogue `spin`)
    const spin = m0.name.startsWith('spin-');
    // Parts that turn round a hub of their own: a windmill's sails, a water wheel (rotor.ts, catalogue `rotor`)
    const rotor = isRotor(m0);
    const period = rotor ? (entry.rotor ?? DEFAULT_ROTOR) : (entry.spin ?? DEFAULT_SPIN);
    const wind = waterfall ? 0 : entry.wind;
    // Trees bend their crowns apart (in the wind block, before the rest pose)
    const crownWarp = wind > 0 && entry.category === 'tree';
    // Floating objects that are not moored structures rock on the water
    const bob = !!entry.float && entry.category !== 'structure';
    // Several looks in one atlas (a herd of several breeds): only for objects that stay where they are
    const variants = !card && !bob && (entry.variants ?? 1) > 1 ? entry.variants! : 1;
    const key = `${source.uuid}|${entry.grime ? 1 : 0}|${crownWarp ? 1 : 0}|${wind}|${wind > 0 ? entry.height : 0}|${card ? objectRadius(entry) : 0}|${bob ? 1 : 0}|${cloth ? 1 : 0}|${spin || rotor ? period : 0}|${rotor ? 1 : 0}|${variants}|${ruin ? 1 : 0}|${tone ? tone.join(',') : ''}`;
    const cached = this.materials.get(key);
    if (cached) return cached;
    // Always an own copy: the library's material is shared (other views, the editor's thumbnails)
    // and is never changed or disposed here. Copies of one source share its textures and programs
    const m = source.clone() as MeshStandardMaterial;
    if (tone) m.color.multiply(STAGE_TONE.setRGB(tone[0], tone[1], tone[2]));
    if (!card && m.emissive) {
      // Glowing surfaces (lava, crystals, windows) stay under a cap: at night a full glow
      // reads as a flat bright disc instead of a lit surface
      const peak = Math.max(m.emissive.r, m.emissive.g, m.emissive.b) * m.emissiveIntensity;
      if (peak > MAX_EMISSIVE) m.emissiveIntensity *= MAX_EMISSIVE / peak;
    }
    if (!card && wind <= 0 && !bob && !spin && !rotor) {
      if (m.userData['roughMetal']) addVertexRoughMetal(m);
      if (entry.grime && m.aoMap) addGrime(m);
      if (variants > 1) addAtlasVariants(m, variants);
      addWindowGlow(m, source);
      addLodFade(m);
      addHeightFog(m);
      if (ruin) asRuin(m);
      this.materials.set(key, m);
      return m;
    }
    const local = {
      // Sway at the top in a strong wind, and the height it is measured at (model metres)
      uWindBend: { value: windSwayAtTop(wind, entry.height) },
      uWindHeight: { value: Math.max(entry.height, 0.3) },
      uFadeRange: { value: this.setFadeRange(new Vector2(), objectRadius(entry)) },
      // Seconds a turn of the spinning or rotor parts
      uSpinPeriod: { value: Math.max(0.5, period) },
    };
    if (card) this.fades.push({ range: local.uFadeRange.value, radius: objectRadius(entry) });
    const variant = `${crownWarp ? 't' : ''}${wind > 0 ? 'w' : ''}${card ? 'c' : ''}${waterfall ? 'f' : ''}${flame ? 'l' : ''}${bob ? 'b' : ''}${cloth ? 'k' : ''}${spin ? 's' : ''}${rotor ? 'r' : ''}`;
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, WIND_UNIFORMS);
      shader.uniforms['uWindBend'] = local.uWindBend;
      shader.uniforms['uWindHeight'] = local.uWindHeight;
      shader.uniforms['uFadeRange'] = local.uFadeRange;
      shader.uniforms['uSpinPeriod'] = local.uSpinPeriod;
      shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>\n${WIND_GLSL}\nuniform float uWindBend;\nuniform float uWindHeight;`);
      // A withered instance (a felled tree, WITHER_FLAG on its colour's red): the flag off its colour, its leaves
      // browned below (card)
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying float vWither;')
        .replace('#include <color_vertex>', WITHER_VERTEX);
      if (wind > 0) {
        shader.vertexShader = shader.vertexShader.replace(
          '#include <begin_vertex>',
          /* glsl */ `#include <begin_vertex>
          ${crownWarp ? `{
            // Each crown its own: low bulges up the crown (none on the trunk), their phase from where the tree
            // stands, so one model's trees part in outline, not only in size and turn
            float crownSeed = 0.0;
            #ifdef USE_INSTANCING
            crownSeed = dot(instanceMatrix[3].xz, vec2(0.173, 0.119));
            #endif
            float crownH = clamp(transformed.y / uWindHeight, 0.0, 1.3);
            vec2 bulge = vec2(sin(crownH * 5.2 + crownSeed * 6.1 + transformed.z * 0.35), cos(crownH * 4.3 + crownSeed * 4.7 + transformed.x * 0.35));
            transformed.xz += bulge * 0.05 * uWindHeight * smoothstep(0.3, 0.6, crownH);
          }` : ''}
          // The rest pose, for the shadow lookup below
          vec3 windRest = transformed;
          {
            // The wind's direction in model space: the instance's rotation and scale undone
            vec3 base = vec3(0.0);
            vec3 windDir = vec3(uWindDir.x, 0.0, uWindDir.y);
            #ifdef USE_INSTANCING
            base = instanceMatrix[3].xyz;
            windDir = normalize(transpose(mat3(instanceMatrix)) * windDir);
            #endif
            vec3 acrossDir = normalize(cross(vec3(0.0, 1.0, 0.0), windDir) + vec3(1e-5, 0.0, 0.0));
            float phase = dot(base.xz, vec2(0.071, 0.093));
            // The push at the plant: steady wind, swell and the gust fronts that cross the map (windPush)
            float push = windPush(base.xz);
            float t = uWindTime;
            float hn = clamp(transformed.y / uWindHeight, 0.0, 1.3);
            // A plant swings slower the taller it is (an 8 m tree about once in four seconds), so a wood does not
            // tremble at one quick beat
            float w = 1.6 * sqrt(8.0 / max(uWindHeight, 0.5));
            // Trunk and crown as one: a stiff trunk (bending with the square of the height) leans with the push
            // and swings slowly round that lean, a little across it too
            float sway = sin(t * w + phase) * 0.6 + sin(t * w * 1.63 + phase * 1.7) * 0.22;
            vec3 off = (windDir * (0.75 * push + 0.3 * sway * (0.3 + push)) + acrossDir * sin(t * w * 0.77 + phase * 1.3) * 0.12 * (0.3 + push))
              * uWindBend * 0.4 * hn * hn;
            // Branches: away from the trunk they bend a little more and bob on their own, slowly; each bough
            // moves as one (the phase changes over a few metres, not from vertex to vertex)
            float reach = length(transformed.xz) / uWindHeight;
            float branch = smoothstep(0.06, 0.35, reach) * smoothstep(0.15, 0.5, hn);
            float bp = dot(transformed, vec3(0.37, 0.29, 0.41)) * 2.6 / uWindHeight + phase;
            float beat = sin(t * w * 1.9 + bp) * 0.75 + sin(t * w * 3.1 + bp * 1.4) * 0.25;
            off += (windDir * (0.3 * push + 0.12 * beat * (0.2 + push)) + vec3(0.0, 0.1 * beat * (0.2 + push), 0.0)) * uWindBend * 0.4 * branch;
            ${card ? `// Leaf cards flutter, each card as a whole (the phase over half a metre), quick and small
            vec3 flutter = sin(t * vec3(4.3, 5.1, 3.7) + transformed * 1.3 + phase);
            off += flutter * 0.03 * (0.2 + push) * smoothstep(0.1, 0.4, hn) * min(uWindBend * 4.0, 1.0);` : ''}
            // The player's plant motion: still, calmer or as the wind takes them
            off *= uPlantSway;
            // Bent, not stretched: what moves sideways sinks a little
            off.y -= dot(off.xz, off.xz) / (2.0 * max(transformed.y, 0.5));
            transformed += off;
          }`,
        );
        // The sun's shadow map holds the plants at rest (three's depth material has no sway, and the map is
        // cached over frames): a swaying leaf looked it up where it had moved to and slid in and out of its own
        // crown's shadow, the canopy flickered. It reads the shadow at its rest pose, so the shading rides along
        shader.vertexShader = shader.vertexShader.replace(
          '#include <shadowmap_vertex>',
          /* glsl */ `#ifdef USE_SHADOWMAP
          vec4 windSwayed = worldPosition;
          worldPosition = vec4(windRest, 1.0);
          #ifdef USE_INSTANCING
          worldPosition = instanceMatrix * worldPosition;
          #endif
          worldPosition = modelMatrix * worldPosition;
          #endif
          #include <shadowmap_vertex>
          #ifdef USE_SHADOWMAP
          worldPosition = windSwayed;
          #endif`,
        );
      }
      if (bob) {
        // Rocking on the water: a slow heave, roll and pitch, each object with its own phase
        shader.vertexShader = shader.vertexShader.replace(
          '#include <begin_vertex>',
          /* glsl */ `#include <begin_vertex>
          {
            float phase = 0.0;
            #ifdef USE_INSTANCING
            phase = dot(instanceMatrix[3].xz, vec2(0.13, 0.17));
            #endif
            float t = uWindTime;
            float heave = sin(t * 0.9 + phase) * 0.06;
            float roll = sin(t * 0.7 + phase * 1.3) * 0.035;
            float pitch = sin(t * 0.55 + phase * 0.7) * 0.025;
            transformed.y += heave + transformed.x * roll + transformed.z * pitch;
          }`,
        );
      }
      if (spin) {
        // Turning round the model's upright axis, each object at its own angle (spinAngle): the shape and its normals
        const angle = `float spinPhase = 0.0;
            #ifdef USE_INSTANCING
            spinPhase = spinAngle(instanceMatrix[3].xz);
            #endif
            float spinA = uWindTime * 6.2831853 / uSpinPeriod + spinPhase;
            mat2 spinTurn = mat2(cos(spinA), sin(spinA), -sin(spinA), cos(spinA));`;
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', `#include <common>
uniform float uSpinPeriod;
${SPIN_GLSL}`)
          .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
{
${angle}
objectNormal.xz = spinTurn * objectNormal.xz;
}`)
          .replace('#include <begin_vertex>', `#include <begin_vertex>
{
${angle}
transformed.xz = spinTurn * transformed.xz;
}`);
      }
      if (rotor) addRotorTurn(shader, local.uSpinPeriod);
      if (cloth) {
        // The cloth ripples down from where it is fastened, more at its free end, and blows out with the wind
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nattribute float aHang;\nuniform float uClothWave;')
          .replace(
            '#include <begin_vertex>',
            /* glsl */ `#include <begin_vertex>
          {
            vec3 clothBase = vec3(0.0);
            vec3 clothWind = vec3(uWindDir.x, 0.0, uWindDir.y);
            #ifdef USE_INSTANCING
            clothBase = instanceMatrix[3].xyz;
            clothWind = normalize(transpose(mat3(instanceMatrix)) * clothWind);
            #endif
            float clothPhase = dot(clothBase.xz, vec2(0.071, 0.093));
            float clothPush = windPush(clothBase.xz);
            float ripple = sin(transformed.y * 2.6 - uWindTime * (3.0 + 2.0 * clothPush) + clothPhase) * 0.65
              + sin(transformed.x * 4.0 - uWindTime * 4.6 + clothPhase * 1.7) * 0.35;
            float clothOn = uClothWave * uPlantSway;
            transformed.z += ripple * aHang * (0.05 + 0.2 * clothPush) * clothOn;
            transformed += clothWind * aHang * aHang * 0.35 * clothPush * clothOn;
          }`,
          );
      }
      if (waterfall) {
        // Water runs down the card: scroll the texture
        shader.vertexShader = shader.vertexShader.replace(
          '#include <uv_vertex>',
          '#include <uv_vertex>\n#ifdef USE_MAP\nvMapUv.y += uWindTime * 0.6;\n#endif',
        );
      }
      if (card) {
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', '#include <common>\nuniform vec2 uFadeRange;\nuniform float uWindTime;\nvarying float vWither;')
          .replace('#include <color_fragment>', WITHER_FRAGMENT)
          // Card normals are authored (bent out of the crown, up for grass); three flips them on
          // back faces of double-sided materials, which turned every card's back black. A geometry
          // without normals draws flat shaded, without vNormal
          .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n#ifndef FLAT_SHADED\nnormal = normalize(vNormal);\n#endif')
          .replace(
            '#include <alphatest_fragment>',
            /* glsl */ `{
            // Cards seen edge-on smear their texture into streaks: fade them out by the flat face normal
            vec3 faceNormal = normalize(cross(dFdx(vViewPosition), dFdy(vViewPosition)));
            float facing = abs(dot(faceNormal, normalize(vViewPosition)));
            diffuseColor.a *= smoothstep(0.08, 0.3, facing);
            // Fade out towards the draw distance: thin far cards turn into dark lines otherwise
            diffuseColor.a *= 1.0 - smoothstep(uFadeRange.x, uFadeRange.y, length(vViewPosition));
          }
          #include <alphatest_fragment>`,
          );
        if (flame) {
          shader.fragmentShader = shader.fragmentShader.replace(
            '#include <emissivemap_fragment>',
            /* glsl */ `#include <emissivemap_fragment>
            totalEmissiveRadiance *= 0.75 + 0.18 * sin(uWindTime * 11.0 + vViewPosition.x * 3.0) + 0.1 * sin(uWindTime * 23.0 + vViewPosition.y * 5.0);`,
          );
        }
      }
    };
    m.customProgramCacheKey = () => `custom-map-object-${variant}`;
    if (m.userData['roughMetal']) addVertexRoughMetal(m);
    if (variants > 1) addAtlasVariants(m, variants);
    // Window glass on parts that move lights up at night as well (a ship rocking on the water, a turning part)
    if (!card) addWindowGlow(m, source);
    addLodFade(m);
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

/**
 * Weathering baked into a model's occlusion texture (catalogue `grime`,
 * blender_kit.bake_ao): dirt from the ground, streaks under the sills, dirt
 * in the hollows. The occlusion darkens the colour in direct light as well,
 * part way, so the weathering shows in the sun; the tiled surfaces stay
 * sharp, no texture or draw call more
 */
function addGrime(m: Material): void {
  const prev = m.onBeforeCompile;
  const prevKey = m.customProgramCacheKey;
  m.onBeforeCompile = (shader, renderer) => {
    prev.call(m, shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      `#include <color_fragment>
      #ifdef USE_AOMAP
      diffuseColor.rgb *= mix(1.0, texture2D(aoMap, vAoMapUv).r, 0.55);
      #endif`,
    );
  };
  m.customProgramCacheKey = () => `${prevKey.call(m)}-grime`;
}

/** Window glass glows at night (night-windows.ts): a merged part per vertex, a glass material all over */
function addWindowGlow(m: Material, source: Material): void {
  if (m.userData['nightGlow']) addNightWindows(m, true);
  else if (isWindowGlass(source.name)) addNightWindows(m, false);
}

const sections = new WeakMap<ObjectModel, Map<number, Uint8Array>>();

/** A model's section at a model height on its top grid (ruin-section.ts), once per model and height (to the centimetre) */
function sectionOf(model: ObjectModel, roof: CatalogRoof, y: number): Uint8Array {
  let byHeight = sections.get(model);
  if (!byHeight) sections.set(model, (byHeight = new Map()));
  const key = Math.round(y * 100);
  let mask = byHeight.get(key);
  if (!mask) byHeight.set(key, (mask = modelSection(model.parts.map((p) => p.geometry), roof, key / 100)));
  return mask;
}

const merged = new WeakMap<ObjectModel, ModelPart[]>();

/**
 * A model's parts with the plain-coloured ones merged (merge-parts.ts), banner cloth cut to wave (cloth.ts) and
 * rotor parts told their hub (rotor.ts), once per model
 */
function mergedParts(model: ObjectModel): ModelPart[] {
  let parts = merged.get(model);
  if (!parts) {
    parts = mergeParts(model.parts).map((p) => (isCloth(p.material) ? { geometry: clothGeometry(p.geometry), material: p.material } : p));
    // Rotor parts learn their shared hub and axle (rotor.ts)
    const rotors = parts.filter((p) => isRotor(p.material));
    if (rotors.length) {
      const hub = rotorHub(rotors.map((p) => p.geometry));
      parts = parts.map((p) => (isRotor(p.material) ? { geometry: rotorGeometry(p.geometry, hub), material: p.material } : p));
    }
    merged.set(model, parts);
  }
  return parts;
}

/**
 * Objects by asset, whether they block sight and whether they are damaged
 * (`asset|1|0`: blocking, intact): one batch each
 */
function groupByAsset(catalog: AssetCatalog, objects: readonly MapObject[], damaged: ReadonlyMap<string, unknown>): Map<string, MapObject[]> {
  const groups = new Map<string, MapObject[]>();
  for (const o of objects) {
    const blocks = o.blocksLos ?? entriesOf(catalog).get(o.asset)?.blocksLos ?? false;
    const key = `${o.asset}|${blocks ? 1 : 0}|${damaged.has(o.id) ? 1 : 0}`;
    let list = groups.get(key);
    if (!list) groups.set(key, (list = []));
    list.push(o);
  }
  return groups;
}

/** Whether a group's objects block sight, and whether they are damaged (groupByAsset) */
const keyBlocks = (key: string): boolean => key.endsWith('|1|0') || key.endsWith('|1|1');
const keyRuin = (key: string): boolean => key.endsWith('|1');

const entryMaps = new WeakMap<AssetCatalog, Map<string, CatalogObject>>();

/** The catalogue's objects by id, built once per catalogue */
function entriesOf(catalog: AssetCatalog): Map<string, CatalogObject> {
  let map = entryMaps.get(catalog);
  if (!map) entryMaps.set(catalog, (map = new Map(catalog.objects.map((e) => [e.id, e]))));
  return map;
}
