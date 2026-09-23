import { Vector3 } from 'three';
import { Enemy } from '../entities/enemy.entity';
import { Tower } from '../entities/tower.entity';
import { Projectile } from '../entities/projectile.entity';
import { GeoPosition } from '../models/game.types';
import { AirSubStrategy, TargetingStrategy, TowerTypeId, UpgradeId } from '../configs/tower-types.config';
import type { AbilityId, AbilityRejectReason, AbilityStatus } from '../configs/abilities.config';
import type { HeroAmmoId, HeroRejectReason, HeroStatus } from '../configs/hero.config';
import { WaveConfig } from '../managers/wave.manager';
import type { SpawnStart } from '../managers/enemy.manager';
import type { WormGroup } from '../managers/worm/worm-group';

/**
 * Game Event Type Definitions
 * Uses discriminated unions for full type-safety
 *
 * IMPORTANT: Only for broadcast events!
 * For spatial queries → use GlobalRouteGrid!
 */
/**
 * Where a gold change came from. Every booking names one, so the run log can
 * split income and spending by source without guessing from the sign
 * (docs/RUN_LOG.md).
 */
export type CreditsSource =
  | 'kill'            // an enemy died and paid its share of the wave budget
  | 'wave-bonus'      // the wave's completion gold, bonuses included
  | 'build'           // a tower was placed
  | 'upgrade'         // a tower was upgraded
  | 'sell'            // a tower was sold
  | 'research'        // a research was started
  | 'research-refund' // a running research was cancelled
  | 'hero'            // the hero was hired or re-armed
  | 'cheat'           // the dev menu handed gold out or took it away
  | 'wave-jump'       // the gold of the waves a dev jump skipped
  | 'reset';          // back to the starting gold of a new run

/** Who killed an enemy. `null` for a death nobody is credited with. */
export type KilledBy =
  | { kind: 'tower'; towerId: string }
  | { kind: 'hero' }
  | { kind: 'ability' }
  | { kind: 'debug' };

/** The parts of a wave's completion gold. */
export interface WaveGoldBreakdown {
  base: number;
  perfect: number;
  combo: number;
  closeCall: number;
  comeback: number;
  milestone: number;
}

