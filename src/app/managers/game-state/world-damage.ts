import type { SimSink } from '../../sim/core/sim-sink';
import type { RunDestruction, RunRules } from '../../sim/protocol/run-rules';
import type { ProjectileTypeConfig } from '../../configs/projectile-types.config';
import type { AbilityId } from '../../configs/abilities.config';
import type { GeoPosition } from '../../models/game.types';
import type { Tower } from '../../entities/tower.entity';
import type { Enemy } from '../../entities/enemy.entity';
import { ABILITIES } from '../../configs/abilities.config';
import { ABILITY_DESTRUCTION, IMPACT_REACH_M, WEAR, type DebugBlast, type StructureStage } from '../../configs/destruction.config';
import { PROJECTILE_TYPES } from '../../configs/projectile-types.config';
import { MAP_METERS_PER_DEGREE } from '../../world/custom-map/map-document';
import { StructureLedger } from './structure-ledger';
import { CraterLedger, craterHitDepthCm } from './crater-ledger';
import { StampField, craterStampOf, rubbleStampOf, type CellSpan, type ToLocal } from '../../utils/stamp-field';

/** What the world's damage needs of the simulation round it */
export interface WorldDamageHost {
  readonly sink: SimSink;
  /** Map degrees to the local frame (the simulation's SimSync) */
  readonly toLocal: ToLocal;
  /** The route cells' grid span, null without routes */
  routeSpan(): CellSpan | null;
  /** The field the enemies read their ground and pace from, null while the ground lies as built */
  setField(field: StampField | null): void;
  towers(): readonly Tower[];
  enemies(): readonly Enemy[];
  /** Something changed at map metres (`x`, `y`) out to `radius`: the towers that may see past it ask anew */
  seeAround(x: number, y: number, radius: number): void;
}

/** A crater's reach past its radius, for the towers that see anew (impact-stamp CRATER_REACH_SQ, rounded up) */
const CRATER_SIGHT_REACH = 1.35;

/**
 * What the fight does to a destructible world, in the simulation
 * (docs/DESTRUCTION_PLAN.md): the structures' HP (StructureLedger), the
 * craters (CraterLedger), the ground they and the rubble of the fallen make
 * under the routes (StampField, which the enemies walk on), and the wear of
 * the enemies passing by. Everything in whole numbers, so every coop client,
 * every replay and every restored save comes to the same.
 *
 * Damage comes in as logic, never by the show: a projectile's impact on the
 * ground (ProjectileManager's impact listener), an ability where it lands
 * and while a beam burns (AbilityWorld.damageWorld), the wear tick, the
 * debug hit. A world without structures and craters holds nothing here and
 * costs nothing: no field, no ops, nothing in the hash.
 */
export class WorldDamage {
  readonly structures: StructureLedger;
  readonly craters = new CraterLedger();
  private rules: RunDestruction | null = null;
  private field: StampField | null = null;

  constructor(private readonly host: WorldDamageHost) {
    this.structures = new StructureLedger(host.sink, {
      staged: (index, from, to) => this.staged(index, from, to),
      carried: (index) => this.carried(index),
    });
  }

  /** Craters dig into this world */
  get cratersOn(): boolean {
    return this.rules?.craters === true;
  }

  /** The world's rules: its structures at their start, no craters */
  load(rules: RunRules): void {
    this.rules = rules.destruction ?? null;
    this.structures.load(rules.structures);
    this.craters.clear();
    this.useField(null);
    this.rebuild();
    this.publishCraters();
  }

  /** The route cells stand anew (after load: the world's routes are in): the field over them from scratch */
  regrid(): void {
    this.useField(null);
    this.rebuild();
  }

  /** A new run: every structure as the map has it, no crater */
  reset(): void {
    this.structures.reset();
    this.craters.clear();
    this.rebuild();
    this.publishCraters();
  }

  /** The HP, headings and craters of a snapshot back (capture's); a snapshot without them starts the world afresh */
  restore(hp: readonly number[] | undefined, craters: readonly number[] | undefined, headings?: readonly number[]): void {
    this.structures.restore(hp, headings);
    this.craters.restore(craters);
    this.rebuild();
    this.publishCraters();
  }

  /** The craters for a snapshot; absent where there are none, so a world without them saves as before */
  captureCraters(): number[] | undefined {
    return this.craters.size > 0 ? Array.from(this.craters.list()) : undefined;
  }

  /** The main thread hears everything as it stands (after a restore or a replay's seek, the resync) */
  publish(): void {
    this.structures.publish();
    this.publishCraters();
  }

  private publishCraters(): void {
    if (this.cratersOn) this.host.sink.craters.setAll(this.craters.list());
  }

