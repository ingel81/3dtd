/**
 * Shared game setup for the hero integration specs (hero.spec.ts,
 * hero.scenario.spec.ts). Both build a GameStateManager the same way, wired
 * against the vi.mock('@angular/core') inject stub each spec file declares
 * (see withAutoStubs in ./test-helpers).
 */
import { createTestCachedPaths, withAutoStubs, TEST_PATH, TEST_SPAWN_POINTS } from './test-helpers';
import { GameStateManager } from '../managers/game-state.manager';
import { CombatEffectService } from '../services/combat/combat-effect.service';
import { DamageApplicationService } from '../services/combat/damage-application.service';
import { GameObject } from '../core/game-object';
import { HERO } from '../configs/hero.config';
import { geoDistanceFast } from '../utils/geo-utils';
import type { Enemy } from '../entities/enemy.entity';
import type { GeoPosition } from '../models/game.types';
import type { ThreeTilesEngine } from '../three-engine';

/** HQ at the north end of the 111 m TEST_PATH. */
export const HERO_TEST_BASE_POSITION: GeoPosition = TEST_PATH[TEST_PATH.length - 1];

/**
 * Resets `mockServices` (the map backing the @angular/core `inject()` stub),
 * stubs the services the loop reaches around the hero, and starts a
 * GameStateManager with enough credits to hire him.
 */
export function createHeroTestGame(
  timescale: number,
  mockServices: Record<string, unknown>,
  engine: ThreeTilesEngine,
): GameStateManager {
  for (const key of Object.keys(mockServices)) delete mockServices[key];
  GameObject.resetIdCounter();

  const ref: { gsm?: GameStateManager } = {};
  mockServices['GlobalRouteGridService'] = withAutoStubs({
    isInitialized: () => false,
    getEnemiesInRadiusGeo: (center: GeoPosition, radiusM: number, _exclude: unknown, out: Enemy[]) => {
      out.length = 0;
      for (const enemy of ref.gsm!.enemyManager.getAlive()) {
        if (geoDistanceFast(center, enemy.position) <= radiusM) out.push(enemy);
      }
      return out;
    },
  });
  const paths = createTestCachedPaths();
  mockServices['PathAndRouteService'] = withAutoStubs({ getCachedPaths: () => paths });
  mockServices['SpatialGridService'] = withAutoStubs({ updateEnemyTracked: () => null });
  mockServices['EnemyDebugService'] = withAutoStubs({ debugEnemies: () => [] });
  mockServices['EconomyService'] = withAutoStubs({ computeWaveCompletionBonus: () => 0 });
  mockServices['DamageApplicationService'] = new DamageApplicationService();
  mockServices['CombatEffectService'] = new CombatEffectService();

  const gsm = new GameStateManager();
  ref.gsm = gsm;
  gsm.initialize(engine, HERO_TEST_BASE_POSITION, TEST_SPAWN_POINTS, paths);
  gsm.trainingTimescale.set(timescale);
  gsm.getEventBus().emit({
    type: 'research:completed',
    researchId: HERO.researchId,
    effects: [{ kind: 'global-perk', perkId: HERO.perkId, description: '' }],
  });
  gsm.addCredits(HERO.cost);
  return gsm;
}
