# Game Engine - Framework-Agnostic Event System

**Status:** Phase 3 - ProjectileManager Refactored ✅

Pure TypeScript game engine without Angular dependencies.
Can run with React, Vue, or vanilla JavaScript.

---

## ✅ Was ist implementiert

### Phase 1: Event Bus Core ✅
- `GameEventBus` - Type-safe event system mit Discriminated Unions
- 20 Event-Typen definiert (Enemy, Tower, Combat, Wave, Game State, Effects, UI)
- Immediate + Deferred dispatch
- WeakMap-based automatic cleanup
- SubscriptionBag für multi-subscription management

### Phase 3: ProjectileManager Refactored ✅
- `ProjectileManager` - Framework-agnostic, constructor injection
- Emittiert Events statt Callbacks
- `VFXService` - Reagiert auf vfx:projectile-impact Events

---

## 🚀 Quick Start - Event System Testen

### 1. Import Event Bus

```typescript
import { GameEventBus } from './game-engine';

const eventBus = new GameEventBus();
```

### 2. Subscribe zu Events

```typescript
// Type-safe subscription
eventBus.on('enemy:died', (event) => {
  // event ist typisiert!
  console.log(`Enemy ${event.enemy.id} died, reward: ${event.credits}`);
  console.log(`Position:`, event.position);
});
```

### 3. Emit Events

```typescript
// Immediate event (critical, blocking)
eventBus.emit({
  type: 'enemy:died',
  enemy: myEnemy,
  credits: 100,
  position: new Vector3(10, 0, 5),
});

// Deferred event (queued, non-critical)
eventBus.emitDeferred({
  type: 'audio:play',
  sound: 'explosion',
  volume: 0.8,
});
```

### 4. Process Queue (einmal pro Frame)

```typescript
function gameLoop(deltaTime: number) {
  // 1. Update game logic
  enemyManager.update(deltaTime);
  towerManager.update(deltaTime);
  projectileManager.update(deltaTime);

  // 2. Process deferred events at stable point
  eventBus.processQueue();
}
```

---

## 🧪 Test ausführen

### Browser Console Test

Öffne in deiner App die Browser Console:

```typescript
import { runAllTests } from './game-engine/projectile-manager.test';

runAllTests();
```

**Output:**
```
🚀 GAME ENGINE EVENT SYSTEM TESTS
============================================================

🧪 Testing ProjectileManager Event System...

✅ GameEventBus created
✅ Event listeners registered

🎯 Simulating projectile hit...
📣 Event: projectile:hit
   Projectile: proj-123
   Target: enemy-456
   Damage: 50

📊 Queue before processing: 1 deferred events
📣 Event: vfx:projectile-impact
   Type: rocket
   Position: (47.3769, 8.5417)
   Height: 420.5m
   Target Lost: false

📊 Queue after processing: 0 deferred events

📈 Test Results:
   Total events: 2
   Immediate events: 1 (projectile:hit)
   Deferred events: 1 (vfx:projectile-impact)
   Listener count: 3

📊 Event Bus Metrics:
   Events emitted: 2
   Events deferred: 1
   Listener calls: 6
   Queue size: 0
   Total listeners: 3

✅ Test complete!
```

---

## 📊 Event Types

### Immediate Events (kritisch, blocking)
Werden sofort verarbeitet, Game State muss konsistent sein.

```typescript
// Enemy Lifecycle
'enemy:died'           // Enemy gestorben → Credits, Blood VFX, Tower Cleanup
'enemy:reached-base'   // Enemy am Ziel → Base Damage, Fire Effect, Alarm

// Combat
'projectile:hit'       // Projektil trifft → Damage, Blood, Impact Sound
'damage:dealt'         // Damage applied → Stats, Achievements

// Tower Lifecycle
'tower:placed'         // Tower gebaut → Credits, Grid Registration
'tower:upgraded'       // Tower upgraded → Credits, Grid Update, VFX

// Game State
'game:over'           // Game beendet → Stop everything
'credits:changed'     // Credits geändert → UI Update
'health:changed'      // Health geändert → UI Update, Fire Intensity
```

### Deferred Events (nicht-kritisch, queued)
Werden in processQueue() verarbeitet, können 1 Frame warten.

```typescript
// Effects
'vfx:projectile-impact'  // Explosion VFX
'vfx:blood'              // Blood Particles
'vfx:explosion'          // Generic Explosion
'audio:play'             // 3D Sound

// Other
'projectile:missed'      // Ground Impact
'ui:notification'        // Toast Message
```

---

## 🎯 ProjectileManager Example

### Vorher (Callback-based, Angular-coupled)

```typescript
@Injectable()
export class ProjectileManager extends EntityManager<Projectile> {
  private onProjectileHit?: (projectile: Projectile, enemy: Enemy) => void;

  override initialize(
    tilesEngine: ThreeTilesEngine,
    onProjectileHit?: (projectile: Projectile, enemy: Enemy) => void
  ): void {
    this.onProjectileHit = onProjectileHit;
  }

  override update(deltaTime: number): void {
    for (const projectile of this.getAllActive()) {
      const hit = projectile.updateTowardsTarget(deltaTime);

      if (hit && !projectile.targetLost) {
        // Callback!
        this.onProjectileHit?.(projectile, projectile.targetEnemy);

        // Direkter VFX Spawn
        this.tilesEngine?.effects.spawnExplosionAtGeo(...);
      }
    }
  }
}
```

