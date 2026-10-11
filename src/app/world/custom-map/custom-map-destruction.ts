import type { WorldDestruction, WorldStructure } from '../world-provider';
import type { RunStructure } from '../../sim/protocol/run-rules';
import { type MapObject, MAP_METERS_PER_DEGREE } from './map-document';

/** Catalogue categories whose objects take damage and fall */
export const DESTRUCTIBLE_CATEGORIES: ReadonlySet<string> = new Set(['building', 'wall', 'structure']);

/**
 * The scale a fallen object is shrunk to: next to nothing in the view (the
 * object layer reads a scale of 0 as 1), and below it an object counts as
 * fallen for the build blocking and the structures
 */
export const FALLEN_SCALE = 1e-3;

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
}

/** A map structure: its object and its HP */
interface MapStructure extends WorldStructure {
  readonly object: MapObject;
  readonly x: number;
  readonly y: number;
}

/** HP of a structure: its volume as a cylinder, held in STRUCTURE_HP */
export function structureHp(radius: number, height: number): number {
  const volume = Math.PI * radius * radius * Math.max(1, height);
  return Math.round(Math.min(STRUCTURE_HP.max, Math.max(STRUCTURE_HP.min, volume * HP_PER_M3)));
}

/**
 * The destructible structures of a custom map (WorldDestruction): every
 * object whose catalogue category is a building, a wall or a structure.
 * The simulation wears them down (StructureLedger, from the run rules
 * `asRunStructures` gives); the set it says lies fallen comes to
 * `setFallen`. A newly fallen one is handed to `fall` (CustomMapWorld takes
 * it out of the picture and the build blocking), `rise` gets the ones that
 * stand again. Pure bookkeeping; the catalogue arrives with `setCatalog`.
 */
export class CustomMapDestruction implements WorldDestruction {
  private list: MapStructure[] = [];

  constructor(
    private readonly objects: () => readonly MapObject[],
    private readonly fall: (fallen: readonly MapObject[]) => void,
    private readonly rise: (risen: readonly MapObject[]) => void,
  ) {}

  /** The catalogue's entries: from now on the map's buildings, walls and structures take damage */
  setCatalog(entries: readonly StructureEntry[]): void {
    const byId = new Map(entries.map((e) => [e.id, e]));
    this.list = [];
    for (const object of this.objects()) {
      const entry = byId.get(object.asset);
      if (!entry || !DESTRUCTIBLE_CATEGORIES.has(entry.category) || object.scale <= FALLEN_SCALE) continue;
      const radius = entry.footprint * object.scale;
      const height = entry.height * object.scale;
      const maxHp = structureHp(radius, height);
      this.list.push({
        id: object.id,
        object,
        x: object.x,
        y: object.y,
        lat: object.y / MAP_METERS_PER_DEGREE,
        lon: object.x / MAP_METERS_PER_DEGREE,
        radius,
        height,
        maxHp,
        hp: maxHp,
      });
    }
  }

  structures(): readonly WorldStructure[] {
    return this.list;
  }

  setFallen(ids: readonly string[]): WorldStructure[] {
    const down = new Set(ids);
    const fallen: MapStructure[] = [];
    const risen: MapStructure[] = [];
    for (const s of this.list) {
      const lies = down.has(s.id);
      if (lies && s.hp > 0) {
        s.hp = 0;
        fallen.push(s);
      } else if (!lies && s.hp <= 0) {
        s.hp = s.maxHp;
        risen.push(s);
      }
    }
    if (fallen.length > 0) this.fall(fallen.map((s) => s.object));
    if (risen.length > 0) this.rise(risen.map((s) => s.object));
    return fallen;
  }

  /** The structures for the run rules (RunRules.structures): what the simulation wears down */
  asRunStructures(): RunStructure[] {
    return this.list.map((s) => ({ id: s.id, lat: s.lat, lon: s.lon, radius: s.radius, height: s.height, hp: s.maxHp }));
  }
}
