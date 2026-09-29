/** Effects the renderer plays after the step (deferred) (part of GameEvent, game-event-bus.ts). */
import type { Vector3 } from 'three';

export type EffectEvent =
  // ==================== Effect Events (Deferred) ====================
  | {
      type: 'audio:play';
      sound: string;
      lat: number;
      lon: number;
      height: number;
      volume?: number;
      /**
       * Played where the listener is instead of at lat/lon: heard without a
       * direction, as the shots of the tower the player sits in
       * (docs/TOWER_CONTROL.md). The limits of a one-shot still apply.
       */
      atListener?: boolean;
    }
  | {
      type: 'vfx:blood';
      position: Vector3;
      intensity: number;
      skipGroundDecal?: boolean;
      /** Colour as hex (EnemyTypeConfig.bloodColor); red when unset */
      color?: number;
    }
  | {
      type: 'vfx:projectile-impact';
      lat: number;
      lon: number;
      height: number;
      projectileType: string;
      targetLost: boolean; // true = ground impact, false = enemy hit
    }
  | {
      type: 'vfx:muzzle-flash';
      towerId: string;
      towerTypeId: string;
    }
  | {
      /**
       * Chain-lightning visual fired by Lightning Tower. `points` is the chain
       * polyline in local-space (length 2..(maxJumps+1)): first point is the
       * tower tip, subsequent points are hit positions in jump order.
       */
      type: 'vfx:chain-lightning';
      points: { x: number; y: number; z: number }[];
      sourceTowerId: string;
    };
