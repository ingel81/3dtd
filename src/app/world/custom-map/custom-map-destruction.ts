import type { WorldDestruction, WorldGroundDamage, WorldStructure } from '../world-provider';
import { RUN_STRUCTURE_ROUNDING, type RunStructure } from '../../sim/protocol/run-rules';
import { presetHp, type StructureStage } from '../../configs/destruction.config';
import { type CustomMapDocument, type MapObject, MAP_METERS_PER_DEGREE, STRUCTURE_HP_SCALE } from './map-document';
import type { GroundBox } from './object-ground';
import type { CatalogRoof } from './object-roof';
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
}

/** A map structure: its object, its stage and what the run rules get of it */
interface MapStructure extends WorldStructure {
  readonly object: MapObject;
  readonly run: RunStructure;
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
      this.list.push({ id: object.id, object, run, lat: run.lat, lon: run.lon, radius, height, maxHp, stage: 0 });
    }
  }

  structures(): readonly WorldStructure[] {
    return this.list;
  }

  setStages(stages: Uint8Array): void {
    const fallen: MapObject[] = [];
    const risen: MapObject[] = [];
    for (let i = 0; i < this.list.length; i++) this.change(i, (stages[i] ?? 0) as StructureStage, fallen, risen);
    this.tell(fallen, risen);
  }

  setStage(index: number, stage: StructureStage): void {
    if (index < 0 || index >= this.list.length) return;
    const fallen: MapObject[] = [];
    const risen: MapObject[] = [];
    this.change(index, stage, fallen, risen);
    this.tell(fallen, risen);
  }

  private change(i: number, stage: StructureStage, fallen: MapObject[], risen: MapObject[]): void {
    const s = this.list[i];
    if (stage === 3 && s.stage !== 3) fallen.push(s.object);
    else if (stage !== 3 && s.stage === 3) risen.push(s.object);
    s.stage = stage;
  }

  private tell(fallen: readonly MapObject[], risen: readonly MapObject[]): void {
    if (fallen.length > 0) this.fall(fallen);
    if (risen.length > 0) this.rise(risen);
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
