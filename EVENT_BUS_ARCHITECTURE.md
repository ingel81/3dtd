# Event Bus Architecture - Hybrid System

**Erstellt:** 2026-01-19
**Status:** Final Design (Ready for Implementation)

---

## Executive Summary

Nach Analyse des existierenden **GlobalRouteGrid** Systems ist klar:

**Event Bus ≠ Spatial Queries!**

Wir brauchen einen **Hybrid-Ansatz:**
1. **Event Bus** für zeitliche Broadcast-Events (enemy:died, game:over)
2. **Spatial Grid** für räumliche Queries (tower targeting, AOE damage)

❌ **Nicht mischen!** Events sind **NICHT** für räumliche Discovery gedacht.

---

## Core Principles

### 1. Event Bus: Für "Was ist passiert?"

**Use Cases:**
- State Changes die viele Systeme interessieren
- Asynchrone Kommunikation (Audio, VFX, UI)
- Lifecycle Events (spawn, death, completion)
- Credits/Resources (add, subtract, update)

**Eigenschaften:**
- **Broadcast** - 1:N Kommunikation
- **Temporal** - Beschreibt Zeitpunkte
- **Decoupled** - Sender kennt Empfänger nicht

### 2. Spatial Grid: Für "Wo ist was?"

**Use Cases:**
- Tower Targeting (enemies in LOS)
- AOE Damage (enemies in radius)
- Placement Validation (tower placement checks)
- Enemy Pathfinding (cell traversal)

**Eigenschaften:**
- **Query-based** - Pull statt Push
- **Spatial** - Beschreibt Positionen
- **Indexed** - O(cells) statt O(all_entities)

---

## Architecture Layers

```
┌─────────────────────────────────────────────────┐
│ UI Layer (Angular)                              │
│ - Components, Signals, Observables              │
└──────────────┬──────────────────────────────────┘
               │ GameEngineService (Adapter)
               ↓
┌─────────────────────────────────────────────────┐
│ GAME ENGINE (Framework-agnostic)                │
│                                                  │
│ ┌─────────────────────────────────────────────┐ │
│ │ GameEngine (Orchestrator)                   │ │
│ │ - Main Loop                                 │ │
│ │ - System Coordination                       │ │
│ └─────────────────────────────────────────────┘ │
│                                                  │
│ ┌───────────────┐     ┌──────────────────────┐ │
│ │ GameEventBus  │     │ GlobalRouteGrid      │ │
│ │ (Broadcast)   │     │ (Spatial Queries)    │ │
│ │               │     │                      │ │
│ │ - emit()      │     │ - registerTower()    │ │
│ │ - on()        │     │ - getEnemiesFor...() │ │
│ │ - off()       │     │ - getEnemiesIn...()  │ │
│ └───────────────┘     └──────────────────────┘ │
│         ↑                        ↑              │
│         │                        │              │
│ ┌───────┴─────────────────────┬──┴────────────┐ │
│ │ Managers & Systems          │               │ │
│ │ - EnemyManager              │               │ │
│ │ - TowerManager              │               │ │
│ │ - ProjectileManager         │               │ │
│ │ - CombatSystem              │               │ │
│ └─────────────────────────────┴───────────────┘ │
└─────────────────────────────────────────────────┘
```

---

## Event Bus Implementation

### Core Event Bus (Pure TypeScript)

