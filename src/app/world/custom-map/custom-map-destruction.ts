import type { FallImpactAt, WorldDestruction, WorldGroundDamage, WorldStructure } from '../world-provider';
import { RUN_STRUCTURE_ROUNDING, type RunStructure } from '../../sim/protocol/run-rules';
import { presetHp, type StructureStage } from '../../configs/destruction.config';
import { type CustomMapDocument, type MapObject, MAP_METERS_PER_DEGREE, STRUCTURE_HP_SCALE } from './map-document';
import type { GroundBox } from './object-ground';
import type { CatalogRoof } from './object-roof';
import { rubbleMaterialOf, type RubbleMaterial } from './rubble-material';
import { massArea, massOf, massTop, objectShape } from './object-mass';

/** Catalogue categories whose objects take damage and fall */
export const DESTRUCTIBLE_CATEGORIES: ReadonlySet<string> = new Set(['building', 'wall', 'structure']);

/**
 * The scale a fallen object is shrunk to: next to nothing in the view (the
 * object layer reads a scale of 0 as 1), and below it an object counts as
 * fallen for the build blocking and the structures
 */
export const FALLEN_SCALE = 1e-3;

/**
 * The objects that may leave the map during a run: those a wave event shows
 * or hides. Nothing stands on them (CustomMapSurface.setObjectCatalog), a
 * tower would be left in the air. A destructible map's structures are not
 * among them: a tower may stand on such a roof, and while one does the
 * structure takes no damage (decided 2026-10-18, StructureLedger).
 */
export function passingObjectIds(doc: Pick<CustomMapDocument, 'gameplay'>): Set<string> {
  const passing = new Set<string>();
  for (const e of doc.gameplay?.events ?? []) if (e.kind === 'objects') for (const id of e.ids) passing.add(id);
  return passing;
}

/** HP per cubic metre of a structure's cylinder (ground radius, height) */
const HP_PER_M3 = 0.5;
/** A structure's HP lies within these */
export const STRUCTURE_HP = { min: 60, max: 3000 } as const;

/** What a structure needs of its catalogue entry */
export interface StructureEntry {
  id: string;
  category: string;
  /** Ground radius at scale 1, m */
  footprint: number;
  /** Height at scale 1, m */
  height: number;
  /** Ground rectangle at scale 1 (object-ground.ts) */
  box?: GroundBox;
  /** Its top carries towers (object-roof.ts) */
  roof?: CatalogRoof;
  /** Biome and style words, which tell what it is built of (rubble-material.ts) */
  tags?: readonly string[];
}

/**
 * A structure's change of stage for its looks: the heading of the hit that
 * brought it (STRUCTURE_HEADING_STEPS, -1 none), the stage it had
 */
export interface StageChange {
  object: MapObject;
  stage: StructureStage;
  heading: number;
  was?: StructureStage;
}

/** A map structure: its object, its stage and what the run rules get of it */
interface MapStructure extends WorldStructure {
  readonly object: MapObject;
  /** The heading of the hit that brought its stage, -1 none */
  heading: number;
  readonly run: RunStructure;
  /** What its rubble, dust and pieces are of */
  readonly material: RubbleMaterial;
}

/** HP of a structure: its volume as a cylinder, held in STRUCTURE_HP */
export function structureHp(radius: number, height: number): number {
  const volume = Math.PI * radius * radius * Math.max(1, height);
  return Math.round(Math.min(STRUCTURE_HP.max, Math.max(STRUCTURE_HP.min, volume * HP_PER_M3)));
}

const metres = (v: number) => Math.round(v * RUN_STRUCTURE_ROUNDING.metres) / RUN_STRUCTURE_ROUNDING.metres;
const turn = (v: number) => Math.round(v * RUN_STRUCTURE_ROUNDING.turn) / RUN_STRUCTURE_ROUNDING.turn;

/**
 * The destructible structures of a custom map (WorldDestruction): every
 * object whose catalogue category is a building, a wall or a structure,
 * but one the map keeps standing (MapObject.destructible false) and one a
 * wave event shows or hides. The simulation wears them down
 * (StructureLedger, from the run rules `asRunStructures` gives) and says
 * each one's stage (setStages, setStage, in that order); one that comes to
 * lie fallen is handed to `fall` (CustomMapWorld takes it out of the picture
 * and the build blocking), one that stands again to `rise`. Pure
 * bookkeeping; the catalogue arrives with `setCatalog`.
 */
export class CustomMapDestruction implements WorldDestruction {
  private list: MapStructure[] = [];

  constructor(
    private readonly doc: () => Pick<CustomMapDocument, 'objects' | 'gameplay'>,
    private readonly fall: (fallen: readonly MapObject[]) => void,
    private readonly rise: (risen: readonly MapObject[]) => void,
    /** Its buildings, walls and structures fall; a map that only digs craters has none that do */
    private readonly structuresFall = true,
    /** The ground the craters and the rubble go into (custom-map-ground-damage.ts), null for none */
    readonly ground: WorldGroundDamage | null = null,
    /**
     * Hears every change of a structure's stage, for its looks: `now` when
     * damage did it just now (setStage), false when the stages came whole
     * (a load, a new run, a restore, a seek: a fallen one lies as it fell)
     */
    private readonly damaged: (changes: readonly StageChange[], now: boolean) => void = () => undefined,
    /** Where and when the object of id hits the ground as it falls now (the view's ruin), null where it does not */
    private readonly impact: (id: string) => FallImpactAt | null = () => null,
  ) {}

