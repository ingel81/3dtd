import { isDevMode } from '@angular/core';
import { Vector3 } from 'three';
import type { ThreeTilesEngine } from '../three-engine';
import type { MainEventBus } from '../sim/client/view-events';
import type { WorldDestruction } from '../world/world-provider';
import type { RunStructure } from '../sim/protocol/run-rules';
import type { StructureStage } from '../configs/destruction.config';
import { CRATER_STRIDE } from '../managers/game-state/crater-ledger';
import { StampField, craterStampOf, rubbleStampOf, type CellSpan, type ToLocal } from '../utils/stamp-field';

type DamageEngine = Pick<ThreeTilesEngine, 'world' | 'effects' | 'sync' | 'getTerrainHeightAtGeo'>;

/** The main thread's route grid as the stamps need it: its extent, and where its sight probes stand */
export interface StampGround {
  cellSpan(): CellSpan | null;
  setStampField(field: StampField | null): void;
}

/** What the DevTools hit takes by default: a point, and as much as a rocket */
const DEBUG_HIT = { reach: 4, amount: 45 } as const;

/**
 * What the fight does to a destructible world, as the simulation has it
 * (docs/DESTRUCTION_PLAN.md, TODO E131). Its StructureLedger says every
 * structure's stage (op `structures.setStages`, all of them, also after a
 * restore or a replay's seek, and `structures.stage` as one changes), which
 * this hands to the world's destruction: a fallen one goes out of the
 * picture and the build blocking. Its CraterLedger says the craters
 * (`craters.setAll`, `craters.dig`). A fall as it happens comes as
 * `main.structureFell`, a moment of the show: an explosion of the
 * structure's size.
 *
 * From the fallen structures' rubble and the craters this keeps the same
 * StampField the simulation's enemies walk on, and hands it to the route
 * grid, whose tower sight probes stand where the enemies stand. Nothing
 * here on a world that cannot be damaged: no op comes.
 *
 * In development `__worldDamage` in DevTools lists the structures and hits a
 * point through the simulation (`debug:hit-structures`, a cheat in coop):
 * `structures()`, `hit(lat, lon, reach, amount)`.
 */
export class WorldDamagePresenter {
  /** The world's structures; null for a world where nothing falls */
  private readonly destruction: WorldDestruction | null;
  /** The DevTools hook while this presenter lives */
  private debugApi: object | null = null;
  /** The run rules' structures, read once the simulation speaks of them (the catalogue comes after this is made) */
  private structures: readonly RunStructure[] | null = null;
  /** The stages as the simulation said them last, in the run rules' order */
  private stages = new Uint8Array(0);
  /** The craters as the simulation said them last, CRATER_STRIDE numbers each */
  private craters = new Int32Array(0);
  private field: StampField | null = null;
  private readonly local = new Vector3();
  private readonly toLocal: ToLocal;

  constructor(
    private readonly engine: DamageEngine,
    bus: MainEventBus,
    private readonly ground: StampGround | null = null,
  ) {
    this.destruction = engine.world.capabilities.destructible ? engine.world.destruction : null;
    this.toLocal = (lat, lon, out) => {
      const at = this.engine.sync.geoToLocalSimpleInto(lat, lon, 0, this.local);
      out.x = at.x;
      out.z = at.z;
    };
    if (!this.destruction || !isDevMode()) return;
    const destruction = this.destruction;
    (globalThis as Record<string, unknown>)['__worldDamage'] = this.debugApi = {
      structures: () => destruction.structures(),
      hit: (lat: number, lon: number, reach: number = DEBUG_HIT.reach, amount: number = DEBUG_HIT.amount) =>
        bus.emit({ type: 'debug:hit-structures', lat, lon, reach, amount }),
    };
  }

  /** Every structure's stage (op `structures.setStages`) */
  setStages(stages: Uint8Array): void {
    this.stages = stages.slice();
    this.destruction?.setStages(stages);
    this.rebuild();
  }

  /** Structure `index` reached `stage` by damage just now (op `structures.stage`) */
  setStage(index: number, stage: StructureStage): void {
    if (index < 0 || index >= this.stages.length) return;
    const was = this.stages[index];
    this.stages[index] = stage;
    this.destruction?.setStage(index, stage);
    const s = this.runStructures()[index];
    if (stage === 3 && was !== 3 && s) this.stampField()?.rubbleHeap(rubbleStampOf(s, this.toLocal), 1);
  }

  /** Every crater of the run (op `craters.setAll`) */
  setCraters(craters: Int32Array): void {
    this.craters = craters.slice();
    this.rebuild();
  }

  /** Crater `index` was dug or deepened just now (op `craters.dig`) */
  dig(index: number, x: number, y: number, radius: number, depth: number): void {
    const k = index * CRATER_STRIDE;
    const field = this.stampField();
    if (k < this.craters.length) {
      const c = this.craters;
      field?.crater(craterStampOf(c[k], c[k + 1], c[k + 2], c[k + 3], this.toLocal), -1);
    } else {
      const grown = new Int32Array(k + CRATER_STRIDE);
      grown.set(this.craters);
      this.craters = grown;
    }
    this.craters.set([x, y, radius, depth], k);
    field?.crater(craterStampOf(x, y, radius, depth, this.toLocal), 1);
  }

  /** A structure fell just now (op `main.structureFell`): it goes up in an explosion of its size */
  fell(lat: number, lon: number, radius: number, height: number): void {
    if (!this.destruction) return;
    const ground = this.engine.getTerrainHeightAtGeo(lat, lon) ?? 0;
    const at = this.engine.sync.geoToLocalSimple(lat, lon, 0);
    const size = Math.max(2, radius);
    this.engine.effects.spawnExplosion(at.x, ground + height / 2, at.z, Math.round(10 + size * 3), size, Math.round(size));
  }

  /** The craters as the simulation said them last, CRATER_STRIDE numbers each */
  craterList(): Int32Array {
    return this.craters;
  }

  /** The field of craters and rubble under the routes, null while the ground lies as built */
  stampField(): StampField | null {
    if (!this.field) this.useField(this.newField());
    return this.field;
  }

  private runStructures(): readonly RunStructure[] {
    return (this.structures ??= this.engine.world.runRules()?.structures ?? []);
  }

  /** The field from scratch, as WorldDamage builds it: every fallen structure's rubble, then every crater */
  private rebuild(): void {
    const fallen = this.stages.indexOf(3) >= 0;
    if (!fallen && this.craters.length === 0) {
      this.useField(null);
      return;
    }
    const field = this.field ?? this.newField();
    if (field) {
      field.clear();
      const list = this.runStructures();
      for (let i = 0; i < this.stages.length && i < list.length; i++) {
        if (this.stages[i] === 3) field.rubbleHeap(rubbleStampOf(list[i], this.toLocal), 1);
      }
      const c = this.craters;
      for (let k = 0; k + CRATER_STRIDE <= c.length; k += CRATER_STRIDE) {
        field.crater(craterStampOf(c[k], c[k + 1], c[k + 2], c[k + 3], this.toLocal), 1);
      }
    }
    this.useField(field);
  }

  private newField(): StampField | null {
    const span = this.ground?.cellSpan() ?? null;
    return span ? new StampField(span) : null;
  }

  private useField(field: StampField | null): void {
    if (field === this.field) return;
    this.field = field;
    this.ground?.setStampField(field);
  }

  destroy(): void {
    this.useField(null);
    const global = globalThis as Record<string, unknown>;
    if (this.debugApi && global['__worldDamage'] === this.debugApi) delete global['__worldDamage'];
  }
}
