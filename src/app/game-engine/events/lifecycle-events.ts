/** Enemies, towers, combat, damage over time, waves, the game (part of GameEvent, game-event-bus.ts). */
import type { Enemy } from '../../entities/enemy.entity';
import type { Tower } from '../../entities/tower.entity';
import type { Projectile } from '../../entities/projectile.entity';
import type { GeoPosition } from '../../models/game.types';
import type { WormGroup } from '../../managers/worm/worm-group';
import type { LosMask } from '../../utils/los-mask';
import type { CreditsSource, LosResolveReason, KilledBy, WaveGoldBreakdown } from './event-types';

export type LifecycleEvent =
  // ==================== Enemy Lifecycle ====================
  | {
      type: 'enemy:spawned';
      enemy: Enemy;
      /**
       * Came out of its spawn portal: a wave spawn (EnemyManager.spawn with
       * 'portal'). Unset for debug placements and split children.
       */
      viaPortal?: boolean;
    }
  | {
      type: 'enemy:died';
      enemy: Enemy;
      credits: number;
      /** Who gets the kill; null when nobody does (a leak that dies on arrival). */
      killedBy: KilledBy | null;
    }
  | {
      type: 'enemy:reached-base';
      enemy: Enemy;
      damage: number;
    }
  | {
      /**
       * An enemy whose body lies along the route (the ooze) flows into the
       * base: HQ damage for the metres that went in, in whole points. Its one
       * enemy:reached-base follows once the whole body is in; until then it
       * is alive and can still be killed.
       */
      type: 'enemy:leaking';
      enemy: Enemy;
      damage: number;
    }
  | {
      /**
       * A heavy step of an enemy with EnemyTypeConfig.footstep, as its walk
       * clip lands a foot (the renderer, EnemyManager). Deferred: sound and
       * shake.
       */
      type: 'enemy:footstep';
      enemy: Enemy;
    }
  | {
      /** A killed enemy split (EnemyTypeConfig.splitOnDeath), after its enemy:died */
      type: 'enemy:split';
      /** The killed enemy */
      enemy: Enemy;
      /** What it split into, already spawned, each with its own enemy:spawned */
      children: readonly Enemy[];
    }
  | {
      /**
       * A worm (EnemyTypeConfig.chain) was spawned, after its head's
       * enemy:spawned. Its other `group.size - 1` segments follow out of the
       * portal, each with its own enemy:spawned.
       */
      type: 'worm:spawned';
      head: Enemy;
      group: WormGroup;
      /**
       * A wave worm out of its spawn portal, as on enemy:spawned. Its
       * segments' own enemy:spawned carry no viaPortal: they come out one by
       * one as the chain moves.
       */
      viaPortal?: boolean;
    }

  // ==================== Tower Lifecycle ====================
  | {
      type: 'tower:placed';
      tower: Tower;
      position: GeoPosition;
      cost: number;
    }
  | {
      type: 'tower:upgraded';
      tower: Tower;
      level: number;
      cost: number;
      /** The branch that was upgraded, so the run log can tell them apart. */
      upgradeId: string;
    }
  | {
      /**
       * A tower's line of sight was resolved against its cube: at placement,
       * after a range upgrade, or when research gave it air targets (drained
       * from the game loop, one tower per frame). `mask` is the whole result,
       * what a snapshot or re-simulation applies instead of a cube.
       */
      type: 'tower:los-resolved';
      towerId: string;
      mask: LosMask;
      reason: LosResolveReason;
    }
  | {
      type: 'tower:sold';
      tower: Tower;
      refund: number;
    }
  | {
      type: 'tower:selected';
      tower: Tower;
    }
  | {
      type: 'tower:deselected';
    }
  | {
      // Nach jedem Kill, der einem Tower gutgeschrieben wird (combat.kills ist
      // schon erhöht). Tower sind mutable Entities; die Sidebar zeichnet ihre
      // Kill-Anzeige über dieses Event neu.
      type: 'tower:kill';
      tower: Tower;
    }
  | {
      /**
       * The player got into a tower or out of it (TowerLifecycle.man,
       * docs/TOWER_CONTROL.md); null when nobody sits in one any more.
       */
      type: 'tower:manned';
      towerId: string | null;
      /** Who got in or out (docs/COOP_PLAN.md, D12) */
      playerId: string;
      /** The player at this client: their camera and HUD follow */
      local: boolean;
    }
  | {
      /**
       * A manned tower fired: at `target`, or a miss when null (muzzle flash
       * and sound, no projectile). Deferred, for the crosshair's feedback.
       */
      type: 'tower:manual-shot';
      towerId: string;
      target: Enemy | null;
    }

  // ==================== Combat Events ====================
  | {
      type: 'projectile:hit';
      projectile: Projectile;
      target: Enemy;
      damage: number;
      damageType: import('../../configs/combat/combat.types').DamageType;
    }
  // ==================== DOT Events ====================
  | {
      type: 'dot:damage';
      enemy: Enemy;
      damage: number;
      sourceId: string;
      effectType: 'poison' | 'burn';
      damageType: import('../../configs/combat/combat.types').DamageType;
    }

  // ==================== Wave Events ====================
  | {
      type: 'wave:started';
      wave: number;
      enemyCount: number;
    }
  | {
      type: 'wave:completed';
      wave: number;
      /** The completion gold that was actually booked, bonuses included. */
      credits: number;
      /** How that gold came about, for the run log and the debug window. */
      creditsBreakdown?: WaveGoldBreakdown;
      /** True wenn keine HP in dieser Wave verloren wurde (triggers PerfectBonus) */
      perfect: boolean;
      /** True wenn HP am Wave-Ende <= closeCallHpThreshold (triggers CloseCallBonus) */
      closeCall: boolean;
      /** Anzahl HP die in dieser Wave verloren wurde (0 wenn perfect) */
      hpLost: number;
    }
  | {
      /**
       * Dev cheat: the counter moved on between waves without the skipped
       * waves being played (GameStateManager.jumpToWave). `from` is the last
       * wave played, `wave` the next one to start; `credits` what the skipped
       * waves paid, 0 without the gold grant.
       */
      type: 'wave:jumped';
      from: number;
      wave: number;
      skipped: number;
      credits: number;
    }

  // ==================== Game State Events ====================
  | {
      type: 'game:started';
    }
  | {
      type: 'game:over';
      reason: 'base-destroyed' | 'quit';
    }
  | {
      type: 'game:reset';
    }
  | {
      /**
       * The simulation was put back to a snapshot (docs/SIMULATOR_PLAN.md,
       * P4) without the events that got it there. What shows the state is
       * set anew by GameStateManager.resyncPresentation. `reason` says whether
       * a replay is starting a wave or giving the live game back.
       */
      type: 'sim:restored';
      reason: 'replay' | 'live';
    }
  | {
      type: 'credits:changed';
      /** The new total of the player's account */
      credits: number;
      delta: number;
      source: CreditsSource;
      /** Whose account (docs/COOP_PLAN.md, D6) */
      playerId: string;
      /** The account of the player at this client, the one the UI shows */
      local: boolean;
    }
  | {
      type: 'health:changed';
      health: number;
      delta: number;
    };