```typescript
// /src/app/game-engine/game-event-bus.ts

/**
 * Game Event Type Definitions
 * Nur für Broadcast-Events, NICHT für Spatial Queries!
 */
export type GameEvent =
    // Enemy Lifecycle
    | { type: 'enemy:died'; enemy: Enemy; credits: number; position: Vector3 }
    | { type: 'enemy:reached-base'; enemy: Enemy; damage: number }

    // Tower Lifecycle
    | { type: 'tower:placed'; tower: Tower; position: Vector3; cost: number }
    | { type: 'tower:upgraded'; tower: Tower; level: number; cost: number }
    | { type: 'tower:sold'; tower: Tower; refund: number }

    // Combat Events
    | { type: 'projectile:hit'; projectile: Projectile; target: Enemy; damage: number }
    | { type: 'damage:dealt'; source: Tower; target: Enemy; amount: number }

    // Wave Events
    | { type: 'wave:started'; wave: number; enemyCount: number }
    | { type: 'wave:completed'; wave: number; credits: number }

    // Game State
    | { type: 'game:started' }
    | { type: 'game:paused' }
    | { type: 'game:resumed' }
    | { type: 'game:over'; reason: 'base-destroyed' | 'quit' }
    | { type: 'credits:changed'; credits: number; delta: number }
    | { type: 'health:changed'; health: number; delta: number }

    // Effects (Deferred)
    | { type: 'audio:play'; sound: string; position?: Vector3; volume?: number }
    | { type: 'vfx:blood'; position: Vector3; intensity: number }
    | { type: 'vfx:explosion'; position: Vector3; radius: number }

    // UI (Deferred)
    | { type: 'ui:notification'; message: string; type: 'info' | 'warning' | 'error' };

/**
 * Event Map für type-safe subscriptions
 */
type GameEventMap = {
    [K in GameEvent['type']]: Extract<GameEvent, { type: K }>;
};

/**
 * Subscription Handle
 */
export class EventSubscription {
    constructor(private unsubscribe: () => void) {}
    dispose(): void { this.unsubscribe(); }
}

/**
 * Subscription Bag
 */
export class SubscriptionBag {
    private subscriptions: EventSubscription[] = [];

    add(sub: EventSubscription): void {
        this.subscriptions.push(sub);
    }

    disposeAll(): void {
        this.subscriptions.forEach(s => s.dispose());
        this.subscriptions = [];
    }
}

/**
 * Type-Safe Game Event Bus
 *
 * WICHTIG: Nur für Broadcast-Events!
 * Für räumliche Queries → GlobalRouteGrid verwenden!
 */
export class GameEventBus {
    private listeners = new Map<GameEvent['type'], Set<(event: any) => void>>();
    private deferredQueue: GameEvent[] = [];
    private ownerSubscriptions = new WeakMap<object, Set<EventSubscription>>();

    // Performance tracking (optional)
    private metrics = {
        eventsEmitted: 0,
        eventsDeferred: 0,
        listenerCalls: 0
    };

    /**
     * Subscribe to event (type-safe)
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
     */
    off<T extends GameEvent['type']>(
        eventType: T,
        handler: (event: GameEventMap[T]) => void
    ): void {
        this.listeners.get(eventType)?.delete(handler);
    }

    /**
     * Emit event immediately (blocking)
     * Use for critical events that need immediate handling
     */
    emit<T extends GameEvent['type']>(
        event: GameEventMap[T]
    ): void {
        this.metrics.eventsEmitted++;

        const handlers = this.listeners.get(event.type);
        if (handlers && handlers.size > 0) {
            handlers.forEach(handler => {
                this.metrics.listenerCalls++;
                handler(event);
            });
        }
    }

    /**
     * Emit event deferred (queued)
     * Use for non-critical events (audio, VFX, UI)
     */
    emitDeferred<T extends GameEvent['type']>(
        event: GameEventMap[T]
    ): void {
        this.metrics.eventsDeferred++;
        this.deferredQueue.push(event);
    }

    /**
     * Process all deferred events
     * Call once per frame at stable point
     */
    processQueue(): void {
        while (this.deferredQueue.length > 0) {
            const event = this.deferredQueue.shift()!;
            this.emit(event);
        }
    }

    /**
     * Subscribe with automatic cleanup when owner is destroyed
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
     */
    unsubscribeAll(owner: object): void {
        const subscriptions = this.ownerSubscriptions.get(owner);
        if (subscriptions) {
            subscriptions.forEach(sub => sub.dispose());
            this.ownerSubscriptions.delete(owner);
        }
    }

    /**
     * Clear all listeners and queued events
     */
    clear(): void {
        this.listeners.clear();
        this.deferredQueue = [];
    }

    /**
     * Get metrics (for debugging)
     */
    getMetrics() {
        return {
            ...this.metrics,
            listenerCount: this.getListenerCount(),
            queueSize: this.deferredQueue.length
        };
    }

    /**
     * Reset metrics
     */
    resetMetrics(): void {
        this.metrics = {
            eventsEmitted: 0,
            eventsDeferred: 0,
            listenerCalls: 0
        };
    }

    /**
     * Get listener count
     */
    getListenerCount(eventType?: GameEvent['type']): number {
        if (eventType) {
            return this.listeners.get(eventType)?.size ?? 0;
        }

        let total = 0;
        this.listeners.forEach(handlers => total += handlers.size);
        return total;
    }
}
```

