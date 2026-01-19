# Event Bus System - Architecture Proposal

**Erstellt:** 2026-01-19
**Status:** Proposal (Noch nicht implementiert)

## Übersicht

Dieses Dokument beschreibt die vorgeschlagene Event Bus Architektur zur Entkopplung der Game Engine von Angular und Ersetzung des Callback-Systems durch typisierte Events.

---

## Problem Statement

### Aktueller Zustand:

**1. Framework-Coupling:**
- 5 von 7 Managern haben `@Injectable` und `inject()`
- Signals in Game Engine (sollten nur in UI sein)
- Game Logic kann nicht ohne Angular laufen

**2. Callback-Explosion:**
- 40+ verschiedene Callbacks
- 13 Callbacks allein für LocationChangeCoordinator
- Callback-Hell mit 5-stufigen Chains
- Manuelle Cleanup-Verwaltung (Memory Leak Risiko)

**3. Keine Event-System:**
- Direkte Callbacks statt Events
- Tight Coupling zwischen Komponenten
- Schwer testbar, nicht wiederverwendbar

---

## Lösung: 3-Schicht Architektur + Event Bus

### Layer 1: Game Engine (Framework-agnostic)

```typescript
// Pure TypeScript, KEINE Angular-Imports!

GameEngine (Orchestrator)
  ├─ GameEventBus (Custom, Type-Safe)
  ├─ Managers (EnemyManager, TowerManager, etc.)
  ├─ Systems (CombatSystem, TowerCombatSystem)
  └─ Entities (Enemy, Tower, Projectile)
```

**Eigenschaften:**
- Keine `@Injectable` Decorators
- Constructor Injection statt `inject()`
- Event-basierte Kommunikation
- Kann mit React, Vue, vanilla JS laufen

### Layer 2: Angular Adapter

```typescript
@Injectable({ providedIn: 'root' })
export class GameEngineService {
  private engine: GameEngine;

  // Signals für UI-Bindings (hier ist das OK!)
  readonly baseHealth = signal(100);
  readonly credits = signal(1000);

  // Observables für Events
  readonly enemyKilled$ = new Subject<Enemy>();

  constructor() {
    this.engine = new GameEngine(config);

    // Wire engine events to Angular
    this.engine.events.on('enemy:died', (event) => {
      this.credits.update(c => c + event.credits);
      this.enemyKilled$.next(event.enemy);
    });
  }
}
```

### Layer 3: UI Components (Angular)

```typescript
@Component({ ... })
export class GameSidebarComponent {
  private gameEngine = inject(GameEngineService);

  // UI bindet auf Adapter-Signals
  credits = this.gameEngine.credits;
  baseHealth = this.gameEngine.baseHealth;
}
```

---

## Event Bus Implementation

### Core Event Bus Code

