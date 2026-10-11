import type { SimSink } from '../../sim/core/sim-sink';
import type { RunStructure } from '../../sim/protocol/run-rules';
import { MAP_METERS_PER_DEGREE } from '../../world/custom-map/map-document';

/** How far from an impact a structure still takes its damage, m (plus the structure's own radius) */
export const IMPACT_REACH_M = 4;
/** HP an impact takes off each structure in reach */
export const IMPACT_DAMAGE = 20;

/** A structure the simulation wears down */
interface LedgerEntry {
  readonly id: string;
  readonly lat: number;
  readonly lon: number;
  readonly height: number;
  /** Map metres (a custom map's lat and lon are its metres over MAP_METERS_PER_DEGREE) */
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly maxHp: number;
  hp: number;
}

/**
 * The HP of a destructible world's structures in the simulation (TODO E131):
 * every projectile impact takes IMPACT_DAMAGE off each standing structure
 * within IMPACT_REACH_M of it plus its radius; at 0 it falls. A fall goes to
 * the main thread as the full set of fallen ids (`structures.setFallen`), so
 * a restore or a replay's seek shows the same, and as the moment of its
 * fall (`main.structureFell`, an explosion); the towers near it see anew
 * (`onFall`). The run rules bring the structures (RunRules.structures), a
 * new run stands them up again. Snapshots and the state hash carry the HP.
 */
export class StructureLedger {
  private list: LedgerEntry[] = [];

  constructor(
    private readonly sink: SimSink,
    /** A structure fell: map metres and its radius, for the towers whose sight it changes */
    private readonly onFall: (x: number, y: number, radius: number) => void,
  ) {}

  /** The world's structures, all standing; none for a world where nothing falls */
  load(structures: readonly RunStructure[] | null): void {
    this.list = (structures ?? []).map((s) => ({
      id: s.id,
      lat: s.lat,
      lon: s.lon,
      height: s.height,
      x: s.lon * MAP_METERS_PER_DEGREE,
      y: s.lat * MAP_METERS_PER_DEGREE,
      radius: s.radius,
      maxHp: s.hp,
      hp: s.hp,
    }));
    this.publish();
  }

  /** A new run: every structure stands again */
  reset(): void {
    if (this.list.length === 0) return;
    for (const s of this.list) s.hp = s.maxHp;
    this.publish();
  }

  get size(): number {
    return this.list.length;
  }

  /** A projectile came down at `lat`, `lon` */
  impact(lat: number, lon: number): void {
    this.hit(lat, lon, IMPACT_REACH_M, IMPACT_DAMAGE);
  }

  /** Take `amount` off every standing structure within `reach` m plus its radius; the ids that fell */
  hit(lat: number, lon: number, reach: number, amount: number): string[] {
    if (this.list.length === 0 || amount <= 0) return [];
    const x = lon * MAP_METERS_PER_DEGREE;
    const y = lat * MAP_METERS_PER_DEGREE;
    const fallen: LedgerEntry[] = [];
    for (const s of this.list) {
      if (s.hp <= 0) continue;
      const r = reach + s.radius;
      const dx = s.x - x;
      const dy = s.y - y;
      if (dx * dx + dy * dy > r * r) continue;
      s.hp = Math.max(0, s.hp - amount);
      if (s.hp === 0) fallen.push(s);
    }
    if (fallen.length === 0) return [];
    this.publish();
    for (const s of fallen) {
      // The moment of the fall: a show op, left out while the show is muted (a replay's seek)
      this.sink.main.structureFell(s.lat, s.lon, s.radius, s.height);
      this.onFall(s.x, s.y, s.radius);
    }
    return fallen.map((s) => s.id);
  }

  /** HP in the order of the list, for a snapshot and the state hash */
  hpList(): number[] {
    return this.list.map((s) => s.hp);
  }

  /** HP back from a snapshot (hpList); a snapshot without them stands every structure */
  restore(hp: readonly number[] | undefined): void {
    this.list.forEach((s, i) => {
      const saved = hp?.[i];
      s.hp = typeof saved === 'number' && Number.isFinite(saved) ? Math.min(s.maxHp, Math.max(0, saved)) : s.maxHp;
    });
    this.publish();
  }

  /** Tell the main thread which structures lie fallen now, all of them */
  publish(): void {
    if (this.list.length === 0) return;
    this.sink.structures.setFallen(this.list.filter((s) => s.hp <= 0).map((s) => s.id));
  }
}
