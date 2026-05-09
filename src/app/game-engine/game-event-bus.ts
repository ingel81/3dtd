import { Vector3 } from 'three';
import { Enemy } from '../entities/enemy.entity';
import { Tower } from '../entities/tower.entity';
import { Projectile } from '../entities/projectile.entity';
import { GeoPosition } from '../models/game.types';
import { TowerTypeId, UpgradeId } from '../configs/tower-types.config';
import { WaveConfig } from '../managers/wave.manager';

/**
 * Game Event Type Definitions
 * Uses discriminated unions for full type-safety
 *
 * IMPORTANT: Only for broadcast events!
 * For spatial queries → use GlobalRouteGrid!
 */
export type GameEvent =
  // ==================== Enemy Lifecycle ====================
  | {
      type: 'enemy:spawned';
      enemy: Enemy;
    }
  | {
      type: 'enemy:died';
      enemy: Enemy;
      credits: number;
    }
  | {
      type: 'enemy:reached-base';
      enemy: Enemy;
      damage: number;
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
      credits: number;
      /** True wenn keine HP in dieser Wave verloren wurde (triggers PerfectBonus) */
      perfect: boolean;
      /** True wenn HP am Wave-Ende <= closeCallHpThreshold (triggers CloseCallBonus) */
      closeCall: boolean;
      /** Anzahl HP die in dieser Wave verloren wurde (0 wenn perfect) */
      hpLost: number;
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
      effectType: 'poison';
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
      centerLevel: number;
      maxSlots: number;
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
    }
  | {
      type: 'vfx:explosion';
      position: Vector3;
      radius: number;
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
      position: { lat: number; lon: number; height?: number };
      typeId: TowerTypeId;
      rotation?: number;
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
      type: 'debug:toggle-movement';
      enabled: boolean;
    }
  | {
      type: 'debug:remove-enemy';
      enemyId: string;
    }
  | {
      type: 'debug:clear-enemies';
    };

/**
 * Event Map for type-safe subscriptions
 * Maps event type string to event payload type
 */
type GameEventMap = {
  [K in GameEvent['type']]: Extract<GameEvent, { type: K }>;
};

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private listeners = new Map<GameEvent['type'], Set<(event: any) => void>>();

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
  private debugListeners = new Set<(event: GameEvent) => void>();

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
    this.debugListeners.add(handler);
    return new EventSubscription(() => this.debugListeners.delete(handler));
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

    this.listeners.get(eventType)!.add(handler);

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
    this.listeners.get(eventType)?.delete(handler);
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
  emit<T extends GameEvent['type']>(event: GameEventMap[T]): void {
    if (this.metricsEnabled) {
      this.metrics.eventsEmitted++;
    }

    // Notify debug listeners (catch-all)
    this.debugListeners.forEach((handler) => handler(event as GameEvent));

    const handlers = this.listeners.get(event.type);
    if (handlers && handlers.size > 0) {
      handlers.forEach((handler) => {
        if (this.metricsEnabled) {
          this.metrics.listenerCalls++;
        }
        handler(event);
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
    while (this.deferredQueue.length > 0) {
      const event = this.deferredQueue.shift()!;
      this.emit(event);
    }
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
   * Disable performance metrics tracking
   */
  disableMetrics(): void {
    this.metricsEnabled = false;
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
