/** The hero: what happened and the commands (part of GameEvent, game-event-bus.ts). */
import type { Enemy } from '../../entities/enemy.entity';
import type { GeoPosition } from '../../models/game.types';
import type { HeroAmmoId, HeroRejectReason, HeroStatus } from '../../configs/hero.config';

export type HeroEvent =
  // ==================== Hero Events ====================
  | {
      // A shot of the hero killed `enemy` (DamageApplicationService, after
      // the enemy:died of that kill). Counts toward his levels. For the
      // fairness gate it is a kill like a tower's, not a leak.
      type: 'hero:kill';
      enemy: Enemy;
      /** Which hero (HeroManager.heroId); absent reads as the single player's */
      heroId?: string;
    }
  | {
      // His kills took him to `level`
      type: 'hero:level-up';
      level: number;
      position: GeoPosition;
      /** Whose hero (docs/COOP_PLAN.md, D10) */
      playerId: string;
      /** The hero of the player at this client, the one the UI shows */
      local: boolean;
    }
  | {
      type: 'hero:rejected';
      reason: HeroRejectReason;
      /** Whose hero (docs/COOP_PLAN.md, D10) */
      playerId: string;
      /** The hero of the player at this client, the one the UI shows */
      local: boolean;
    }
  | {
      // Snapshot after every HeroManager mutation the UI shows (unlock, hire,
      // order, arrival, kill, ammo). GameStateSyncService writes it into
      // GameStore.hero.
      type: 'hero:state-changed';
      hero: HeroStatus;
      /** Sent by a snapshot restore: a new baseline, no change the player made */
      restored?: true;
      /** Whose hero (docs/COOP_PLAN.md, D10) */
      playerId: string;
      /** The hero of the player at this client, the one the UI shows */
      local: boolean;
    }

  // ==================== Hero Commands ====================
  | {
      // Hire the hero. The HeroManager checks research and credits and
      // answers with hero:state-changed or hero:rejected.
      type: 'command:hire-hero';
    }
  | {
      // Send the hero to the route point nearest to `target`; the HeroManager
      // snaps it (within 30 m) and walks him there along the routes.
      type: 'command:hero-move';
      target: { lat: number; lon: number; height?: number };
    }
  | {
      // Load the hero's ammo, which is his damage type. Carries the ammo,
      // not "next", so a replay lands on the same one.
      type: 'command:hero-ammo';
      ammo: HeroAmmoId;
    };
