# Event System - Framework-Agnostic Event Bus

**Stand:** 2026-01-19

Das Event-System ermoeglicht lose Kopplung zwischen Game-Engine Komponenten. Alle Manager kommunizieren ueber Events statt direkter Methodenaufrufe oder Callbacks.

---

## Uebersicht

### Warum Event-System?

| Vorher | Nachher |
|--------|---------|
| 5 Manager mit `@Injectable()` | 1 Manager mit `@Injectable()` (GameStateManager) |
| 40+ Callbacks | 0 Callbacks (alle via Events) |
| Tight Coupling | Loose Coupling via Events |
| Angular-abhaengig | Framework-agnostic (React/Vue/Vanilla JS kompatibel) |

### Architektur-Prinzip

- **Angular nur fuer UI** - Services mit `@Injectable()` nur fuer UI-Bindings
- **Game Engine framework-agnostic** - Alle Manager ohne Angular-Decorator
- **Events fuer Broadcasts** - `enemy:died`, `projectile:hit`, `wave:completed`
- **Spatial Grid fuer Queries** - Tower Targeting, AOE Damage

---

## Event-Typen

### Immediate Events (kritisch, blocking)

Werden sofort verarbeitet. Game State muss konsistent sein.

| Event | Producer | Consumer | Beschreibung |
|-------|----------|----------|--------------|
| `enemy:died` | EnemyManager | GameStateManager | Enemy gestorben, Credits vergeben |
| `enemy:reached-base` | EnemyManager | GameStateManager | Enemy am Ziel, Base Damage |
| `projectile:hit` | ProjectileManager | CombatEffectService | Projektil trifft, Damage anwenden |
| `tower:placed` | TowerManager | GameStateManager | Tower gebaut, Credits abziehen |
| `tower:sold` | TowerManager | GameStateManager | Tower verkauft, Refund |
| `game:over` | GameStateManager | TowerDefenseComponent | Spiel beendet |
| `health:changed` | GameStateManager | HQDamageService | Base Health geaendert |
| `wave:started` | WaveManager | UI | Neue Welle gestartet |
| `wave:completed` | WaveManager | UI | Welle abgeschlossen |

### Deferred Events (nicht-kritisch, queued)

Werden in `processQueue()` am Frame-Ende verarbeitet.

| Event | Producer | Consumer | Beschreibung |
|-------|----------|----------|--------------|
| `vfx:projectile-impact` | ProjectileManager | VFXService | Explosion VFX spawnen |
| `audio:play` | ProjectileManager, HQDamageService | AudioService | 3D Sound abspielen |
| `debug:sound` | SpatialAudioManager | SoundDebugService | Sound-Debug-Events (play, stop, budget) |

---

## Quick Start

### 1. Event Bus erstellen

```typescript
import { GameEventBus } from './game-engine';

const eventBus = new GameEventBus();
```

### 2. Events subscriben

```typescript
// Type-safe subscription
eventBus.on('enemy:died', (event) => {
  console.log(`Enemy ${event.enemy.id} died, reward: ${event.credits}`);
});
```

### 3. Events emittieren

```typescript
// Immediate event (kritisch)
eventBus.emit({
  type: 'enemy:died',
  enemy: myEnemy,
  credits: 100,
  position: new Vector3(10, 0, 5),
});

// Deferred event (nicht-kritisch)
eventBus.emitDeferred({
  type: 'audio:play',
  sound: 'explosion',
  volume: 0.8,
  lat: 47.3769,
  lon: 8.5417,
  height: 420,
});
```

### 4. Queue verarbeiten (einmal pro Frame)

```typescript
function gameLoop(deltaTime: number) {
  // 1. Game Logic updaten
  enemyManager.update(deltaTime);
  towerManager.update(deltaTime);
  projectileManager.update(deltaTime);

  // 2. Deferred Events am stabilen Punkt verarbeiten
  eventBus.processQueue();
}
```

---

## Event Flow Diagramm