```typescript
// /src/app/game-engine/game-event-bus.ts

/**
 * Game Event Definitions mit Discriminated Unions
 * Volle Type-Safety ohne Runtime-Overhead
 */
export type GameEvent =
    // Enemy Events
    | { type: 'enemy:spawned'; enemy: Enemy; position: Vector3 }
    | { type: 'enemy:moved'; enemy: Enemy; position: Vector3 }
    | { type: 'enemy:damaged'; enemy: Enemy; amount: number; source: Tower }
    | { type: 'enemy:died'; enemy: Enemy; credits: number; position: Vector3 }
    | { type: 'enemy:reached-base'; enemy: Enemy; damage: number }

    // Tower Events
    | { type: 'tower:placed'; tower: Tower; position: Vector3; cost: number }
    | { type: 'tower:upgraded'; tower: Tower; level: number; cost: number }
    | { type: 'tower:sold'; tower: Tower; refund: number }
    | { type: 'tower:shot'; tower: Tower; target: Enemy; projectile: Projectile }

    // Projectile Events
    | { type: 'projectile:spawned'; projectile: Projectile; source: Tower }
    | { type: 'projectile:hit'; projectile: Projectile; target: Enemy; damage: number }
    | { type: 'projectile:missed'; projectile: Projectile }

    // Wave Events
    | { type: 'wave:started'; wave: number; enemyCount: number }
    | { type: 'wave:completed'; wave: number; credits: number }

    // Game State Events
    | { type: 'game:over'; reason: 'base-destroyed' | 'quit' }
    | { type: 'game:credits-changed'; credits: number; delta: number }
    | { type: 'game:health-changed'; health: number; delta: number }

    // Audio Events (deferred)
    | { type: 'audio:play'; sound: string; position?: Vector3; volume?: number }

    // UI Events (deferred)
    | { type: 'ui:notification'; message: string; type: 'info' | 'warning' | 'error' };

/**
 * Event Map für type-safe subscriptions
 */
type GameEventMap = {
    [K in GameEvent['type']]: Extract<GameEvent, { type: K }>;
};

/**
 * Subscription Handle für Cleanup
 */
export class EventSubscription {
    constructor(private unsubscribe: () => void) {}
    dispose(): void { this.unsubscribe(); }
}

/**
 * Subscription Bag für managing multiple subscriptions
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
 * Framework-Agnostic Game Event Bus
 *
 * Features:
 * - Type-safe mit Discriminated Unions
 * - Immediate + Deferred Event Dispatch
 * - WeakMap-basiertes automatisches Cleanup
 * - ~50-100ns per event (estimated)
 * - Zero Framework Dependencies
 */
export class GameEventBus {
    private listeners = new Map<GameEvent['type'], Set<(event: any) => void>>();
    private deferredQueue: GameEvent[] = [];
    private ownerSubscriptions = new WeakMap<object, Set<EventSubscription>>();

    /**
     * Subscribe mit Type-Safety
     * @returns Subscription für manuelles Cleanup
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
     * Unsubscribe
     */
    off<T extends GameEvent['type']>(
        eventType: T,
        handler: (event: GameEventMap[T]) => void
    ): void {
        this.listeners.get(eventType)?.delete(handler);
    }

    /**
     * Emit event immediately (blocking)
     * Für kritische Events die sofort behandelt werden müssen
     */
    emit<T extends GameEvent['type']>(
        event: GameEventMap[T]
    ): void {
        const handlers = this.listeners.get(event.type);
        if (handlers && handlers.size > 0) {
            handlers.forEach(handler => handler(event));
        }
    }

    /**
     * Emit event deferred (queued)
     * Für non-critical events (UI, audio, etc.)
     * Wird an stabilem Punkt im Game Loop verarbeitet
     */
    emitDeferred<T extends GameEvent['type']>(
        event: GameEventMap[T]
    ): void {
        this.deferredQueue.push(event);
    }

    /**
     * Process all deferred events
     * Einmal pro Frame an stabilem Punkt aufrufen
     */
    processQueue(): void {
        while (this.deferredQueue.length > 0) {
            const event = this.deferredQueue.shift()!;
            this.emit(event);
        }
    }

    /**
     * Subscribe mit automatischem Cleanup wenn owner destroyed wird
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
     * Unsubscribe all events für owner
     * In destroy/cleanup methods aufrufen
     */
    unsubscribeAll(owner: object): void {
        const subscriptions = this.ownerSubscriptions.get(owner);
        if (subscriptions) {
            subscriptions.forEach(sub => sub.dispose());
            this.ownerSubscriptions.delete(owner);
        }
    }

    /**
     * Clear all listeners und queued events
     */
    clear(): void {
        this.listeners.clear();
        this.deferredQueue = [];
    }

    /**
     * Get listener count für debugging
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
// VORHER: Mit Callbacks
@Injectable()
export class EnemyManager {
  private onEnemyReachedBase?: (enemy: Enemy) => void;

  update(deltaTime: number) {
    if (enemy.reachedEnd()) {
      this.onEnemyReachedBase?.(enemy);  // Callback
    }
  }
}

// NACHHER: Mit Event Bus
export class EnemyManager {
  constructor(private eventBus: GameEventBus) {}

  update(deltaTime: number) {
    if (enemy.reachedEnd()) {
      this.eventBus.emit({
        type: 'enemy:reached-base',
        enemy,
        damage: 10
      });
    }
  }
}
```

### Example 2: Tower subscribes to Enemy Events

```typescript
export class Tower {
    private subscriptions = new SubscriptionBag();

    constructor(private eventBus: GameEventBus) {
        // Type-safe subscription
        this.subscriptions.add(
            this.eventBus.on('enemy:spawned', (event) => {
                // event.enemy ist typisiert!
                this.checkIfInRange(event.enemy);
            })
        );
    }

    shoot(target: Enemy) {
        // Immediate event
        this.eventBus.emit({
            type: 'tower:shot',
            tower: this,
            target,
            projectile: this.projectile
        });

        // Deferred audio event
        this.eventBus.emitDeferred({
            type: 'audio:play',
            sound: 'tower_shoot',
            position: this.position,
            volume: 0.5
        });
    }

    destroy() {
        this.subscriptions.disposeAll();
    }
}
```

### Example 3: Game Loop Integration

```typescript
export class GameEngine {
    private eventBus = new GameEventBus();

    constructor() {
        this.setupEventHandlers();
    }

    private setupEventHandlers() {
        this.eventBus.on('enemy:died', (event) => {
            this.credits += event.credits;
            this.combatSystem.spawnBloodEffect(event.position);
        });

        this.eventBus.on('tower:placed', (event) => {
            this.credits -= event.cost;
        });
    }

    update(deltaTime: number) {
        // 1. Update game logic
        this.enemyManager.update(deltaTime);
        this.towerManager.update(deltaTime);
        this.projectileManager.update(deltaTime);

        // 2. Process deferred events an stabilem Punkt
        this.eventBus.processQueue();
    }
}
```