  /** The field as everything stands now: none where the ground lies as built, else every stamp from scratch */
  private rebuild(): void {
    const fallen = this.structures.stages().indexOf(3) >= 0;
    if (!fallen && this.craters.size === 0) this.useField(null);
    else this.restamp(this.field ?? this.newField());
  }

  /** `field` cleared and stamped with every fallen structure's rubble and every crater, in the run rules' and the dig order */
  private restamp(field: StampField | null): void {
    if (field) {
      field.clear();
      const list = this.structures.list();
      const stages = this.structures.stages();
      for (let i = 0; i < list.length; i++) if (stages[i] === 3) field.rubbleHeap(rubbleStampOf(list[i], this.host.toLocal), 1);
      for (let i = 0; i < this.craters.size; i++) field.crater(this.craterStamp(i), 1);
    }
    this.useField(field);
  }

  private newField(): StampField | null {
    const span = this.host.routeSpan();
    return span ? new StampField(span) : null;
  }

  private useField(field: StampField | null): void {
    this.field = field;
    this.host.setField(field);
  }

  /**
   * The field for a stamp to come, made with everything that stands so far
   * where there was none: call it before the ledgers change, the stamp goes on top
   */
  private stampField(): StampField | null {
    if (!this.field) this.restamp(this.newField());
    return this.field;
  }

  private craterStamp(i: number) {
    const e = this.craters.entry(i);
    return craterStampOf(e[0], e[1], e[2], e[3], this.host.toLocal);
  }

  /**
   * A projectile of `type` came down at map degrees (`lat`, `lon`): on the
   * ground (`air` false) it takes its structureDamage off the structures in
   * reach and digs its crater; in the air it does neither
   */
  impact(lat: number, lon: number, type: ProjectileTypeConfig, air: boolean): void {
    if (air) return;
    const x = lon * MAP_METERS_PER_DEGREE;
    const y = lat * MAP_METERS_PER_DEGREE;
    if (type.structureDamage > 0) this.structures.hit(x, y, (type.splashRadius ?? 0) + IMPACT_REACH_M, type.structureDamage);
    if (type.craterRadius) this.dig(x, y, type.craterRadius, null);
  }

  /**
   * Ability `id` acts at `at` over the game ms from `fromMs` to `toMs` of
   * its strike: a strike that acts at once (0 to 0) fells and digs, a beam
   * takes its HP per second for the time in between
   */
  ability(id: AbilityId, at: GeoPosition, fromMs: number, toMs: number): void {
    const what = ABILITY_DESTRUCTION[id];
    const x = at.lon * MAP_METERS_PER_DEGREE;
    const y = at.lat * MAP_METERS_PER_DEGREE;
    const radius = ABILITIES[id].radiusM;
    if (what.fells) this.structures.fell(x, y, radius);
    const perSecond = what.structureHpPerSecond ?? 0;
    if (perSecond > 0) {
      // Whole HP: what the beam has taken by its end of this sub-step less what by its start
      const amount = Math.floor((perSecond * toMs) / 1000) - Math.floor((perSecond * fromMs) / 1000);
      if (amount > 0) this.structures.hit(x, y, radius, amount);
    }
    if (what.crater) this.dig(x, y, what.crater.radiusM, what.crater.depthCm);
  }

  /**
   * A shell of an enemy's gun (EnemySiege) lands at map metres (`x`, `y`):
   * `amount` off every structure within `reach` m plus its radius, and a
   * crater of `craterRadiusM` where the world digs them
   */
  shell(x: number, y: number, amount: number, reach: number, craterRadiusM: number): void {
    if (amount > 0) this.structures.hit(x, y, reach, amount);
    if (craterRadiusM > 0) this.dig(x, y, craterRadiusM, null);
  }

  /** A crater of `radiusM` at map metres, `depthCm` deeper (its radius's hit depth when null), when the world digs them */
  private dig(x: number, y: number, radiusM: number, depthCm: number | null): void {
    if (!this.cratersOn) return;
    const rDm = Math.round(radiusM * 10);
    const field = this.stampField();
    const dug = this.craters.dig(Math.round(x * 10), Math.round(y * 10), rDm, depthCm ?? craterHitDepthCm(rDm));
    if (!dug) return;
    let touched = false;
    if (field) {
      if (dug.before) {
        const [bx, by, br, bd] = dug.before;
        field.crater(craterStampOf(bx, by, br, bd, this.host.toLocal), -1);
      }
      touched = field.crater(this.craterStamp(dug.index), 1);
    }
    const e = this.craters.entry(dug.index);
    this.host.sink.craters.dig(dug.index, e[0], e[1], e[2], e[3]);
    // A new crater under the routes: the towers probe the enemies' new ground (a deeper one, a few cm more, does not ask)
    if (touched && !dug.before) this.host.seeAround(e[0] / 10, e[1] / 10, (e[2] / 10) * CRATER_SIGHT_REACH);
  }