```
┌─────────────────────────────────────────────────────────────────────┐
│                         GAME LOOP                                   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ProjectileManager.update(deltaTime)                                │
│       │                                                             │
│       ├─► HIT? ──► emit('projectile:hit')                           │
│       │                    │                                        │
│       │                    ├──► CombatEffectService                 │
│       │                    │         │                              │
│       │                    │         ├─► applyDamage()              │
│       │                    │         ├─► spawnBlood/Ice VFX         │
│       │                    │         └─► enemyManager.kill()        │
│       │                    │                    │                   │
│       │                    │                    ▼                   │
│       │                    │           emit('enemy:died')           │
│       │                    │                    │                   │
│       │                    │                    ▼                   │
│       │                    │           GameStateManager             │
│       │                    │           credits.update()             │
│       │                    │                                        │
│       └─► emitDeferred('vfx:projectile-impact') ──► [QUEUE]         │
│                                                                     │
│  EnemyManager.update(deltaTime)                                     │
│       │                                                             │
│       └─► REACHED BASE? ──► emit('enemy:reached-base')              │
│                                      │                              │
│                                      ▼                              │
│                              GameStateManager                       │
│                              baseHealth.update()                    │
│                              emit('health:changed')                 │
│                                      │                              │
│                                      ▼                              │
│                              HQDamageService                        │
│                              updateFireIntensity()                  │
│                                                                     │
│  eventBus.processQueue() ◄── Am Ende des Frames                     │
│       │                                                             │
│       ├─► VFXService.handleProjectileImpact()                       │
│       │          │                                                  │
│       │          └─► tilesEngine.effects.spawnExplosionAtGeo()      │
│       │                                                             │
│       └─► AudioService.handleAudioPlay()                            │
│                  │                                                  │
│                  └─► tilesEngine.spatialAudio.playAtGeo()           │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Komponenten-Status

| Komponente | Angular DI | Events | Beschreibung |
|------------|------------|--------|--------------|
| **GameEventBus** | Nein | Core System | Event Bus mit 20 Event-Typen |
| **VFXService** | Nein | Subscriber | Reagiert auf `vfx:*` Events |
| **AudioService** | Nein | Subscriber | Reagiert auf `audio:play` |
| **ProjectileManager** | Nein | Producer | Emittiert `projectile:hit`, `vfx:*`, `audio:play` |
| **EnemyManager** | Nein | Producer | Emittiert `enemy:died`, `enemy:reached-base` |
| **WaveManager** | Nein | Producer | Emittiert `wave:started`, `wave:completed` |
| **TowerManager** | Nein | Producer | Emittiert `tower:placed`, `tower:sold` |
| **CombatEffectService** | Ja | Subscriber | Reagiert auf `projectile:hit` |
| **HQDamageService** | Ja | Mixed | Reagiert auf `health:changed`, emittiert `audio:play` |
| **GameStateManager** | Ja | Adapter | Orchestriert Manager, emittiert `game:over` |

---

## Debugging

### Event Debugger Panel

Das Event-Debugger-Panel zeigt alle Events in Echtzeit:

1. **Oeffnen:** Quick Actions → Cell Tower Icon (oder Tastenkuerzel)
2. **Filter:** Nach Kategorie filtern (enemy, tower, wave, game, vfx, audio)
3. **Pause/Resume:** Event-Stream pausieren
4. **Clear:** Event-Log leeren

Dateien: `event-debugger.component.ts`, `draggable-debug-panel.component.ts`

### Catch-All Logging

```typescript
// Alle Events loggen (nur Debug!)
eventBus.onAny((event) => {
  console.log(`[Event] ${event.type}`, event);
});
```

---

## Best Practices

### Immediate vs Deferred

| Verwende Immediate | Verwende Deferred |
|--------------------|-------------------|
| Game State Aenderungen | VFX, Audio |
| Damage, Credits | UI Notifications |
| Kritische Logik | Nicht-kritische Effekte |

### Subscription Cleanup

```typescript
// SubscriptionBag fuer automatisches Cleanup
const bag = eventBus.createSubscriptionBag();
bag.add(eventBus.on('enemy:died', handler1));
bag.add(eventBus.on('tower:placed', handler2));

// Bei Destroy
bag.unsubscribeAll();
```

---

## Dateien

| Datei | LOC | Beschreibung |
|-------|-----|--------------|
| `game-engine/game-event-bus.ts` | ~530 | Event Bus Core |
| `game-engine/vfx.service.ts` | ~85 | VFX Event Handler |
| `game-engine/audio.service.ts` | ~56 | Audio Event Handler |
| `game-engine/index.ts` | 7 | Barrel Exports |
| `components/debug-window/event-debugger.component.ts` | ~200 | Debug Panel |

---

## Performance

- Event Emission: ~50-100ns pro Event
- Typische Last: ~50 Events/Frame @ 60 FPS
- Overhead: ~5μs/Frame (0.03% des 16ms Budgets)

**Vernachlaessigbarer Performance Impact!**

---

## Siehe auch

- [ARCHITECTURE.md](ARCHITECTURE.md) - Gesamt-Architektur
- [WAVE_SYSTEM.md](WAVE_SYSTEM.md) - Wave Events
- [PROJECTILES.md](PROJECTILES.md) - Projektil Events
