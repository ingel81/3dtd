import { isDevMode } from '@angular/core';
import { Vector3 } from 'three';
import type { ThreeTilesEngine } from '../three-engine';
import type { MainEventBus } from '../sim/client/view-events';
import type { WorldDestruction, WorldGroundDamage } from '../world/world-provider';
import type { Tower } from '../entities/tower.entity';
import type { TowerChange } from '../sim/client/mirror/sim-mirror';
import { MAP_METERS_PER_DEGREE } from '../world/custom-map/map-document';
import { RUBBLE_COLOURS, type RubbleMaterial } from '../world/custom-map/rubble-material';
import { DESTRUCTION_SOUNDS } from '../configs/audio.config';
import type { RunStructure } from '../sim/protocol/run-rules';
import type { DebugBlast, StructureStage } from '../configs/destruction.config';
import { structureBarWidth } from '../three-engine/renderers/structure-health-bars';
import { CRATER_STRIDE } from '../managers/game-state/crater-ledger';
import { StampField, craterStampOf, rubbleStampOf, type CellSpan, type ToLocal } from '../utils/stamp-field';

type DamageEngine = Pick<ThreeTilesEngine, 'world' | 'effects' | 'sync' | 'getTerrainHeightAtGeo' | 'structureBars'>;

/** A structure's HP as the main thread mirrors them (WorldDamagePresenter.hpOf) */
export interface StructureHp {
  /** The map object's id */
  id: string;
  hp: number;
  max: number;
  stage: StructureStage;
}

/** How far over its roof a structure's bar floats, m */
const BAR_OVER_ROOF_M = 1.5;

/** The main thread's route grid as the stamps need it: its extent, and where its sight probes stand */
export interface StampGround {
  cellSpan(): CellSpan | null;
  setStampField(field: StampField | null): void;
  /** Hear when the cells are built anew or dropped; returns the unsubscribe */
  onCellsChanged(listener: () => void): () => void;
}

