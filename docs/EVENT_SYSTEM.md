# Event System - Framework-Agnostic Event Bus

**Stand:** 2026-05-08

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
| `enemy:spawned` | EnemyManager | UI, GameStateSyncService | Enemy gespawnt (`enemy`) |
| `enemy:died` | EnemyManager | GameStateManager | Enemy gestorben (`enemy`, `credits`) |
| `enemy:reached-base` | EnemyManager | GameStateManager | Enemy am Ziel (`enemy`, `damage`) |
| `projectile:hit` | ProjectileManager | CombatEffectService | Projektil trifft (`projectile`, `target`, `damage`, `damageType`) |
| `dot:damage` | StatusEffectService | DamageApplicationService | DOT-Tick (Poison) (`enemy`, `damage`, `sourceId`, `effectType`, `damageType`) |
| `tower:placed` | TowerManager | GameStateManager | Tower gebaut (`tower`, `position`, `cost`) |
| `tower:upgraded` | TowerManager | GameStateManager | Tower aufgewertet (`tower`, `level`, `cost`) |
| `tower:sold` | TowerManager | GameStateManager | Tower verkauft (`tower`, `refund`) |
| `tower:selected` | TowerManager | UI | Tower ausgewaehlt (`tower`) |
| `tower:deselected` | TowerManager | UI | Tower-Auswahl aufgehoben |
| `wave:started` | WaveManager | UI | Welle gestartet (`wave`, `enemyCount`) |
| `wave:completed` | WaveManager | UI, GameLoopFacade | Welle abgeschlossen (`wave`, `credits`, `perfect`, `closeCall`, `hpLost`) |
| `game:started` | GameStateManager | UI | Spiel gestartet |
| `game:over` | GameStateManager | TowerDefenseComponent | Spiel beendet (`reason: 'base-destroyed' \| 'quit'`) |
| `game:reset` | GameStateManager | All Managers | Spiel zurueckgesetzt |
| `credits:changed` | GameStateManager | UI, GameStateSyncService | Credits geaendert (`credits`, `delta`) |
| `health:changed` | GameStateManager | HQDamageService | Base Health geaendert (`health`, `delta`) |
| `research:started` | ResearchManager | UI, GameStateSyncService | Forschung gestartet (`researchId`, `cost`, `duration`) |
| `research:completed` | ResearchManager | TowerManager, UI | Forschung fertig (`researchId`, `effects`) |
| `research:cancelled` | ResearchManager | UI | Forschung abgebrochen (`researchId`, `refund`) |

### Deferred Events (nicht-kritisch, queued)

Werden in `processQueue()` am Frame-Ende verarbeitet.

| Event | Producer | Consumer | Beschreibung |
|-------|----------|----------|--------------|
| `vfx:blood` | CombatEffectService | VFXService | Blut-VFX spawnen |
| `vfx:explosion` | CombatEffectService | VFXService | Explosion VFX spawnen |
| `vfx:projectile-impact` | ProjectileManager | VFXService | Projektil-Einschlag VFX spawnen |
| `vfx:muzzle-flash` | TowerManager | VFXService | Muzzle-Flash VFX am Tower spawnen |
| `audio:play` | ProjectileManager, HQDamageService | AudioService | 3D Sound abspielen |

### Debug Events

| Event | Producer | Consumer | Beschreibung |
|-------|----------|----------|--------------|
| `debug:sound` | SpatialAudioManager | SoundDebugService | Sound-Debug-Events (play, stop, budget, pool_exhausted, distance_culled) |
| `debug:add-credits` | Debug UI | GameStateManager | Credits hinzufuegen |
| `debug:add-health` | Debug UI | GameStateManager | Health hinzufuegen |
| `debug:complete-all-research` | Debug UI | ResearchManager | Alle Forschungen sofort abschliessen |
| `debug:max-upgrade-all-towers` | Debug UI | TowerManager | Alle Tower auf Max-Level setzen |
| `debug:toggle-movement` | Debug UI | EnemyManager | Enemy-Bewegung an/aus |
| `debug:remove-enemy` | Debug UI | EnemyManager | Einzelnen Enemy entfernen |
| `debug:clear-enemies` | Debug UI | EnemyManager | Alle Enemies entfernen |
| `debug:start-custom-wave` | Debug UI | WaveManager | Custom Wave starten |
| `debug:spawn-enemy` | Debug UI | EnemyManager | Enemy manuell spawnen |
| `debug:kill-all` | Debug UI | EnemyManager | Alle Enemies toeten |

### Command Events (UI → Game Engine)

| Event | Producer | Consumer | Beschreibung |
|-------|----------|----------|--------------|
| `command:place-tower` | UI / Bot | TowerManager | Tower platzieren (`position`, `typeId`, `rotation?`) |
| `command:sell-tower` | UI / Bot | TowerManager | Tower verkaufen (`towerId`) |
| `command:upgrade-tower` | UI / Bot | TowerManager | Tower upgraden (`towerId`, `upgradeId`) |
| `command:start-wave` | UI / Bot | WaveManager | Welle starten (`config?`) |
| `command:restart-game` | UI | GameStateManager | Spiel neu starten |
| `command:start-research` | UI | ResearchManager | Forschung starten (`researchId`) |
| `command:cancel-research` | UI | ResearchManager | Forschung abbrechen (`researchId`) |

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
| **GameEventBus** | Nein | Core System | Event Bus mit ~40 Event-Typen (incl. DOT, Research, Debug-Commands) |
| **VFXService** | Nein | Subscriber | Reagiert auf `vfx:*` Events |
| **AudioService** | Nein | Subscriber | Reagiert auf `audio:play` |
| **ProjectileManager** | Nein | Producer | Emittiert `projectile:hit`, `vfx:*`, `audio:play` |
| **EnemyManager** | Nein | Producer | Emittiert `enemy:died`, `enemy:reached-base` |
| **WaveManager** | Nein | Producer | Emittiert `wave:started`, `wave:completed` |
| **TowerManager** | Nein | Producer | Emittiert `tower:placed`, `tower:sold` |
| **CombatEffectService** | Ja | Subscriber | Reagiert auf `projectile:hit` |
| **HQDamageService** | Ja | Mixed | Reagiert auf `health:changed`, emittiert `audio:play` |
| **GameStateSyncService** | Ja | Subscriber | Synchronisiert Game State mit Angular UI |
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
const bag = new SubscriptionBag();
bag.add(eventBus.on('enemy:died', handler1));
bag.add(eventBus.on('tower:placed', handler2));

// Bei Destroy
bag.disposeAll();
```

---

## Dateien

| Datei | LOC | Beschreibung |
|-------|-----|--------------|
| `game-engine/game-event-bus.ts` | ~671 | Event Bus Core (GameEvent Union, Subscriptions, processQueue) |
| `game-engine/vfx.service.ts` | ~153 | VFX Event Handler |
| `game-engine/audio.service.ts` | ~61 | Audio Event Handler |
| `game-engine/background-music.service.ts` | — | Phasen-basiertes Crossfade-System |
| `game-engine/screen-shake.service.ts` | — | Camera-Shake auf VFX-Events |
| `game-engine/index.ts` | ~26 | Barrel Exports |
| `components/debug-window/event-debugger.component.ts` | — | Debug Panel |

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
