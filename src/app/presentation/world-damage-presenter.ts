import { isDevMode } from '@angular/core';
import type { ThreeTilesEngine } from '../three-engine';
import type { MainEventBus } from '../sim/client/view-events';
import type { WorldDestruction } from '../world/world-provider';
import { IMPACT_DAMAGE, IMPACT_REACH_M } from '../managers/game-state/structure-ledger';

type DamageEngine = Pick<ThreeTilesEngine, 'world' | 'effects' | 'sync' | 'getTerrainHeightAtGeo'>;

/**
 * The structures of a destructible world as the simulation has them (TODO
 * E131): its StructureLedger keeps their HP and says which lie fallen (op
 * `structures.setFallen`, the whole set, also after a restore or a replay's
 * seek), which this hands to the world's destruction, out of the picture and
 * the build blocking. A fall as it happens comes as `main.structureFell`, a
 * moment of the show: an explosion of the structure's size. Nothing here
 * without a destructible world.
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

  constructor(private readonly engine: DamageEngine, bus: MainEventBus) {
    this.destruction = engine.world.capabilities.destructible ? engine.world.destruction : null;
    if (!this.destruction || !isDevMode()) return;
    const destruction = this.destruction;
    (globalThis as Record<string, unknown>)['__worldDamage'] = this.debugApi = {
      structures: () => destruction.structures(),
      hit: (lat: number, lon: number, reach = IMPACT_REACH_M, amount = IMPACT_DAMAGE) =>
        bus.emit({ type: 'debug:hit-structures', lat, lon, reach, amount }),
    };
  }

  /** The structures lying fallen now, all of them (op `structures.setFallen`) */
  setFallen(ids: readonly string[]): void {
    this.destruction?.setFallen(ids);
  }

  /** A structure fell just now (op `main.structureFell`): it goes up in an explosion of its size */
  fell(lat: number, lon: number, radius: number, height: number): void {
    if (!this.destruction) return;
    const ground = this.engine.getTerrainHeightAtGeo(lat, lon) ?? 0;
    const at = this.engine.sync.geoToLocalSimple(lat, lon, 0);
    const size = Math.max(2, radius);
    this.engine.effects.spawnExplosion(at.x, ground + height / 2, at.z, Math.round(10 + size * 3), size, Math.round(size));
  }

  destroy(): void {
    const global = globalThis as Record<string, unknown>;
    if (this.debugApi && global['__worldDamage'] === this.debugApi) delete global['__worldDamage'];
  }
}