  /**
   * The enemies passing by wear the structures down (a map's `gameplay.wear`):
   * every WEAR.intervalMs of game time each enemy on the ground takes WEAR.hp
   * (a boss WEAR.bossHp) off every structure within WEAR.reachM of it
   */
  tick(stepMs: number, gameTimeMs: number): void {
    if (this.rules?.wear !== true || this.structures.size === 0) return;
    if (Math.floor(gameTimeMs / WEAR.intervalMs) === Math.floor((gameTimeMs - stepMs) / WEAR.intervalMs)) return;
    for (const enemy of this.host.enemies()) {
      if (!enemy.alive || enemy.typeConfig.isAirUnit) continue;
      const p = enemy.position;
      this.structures.hit(p.lon * MAP_METERS_PER_DEGREE, p.lat * MAP_METERS_PER_DEGREE, WEAR.reachM, enemy.typeConfig.isBoss ? WEAR.bossHp : WEAR.hp);
    }
  }

  /** Debug: a crater of `radiusM` at map degrees (`lat`, `lon`), `depthCm` deeper, where the world takes craters */
  debugDig(lat: number, lon: number, radiusM: number, depthCm: number): void {
    this.dig(lon * MAP_METERS_PER_DEGREE, lat * MAP_METERS_PER_DEGREE, radiusM, Math.round(depthCm));
  }

  /**
   * Debug (the dev tools' destruction tool): `blast` goes off at map degrees
   * (`lat`, `lon`) as the real one does: a projectile type's impact on the
   * ground, or the nuclear strike where it lands. The show is the caller's
   */
  debugBlast(lat: number, lon: number, blast: DebugBlast): void {
    if (blast === 'nuclear-strike') this.ability(blast, { lat, lon }, 0, 0);
    else this.impact(lat, lon, PROJECTILE_TYPES[blast], false);
  }

  /**
   * Debug: structure `index` to `stage`, pushed from map degrees (`lat`,
   * `lon`) (StructureLedger.setStage). Worse goes the way of damage; a
   * mended one takes its rubble with it, the main thread hears every stage
   * anew and the towers round it look again
   */
  debugSetStage(index: number, stage: StructureStage, lat: number, lon: number): void {
    const wasFallen = this.structures.stages()[index] === 3;
    if (!this.structures.setStage(index, stage, lon * MAP_METERS_PER_DEGREE, lat * MAP_METERS_PER_DEGREE)) return;
    this.rebuild();
    this.structures.publish();
    if (wasFallen) this.host.seeAround(this.structures.xOf(index), this.structures.yOf(index), this.structures.radiusOf(index));
  }

  /** The HP that changed go out to the main thread, once per packet (StructureLedger.flushHp) */
  flushHp(): void {
    this.structures.flushHp();
  }

  /** Debug: `amount` off the structures within `reach` m of map degrees (`lat`, `lon`); how many changed their stage */
  debugHit(lat: number, lon: number, reach: number, amount: number): number {
    return this.structures.hit(lon * MAP_METERS_PER_DEGREE, lat * MAP_METERS_PER_DEGREE, reach, Math.round(amount));
  }

  /** Structure `index` changed its stage by damage: a fall shows, leaves its rubble and opens the sight round it */
  private staged(index: number, _from: StructureStage, to: StructureStage): void {
    if (to !== 3) return;
    const s = this.structures.list()[index];
    // The moment of the fall: a show op, left out while the show is muted (a replay's seek)
    this.host.sink.main.structureFell(index, s.lat, s.lon, s.radius, s.height);
    // Its stage is 3 already: a field made now stamps its rubble with the rest
    if (this.field) this.field.rubbleHeap(rubbleStampOf(s, this.host.toLocal), 1);
    else this.restamp(this.newField());
    this.host.seeAround(this.structures.xOf(index), this.structures.yOf(index), s.radius);
  }

  /**
   * The roof at `at` belongs to a structure that has fallen: a tower
   * ordered onto it (place-tower with `roof`) finds none, on every client
   * in the same tick
   */
  roofFallen(at: GeoPosition): boolean {
    return this.structures.fallenRoofAt(at.lon * MAP_METERS_PER_DEGREE, at.lat * MAP_METERS_PER_DEGREE);
  }

  /** A tower stands on the roof of structure `index` */
  private carried(index: number): boolean {
    for (const tower of this.host.towers()) {
      const p = tower.position;
      if (this.structures.onRoof(index, p.lon * MAP_METERS_PER_DEGREE, p.lat * MAP_METERS_PER_DEGREE)) return true;
    }
    return false;
  }
}