export type GameEvent =
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
       * A heavy step of an enemy with EnemyTypeConfig.footstep, every
       * `everyM` metres it walks (EnemyManager). Deferred: sound and shake.
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

  // ==================== Combat Events ====================
  | {
      type: 'projectile:hit';
      projectile: Projectile;
      target: Enemy;
      damage: number;
      damageType: import('../configs/combat/combat.types').DamageType;
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
      type: 'credits:changed';
      credits: number;
      delta: number;
      source: CreditsSource;
    }
  | {
      type: 'health:changed';
      health: number;
      delta: number;
    }

  // ==================== DOT Events ====================
  | {
      type: 'dot:damage';
      enemy: Enemy;
      damage: number;
      sourceId: string;
      effectType: 'poison' | 'burn';
      damageType: import('../configs/combat/combat.types').DamageType;
    }

  // ==================== Research Events ====================
  | {
      type: 'research:started';
      researchId: string;
      cost: number;
      duration: number;
    }
  | {
      type: 'research:completed';
      researchId: string;
      effects: import('../configs/research/research.types').ResearchEffect[];
    }
  | {
      type: 'research:cancelled';
      researchId: string;
      refund: number;
    }
  | {
      // Snapshot-Event nach jeder ResearchManager-Mutation. Trägt den
      // vollen Active-/Completed-/Center-State, damit GameStateSyncService
      // ohne direktes ResearchManager-Polling den Store updaten kann.
      type: 'research:state-changed';
      activeResearches: import('../configs/research/research.types').ActiveResearch[];
      completedResearches: Set<import('../configs/research/research.types').ResearchId>;
      /** Waiting for a slot and the credits, in start order */
      queuedResearches: import('../configs/research/research.types').ResearchId[];
      centerLevel: number;
      maxSlots: number;
    }
  | {
      // Laufender Fortschritt: vergangene Spielzeit (s) je aktiver Forschung.
      // Der ResearchManager drosselt auf 10 Hz Wanduhr.
      type: 'research:progress';
      elapsed: ReadonlyMap<import('../configs/research/research.types').ResearchId, number>;
    }

  // ==================== Research Commands ====================
  | {
      type: 'command:start-research';
      researchId: string;
    }
  | {
      type: 'command:cancel-research';
      researchId: string;
    }
  | {
      // Player UI only: bots start researches with command:start-research,
      // which still refuses when every slot is busy.
      type: 'command:queue-research';
      researchId: string;
    }
  | {
      type: 'command:unqueue-research';
      researchId: string;
    }
  | {
      // Player UI only: reorder what is waiting. startQueued() works through
      // the queue in order, so this decides what starts next.
      type: 'command:move-queued-research';
      researchId: string;
      toIndex: number;
    }

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
    }
  | {
      type: 'ability:rejected';
      abilityId: AbilityId;
      reason: AbilityRejectReason;
    }
  | {
      // Snapshot after every AbilityManager mutation (unlock, use, impact,
      // recharge). GameStateSyncService writes it into GameStore.abilities.
      type: 'ability:state-changed';
      abilities: AbilityStatus[];
    }

  // ==================== Ability Commands ====================
  | {
      // The AbilityManager validates, snaps the target to the route and
      // answers with ability:used or ability:rejected.
      type: 'command:use-ability';
      abilityId: AbilityId;
      target: { lat: number; lon: number; height?: number };
    }

  // ==================== Hero Events ====================
  | {
      // A shot of the hero killed `enemy` (DamageApplicationService, after
      // the enemy:died of that kill). Counts toward his levels. For the
      // fairness gate it is a kill like a tower's, not a leak.
      type: 'hero:kill';
      enemy: Enemy;
    }
  | {
      // His kills took him to `level`
      type: 'hero:level-up';
      level: number;
      position: GeoPosition;
    }
  | {
      type: 'hero:rejected';
      reason: HeroRejectReason;
    }
  | {
      // Snapshot after every HeroManager mutation the UI shows (unlock, hire,
      // order, arrival, kill, ammo). GameStateSyncService writes it into
      // GameStore.hero.
      type: 'hero:state-changed';
      hero: HeroStatus;
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
    }

  // ==================== Effect Events (Deferred) ====================
  | {
      type: 'audio:play';
      sound: string;
      lat: number;
      lon: number;
      height: number;
      volume?: number;
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
    }

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
      type: 'command:start-wave';
      config?: WaveConfig;
    }
  | {
      type: 'command:restart-game';
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

/**
 * Event Map for type-safe subscriptions
 * Maps event type string to event payload type
 */
type GameEventMap = {
  [K in GameEvent['type']]: Extract<GameEvent, { type: K }>;
};

/** A handler as stored in GameEventBus.listeners: widened to the union, see on(). */
type StoredHandler = (event: GameEvent) => void;

/**
 * Subscription Handle
 * Returned by on() for manual cleanup
 */
export class EventSubscription {
  constructor(private unsubscribe: () => void) {}

  /**
   * Dispose this subscription (remove listener)
   */
  dispose(): void {
    this.unsubscribe();
  }
}

/**
 * Subscription Bag
 * Manages multiple subscriptions for easy cleanup
 */
export class SubscriptionBag {
  private subscriptions: EventSubscription[] = [];

  /**
   * Add subscription to bag
   */
  add(subscription: EventSubscription): void {
    this.subscriptions.push(subscription);
  }

  /**
   * Dispose all subscriptions in bag
   */
  disposeAll(): void {
    this.subscriptions.forEach((sub) => sub.dispose());
    this.subscriptions = [];
  }

  /**
   * Get number of subscriptions in bag
   */
  get size(): number {
    return this.subscriptions.length;
  }
}

/**
 * Performance Metrics
 */
interface EventBusMetrics {
  eventsEmitted: number;
  eventsDeferred: number;
  listenerCalls: number;
  queueSize: number;
  listenerCount: number;
}

/**
 * Type-Safe Game Event Bus
 *
 * Framework-agnostic event system for game events.
 * Uses discriminated unions for full type-safety.
 *
 * Features:
 * - Type-safe with TypeScript discriminated unions
 * - Immediate and deferred event dispatch
 * - WeakMap-based automatic cleanup
 * - ~50-100ns per event (estimated)
 * - Zero framework dependencies
 *
 * IMPORTANT: Only use for broadcast events!
 * For spatial queries (tower targeting, AOE damage) → GlobalRouteGrid!
 *
 * @example
 * ```typescript
 * const eventBus = new GameEventBus();
 *
 * // Subscribe
 * eventBus.on('enemy:died', (event) => {
 *   console.log(`Enemy died, reward: ${event.credits}`);
 * });
 *
 * // Emit immediate event
 * eventBus.emit({
 *   type: 'enemy:died',
 *   enemy,
 *   credits: 100,
 *   position: enemy.position
 * });
 *
 * // Emit deferred event (queued)
 * eventBus.emitDeferred({
 *   type: 'audio:play',
 *   sound: 'explosion'
 * });
 *
 * // Process queue (once per frame)
 * eventBus.processQueue();
 * ```
 */
export class GameEventBus {
  /** Map of event types to their listener sets */
  private listeners = new Map<GameEvent['type'], Set<StoredHandler>>();

  /** Queue for deferred events (processed at stable point in game loop) */
  private deferredQueue: GameEvent[] = [];

  /** WeakMap tracking subscriptions per owner for automatic cleanup */
  private ownerSubscriptions = new WeakMap<object, Set<EventSubscription>>();

  /** Performance metrics (optional) */
  private metrics = {
    eventsEmitted: 0,
    eventsDeferred: 0,
    listenerCalls: 0,
  };

  /** Enable/disable metrics tracking */
  private metricsEnabled = false;

  /** Debug listeners that receive ALL events (for debug panel) */
  /** Catch-all listeners (onAny); a new array on every change, so an emit under way keeps its list */
  private debugListeners: readonly ((event: GameEvent) => void)[] = [];

  /**
   * Subscribe to ALL events (for debugging/monitoring)
   *
   * @param handler - Handler that receives all events
   * @returns Subscription handle for cleanup
   *
   * @example
   * ```typescript
   * const subscription = eventBus.onAny((event) => {
   *   console.log(event.type, event);
   * });
   * ```
   */
  onAny(handler: (event: GameEvent) => void): EventSubscription {
    this.debugListeners = [...this.debugListeners, handler];
    return new EventSubscription(() => {
      const list = this.debugListeners;
      const at = list.indexOf(handler);
      if (at >= 0) this.debugListeners = [...list.slice(0, at), ...list.slice(at + 1)];
    });
  }

  /**
   * Subscribe to event (type-safe)
   *
   * @param eventType - Event type to listen for
   * @param handler - Handler function (receives typed event payload)
   * @returns Subscription handle for manual cleanup
   *
   * @example
   * ```typescript
   * const subscription = eventBus.on('enemy:died', (event) => {
   *   console.log(event.enemy.id, event.credits);
   * });
   *
   * // Later: cleanup
   * subscription.dispose();
   * ```
   */
  on<T extends GameEvent['type']>(
    eventType: T,
    handler: (event: GameEventMap[T]) => void
  ): EventSubscription {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, new Set());
    }

    // Widening is safe: the set under eventType only receives events of that type.
    this.listeners.get(eventType)!.add(handler as StoredHandler);

    return new EventSubscription(() => this.off(eventType, handler));
  }

  /**
   * Unsubscribe from event
   *
   * @param eventType - Event type
   * @param handler - Handler to remove
   */
  off<T extends GameEvent['type']>(
    eventType: T,
    handler: (event: GameEventMap[T]) => void
  ): void {
    this.listeners.get(eventType)?.delete(handler as StoredHandler);
  }

  /**
   * Emit event immediately (blocking)
   *
   * Use for critical events that need immediate handling:
   * - enemy:died (credits must update immediately)
   * - projectile:hit (damage must apply immediately)
   * - game:over (game must stop immediately)
   *
   * @param event - Event to emit
   *
   * @example
   * ```typescript
   * eventBus.emit({
   *   type: 'enemy:died',
   *   enemy,
   *   credits: 100,
   *   position: enemy.position
   * });
   * ```
   */
  /** Listeners on the catch-all path (onAny); with none, emit skips it. */
  get catchAllListenerCount(): number {
    return this.debugListeners.length;
  }

  emit<T extends GameEvent['type']>(event: GameEventMap[T]): void {
    if (this.metricsEnabled) {
      this.metrics.eventsEmitted++;
    }

    // Catch-all listeners (event debugger, replay recorder while it records a
    // wave). With none attached the loop ends at once, the hot path. A plain
    // loop over the array, no closure per event (the list is replaced, never
    // changed, so one that leaves during the event skips nobody); isolated
    // like the typed listeners below, so a throwing one neither aborts the
    // emit nor keeps the event from the game's handlers
    for (const handler of this.debugListeners) {
      try {
        handler(event as GameEvent);
      } catch (err) {
        console.error(`[GameEventBus] Catch-all listener threw on '${event.type}':`, err);
      }
    }

    const handlers = this.listeners.get(event.type);
    if (handlers && handlers.size > 0) {
      handlers.forEach((handler) => {
        if (this.metricsEnabled) {
          this.metrics.listenerCalls++;
        }
        // Isolate handler failures: a throwing listener must not abort the
        // remaining subscribers of the same event (e.g. a VFX handler error
        // must not skip the credits/health state updates).
        try {
          handler(event);
        } catch (err) {
          console.error(`[GameEventBus] Handler for '${event.type}' threw:`, err);
        }
      });
    }
  }

  /**
   * Emit event deferred (queued)
   *
   * Use for non-critical events that can wait 1 frame:
   * - audio:play (audio can wait 16ms)
   * - vfx:* (VFX can wait 1 frame)
   *
   * Events are processed at stable point in game loop via processQueue()
   *
   * @param event - Event to queue
   *
   * @example
   * ```typescript
   * eventBus.emitDeferred({
   *   type: 'audio:play',
   *   sound: 'explosion',
   *   position: explosionPos
   * });
   * ```
   */
  emitDeferred<T extends GameEvent['type']>(event: GameEventMap[T]): void {
    if (this.metricsEnabled) {
      this.metrics.eventsDeferred++;
    }
    this.deferredQueue.push(event);
  }

  /**
   * Process all deferred events
   *
   * Call once per frame at stable point (after game logic, before rendering)
   *
   * @example
   * ```typescript
   * // In game loop
   * update(deltaTime: number) {
   *   // 1. Update game logic
   *   this.enemyManager.update(deltaTime);
   *   this.towerManager.update(deltaTime);
   *
   *   // 2. Process deferred events at stable point
   *   this.eventBus.processQueue();
   * }
   * ```
   */
  processQueue(): void {
    // Index-walk instead of shift() (O(n) per element → O(n²)). Re-read
    // this.deferredQueue each iteration (don't capture it) so a re-entrant
    // reset that swaps the array reference can't make us drain/clear the wrong
    // one. Events that emit() enqueues during processing extend the same array
    // and are still drained this call, preserving drain-until-empty semantics.
    let i = 0;
    while (i < this.deferredQueue.length) {
      this.emit(this.deferredQueue[i++]);
    }
    this.deferredQueue.length = 0;
  }

  /**
   * Subscribe with automatic cleanup when owner is destroyed
   *
   * Subscriptions are tracked in WeakMap per owner.
   * Call unsubscribeAll(owner) in destroy/cleanup methods.
   *
   * @param owner - Owner object (e.g., Tower, Enemy, Manager)
   * @param eventType - Event type to listen for
   * @param handler - Handler function
   *
   * @example
   * ```typescript
   * class Tower {
   *   constructor(private eventBus: GameEventBus) {
   *     // Subscribe with 'this' as owner
   *     this.eventBus.subscribe(this, 'enemy:died', (event) => {
   *       if (this.targetEnemy === event.enemy) {
   *         this.clearTarget();
   *       }
   *     });
   *   }
   *
   *   destroy() {
   *     // Cleanup all subscriptions
   *     this.eventBus.unsubscribeAll(this);
   *   }
   * }
   * ```
   */
  subscribe<T extends GameEvent['type']>(
    owner: object,
    eventType: T,
    handler: (event: GameEventMap[T]) => void
  ): void {
    const subscription = this.on(eventType, handler);

    if (!this.ownerSubscriptions.has(owner)) {
      this.ownerSubscriptions.set(owner, new Set());
    }

    this.ownerSubscriptions.get(owner)!.add(subscription);
  }

  /**
   * Unsubscribe all events for owner
   *
   * Call in destroy/cleanup methods to prevent memory leaks
   *
   * @param owner - Owner to unsubscribe
   */
  unsubscribeAll(owner: object): void {
    const subscriptions = this.ownerSubscriptions.get(owner);
    if (subscriptions) {
      subscriptions.forEach((sub) => sub.dispose());
      this.ownerSubscriptions.delete(owner);
    }
  }

  /**
   * Clear all listeners and queued events
   * Use for testing or full reset
   */
  clear(): void {
    this.listeners.clear();
    this.deferredQueue = [];
  }

  /**
   * Enable performance metrics tracking
   */
  enableMetrics(): void {
    this.metricsEnabled = true;
  }

  /**
   * Get performance metrics
   *
   * @returns Metrics object
   */
  getMetrics(): EventBusMetrics {
    return {
      ...this.metrics,
      queueSize: this.deferredQueue.length,
      listenerCount: this.getListenerCount(),
    };
  }

  /**
   * Reset performance metrics
   */
  resetMetrics(): void {
    this.metrics = {
      eventsEmitted: 0,
      eventsDeferred: 0,
      listenerCalls: 0,
    };
  }

  /**
   * Get listener count
   *
   * @param eventType - Optional event type to count (all if omitted)
   * @returns Number of listeners
   */
  getListenerCount(eventType?: GameEvent['type']): number {
    if (eventType) {
      return this.listeners.get(eventType)?.size ?? 0;
    }

    let total = 0;
    this.listeners.forEach((handlers) => (total += handlers.size));
    return total;
  }

  /**
   * Get queue size (for debugging)
   */
  getQueueSize(): number {
    return this.deferredQueue.length;
  }

  /**
   * Check if any listeners are registered for event type
   */
  hasListeners(eventType: GameEvent['type']): boolean {
    const handlers = this.listeners.get(eventType);
    return handlers ? handlers.size > 0 : false;
  }
}
