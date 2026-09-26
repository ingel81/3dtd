/** Abilities: what happened and the commands (part of GameEvent, game-event-bus.ts). */
import type { GeoPosition } from '../../models/game.types';
import type { AbilityId, AbilityRejectReason, AbilityStatus } from '../../configs/abilities.config';

export type AbilityEvent =
  // ==================== Ability Events ====================
  | {
      // A strike is on its way: the charge is spent, the impact lands
      // `warningMs` of game time later on `target`, already snapped to the
      // route. Drives the target marker.
      type: 'ability:used';
      abilityId: AbilityId;
      strikeId: number;
      target: GeoPosition;
      radiusM: number;
      warningMs: number;
      /** A beam: the route stretch it will burn along, from `target` toward the spawn */
      path?: readonly GeoPosition[];
      /**
       * A strike fired from a building (the nuclear strike from the missile
       * silo): the tower id of that building and its base position, `height`
       * the top of its plinth. The missile leaves there at the command and
       * lands on `target` after `warningMs`.
       */
      launch?: { towerId: string; position: GeoPosition };
      /** Whose ability (docs/COOP_PLAN.md, D11) */
      playerId: string;
      /** The ability of the player at this client, the one the UI shows */
      local: boolean;
    }
  | {
      // The strike landed: drives its effects, sound and screen shake. A
      // beam starts burning here and resolves when it is done.
      type: 'ability:impact';
      abilityId: AbilityId;
      strikeId: number;
      target: GeoPosition;
      radiusM: number;
      /** A beam: the route stretch it burns along, as in ability:used */
      path?: readonly GeoPosition[];
      /** Whose ability (docs/COOP_PLAN.md, D11) */
      playerId: string;
      /** The ability of the player at this client, the one the UI shows */
      local: boolean;
    }
  | {
      // The strike is over, it hits and kills nothing more. `kills` count
      // as leaks for the fairness gate (LeakController), `hits` includes the
      // survivors. Right after ability:impact for a strike that acts at once.
      type: 'ability:resolved';
      abilityId: AbilityId;
      strikeId: number;
      hits: number;
      kills: number;
      /** Whose ability (docs/COOP_PLAN.md, D11) */
      playerId: string;
      /** The ability of the player at this client, the one the UI shows */
      local: boolean;
    }
  | {
      type: 'ability:rejected';
      abilityId: AbilityId;
      reason: AbilityRejectReason;
      /** Whose ability (docs/COOP_PLAN.md, D11) */
      playerId: string;
      /** The ability of the player at this client, the one the UI shows */
      local: boolean;
    }
  | {
      // Snapshot after every AbilityManager mutation (unlock, use, impact,
      // recharge). GameStateSyncService writes it into GameStore.abilities.
      type: 'ability:state-changed';
      abilities: AbilityStatus[];
      /** Sent by a snapshot restore or a replay's seek: a new baseline, no change the player made */
      restored?: true;
      /** Whose ability (docs/COOP_PLAN.md, D11) */
      playerId: string;
      /** The ability of the player at this client, the one the UI shows */
      local: boolean;
    }

  // ==================== Ability Commands ====================
  | {
      // The AbilityManager validates, snaps the target to the route and
      // answers with ability:used or ability:rejected.
      type: 'command:use-ability';
      abilityId: AbilityId;
      target: { lat: number; lon: number; height?: number };
    };
