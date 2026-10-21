/** The dev tools: what happened and the commands (part of GameEvent, game-event-bus.ts). */
import type { GeoPosition } from '../../models/game.types';
import type { AbilityId } from '../../configs/abilities.config';
import type { SpawnStart } from '../../managers/enemy.manager';
import type { DebugBlast, StructureStage } from '../../configs/destruction.config';

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
      // Take `amount` off the structures of a destructible world within `reach` m of a point (TODO E131)
      type: 'debug:hit-structures';
      lat: number;
      lon: number;
      reach: number;
      amount: number;
    }
  | {
      // Dig a crater of `radius` m `depth` cm deeper at a point of a world that takes craters (docs/DESTRUCTION_PLAN.md)
      type: 'debug:dig-crater';
      lat: number;
      lon: number;
      radius: number;
      depth: number;
    }
  | {
      // The destruction tool: `blast` goes off at a point of a destructible world as the real one does
      // (WorldDamage.debugBlast), at `height` for its show (docs/DESTRUCTION_PLAN.md). `radius` m (E284):
      // the nuclear strike's instead of its own, within DEBUG_BLAST_RADIUS (destruction.config.ts)
      type: 'debug:blast';
      lat: number;
      lon: number;
      height: number;
      blast: DebugBlast;
      radius?: number;
    }
  | {
      // The destruction tool: structure `index` (run rules' order) to `stage`, pushed from the point (lat, lon)
      // (WorldDamage.debugSetStage): worse by damage, better mended
      type: 'debug:set-structure-stage';
      index: number;
      stage: StructureStage;
      lat: number;
      lon: number;
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
      // Between waves; asked for during a wave it waits for its end, see GameStateManager.jumpToWave.
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
    }
  | {
      /**
       * Enemy Debug: walk or run, stop or start moving (Enemy.setRunning,
       * startMoving, stopMoving). The main thread shows the clip.
       */
      type: 'debug:enemy-move';
      enemyId: string;
      action: 'walk' | 'run' | 'start' | 'stop';
    }
  | {
      /** Enemy Debug: base speed of one enemy, or of every enemy when enemyId is absent (movement.speedMps) */
      type: 'debug:enemy-speed';
      enemyId?: string;
      speedMps: number;
    }
  | {
      /** Display option: enemies stand still (EnemyManager.movementEnabled) */
      type: 'debug:movement';
      enabled: boolean;
    };
