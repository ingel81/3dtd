import { isDevMode } from '@angular/core';
import type { ThreeTilesEngine } from '../three-engine';
import { SubscriptionBag } from '../game-engine/game-event-bus';
import type { MainEventBus } from '../sim/client/view-events';
import type { WorldDestruction } from '../world/world-provider';

/** How far from an impact a structure still takes its damage, m (plus the structure's own radius) */
export const IMPACT_REACH_M = 4;
/** HP an impact takes off each structure in reach */
export const IMPACT_DAMAGE = 20;

type DamageEngine = Pick<ThreeTilesEngine, 'world' | 'effects' | 'sync' | 'getTerrainHeightAtGeo'>;

/**
 * Damage to the structures of a destructible world (WorldProvider.destruction,
 * capabilities.destructible): every projectile impact on the main bus, on
 * an enemy or on the ground, takes IMPACT_DAMAGE off the structures within
 * reach; one that falls goes up in an explosion of its size. A new run stands
 * them all up again. Nothing here without a destructible world.
 *
 * Main thread only and off the simulation: it hears the simulation's
 * events, so every client of a coop room and a replay see the same falls,
 * but a fall does not change the simulation (docs/CUSTOM_MAP_WORLD.md).
 * In development `__worldDamage` in DevTools lists the structures and hits
 * a point: `structures()`, `hit(lat, lon, radius, amount)`.
 */
export class WorldDamagePresenter {
  private readonly subs = new SubscriptionBag();
  /** The world's structures; null for a world where nothing falls */
  private readonly destruction: WorldDestruction | null;
  /** The DevTools hook while this presenter lives */
  private debugApi: object | null = null;

  constructor(private readonly engine: DamageEngine, bus: MainEventBus) {
    this.destruction = engine.world.capabilities.destructible ? engine.world.destruction : null;
    if (!this.destruction) return;
    this.subs.add(bus.onLive('vfx:projectile-impact', (e) => this.hit(e.lat, e.lon)));
    this.subs.add(bus.onLive('game:reset', () => this.reset()));
    if (isDevMode()) {
      const destruction = this.destruction;
      (globalThis as Record<string, unknown>)['__worldDamage'] = this.debugApi = {
        structures: () => destruction.structures(),
        hit: (lat: number, lon: number, radius = IMPACT_REACH_M, amount = IMPACT_DAMAGE) => this.hit(lat, lon, radius, amount),
      };
    }
  }

  /** A new game: every structure stands again */
  reset(): void {
    this.destruction?.reset();
  }

  destroy(): void {
    this.subs.disposeAll();
    const global = globalThis as Record<string, unknown>;
    if (this.debugApi && global['__worldDamage'] === this.debugApi) delete global['__worldDamage'];
  }

  private hit(lat: number, lon: number, radius = IMPACT_REACH_M, amount = IMPACT_DAMAGE): string[] {
    const fallen = this.destruction?.damage({ lat, lon }, radius, amount) ?? [];
    for (const s of fallen) {
      const ground = this.engine.getTerrainHeightAtGeo(s.lat, s.lon) ?? 0;
      const at = this.engine.sync.geoToLocalSimple(s.lat, s.lon, 0);
      const size = Math.max(2, s.radius);
      this.engine.effects.spawnExplosion(at.x, ground + s.height / 2, at.z, Math.round(10 + size * 3), size, Math.round(size));
    }
    return fallen.map((s) => s.id);
  }
}
