import type { LifecycleEvent } from './events/lifecycle-events';
import type { ResearchEvent } from './events/research-events';
import type { AbilityEvent } from './events/ability-events';
import type { HeroEvent } from './events/hero-events';
import type { EffectEvent } from './events/effect-events';
import type { CommandEvent } from './events/command-events';
import type { DebugEvent } from './events/debug-events';

/**
 * Game Event Type Definitions
 * Uses discriminated unions for full type-safety
 *
 * IMPORTANT: Only for broadcast events!
 * For spatial queries → use GlobalRouteGrid!
 */
export type { CreditsSource, LosResolveReason, KilledBy, WaveGoldBreakdown } from './events/event-types';
export type { LifecycleEvent, ResearchEvent, AbilityEvent, HeroEvent, EffectEvent, CommandEvent, DebugEvent };

export type GameEvent =
  | LifecycleEvent
  | ResearchEvent
  | AbilityEvent
  | HeroEvent
  | EffectEvent
  | CommandEvent
  | DebugEvent;

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

  /** See onLive() */
  private liveMuted = false;
  /** See onShow() */
  private showMuted = false;

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
   * Subscribe a listener that follows the live game only: while a replay
   * re-simulates a wave (setLiveMuted), it hears nothing. For what records
   * the run or mirrors it (run log, director history, stores, best wave,
   * bot, boss intro, hints): the re-simulation sends the same events as the
   * game, kills, credits and wave ends included, and none of that may count
   * twice or move the live UI (docs/SIMULATOR_PLAN.md, P6). VFX, audio and
   * screen shake subscribe with on(): they are what the replay shows.
   * Same place in the order as on().
   */
  onLive<T extends GameEvent['type']>(
    eventType: T,
    handler: (event: GameEventMap[T]) => void
  ): EventSubscription {
    return this.on(eventType, (event) => {
      if (!this.liveMuted) handler(event);
    });
  }

  /**
   * Subscribe a listener that shows the game (VFX, sounds, music, screen
   * shake, the blood moon look). It hears the live game and a replay alike,
   * but not while a replay seeks (setShowMuted): the fast-forward to the
   * point sought runs thousands of sub-steps in one frame, and their sounds
   * and effects all at once would be noise, not a picture. Same place in the
   * order as on().
   */
  onShow<T extends GameEvent['type']>(
    eventType: T,
    handler: (event: GameEventMap[T]) => void
  ): EventSubscription {
    return this.on(eventType, (event) => {
      if (!this.showMuted) handler(event);
    });
  }

  /** See onShow(): true while a replay fast-forwards. */
  setShowMuted(muted: boolean): void {
    this.showMuted = muted;
  }

  /** See onLive(): true while a replay re-simulates. */
  setLiveMuted(muted: boolean): void {
    this.liveMuted = muted;
  }

  get isLiveMuted(): boolean {
    return this.liveMuted;
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
  /** Events waiting for the next processQueue(), see emitDeferred */
  get hasDeferred(): boolean {
    return this.deferredQueue.length > 0;
  }

  /**
   * Drop the events waiting for processQueue(). A snapshot restore does: an
   * event the state before it sent (a replayed wave's wave:completed) must
   * not reach the state after it.
   */
  clearDeferred(): void {
    this.deferredQueue.length = 0;
  }

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
