/** Commands from the UI to the game engine (part of GameEvent, game-event-bus.ts). */
import type { AirSubStrategy, TargetingStrategy, TowerTypeId, UpgradeId } from '../../configs/tower-types.config';
import type { WaveConfig } from '../../managers/wave.manager';
import type { WaveConfig as DirectorWave } from '../../director/models/wave-config';
import type { LosResolveReason } from './event-types';

export type CommandEvent =
  // ==================== Command Events (UI → Game Engine) ====================
  | {
      type: 'command:place-tower';
      /** height: the tower's foot, on uneven ground the top of its plinth */
      position: { lat: number; lon: number; height?: number };
      typeId: TowerTypeId;
      rotation?: number;
      /** Stone plinth below the foot, from the lowest point of the footprint (m); 0 or missing = none */
      plinthHeight?: number;
      /** Footprint probes the plinth hangs over a drop at (TowerFootprint.overhang), braced there; missing = none */
      plinthOverhang?: readonly number[];
    }
  | {
      type: 'command:sell-tower';
      towerId: string;
    }
  | {
      type: 'command:upgrade-tower';
      towerId: string;
      upgradeId: UpgradeId;
    }
  | {
      /** Targeting of a tower; a field left out keeps its value */
      type: 'command:set-targeting';
      towerId: string;
      strategy?: TargetingStrategy;
      airSubStrategy?: AirSubStrategy;
    }
  | {
      /** Hold fire of a tower on or off (Tower.holdFire); a passive tower ignores it */
      type: 'command:set-hold-fire';
      towerId: string;
      holdFire: boolean;
    }
  | {
      /** Get into a tower and aim it by hand; a tower that cannot be manned ignores it */
      type: 'command:man-tower';
      towerId: string;
    }
  | {
      /** Get out of the manned tower; it fires by itself again */
      type: 'command:leave-tower';
    }
  | {
      /** Trigger of the manned tower pressed or let go */
      type: 'command:tower-trigger';
      held: boolean;
    }
  | {
      /**
       * Where the player aims from the manned tower (Tower.manualAim): heading
       * (geoHeading convention) and pitch (up positive), rad. Sent only when
       * the mouse moved it, at most once a frame
       */
      type: 'command:tower-aim';
      heading: number;
      pitch: number;
    }
  | {
      type: 'command:start-wave';
      config?: WaveConfig;
      /**
       * A wave from the wave source, not yet turned into a spawn schedule. The
       * schedule draws from the run's spawn stream; built where the command
       * acts, every coop client draws the same (docs/COOP_PLAN.md, C0).
       */
      director?: DirectorWave;
    }
  | {
      type: 'command:restart-game';
      /** The new run's seed; coop gives one so every client starts the same run, alone a fresh one is drawn */
      seed?: number;
    }
  | {
      /**
       * Coop: the host's line of sight for a tower (docs/COOP_PLAN.md, C3),
       * applied by every client at the tick it comes back
       */
      type: 'command:los-mask';
      towerId: string;
      reason: LosResolveReason;
      mask: import('../../utils/los-mask').LosMaskJson;
    }
  | {
      /** Coop: the giving player left the game; the relay puts it in a tick for them (docs/COOP_PLAN.md, C4) */
      type: 'command:leave-game';
    }
  | {
      /** Coop: a player left the game, their lane is closed */
      type: 'coop:player-left';
      playerId: string;
      /** Their place in the roster */
      index: number;
      local: boolean;
    }
  | {
      /** Coop: the giving player is ready for the next wave, or no longer (docs/COOP_PLAN.md, D15) */
      type: 'command:set-ready';
      ready: boolean;
    }
  | {
      /** Coop: the giving player sends `amount` of their gold to player `to` */
      type: 'command:give-credits';
      to: string;
      amount: number;
    }
  | {
      /** Coop: gold went from one player to another (command:give-credits) */
      type: 'coop:credits-given';
      from: string;
      to: string;
      amount: number;
      /** The gold came to the player at this client */
      toLocal: boolean;
    }
  | {
      /** Coop: a player's readiness for the next wave changed; `allReady` once everybody is */
      type: 'coop:ready-changed';
      playerId: string;
      ready: boolean;
      local: boolean;
      allReady: boolean;
    };