---

## Migration Plan

### Phase 1: Event Bus Implementation (1-2h)
- [ ] Create `/src/app/game-engine/game-event-bus.ts`
- [ ] Write Unit Tests
- [ ] Add to projekt

### Phase 2: Manager Refactoring (4-6h)
**Für jeden Manager:**
- [ ] Remove `@Injectable` decorator
- [ ] Replace `inject()` with Constructor Injection
- [ ] Remove Signals (nur Getter-Methoden)
- [ ] Replace Callbacks mit Event Emits

**Reihenfolge:**
1. ProjectileManager (einfachste)
2. EnemyManager
3. TowerManager
4. WaveManager
5. GameStateManager (komplexeste)

### Phase 3: GameEngine Core (2-3h)
- [ ] Create `/src/app/game-engine/game-engine.ts`
- [ ] Constructor Injection für alle Manager
- [ ] Event Wiring
- [ ] Public API definieren

### Phase 4: Angular Adapter (2-3h)
- [ ] Create `GameEngineService`
- [ ] Wire Events → Signals/Observables
- [ ] Update Components zu nutzen Adapter

### Phase 5: Service → System Migration (3-4h)
- [ ] `CombatEffectService` → `CombatSystem`
- [ ] `TowerCombatService` → `TowerCombatSystem`
- [ ] `HQDamageService` → `HQDamageSystem`

### Phase 6: Testing & Validation (2-3h)
- [ ] Unit Tests für alle Manager
- [ ] Integration Tests für Event Flows
- [ ] Performance Validation (<1μs overhead)
- [ ] Memory Leak Testing

**Total Estimated Time: 14-21 Stunden**

---

## Benefits

### 1. Testability
```typescript
// Pure unit tests ohne Angular!
describe('EnemyManager', () => {
  it('should emit enemy:died event', () => {
    const eventBus = new GameEventBus();
    const manager = new EnemyManager(eventBus, entityPool, grid);

    const spy = jest.fn();
    eventBus.on('enemy:died', spy);

    manager.killEnemy(enemy);

    expect(spy).toHaveBeenCalledWith({
      type: 'enemy:died',
      enemy,
      credits: 100,
      position: expect.any(Vector3)
    });
  });
});
```

### 2. Wiederverwendbarkeit
```typescript
// Game Engine kann in React verwendet werden!
function GameComponent() {
  const [engine] = useState(() => new GameEngine(config));

  useEffect(() => {
    const subscription = engine.events.on('game:over', () => {
      setGameOver(true);
    });
    return () => subscription.dispose();
  }, []);
}
```

### 3. Debugging
```typescript
// Event Logger für debugging
eventBus.on('*', (event) => {
  console.log(`[Event] ${event.type}`, event);
});
```

### 4. Performance
- Keine Angular Change Detection in Game Loop
- Direktere Method Calls (kein DI Overhead)
- Besser optimierbar durch V8

---

## Risks & Mitigations

### Risk 1: Breaking Changes
**Mitigation:** Schrittweise Migration, ein Manager nach dem anderen

### Risk 2: Performance Regression
**Mitigation:** Benchmark vor/nach, Performance Budget (<1μs overhead)

### Risk 3: Complexity
**Mitigation:** Klare Dokumentation, Code-Reviews, Pair Programming

---

## Open Questions

1. **Sollen wir TypeScript Decorators für Event Subscriptions nutzen?**
   ```typescript
   class Tower {
     @On('enemy:spawned')
     onEnemySpawned(event: EnemySpawnedEvent) { ... }
   }
   ```

2. **Event Priorities implementieren?**
   - Critical, High, Normal, Low
   - Oder reicht Immediate vs Deferred?

3. **Event-Logging/Debugging einbauen?**
   - Replay-fähiges Event Log
   - Time-travel debugging

4. **Wildcard-Subscriptions erlauben?**
   ```typescript
   eventBus.on('enemy:*', handler);  // Alle Enemy-Events
   ```

---

## Decision Log

| Date | Decision | Reason |
|------|----------|--------|
| 2026-01-19 | Custom Event Bus statt Library (Mitt, etc.) | Volle Kontrolle, Type-Safety, Zero Dependencies |
| 2026-01-19 | Discriminated Unions für Events | Beste Type-Safety ohne Runtime-Overhead |
| 2026-01-19 | Immediate + Deferred Dispatch | Game Programming Pattern Best Practice |
| 2026-01-19 | WeakMap für Cleanup | Automatisches Memory Management |

---

## Next Steps

1. **Review dieses Proposal** mit Team
2. **Entscheidung:** Go/No-Go für Migration
3. **Falls Go:** Spike für Phase 1 (Event Bus Implementation)
4. **Performance Baseline** messen vor Migration

---

**Erstellt von:** Claude (AI Assistant)
**Review Status:** ⏳ Pending
**Approval:** ⏳ Pending