---

## Usage Examples

### Example 1: Enemy Manager

```typescript
// /src/app/game-engine/managers/enemy.manager.ts

export class EnemyManager {
    constructor(
        private eventBus: GameEventBus,
        private grid: GlobalRouteGrid,
        private entityPool: EntityPoolService
    ) {}

    update(deltaTime: number) {
        for (const enemy of this.enemies) {
            // Update position
            enemy.update(deltaTime);

            // Update spatial grid (O(1))
            const local = this.coordinateSync.geoToLocal(enemy.position);
            this.grid.updateEnemyPosition(enemy, local.x, local.z);

            // Check if reached base
            if (enemy.hasReachedEnd()) {
                // Emit immediate event
                this.eventBus.emit({
                    type: 'enemy:reached-base',
                    enemy,
                    damage: 10
                });
                this.removeEnemy(enemy);
            }
        }
    }

    killEnemy(enemy: Enemy, credits: number) {
        // Emit immediate event (critical for game state)
        this.eventBus.emit({
            type: 'enemy:died',
            enemy,
            credits,
            position: enemy.position
        });

        // Deferred VFX event
        this.eventBus.emitDeferred({
            type: 'vfx:blood',
            position: enemy.position,
            intensity: 1.0
        });

        // Remove from grid
        this.grid.removeEnemy(enemy);
        this.removeEnemy(enemy);
    }
}
```

### Example 2: Tower Manager

```typescript
// /src/app/game-engine/managers/tower.manager.ts

export class TowerManager {
    private towers: Tower[] = [];

    constructor(
        private eventBus: GameEventBus,
        private grid: GlobalRouteGrid
    ) {
        // Subscribe to events
        this.setupEventHandlers();
    }

    private setupEventHandlers() {
        // React to enemy deaths (stop targeting dead enemy)
        this.eventBus.on('enemy:died', (event) => {
            for (const tower of this.towers) {
                if (tower.targetEnemy === event.enemy) {
                    tower.clearTarget();
                }
            }
        });
    }

    placeTower(position: Vector3, towerType: TowerTypeId) {
        const tower = new Tower(towerType, position, this.eventBus, this.grid);
        this.towers.push(tower);

        // Emit immediate event (for credits)
        this.eventBus.emit({
            type: 'tower:placed',
            tower,
            position,
            cost: tower.cost
        });

        return tower;
    }

    update(deltaTime: number) {
        for (const tower of this.towers) {
            tower.update(deltaTime);
        }
    }
}
```

### Example 3: Tower Entity

```typescript
// /src/app/game-engine/entities/tower.entity.ts

export class Tower {
    private visibleCells: RouteCell[] = [];
    private targetEnemy: Enemy | null = null;
    private subscriptions = new SubscriptionBag();

    constructor(
        private type: TowerType,
        private position: Vector3,
        private eventBus: GameEventBus,
        private grid: GlobalRouteGrid
    ) {
        // Register with spatial grid (einmalig!)
        this.visibleCells = grid.registerTower(
            this.id,
            position.x,
            position.z,
            this.getTipY(),
            this.type.range,
            this.losRaycaster
        );

        console.log(`Tower ${this.id} registered with ${this.visibleCells.length} visible cells`);
    }

    update(deltaTime: number) {
        // 1. Find targets using SPATIAL GRID (nicht Events!)
        const enemiesInRange = this.grid.getEnemiesForTower(this.visibleCells);

        if (enemiesInRange.length === 0) {
            this.targetEnemy = null;
            return;
        }

        // 2. Select target (closest, strongest, etc.)
        this.targetEnemy = this.selectTarget(enemiesInRange);

        // 3. Shoot if ready
        if (this.canShoot()) {
            this.shoot(this.targetEnemy);
        }
    }

    private shoot(target: Enemy) {
        const projectile = this.createProjectile(target);

        // Emit immediate event (combat is critical)
        this.eventBus.emit({
            type: 'tower:shot',
            tower: this,
            target,
            projectile
        });

        // Deferred audio event
        this.eventBus.emitDeferred({
            type: 'audio:play',
            sound: 'tower_shoot',
            position: this.position,
            volume: 0.5
        });
    }

    clearTarget() {
        this.targetEnemy = null;
    }

    destroy() {
        // Cleanup
        this.grid.unregisterTower(this.id);
        this.subscriptions.disposeAll();
    }
}
```

