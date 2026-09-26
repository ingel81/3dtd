/** The dev tools: what happened and the commands (part of GameEvent, game-event-bus.ts). */
import type { GeoPosition } from '../../models/game.types';
import type { AbilityId } from '../../configs/abilities.config';
import type { SpawnStart } from '../../managers/enemy.manager';

export type DebugEvent =
  // ==================== Debug Events ====================
  | {
      type: 'debug:sound';
      eventType: 'play' | 'stop' | 'budget_exceeded' | 'pool_exhausted' | 'distance_culled';
      soundId: string;
      timestamp: number;
      details?: string;
    }
  | {
      type: 'debug:start-custom-wave';
    }
  | {
      type: 'debug:spawn-enemy';
      enemyType: string;
      count?: number;
      path?: GeoPosition[];
      /** Part-way along `path` instead of on path[0] (enemy debugger placement) */
      start?: SpawnStart;
      speed?: number;
      paused?: boolean;
      health?: number;
    }
  | {
      type: 'debug:kill-all';
    }
  | {
      /** The debug kill-all has acted: nothing of the wave is left, the enemies still to spawn included */
      type: 'wave:cleared';
    }
  // ==================== Debug Command Events ====================
  | {
      type: 'debug:add-credits';
      amount: number;
    }
  | {
      type: 'debug:add-health';
      amount: number;
    }
  | {
      type: 'debug:complete-all-research';
    }
  | {
      type: 'debug:max-upgrade-all-towers';
    }
  | {
      // The ability's research with its prerequisites done, every charge
      // back. Sent deferred, so it lands in a gameplay sub-step.
      type: 'debug:ready-ability';
      abilityId: AbilityId;
    }
  | {
      // The next wave to start is `wave`, the ones before it are skipped.
      // Between waves only, see GameStateManager.jumpToWave.
      type: 'debug:jump-to-wave';
      wave: number;
      /** Pay what the skipped waves would have paid, see skippedWavesGold */
      grantGold: boolean;
    }
  | {
      // The hero's research with its prerequisites done and the hero hired
      // for free. Sent deferred, so it lands in a gameplay sub-step.
      type: 'debug:ready-hero';
    }
  | {
      type: 'debug:remove-enemy';
      enemyId: string;
    };