  /** The catalogue's entries: from now on the map's buildings, walls and structures take damage */
  setCatalog(entries: readonly StructureEntry[]): void {
    const byId = new Map(entries.map((e) => [e.id, e]));
    const doc = this.doc();
    const passing = passingObjectIds(doc);
    const asked = doc.gameplay?.structureHp;
    const hpScale = (typeof asked === 'number' && Number.isFinite(asked)
      ? Math.min(STRUCTURE_HP_SCALE.max, Math.max(STRUCTURE_HP_SCALE.min, asked))
      : STRUCTURE_HP_SCALE.normal) / 100;
    this.list = [];
    if (!this.structuresFall) return;
    for (const object of doc.objects) {
      const entry = byId.get(object.asset);
      if (!entry || !DESTRUCTIBLE_CATEGORIES.has(entry.category) || object.scale <= FALLEN_SCALE) continue;
      if (object.destructible === false || passing.has(object.id)) continue;
      // A raised building (object-mass.ts) as a cylinder of its own ground and height, with its own rectangle and roof
      const mass = massOf(object);
      const shape = objectShape(object, entry);
      const radius = (mass ? Math.sqrt(massArea(mass) / Math.PI) : entry.footprint) * object.scale;
      const height = (mass ? massTop(mass) : entry.height) * object.scale;
      const maxHp = Math.max(1, Math.round(structureHp(radius, height) * hpScale));
      const stage = (object.damage ?? 0) as StructureStage;
      const run: RunStructure = {
        id: object.id,
        lat: object.y / MAP_METERS_PER_DEGREE,
        lon: object.x / MAP_METERS_PER_DEGREE,
        radius,
        height,
        hp: maxHp,
        ...(stage > 0 ? { start: presetHp(maxHp, stage) } : {}),
        ...(shape.box ? { box: groundPlan(shape.box, object) } : {}),
        // As the surface lays its roofs: an upright object whose entry (or own building) has one
        ...(shape.roof && !object.pitch && !object.roll ? { roof: true } : {}),
        // Its own outline: a tower in a courtyard stands on no roof
        ...(mass ? { mass: { x: object.x, y: object.y, turn: object.rotation, scale: object.scale || 1, rings: mass.rings } } : {}),
      };
      // Standing until the simulation says otherwise: a structure the map damaged beforehand comes with its first stages
      const material = rubbleMaterialOf(object, entry.tags);
      this.list.push({ id: object.id, object, run, lat: run.lat, lon: run.lon, radius, height, maxHp, stage: 0, heading: -1, material });
    }
  }

  structures(): readonly WorldStructure[] {
    return this.list;
  }

  setStages(stages: Uint8Array, headings?: Int16Array): void {
    const changes: StageChange[] = [];
    for (let i = 0; i < this.list.length; i++) this.change(i, (stages[i] ?? 0) as StructureStage, headings?.[i] ?? -1, changes);
    this.tell(changes, false);
  }

  setStage(index: number, stage: StructureStage, heading = -1): void {
    if (index < 0 || index >= this.list.length) return;
    const changes: StageChange[] = [];
    this.change(index, stage, heading, changes);
    this.tell(changes, true);
  }

  impactOf(index: number): FallImpactAt | null {
    const s = this.list[index];
    return s ? this.impact(s.id) : null;
  }

  private readonly impactListeners = new Set<(index: number, hit: FallImpactAt) => void>();

  onImpact(listener: (index: number, hit: FallImpactAt) => void): () => void {
    this.impactListeners.add(listener);
    return () => this.impactListeners.delete(listener);
  }

  /** Object `id`, falling, came down now (the view's clock): the listeners hear it by its index */
  impacted(id: string, hit: FallImpactAt): void {
    const index = this.list.findIndex((s) => s.id === id);
    if (index >= 0) for (const listener of this.impactListeners) listener(index, hit);
  }

  private change(i: number, stage: StructureStage, heading: number, changes: StageChange[]): void {
    const s = this.list[i];
    if (stage !== s.stage || heading !== s.heading) changes.push({ object: s.object, stage, heading, was: s.stage });
    s.stage = stage;
    s.heading = heading;
  }

  private tell(changes: readonly StageChange[], now: boolean): void {
    if (!changes.length) return;
    this.damaged(changes, now);
    const fallen = changes.filter((c) => c.stage === 3).map((c) => c.object);
    const risen = changes.filter((c) => c.was === 3).map((c) => c.object);
    if (fallen.length > 0) this.fall(fallen);
    if (risen.length > 0) this.rise(risen);
  }

  /** What structure `id`'s rubble is of; plaster for one not in the list */
  materialOf(id: string): RubbleMaterial {
    return this.byId().get(id)?.material ?? 'plaster';
  }

  private index: Map<string, MapStructure> | null = null;
  private indexed: MapStructure[] | null = null;

  private byId(): Map<string, MapStructure> {
    if (this.indexed !== this.list) {
      this.index = new Map(this.list.map((s) => [s.id, s]));
      this.indexed = this.list;
    }
    return this.index!;
  }

  /** The structures for the run rules (RunRules.structures): what the simulation wears down, in this order */
  asRunStructures(): RunStructure[] {
    return this.list.map((s) => s.run);
  }
}

/**
 * An object's ground rectangle in map metres for the run rules: its middle,
 * half extents and turn, rounded (RUN_STRUCTURE_ROUNDING) so every client
 * comes to the same numbers and the same world key
 */
function groundPlan(box: GroundBox, o: MapObject): [number, number, number, number, number] {
  const s = o.scale || 1;
  const cos = Math.cos(o.rotation);
  const sin = Math.sin(o.rotation);
  // The rectangle's middle from the model's x and z to the map (CustomMapSurface.setObjectCatalog)
  const x = o.x - (box[0] * cos + box[1] * sin) * s;
  const y = o.y - box[0] * sin * s + box[1] * cos * s;
  return [metres(x), metres(y), metres(box[2] * s), metres(box[3] * s), turn(o.rotation)];
}
