# Event System - Framework-Agnostic Event Bus

**Stand:** 2026-09-14 (`wave:completed`-Semantik: 2026-09-07)

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
| `enemy:spawned` | EnemyManager | GameStateSyncService, AIDataCollector, EnemyDebugService, BossBarComponent (merkt sich Bosse, außer Wurm-Segmenten) | Enemy gespawnt (`enemy`); bei einem Wurm jedes Segment, wenn es aus dem Portal kommt |
| `enemy:died` | EnemyManager (`kill()`, u.a. aus DamageApplicationService) | GameStateManager (Credits; außerhalb einer Welle Tower in Wachrichtung), GameStateSyncService, WaveManager, ScreenShakeService (Boss), AIDataCollector | Enemy gestorben (`enemy`, `credits`) |
| `enemy:reached-base` | EnemyManager | GameStateManager (Schaden, gedeckelt durch `maxLeakDamagePerWave`), WaveManager, GameStateSyncService, AIDataCollector, LeakVignetteComponent (roter Rand, gedrosselt) | Enemy am Ziel (`enemy`, `damage`) |
| `enemy:leaking` | EnemyManager (`OozeBodies.update`) | GameStateManager (Schaden, im selben Leck-Budget), WaveManager (`hpLost`), LeakVignetteComponent | Eine Ooze fließt in die HQ: Schaden für die Meter, die hineingingen, in ganzen Punkten (`enemy`, `damage`). Ihr eines `enemy:reached-base` folgt, wenn der ganze Körper drin ist |
| `enemy:split` | EnemyManager (`kill()` mit Ursache `combat`, Typ mit `splitOnDeath`) | GameStateSyncService (Rest und Gesamtzahl der Welle), AIDataCollector (`enemiesSpawned`), VFXService (Knochen-Burst, bei blutenden Eltern ein Spritzer je Kind), EnemyDebugService (Kinder eines Debug-Gegners) | Getöteter Enemy hat sich geteilt (`enemy`, `children`); kommt nach seinem `enemy:died` und den `enemy:spawned` der Kinder |
| `worm:spawned` | EnemyManager (`spawn()` eines Typs mit `chain`) | GameStateSyncService (Rest und Gesamtzahl der Welle um `size - 1`), AIDataCollector (`enemiesSpawned`), BossBarComponent (ein Balken für den ganzen Wurm) | Ein Wurm wurde gespawnt (`head`, `group`); kommt nach dem `enemy:spawned` des Kopfes, die übrigen Segmente folgen mit eigenem `enemy:spawned` |
| `projectile:hit` | ProjectileManager | CombatEffectService | Projektil trifft (`projectile`, `target`, `damage`, `damageType`) |
| `dot:damage` | EnemyManager (`tickDamageOverTime()`) | CombatEffectService → DamageApplicationService | DOT-Tick (Poison, Burn) (`enemy`, `damage`, `sourceId`, `effectType`, `damageType`) |
| `tower:placed` | TowerManager | GameStateSyncService, VisualizationFacade, AIDataCollector | Tower gebaut (`tower`, `position`, `cost`). Die Kosten zieht `GameStateManager.placeTower()` (`TowerLifecycle.place()`) direkt ab |
| `tower:upgraded` | TowerLifecycle (`upgrade()`; auch bei `debug:max-upgrade-all-towers` über `maxUpgradeAll()`, dann mit `level: 0`, `cost: 0`) | GameStateSyncService, VisualizationFacade, AIDataCollector | Tower aufgewertet (`tower`, `level`, `cost`) |
| `tower:sold` | TowerManager | GameStateSyncService, VisualizationFacade, LosDebugService, AIDataCollector | Tower verkauft (`tower`, `refund`). Die Gutschrift macht `GameStateManager.sellTower()` (`TowerLifecycle.sell()`) direkt |
| `tower:selected` | TowerManager | GameStateSyncService, VisualizationFacade, LosDebugService | Tower ausgewählt (`tower`) |
| `tower:deselected` | TowerManager | GameStateSyncService, LosDebugService | Tower-Auswahl aufgehoben |
| `tower:kill` | DamageApplicationService | GameStateManager, GameStateSyncService | Kill einem Tower gutgeschrieben, `combat.kills` ist schon erhöht (`tower`). Der GameStateManager gibt den Veteranen-Rang an `TowerManager.refreshVeteranBadge` (Abzeichen über dem Tower). Beim gewählten Tower zählt `selectedTowerRevision` hoch, daraus leitet die Sidebar Kills, Stats und Rang ab |
| `wave:started` | WaveManager | GameStateSyncService, AIDataCollector, BackgroundMusicService | Welle gestartet (`wave`, `enemyCount`). Manuelle Debug-Wellen (`beginWave()`) melden `enemyCount: 0` |
| `game:started` | GameStateManager (vor der ersten Welle) | AIDataCollector | Spiel gestartet |
| `game:over` | GameStateManager (`triggerGameOver()`) | GameStateSyncService, GameLoopFacade, AIDataCollector, BackgroundMusicService, TrainingSession | Spiel beendet (`reason: 'base-destroyed' \| 'quit'`; emittiert wird nur `'base-destroyed'`) |
| `game:reset` | GameStateManager (`reset()`) | GameStateSyncService, BackgroundMusicService | Spiel zurückgesetzt |
| `credits:changed` | GameStateManager (`CreditsLedger`) | GameStateSyncService | Credits geändert (`credits`, `delta`) |
| `health:changed` | GameStateManager (`BaseHealthLedger`: Leaks und `debug:add-health`) | HQDamageService, ScreenShakeService, GameStateSyncService, AIDataCollector | Base Health geändert (`health`, `delta`) |
| `research:started` | ResearchManager | kein Listener (nur Event-Debugger über `onAny`) | Forschung gestartet (`researchId`, `cost`, `duration`) |
| `research:completed` | ResearchManager (auch `completeAllResearch()`) | GameStateSyncService (`applyResearchEffects`), GameStateManager (LOS-Neuberechnung, wenn Air-Targeting frei wird) | Forschung fertig (`researchId`, `effects`) |
| `research:cancelled` | ResearchManager | kein Listener (nur Event-Debugger über `onAny`) | Forschung abgebrochen (`researchId`, `refund`) |
| `research:state-changed` | ResearchManager | GameStateSyncService | **Snapshot-Event** nach jeder Research-Mutation (`activeResearches`, `completedResearches`, `queuedResearches`, `centerLevel`, `maxSlots`). Single Source of Truth fuer Store-Sync — ersetzt 2026-05-10 das direkte `syncResearchStoreState()`-Polling aus dem GameStateManager. |
| `research:progress` | ResearchManager | GameStateSyncService | Vergangene Spielzeit je laufender Forschung (`elapsed`), höchstens alle 100 ms Wanduhr. Füllt `ResearchStore.researchElapsed`, das den Fortschrittsbalken treibt |
| `ability:used` | AbilityManager (`use()`) | VFXService (je `abilityId`, Nuklearschlag: Zielmarker) | Nuklearschlag unterwegs, die Ladung ist verbraucht (`abilityId`, `strikeId`, `target` auf die Route gesnappt, `radiusM`, `warningMs`). Siehe [ABILITIES.md](ABILITIES.md) |
| `ability:impact` | AbilityManager (im Sub-Step des Einschlags) | VFXService, AudioService, ScreenShakeService (je `abilityId` aus einer Tabelle, siehe [ABILITIES.md](ABILITIES.md#darstellung)), AIDataCollector | Einschlag (`abilityId`, `strikeId`, `target`, `radiusM`, `hits`, `kills`). Die Kills bucht das Fairness-Gate als Leck |
| `ability:rejected` | AbilityManager (`use()`) | kein Listener (nur Event-Debugger über `onAny`) | Einsatz abgelehnt (`abilityId`, `reason`: `locked`, `no-charge`, `no-wave`, `no-route`, `unknown`) |
| `ability:state-changed` | AbilityManager | GameStateSyncService | **Snapshot-Event** nach Freischaltung, Einsatz, Einschlag und Nachladen (`abilities`). Füllt `GameStore.abilities` |

### Deferred Events (nicht-kritisch, queued)

Werden in `processQueue()` am Frame-Ende verarbeitet.

| Event | Producer | Consumer | Beschreibung |
|-------|----------|----------|--------------|
| `vfx:blood` | CombatVfxService | VFXService | Blut-VFX spawnen (`position`, `intensity`, `skipGroundDecal?`) |
| `vfx:projectile-impact` | ProjectileManager | VFXService, ScreenShakeService | Projektil-Einschlag VFX spawnen, einzige Quelle für Explosionen (`lat`, `lon`, `height`, `projectileType`, `targetLost`) |
| `vfx:muzzle-flash` | ProjectileManager (beim Abschuss) | VFXService | Muzzle-Flash VFX am Tower spawnen (`towerId`, `towerTypeId`) |
| `vfx:chain-lightning` | CombatEffectService (`emitChainLightningVfx()`, aufgerufen von TowerCombatService für den Lightning Tower) | VFXService → LightningBoltRenderer | Chain-Polyline rendern (`points` = Tip → primary → jumpN, `sourceTowerId`). Triggert pro Segment einen Bolt + lokalen Aufhell-Halo. |
| `audio:play` | ProjectileManager, TowerManager (Bau, Verkauf), HQDamageService | AudioService | 3D Sound abspielen (`sound`, `lat`, `lon`, `height`, `volume?`) |
| `wave:completed` | WaveManager (`endWave()`) | GameStateSyncService, GameStateManager (Tower in Wachrichtung drehen), AIDataCollector, BackgroundMusicService, TrainingSession | Welle abgeschlossen (`wave`, `credits`, `perfect`, `closeCall`, `hpLost`). Den Wave-Bonus bucht der GameStateManager im Update-Loop, nicht über dieses Event. Siehe Warnung unten. |

> **`wave:completed` ist kein verlaesslicher „jede Welle"-Hook.**
>
> 1. **Beim Game Over wird es nicht emittiert.** `endWave()` laeuft nur, wenn
>    die Welle regulaer fertig wird. Faellt die Basis, setzt
>    `GameStateManager.triggerGameOver()` die Phase direkt auf `gameover`. Wer
>    *jede* Welle sehen muss — inklusive der, die den Run beendet hat —, muss
>    an `AIDataCollectorService.onWaveResult()` haengen; das ist der einzige
>    Punkt, den beide Pfade passieren. Der `GateController` ist daran fast
>    gescheitert: sein Death-Backoff war ueber das Event schlicht unerreichbar.
> 2. **Reihenfolge gegen `game:over`.** Zerstoert der letzte Leaker einer Welle
>    die Basis, feuern beide fuer dieselbe Wave-Nummer. Der Wave-Complete-Check
>    laeuft zwar zuerst, aber `wave:completed` ist **deferred** und `game:over`
>    **immediate** — zugestellt wird der Game-Over-Pfad also zuerst, und das
>    Event kommt fuer eine bereits finalisierte Welle nach. Der Collector
>    verwirft es anhand der gemerkten Wave-Nummer.

### Debug Events

| Event | Producer | Consumer | Beschreibung |
|-------|----------|----------|--------------|
| `debug:sound` | SpatialAudioPlayback (deferred) | SoundDebugService | Sound-Debug-Events (`eventType`: play, stop, budget_exceeded, pool_exhausted, distance_culled; `soundId`, `timestamp`, `details?`) |
| `debug:add-credits` | DebugFacadeService | GameCommandsHandler → GameStateManager | Credits hinzufügen (`amount`) |
| `debug:add-health` | DebugFacadeService | GameCommandsHandler → GameStateManager.adjustBaseHealth() (emittiert `health:changed`) | Health hinzufügen (`amount`) |
| `debug:complete-all-research` | DebugFacadeService | GameCommandsHandler → ResearchManager | Alle Forschungen sofort abschließen |
| `debug:max-upgrade-all-towers` | DebugFacadeService | GameCommandsHandler → GameStateManager.maxUpgradeAllTowers() | Alle Tower auf Max-Level setzen, emittiert je Tower `tower:upgraded` |
| `debug:ready-ability` | DebugFacadeService (Cheat "Nuke", **deferred**) | GameCommandsHandler → ResearchManager.completeResearch() (Forschung samt Voraussetzungen, je `research:completed`), dann AbilityManager.refillCharges() | Fähigkeit sofort bereit (`abilityId`): freigeschaltet, alle Ladungen. Deferred, damit es im nächsten Sub-Step greift; in der Pause erst beim Weiterlaufen |
| `debug:remove-enemy` | EnemyDebugService (Enemy-Debug-Fenster: Entfernen-Knopf, „Clear All“ je Debug-Enemy) | EnemyManager, GameStateManager (Tower in Wachrichtung) | Einzelnen Enemy entfernen (`enemyId`) |
| `debug:start-custom-wave` | WaveDebuggerComponent | GameLoopFacade (`startCustomWave()`) | Custom Wave starten |
| `debug:spawn-enemy` | EnemyDebugService | EnemyManager | Enemy manuell spawnen (`enemyType`, `count?`, `path?`, `speed?`, `paused?`, `health?`) |
| `debug:kill-all` | DebugFacadeService | WaveManager (stoppt Spawns, tötet ohne Credits), GameStateSyncService (`waveEnemiesLeft` auf 0) | Alle Enemies töten |

### Command Events (UI → Game Engine)

> **Routing (2026-05-10):** Alle `command:*`-Subscriptions und die Cheat-Events
> `debug:add-credits`, `debug:add-health`, `debug:complete-all-research`,
> `debug:max-upgrade-all-towers` (seit 2026-09-13 auch `debug:ready-ability`) liegen in
> `GameCommandsHandler` (`managers/game-commands.handler.ts`).
> Vorher hingen die 11 Listener direkt am `GameStateManager`. Der Handler hält keinen State
> und delegiert an den GameStateManager bzw. dessen `towerManager` und `researchManager`.
> Die übrigen `debug:*`-Events abonnieren EnemyManager, WaveManager, GameLoopFacade,
> GameStateSyncService und SoundDebugService direkt.

| Event | Producer | Consumer | Beschreibung |
|-------|----------|----------|--------------|
| `command:place-tower` | TowerPlacementService (der Trainings-Bot ruft `GameStateManager.placeTower()` direkt) | GameCommandsHandler → GameStateManager.placeTower() | Tower platzieren (`position`, `typeId`, `rotation?`) |
| `command:sell-tower` | TowerDefenseFacade (der Trainings-Bot ruft `GameStateManager.sellTower()` direkt) | GameCommandsHandler → GameStateManager.sellTower() | Tower verkaufen (`towerId`) |
| `command:upgrade-tower` | GameLoopFacade (`upgradeTower()`, auch für den Trainings-Bot per Callback) | GameCommandsHandler → GameStateManager.upgradeTower() (`TowerLifecycle`: Kosten, Tier-Gating, emittiert `tower:upgraded`) | Tower upgraden (`towerId`, `upgradeId`) |
| `command:start-wave` | GameLoopFacade | GameCommandsHandler → GameStateManager.startWave() bzw. beginWave() → WaveManager | Welle starten (`config?`) |
| `command:restart-game` | GameLoopFacade | GameCommandsHandler → GameStateManager.reset() | Spiel neu starten |
| `command:start-research` | TowerDefenseComponent (`facade.emitCommand`), TrainingSession | GameCommandsHandler → ResearchManager | Forschung starten (`researchId`) |
| `command:cancel-research` | TowerDefenseComponent (`facade.emitCommand`), TrainingSession | GameCommandsHandler → ResearchManager | Forschung abbrechen (`researchId`) |
| `command:queue-research` | TowerDefenseComponent (nur Spieler) | GameCommandsHandler → ResearchManager | In die Warteschlange (`researchId`), kostet nichts. Fehlende Voraussetzungen (weder fertig, laufend noch eingereiht) kommen davor, die ganze Kette in Reihenfolge. Gestartet und bezahlt wird im Sub-Step nach `update()` (`ResearchManager.startQueued`), sobald ein Slot frei ist und das Gold reicht. Wer aufs Gold wartet, hält die Schlange, nichts dahinter überholt; wer auf eine Voraussetzung wartet, lässt den Nächsten an den Slot. Bots nutzen weiter `command:start-research`, das bei vollen Slots ablehnt |
| `command:unqueue-research` | TowerDefenseComponent | GameCommandsHandler → ResearchManager | Aus der Warteschlange nehmen (`researchId`), keine Erstattung, weil nichts bezahlt war. Was dahinter nur wegen dieser Voraussetzung stand, geht mit raus (ebenso beim Abbrechen einer laufenden Forschung) |
| `command:use-ability` | AbilityTargetingService (Klick im Zielmodus), TrainingSession (Bot-Aktion `use-ability`) | GameCommandsHandler → AbilityManager.use() | Fähigkeit einsetzen (`abilityId`, `target`); Antwort `ability:used` oder `ability:rejected` |

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
| **GameEventBus** | Nein | Core System | Event Bus mit 46 Event-Typen (incl. DOT, Research, Debug-Commands) |
| **VFXService** | Nein | Subscriber | Reagiert auf `vfx:*` Events |
| **AudioService** | Nein | Subscriber | Reagiert auf `audio:play` |
| **ScreenShakeService** | Nein | Subscriber | Reagiert auf `vfx:projectile-impact`, `health:changed`, `enemy:died` (Boss) |
| **BackgroundMusicService** | Nein | Subscriber | Reagiert auf `wave:started`, `wave:completed`, `game:over`, `game:reset` |
| **ProjectileManager** | Nein | Producer | Emittiert `projectile:hit`, `vfx:*`, `audio:play` |
| **EnemyManager** | Nein | Mixed | Emittiert `enemy:spawned`, `enemy:died`, `enemy:reached-base`, `enemy:leaking`, `enemy:split`, `worm:spawned`, `dot:damage`; reagiert auf `debug:*` (Spawn, Entfernen, Bewegung) |
| **WaveManager** | Nein | Mixed | Emittiert `wave:started`, `wave:completed`; reagiert auf `enemy:died`, `enemy:reached-base`, `enemy:leaking`, `debug:kill-all` |
| **TowerManager** | Nein | Producer | Emittiert `tower:placed`, `tower:sold`, `tower:selected`, `tower:deselected`, `audio:play` |
| **ResearchManager** | Nein | Producer | Emittiert `research:*` |
| **GameCommandsHandler** | Nein | Subscriber | Reagiert auf `command:*` und vier `debug:*`-Cheats, sucht den Tower heraus und ruft den GameStateManager; emittiert selbst nichts |
| **CombatEffectService** | Ja | Mixed | Reagiert auf `projectile:hit`, `dot:damage`, emittiert `vfx:chain-lightning` |
| **DamageApplicationService** | Ja | Producer | Emittiert `tower:kill` |
| **HQDamageService** | Ja | Mixed | Reagiert auf `health:changed`, emittiert `audio:play` |
| **GameStateSyncService** | Ja | Subscriber | Synchronisiert Game State mit Angular UI |
| **GameStateManager** | Ja | Adapter | Orchestriert Manager, emittiert `game:started`, `game:over`, `game:reset`; über seine Klassen in `managers/game-state/` außerdem `credits:changed`, `health:changed`, `tower:upgraded` |

---

## Debugging

### Event Debugger Panel

Das Event-Debugger-Panel zeigt alle Events in Echtzeit:

1. **Öffnen:** Quick Actions → Dev-Menü → Kachel „Event bus“
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
| `game-engine/game-event-bus.ts` | ~763 | Event Bus Core (GameEvent Union, Subscriptions, processQueue) |
| `game-engine/vfx.service.ts` | ~268 | VFX Event Handler, Zielmarker und Explosion des Nuklearschlags |
| `game-engine/audio.service.ts` | ~80 | Audio Event Handler, Sound des Nuklearschlags |
| `game-engine/background-music.service.ts` | — | Phasen-basiertes Crossfade-System |
| `game-engine/screen-shake.service.ts` | ~156 | Screen-Shake bei nahen Einschlägen, HQ-Schaden, Boss-Tod und Nuklearschlag |
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