/** The towers as the main thread mirrors them: the ground under them holds (WorldGroundDamage.holdTower) */
export interface TowerSource {
  towers(): readonly Tower[];
  onTowerChange(listener: (change: TowerChange) => void): () => void;
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
 * It mirrors every structure's HP too (with `structures.setStages`, and
 * `structures.hp` once per packet for those that changed) and keeps a bar
 * over each damaged one that still stands (engine.structureBars), set when
 * its HP changes, never per frame. The dev tools' destruction tool reads
 * the HP here (hpOf, onHpChanged).
 *
 * In development `__worldDamage` in DevTools lists the structures and hits a
 * point through the simulation (`debug:hit-structures`, a cheat in coop):
 * `structures()`, `hit(lat, lon, reach, amount)`, `dig(lat, lon, radius, depth)`,
 * `blast(lat, lon, blast)`, `setStage(index, stage)`, `hp(index)`.
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
  /** The HP as the simulation said them last, in the run rules' order */
  private hp = new Int32Array(0);
  private readonly hpListeners = new Set<() => void>();
  /** The craters as the simulation said them last, CRATER_STRIDE numbers each */
  private craters = new Int32Array(0);
  private field: StampField | null = null;
  private readonly local = new Vector3();
  private readonly toLocal: ToLocal;
  private readonly unsubscribe: (() => void) | null;
  private readonly unsubscribeTowers: (() => void) | null;
  /** The world's drawn ground under craters and rubble, null where it stays as built */
  private readonly drawn: WorldGroundDamage | null;

  constructor(
    private readonly engine: DamageEngine,
    private readonly bus: MainEventBus,
    private readonly ground: StampGround | null = null,
    private readonly towerSource: TowerSource | null = null,
  ) {
    this.destruction = engine.world.capabilities.destructible ? engine.world.destruction : null;
    this.drawn = this.destruction?.ground ?? null;
    const drawn = this.drawn;
    this.unsubscribeTowers = drawn && towerSource
      ? towerSource.onTowerChange((change) => {
        const t = change.tower;
        if (change.kind === 'removed') drawn.releaseTower(t.id);
        else drawn.holdTower(t.id, t.position.lon * MAP_METERS_PER_DEGREE, t.position.lat * MAP_METERS_PER_DEGREE);
      })
      : null;
    this.toLocal = (lat, lon, out) => {
      const at = this.engine.sync.geoToLocalSimpleInto(lat, lon, 0, this.local);
      out.x = at.x;
      out.z = at.z;
    };
    // Cells built anew: the field over them from scratch
    this.unsubscribe = ground?.onCellsChanged(() => {
      this.useField(null);
      this.rebuild();
    }) ?? null;
    if (!this.destruction || !isDevMode()) return;
    const destruction = this.destruction;
    (globalThis as Record<string, unknown>)['__worldDamage'] = this.debugApi = {
      structures: () => destruction.structures(),
      hit: (lat: number, lon: number, reach: number = DEBUG_HIT.reach, amount: number = DEBUG_HIT.amount) =>
        bus.emit({ type: 'debug:hit-structures', lat, lon, reach, amount }),
      dig: (lat: number, lon: number, radius = 2.5, depth = 35) => bus.emit({ type: 'debug:dig-crater', lat, lon, radius, depth }),
      blast: (lat: number, lon: number, blast: DebugBlast = 'rocket') =>
        bus.emit({ type: 'debug:blast', lat, lon, height: engine.getTerrainHeightAtGeo(lat, lon) ?? 0, blast }),
      setStage: (index: number, stage: StructureStage) => {
        const s = this.runStructures()[index];
        if (s) bus.emit({ type: 'debug:set-structure-stage', index, stage, lat: s.lat, lon: s.lon });
      },
      hp: (index: number) => this.hpOf(index),
    };
  }

  /** Every structure's stage (op `structures.setStages`), with the heading of the hit that brought it and the HP */
  setStages(stages: Uint8Array, headings?: Int16Array, hp?: Int32Array): void {
    this.stages = stages.slice();
    this.destruction?.setStages(stages, headings);
    this.rebuild();
    if (hp) {
      this.hp = hp.slice();
      this.engine.structureBars?.clear();
      for (let i = 0; i < this.hp.length; i++) this.showBar(i);
    }
    this.hpChanged();
  }

  /** The HP that changed, pairs of index and HP (op `structures.hp`) */
  setHp(changes: Int32Array): void {
    for (let k = 0; k + 1 < changes.length; k += 2) {
      const i = changes[k];
      if (i < 0 || i >= this.hp.length) continue;
      this.hp[i] = changes[k + 1];
      this.showBar(i);
    }
    this.hpChanged();
  }

  /** Structure `index`'s HP, its most and its stage as the simulation said them last; null for none */
  hpOf(index: number): StructureHp | null {
    const s = this.runStructures()[index];
    if (!s || index >= this.hp.length) return null;
    return { id: s.id, hp: this.hp[index], max: maxHpOf(s), stage: (this.stages[index] ?? 0) as StructureStage };
  }

  /** Hear when HP or stages change; returns the unsubscribe */
  onHpChanged(listener: () => void): () => void {
    this.hpListeners.add(listener);
    return () => this.hpListeners.delete(listener);
  }

  private hpChanged(): void {
    for (const listener of this.hpListeners) listener();
  }

  /**
   * The structure under map degrees (`lat`, `lon`): the one whose ground
   * plan holds the point (its circle where it has none), the nearest middle
   * of several; -1 for none
   */
  structureAt(lat: number, lon: number): number {
    const x = lon * MAP_METERS_PER_DEGREE;
    const y = lat * MAP_METERS_PER_DEGREE;
    const list = this.runStructures();
    let best = -1;
    let bestSq = Infinity;
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      const dx = x - s.lon * MAP_METERS_PER_DEGREE;
      const dy = y - s.lat * MAP_METERS_PER_DEGREE;
      const sq = dx * dx + dy * dy;
      if (sq >= bestSq || !covers(s, x, y, sq)) continue;
      best = i;
      bestSq = sq;
    }
    return best;
  }

  /** The bar over structure `index` as its HP stand: none while full or fallen */
  private showBar(index: number): void {
    const bars = this.engine.structureBars;
    const s = this.runStructures()[index];
    if (!bars || !s) return;
    const hp = this.hp[index];
    const max = maxHpOf(s);
    if (hp <= 0 || hp >= max) {
      bars.set(index, 0, 0, 0, 0, 0);
      return;
    }
    const ground = this.engine.getTerrainHeightAtGeo(s.lat, s.lon) ?? 0;
    const at = this.engine.sync.geoToLocalSimpleInto(s.lat, s.lon, ground + s.height + BAR_OVER_ROOF_M, this.local);
    bars.set(index, at.x, at.y, at.z, structureBarWidth(s.radius), hp / max);
  }

  /** Structure `index` reached `stage` by damage just now, pushed the way of `heading` (op `structures.stage`) */
  setStage(index: number, stage: StructureStage, heading = -1): void {
    if (index < 0 || index >= this.stages.length) return;
    const was = this.stages[index];
    this.stages[index] = stage;
    this.destruction?.setStage(index, stage, heading);
    if (stage !== was) this.hpChanged();
    const s = this.runStructures()[index];
    if (stage !== 3 || was === 3 || !s) return;
    this.drawn?.rubble(s, 1);
    // A field made now stamps its rubble with the rest
    if (this.field) this.field.rubbleHeap(rubbleStampOf(s, this.toLocal), 1);
    else this.restamp(this.newField());
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
      this.drawn?.crater(c[k], c[k + 1], c[k + 2], c[k + 3], -1);
    } else {
      const grown = new Int32Array(k + CRATER_STRIDE);
      grown.set(this.craters);
      this.craters = grown;
    }
    this.craters.set([x, y, radius, depth], k);
    field?.crater(craterStampOf(x, y, radius, depth, this.toLocal), 1);
    this.drawn?.crater(x, y, radius, depth, 1);
    if (this.destruction) this.playAt(DESTRUCTION_SOUNDS.crater.id, y / MAP_METERS_PER_DEGREE, x / MAP_METERS_PER_DEGREE);
  }

  /**
   * Structure `index` fell just now (op `main.structureFell`): a short flash
   * where it breaks, a wall of dust rolling out over the ground round its
   * foot, a column of it up its height, grit of what it was built of thrown
   * up, smoke that hangs on; all of its size
   */
  fell(index: number, lat: number, lon: number, radius: number, height: number): void {
    if (!this.destruction) return;
    const effects = this.engine.effects;
    const ground = this.engine.getTerrainHeightAtGeo(lat, lon) ?? 0;
    const at = this.engine.sync.geoToLocalSimple(lat, lon, 0);
    const size = Math.max(2, radius);
    const material = this.destruction.structures()[index]?.material ?? 'plaster';
    const { grit, dust } = RUBBLE_COLOURS[material];
    // The break: a little fire, much smoke
    effects.spawnExplosion(at.x, ground + height * 0.4, at.z, Math.round(4 + size), size * 0.7, Math.round(size * 1.5));
    // The dust wall over the ground, wider than the house, and its column up the height
    effects.spawnGroundDust(at.x, ground + 0.3, at.z, Math.round(18 + size * 5), size * 1.6, 3 + size * 0.6);
    for (let k = 1; k <= 3; k++) {
      effects.spawnGroundDust(at.x, ground + (height * k) / 4, at.z, Math.round(6 + size * 1.5), size * (0.9 - k * 0.15), 1.2);
    }
    // Grit of its class, lit like dust: the palette's dark, mid and light
    const rgb = (c: readonly [number, number, number], k: number) => ({ r: c[0] * k, g: c[1] * k, b: c[2] * k });
    effects.spawnBurstAtGeo(lat, lon, ground + height * 0.3, Math.round(16 + size * 4), [rgb(grit, 0.6), rgb(grit, 1.1), rgb(dust, 1.2)]);
    // Pieces of it thrown up and out, coming down round its heap
    this.drawn?.debris(lon * MAP_METERS_PER_DEGREE, lat * MAP_METERS_PER_DEGREE, radius, height, material, index * 7.31 + 1);
    // Its collapse by class and size, the rubble settling with it
    const sizes = DESTRUCTION_SOUNDS.collapse[collapseClass(material)];
    const large = Math.max(height, radius) >= DESTRUCTION_SOUNDS.largeFrom;
    this.playAt((large ? sizes.large : sizes.small).id, lat, lon);
    this.playAt(DESTRUCTION_SOUNDS.rubble.id, lat, lon);
  }

  private playAt(sound: string, lat: number, lon: number): void {
    const height = this.engine.getTerrainHeightAtGeo(lat, lon) ?? 0;
    this.bus.emit({ type: 'audio:play', sound, lat, lon, height });
  }

  /** The craters as the simulation said them last, CRATER_STRIDE numbers each */
  craterList(): Int32Array {
    return this.craters;
  }

  /** The field for a stamp to come, made with everything known so far where there was none: before the lists change */
  private stampField(): StampField | null {
    if (!this.field) this.restamp(this.newField());
    return this.field;
  }

  private runStructures(): readonly RunStructure[] {
    return (this.structures ??= this.engine.world.runRules()?.structures ?? []);
  }

  /** The drawn ground as everything stands now: every stamp anew, the standing towers holding it */
  private redraw(): void {
    const drawn = this.drawn;
    if (!drawn) return;
    drawn.clear();
    const list = this.runStructures();
    for (let i = 0; i < this.stages.length && i < list.length; i++) if (this.stages[i] === 3) drawn.rubble(list[i], 1);
    const c = this.craters;
    for (let k = 0; k + CRATER_STRIDE <= c.length; k += CRATER_STRIDE) drawn.crater(c[k], c[k + 1], c[k + 2], c[k + 3], 1);
    for (const t of this.towerSource?.towers() ?? []) {
      drawn.holdTower(t.id, t.position.lon * MAP_METERS_PER_DEGREE, t.position.lat * MAP_METERS_PER_DEGREE);
    }
  }

  /** The field as everything stands now, as WorldDamage builds it: none where the ground lies as built */
  private rebuild(): void {
    this.redraw();
    const fallen = this.stages.indexOf(3) >= 0;
    if (!fallen && this.craters.length === 0) this.useField(null);
    else this.restamp(this.field ?? this.newField());
  }

  /** `field` cleared and stamped with every fallen structure's rubble, then every crater */
  private restamp(field: StampField | null): void {
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
    this.hpListeners.clear();
    this.engine.structureBars?.clear();
    this.unsubscribe?.();
    this.unsubscribeTowers?.();
    this.useField(null);
    const global = globalThis as Record<string, unknown>;
    if (this.debugApi && global['__worldDamage'] === this.debugApi) delete global['__worldDamage'];
  }
}

/** A structure's most HP, as StructureLedger takes them from the run rules */
function maxHpOf(s: RunStructure): number {
  return Math.max(1, Math.round(s.hp));
}

/** Map metres (`x`, `y`), `sq` from its middle, lie on structure `s`'s ground: in its box, or its circle without one */
function covers(s: RunStructure, x: number, y: number, sq: number): boolean {
  if (!s.box) return sq <= s.radius * s.radius;
  const [bx, by, hx, hy, turn] = s.box;
  const ox = x - bx;
  const oy = y - by;
  const cos = Math.cos(turn);
  const sin = Math.sin(turn);
  // In the box's own axes, as StructureLedger.onRoof
  return Math.abs(-ox * cos - oy * sin) <= hx && Math.abs(-ox * sin + oy * cos) <= hy;
}

/** The collapse sound a rubble class falls with: plaster, brick and stone as masonry */
export function collapseClass(material: RubbleMaterial): keyof typeof DESTRUCTION_SOUNDS.collapse {
  return material === 'concrete' || material === 'wood' || material === 'metal' ? material : 'masonry';
}