### Example 4: Combat System

```typescript
// /src/app/game-engine/systems/combat.system.ts

export class CombatSystem {
    constructor(
        private eventBus: GameEventBus,
        private grid: GlobalRouteGrid
    ) {
        this.setupEventHandlers();
    }

    private setupEventHandlers() {
        // Listen to projectile hits
        this.eventBus.on('projectile:hit', (event) => {
            this.applyDamage(event.target, event.damage, event.projectile.source);
        });
    }

    private applyDamage(target: Enemy, amount: number, source: Tower) {
        target.takeDamage(amount);

        // Emit damage event
        this.eventBus.emit({
            type: 'damage:dealt',
            source,
            target,
            amount
        });

        // Check for death
        if (target.health <= 0) {
            // Enemy will emit enemy:died event in its own death logic
            target.die();
        }
    }

    applyAOEDamage(position: Vector3, radius: number, damage: number) {
        // Use SPATIAL GRID for AOE, nicht Events!
        const enemiesInRadius = this.grid.getEnemiesInRadius(
            position.x,
            position.z,
            radius
        );

        for (const enemy of enemiesInRadius) {
            this.applyDamage(enemy, damage, null);
        }

        // Deferred VFX
        this.eventBus.emitDeferred({
            type: 'vfx:explosion',
            position,
            radius
        });
    }
}
```

### Example 5: Game Loop

```typescript
// /src/app/game-engine/game-engine.ts

export class GameEngine {
    private eventBus = new GameEventBus();
    private grid = new GlobalRouteGrid();

    private enemyManager: EnemyManager;
    private towerManager: TowerManager;
    private combatSystem: CombatSystem;

    constructor(config: GameConfig) {
        // Initialize systems
        this.enemyManager = new EnemyManager(this.eventBus, this.grid, ...);
        this.towerManager = new TowerManager(this.eventBus, this.grid);
        this.combatSystem = new CombatSystem(this.eventBus, this.grid);

        // Setup event handlers
        this.setupEventHandlers();
    }

    private setupEventHandlers() {
        // React to enemy deaths
        this.eventBus.on('enemy:died', (event) => {
            this.credits += event.credits;
        });

        // React to base damage
        this.eventBus.on('enemy:reached-base', (event) => {
            this.baseHealth -= event.damage;

            if (this.baseHealth <= 0) {
                this.eventBus.emit({
                    type: 'game:over',
                    reason: 'base-destroyed'
                });
            }
        });

        // React to game over
        this.eventBus.on('game:over', (event) => {
            this.stop();
        });
    }

    update(deltaTime: number) {
        if (!this.running) return;

        // 1. Update game logic
        this.enemyManager.update(deltaTime);
        this.towerManager.update(deltaTime);
        this.projectileManager.update(deltaTime);

        // 2. Process deferred events at stable point
        this.eventBus.processQueue();

        // 3. Update spatial grid visualization (if debug mode)
        if (this.debugMode) {
            this.grid.updateVisualization();
            this.grid.updateAnimation(deltaTime);
        }
    }
}
```

---

## Event Categories

### Immediate Events (emit)
**When:** State must be consistent immediately
**Examples:**
- `enemy:died` - Credits müssen sofort aktualisiert werden
- `enemy:reached-base` - Base damage ist critical
- `projectile:hit` - Damage muss sofort applied werden
- `game:over` - Game muss sofort stoppen

### Deferred Events (emitDeferred)
**When:** Can wait 1 frame
**Examples:**
- `audio:play` - Audio kann 16ms warten
- `vfx:*` - Particle Effects können 1 Frame warten
- `ui:notification` - Notifications sind nicht critical