### Nachher (Event-based, Framework-agnostic)

```typescript
export class ProjectileManager extends EntityManager<Projectile> {
  constructor(
    private eventBus: GameEventBus,
    private entityPool: EntityPoolService
  ) {
    super();
  }

  override update(deltaTime: number): void {
    for (const projectile of this.getAllActive()) {
      const hit = projectile.updateTowardsTarget(deltaTime);

      if (hit && !projectile.targetLost) {
        // Emit immediate event
        this.eventBus.emit({
          type: 'projectile:hit',
          projectile,
          target: projectile.targetEnemy,
          damage: projectile.damage,
        });

        // Emit deferred VFX event
        this.eventBus.emitDeferred({
          type: 'vfx:projectile-impact',
          lat: projectile.position.lat,
          lon: projectile.position.lon,
          height: projectile.flightHeight,
          projectileType: projectile.typeConfig.id,
          targetLost: false,
        });
      }
    }
  }
}
```

**VFX Service reagiert auf Event:**

```typescript
export class VFXService {
  constructor(eventBus: GameEventBus, tilesEngine: ThreeTilesEngine) {
    eventBus.on('vfx:projectile-impact', (event) => {
      this.handleProjectileImpact(event);
    });
  }

  private handleProjectileImpact(event) {
    // Select explosion preset based on projectile type
    const preset = this.selectPreset(event.projectileType);
    this.tilesEngine.effects.spawnExplosionAtGeo(
      event.lat, event.lon, event.height, preset
    );
  }
}
```

---

## ✅ Benefits

### 1. Testability
```typescript
// Pure unit test ohne Angular!
describe('ProjectileManager', () => {
  it('should emit projectile:hit event', () => {
    const eventBus = new GameEventBus();
    const spy = jest.fn();
    eventBus.on('projectile:hit', spy);

    const manager = new ProjectileManager(eventBus, entityPool);
    // ... simulate hit ...

    expect(spy).toHaveBeenCalledWith({
      type: 'projectile:hit',
      projectile: expect.any(Projectile),
      target: expect.any(Enemy),
      damage: 50,
    });
  });
});
```

### 2. Separation of Concerns
- ProjectileManager: Hit Detection
- VFXService: Visual Effects
- CombatSystem: Damage Logic
- AudioService: Sound Effects

Alles sauber getrennt!

### 3. Extensibility
```typescript
// Neues Achievement System? Einfach subscriben!
class AchievementSystem {
  constructor(eventBus: GameEventBus) {
    eventBus.on('projectile:hit', (event) => {
      this.totalHits++;
      if (this.totalHits >= 1000) {
        this.unlock('sharpshooter');
      }
    });
  }
}
```

### 4. Debugging
```typescript
// Event Logger (einschalten bei Bedarf)
if (DEBUG_MODE) {
  eventBus.on('projectile:hit', (e) => {
    console.log(`[Hit] ${e.projectile.id} → ${e.target.id}`);
  });
}
```

---

## 📁 File Structure

```
src/app/game-engine/
├── game-event-bus.ts           # Event Bus Core (545 lines)
├── vfx.service.ts              # VFX Service (79 lines)
├── projectile-manager.test.ts  # Test Suite
├── index.ts                    # Barrel exports
└── README.md                   # This file

src/app/managers/
├── projectile.manager.ts               # Original (noch aktiv)
└── projectile.manager.refactored.ts    # Refactored (parallel)
```

---

## 🚧 Next Steps

### Phase 4: EnemyManager Refactoring
- Remove @Injectable
- Constructor injection
- Emit events: enemy:died, enemy:reached-base
- No more Signals (pure getters)

### Phase 5: TowerManager Refactoring
- Similar to ProjectileManager
- Events: tower:placed, tower:upgraded, tower:sold

### Phase 6: WaveManager Refactoring
- Events: wave:started, wave:completed

### Phase 7: GameStateManager Refactoring
- Orchestrator class
- Game loop mit processQueue()
- Event wiring für alle Systeme

### Phase 8: Angular Adapter
- GameEngineService (@Injectable)
- Wraps GameEngine
- Converts Events → Signals/Observables
- Bridge zwischen Framework-agnostic Engine und Angular UI

---

## 📊 Performance

**Estimated Performance:**
- Event emission: ~50-100ns per event
- Typical load: ~50 events/frame @ 60 FPS
- Overhead: ~5μs/frame (0.03% of 16ms budget)

**Negligible performance impact! ✅**

---

## 🔗 References

- [EVENT_BUS_ARCHITECTURE.md](../../EVENT_BUS_ARCHITECTURE.md) - Full architecture
- [EVENT_FLOW_EXAMPLES.md](../../EVENT_FLOW_EXAMPLES.md) - Producer/Consumer examples
- [ARCHITECTURE_PROPOSAL.md](../../ARCHITECTURE_PROPOSAL.md) - Initial research

---

**Status:** Phase 3 Complete - Ready for Testing! 🚀
**Next:** EnemyManager Refactoring