---

## Migration Strategy

### Phase 1: Event Bus Core (2-3h)
1. Create `/src/app/game-engine/game-event-bus.ts`
2. Write unit tests
3. Add to project structure

### Phase 2: GameEngine Class (3-4h)
1. Create `/src/app/game-engine/game-engine.ts`
2. Constructor Injection für alle Manager
3. Event wiring
4. Main loop mit `processQueue()`

### Phase 3: Manager Refactoring (6-8h)
**Für jeden Manager:**
1. Remove `@Injectable`
2. Replace `inject()` with constructor injection
3. Remove Signals → Getter methods
4. Replace Callbacks mit `eventBus.emit()`
5. Keep Spatial Grid usage intact

**Reihenfolge:**
1. ProjectileManager (simplest)
2. CombatSystem (already extracted)
3. EnemyManager
4. TowerManager
5. WaveManager

### Phase 4: Angular Adapter (3-4h)
1. Create `GameEngineService` (@Injectable)
2. Wraps `GameEngine`
3. Event → Signal/Observable conversion
4. Update Components

### Phase 5: Testing & Validation (3-4h)
1. Unit tests für alle Manager
2. Integration tests für Event flows
3. Performance validation
4. Memory leak testing

**Total: 17-23 hours**

---

## Performance Targets

### Event Bus Performance
- **< 100ns per event emission** (without listeners)
- **< 1μs per frame** for all events
- **< 50 listeners total** (reasonable limit)

### Spatial Grid Performance (current)
- **O(1) enemy position updates**
- **O(visible_cells) tower queries** (~50 cells)
- **O(cells_in_radius) AOE queries**

### Combined Performance Budget
- **Events: < 1μs/frame**
- **Spatial: < 10μs/frame** (10 towers × 1μs)
- **Total: < 11μs/frame** (0.07% of 16ms budget @ 60 FPS)

---

## Anti-Patterns to Avoid

### ❌ Don't: Subscribe to spatial events
```typescript
// FALSCH - performance killer!
eventBus.on('enemy:moved', (event) => {
  if (this.isInRange(event.enemy)) {
    this.shoot(event.enemy);
  }
});
```

### ✅ Do: Use spatial queries
```typescript
// RICHTIG - performant!
update() {
  const enemies = this.grid.getEnemiesForTower(this.visibleCells);
  if (enemies.length > 0) {
    this.shoot(enemies[0]);
  }
}
```

### ❌ Don't: Emit events in hot loops
```typescript
// FALSCH - 50 events @ 60 FPS = 3000 events/sec
for (const enemy of enemies) {
  eventBus.emit({ type: 'enemy:updated', enemy });
}
```

### ✅ Do: Use deferred events for batch operations
```typescript
// RICHTIG - 1 event @ 60 FPS
eventBus.emitDeferred({
  type: 'enemies:updated',
  count: enemies.length
});
```

---

## Open Questions

1. **Event Priorities?**
   - Critical, High, Normal, Low
   - Oder reicht Immediate/Deferred?
   → **Decision:** Immediate/Deferred reicht

2. **Event Logging/Replay?**
   - Debug mode mit Event Log
   - Time-travel debugging
   → **Decision:** Later, not for MVP

3. **Wildcard Subscriptions?**
   - `eventBus.on('enemy:*', handler)`
   → **Decision:** Not needed, explicit is better

4. **Event Validation?**
   - Runtime validation (Zod, etc.)
   → **Decision:** TypeScript types reichen

---

## Next Steps

1. ✅ Review approved
2. ⏳ Create `/src/app/game-engine/` directory
3. ⏳ Implement `GameEventBus`
4. ⏳ Implement `GameEngine` orchestrator
5. ⏳ Refactor first manager (ProjectileManager)
6. ⏳ Continue with other managers
7. ⏳ Create `GameEngineService` adapter
8. ⏳ Update Components
9. ⏳ Testing & Performance validation

---

**Status:** ✅ Design Complete - Ready for Implementation
**Estimated Time:** 17-23 hours
**Performance Target:** < 11μs/frame overhead
**Memory Target:** < 1MB for event system
