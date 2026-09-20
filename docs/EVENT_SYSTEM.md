# Event System - Framework-Agnostic Event Bus

**Stand:** 2026-09-15, Listener per Grep nachgezogen (`wave:completed`-Semantik: 2026-09-07)

Das Event-System ermöglicht lose Kopplung zwischen Game-Engine Komponenten. Alle Manager kommunizieren über Events statt direkter Methodenaufrufe oder Callbacks.

---

## Übersicht

### Warum Event-System?

| Vorher | Nachher |
|--------|---------|
| 5 Manager mit `@Injectable()` | 1 Manager mit `@Injectable()` (GameStateManager) |
| 40+ Callbacks | 0 Callbacks (alle via Events) |
| Tight Coupling | Loose Coupling via Events |
| Angular-abhängig | Framework-agnostic (React/Vue/Vanilla JS kompatibel) |

### Architektur-Prinzip

- **Angular nur für UI** - Services mit `@Injectable()` nur für UI-Bindings
- **Game Engine framework-agnostic** - Alle Manager ohne Angular-Decorator
- **Events für Broadcasts** - `enemy:died`, `projectile:hit`, `wave:completed`
- **Spatial Grid für Queries** - Tower Targeting, AOE Damage

---

## Event-Typen

### Immediate Events (kritisch, blocking)

Werden sofort verarbeitet. Game State muss konsistent sein.

| Event | Producer | Consumer | Beschreibung |
|-------|----------|----------|--------------|
| `enemy:spawned` | EnemyManager | GameStateSyncService, AIDataCollector, EnemyDebugService, BossBarComponent (merkt sich Bosse, außer Wurm-Segmenten), BossIntroService (Boss aus dem Portal), MarkerVisualizationService (Spawn-Portal) | Enemy gespawnt (`enemy`; `viaPortal` true für einen Wellen-Spawn aus dem Spawn-Portal, `spawn(..., 'portal')`, bei Debug-Platzierungen und Split-Kindern false oder nicht gesetzt); bei einem Wurm jedes Segment, wenn es aus dem Portal kommt |
| `enemy:died` | EnemyManager (`kill()`, u.a. aus DamageApplicationService) | GameStateManager (Credits; außerhalb einer Welle Tower in Wachrichtung), GameStateSyncService, WaveManager, ScreenShakeService (Boss), AIDataCollector, RunStatsTracker (Kills) | Enemy gestorben (`enemy`, `credits`) |
| `enemy:reached-base` | EnemyManager, bei einer Ooze `OozeBodies` | GameStateManager (Schaden), WaveManager, GameStateSyncService, StateSnapshotService, LeakVignetteComponent (roter Rand, gedrosselt), RunLogCollector | Enemy am Ziel (`enemy`, `damage`) |
| `enemy:leaking` | EnemyManager (`OozeBodies.update`) | GameStateManager (Schaden, im selben Leck-Budget), WaveManager (`hpLost`), LeakVignetteComponent, AIDataCollector und RunStatsTracker (ab dem ersten Punkt einmal ein Leck, kein Kill mehr) | Eine Ooze fließt in die HQ: Schaden für die Meter, die hineingingen, in ganzen Punkten (`enemy`, `damage`). Ihr eines `enemy:reached-base` folgt, wenn der ganze Körper drin ist |
| `enemy:split` | EnemyManager (`kill()` mit Ursache `combat`, Typ mit `splitOnDeath`) | GameStateSyncService (Rest und Gesamtzahl der Welle), AIDataCollector (`enemiesSpawned`), VFXService (Knochen-Burst, bei blutenden Eltern ein Spritzer je Kind), EnemyDebugService (Kinder eines Debug-Gegners) | Getöteter Enemy hat sich geteilt (`enemy`, `children`); kommt nach seinem `enemy:died` und den `enemy:spawned` der Kinder |
| `worm:spawned` | EnemyManager (`spawn()` eines Typs mit `chain`) | GameStateSyncService (Rest und Gesamtzahl der Welle um `size - 1`), AIDataCollector (`enemiesSpawned`), BossBarComponent (ein Balken für den ganzen Wurm), BossIntroService (ein Intro für den ganzen Wurm) | Ein Wurm wurde gespawnt (`head`, `group`, `viaPortal` wie bei `enemy:spawned`; die Segmente selbst tragen es nicht); kommt nach dem `enemy:spawned` des Kopfes, die übrigen Segmente folgen mit eigenem `enemy:spawned` |
| `projectile:hit` | ProjectileManager | CombatEffectService | Projektil trifft (`projectile`, `target`, `damage`, `damageType`) |
| `dot:damage` | EnemyManager (`tickDamageOverTime()`) | CombatEffectService → DamageApplicationService | DOT-Tick (Poison, Burn) (`enemy`, `damage`, `sourceId`, `effectType`, `damageType`) |
| `tower:placed` | TowerManager | GameStateSyncService, DpsBinsOverlay (DPS-Anzeige der VisualizationFacade, nur solange sie an ist), AIDataCollector, RunStatsTracker, OnboardingService | Tower gebaut (`tower`, `position`, `cost`). Die Kosten zieht `GameStateManager.placeTower()` (`TowerLifecycle.place()`) direkt ab. GameStateSyncService führt daraus auch `GameStore.placedUniqueTypes` (Einmal-Gebäude, `TowerTypeConfig.unique`) |
| `tower:upgraded` | TowerLifecycle (`upgrade()`; auch bei `debug:max-upgrade-all-towers` über `maxUpgradeAll()`, dann mit `level: 0`, `cost: 0`) | GameStateSyncService, DpsBinsOverlay, AIDataCollector, OnboardingService | Tower aufgewertet (`tower`, `level`, `cost`) |
| `tower:sold` | TowerManager | GameStateSyncService, DpsBinsOverlay, LosDebugService, AIDataCollector, RunStatsTracker | Tower verkauft (`tower`, `refund`). Die Gutschrift macht `GameStateManager.sellTower()` (`TowerLifecycle.sell()`) direkt. Kommt, bevor der Tower aus der Tower-Liste geht |
| `tower:selected` | TowerManager | GameStateSyncService, VisualizationFacade, LosDebugService | Tower ausgewählt (`tower`) |
| `tower:deselected` | TowerManager | GameStateSyncService, LosDebugService | Tower-Auswahl aufgehoben |
| `tower:kill` | DamageApplicationService | GameStateSyncService | Kill einem Tower gutgeschrieben, `combat.kills` ist schon erhöht (`tower`). Das Abzeichen über dem Tower hängt nicht an diesem Event, es liest die Kills jeden Frame (`TowerManager.syncVeteranBadges`). Beim gewählten Tower zählt `selectedTowerRevision` hoch, daraus leitet die Sidebar Kills, Stats und Rang ab |
| `wave:started` | WaveManager | GameStateSyncService, AIDataCollector, BackgroundMusicService, BloodMoonService, BloodMoonBannerComponent, ReplayRecorder (startet die Aufnahme), GameLoopFacade (bricht den Auto-Wave-Countdown ab), RunStatsTracker, BestWaveService, OnboardingService, MarkerVisualizationService (Spawn-Portal) | Welle gestartet (`wave`, `enemyCount`). Manuelle Debug-Wellen (`beginWave()`) melden `enemyCount: 0` |
| `wave:jumped` | GameStateManager (`jumpToWave()`, Dev-Cheat) | GameStateSyncService (`waveNumber`), RunStatsTracker (Cheat-Gold), BestWaveService (Lauf zählt nicht mehr), ReplayRecorder (verwirft die Aufnahme), OnboardingService (übersprungene Wellen gelten als gespielt) | Zähler zwischen zwei Wellen vorgesetzt (`from` zuletzt gespielte Welle, `wave` nächster Start, `skipped`, `credits` Gold der übersprungenen Wellen, 0 ohne). Siehe [WAVE_SYSTEM.md](WAVE_SYSTEM.md#jump-to-wave) |
| `game:started` | GameStateManager (vor der ersten Welle eines Laufs, auch nach einem Wellensprung) | AIDataCollector | Spiel gestartet |
| `game:over` | GameStateManager (`triggerGameOver()`) | GameStateSyncService, GameLoopFacade, AIDataCollector, BackgroundMusicService, BloodMoonService, TrainingSession, BestWaveService, MarkerVisualizationService | Spiel beendet (`reason: 'base-destroyed' \| 'quit'`; emittiert wird nur `'base-destroyed'`) |
| `game:reset` | GameStateManager (`reset()`) | GameStateSyncService, BackgroundMusicService, BloodMoonService, BloodMoonBannerComponent, BossIntroService (bricht ein laufendes Intro ab, vergisst wartende Bosse), VFXService und AudioService (laufende Schläge und Nachhall weg), GameLoopFacade, RunStatsTracker, BestWaveService, OnboardingService, RefusalHintService, MarkerVisualizationService | Spiel zurückgesetzt |
| `credits:changed` | GameStateManager (`CreditsLedger`) | GameStateSyncService, RunStatsTracker | Credits geändert (`credits`, `delta`) |
| `health:changed` | GameStateManager (`BaseHealthLedger`: Leaks und `debug:add-health`) | HQDamageService, ScreenShakeService, GameStateSyncService, AIDataCollector, RunStatsTracker | Base Health geändert (`health`, `delta`) |
| `research:started` | ResearchManager | OnboardingService | Forschung gestartet (`researchId`, `cost`, `duration`) |
| `research:completed` | ResearchManager (auch `completeAllResearch()`) | GameStateSyncService (`applyResearchEffects`), GameStateManager (LOS-Neuberechnung, wenn Air-Targeting frei wird), AbilityManager und HeroManager (Freischaltung) | Forschung fertig (`researchId`, `effects`) |
| `research:cancelled` | ResearchManager | RunStatsTracker (Erstattung) | Forschung abgebrochen (`researchId`, `refund`) |
| `research:state-changed` | ResearchManager | GameStateSyncService, OnboardingService | **Snapshot-Event** nach jeder Research-Mutation (`activeResearches`, `completedResearches`, `queuedResearches`, `centerLevel`, `maxSlots`). Single Source of Truth für Store-Sync; ersetzt seit 2026-05-10 das direkte `syncResearchStoreState()`-Polling aus dem GameStateManager |
| `research:progress` | ResearchManager | GameStateSyncService | Vergangene Spielzeit je laufender Forschung (`elapsed`), höchstens alle 100 ms Wanduhr. Füllt `ResearchStore.researchElapsed`, das den Fortschrittsbalken treibt |
| `ability:used` | AbilityManager (`use()`) | VFXService (je `abilityId`, etwa der Zielmarker; mit `launch` die Rakete ab dem Silo, die im Silo ist sofort weg), AudioService (Sirene des Nuklearschlags; mit `launch` Zündung, Triebwerks-Loop und Pfeifen), ScreenShakeService (Start-Shake, nur mit `launch`), OnboardingService | Ein Schlag ist unterwegs, die Ladung ist verbraucht (`abilityId`, `strikeId`, `target` auf die Route gesnappt, `radiusM`, `warningMs`; bei einem Strahl `path`, der Weg, den er brennen wird; beim Nuklearschlag `launch`, Tower-ID und Grundposition des Missile Silo, von dem die Rakete startet). Siehe [ABILITIES.md](ABILITIES.md) |
| `ability:impact` | AbilityManager (im Sub-Step des Einschlags) | VFXService, AudioService, ScreenShakeService (je `abilityId` aus einer Tabelle, siehe [ABILITIES.md](ABILITIES.md#darstellung)) | Einschlag (`abilityId`, `strikeId`, `target`, `radiusM`; bei einem Strahl `path`, der Weg, den er brennt) |
| `ability:resolved` | AbilityManager (wenn der Schlag vorbei ist; bei einem Schlag, der sofort wirkt, direkt nach `ability:impact`) | AIDataCollector | Treffer und Kills eines Schlags (`abilityId`, `strikeId`, `hits`, `kills`). Die Kills bucht das Überlebbarkeits-Deckel als Leck |
| `ability:rejected` | AbilityManager (`use()`) | RefusalHintService (Hinweis, nur bei einem Einsatz des Spielers) | Einsatz abgelehnt (`abilityId`, `reason`: `locked`, `no-launch-site`, `no-charge`, `no-wave`, `no-route`, `unknown`; `no-launch-site`: kein Missile Silo steht) |
| `ability:state-changed` | AbilityManager | GameStateSyncService, OnboardingService, VFXService (Rakete im Silo sichtbar, solange eine Ladung bereit und kein Schlag unterwegs ist) | **Snapshot-Event** nach Freischaltung, Einsatz, Einschlag und Nachladen, und nach Bau und Verkauf eines Gebäudes, von dem eine Fähigkeit startet (`AbilityManager.buildingChanged`, aufgerufen von `TowerLifecycle`) (`abilities`). Füllt `GameStore.abilities` |
| `hero:kill` | DamageApplicationService (Kill eines Schusses mit Quelle `hero`, nach dessen `enemy:died`) | HeroManager (Kills, Stufe) | Der Held hat getötet (`enemy`). Für das Überlebbarkeits-Deckel ein Kill wie der eines Towers, kein Leck. Siehe [HERO.md](HERO.md) |
| `hero:level-up` | HeroManager | VFXService ("LEVEL N") | Neue Stufe durch Kills (`level`, `position`) |
| `hero:rejected` | HeroManager | RefusalHintService (Hinweis, nur bei einem Befehl des Spielers) | Befehl abgelehnt (`reason`: `locked`, `hired`, `credits`, `no-hero`, `no-route`, `unknown-ammo`) |
| `hero:state-changed` | HeroManager | GameStateSyncService, OnboardingService | **Snapshot-Event** nach Freischaltung, Anheuern, Befehl, Ankunft, Kill und Munitionswechsel (`hero`). Füllt `GameStore.hero` |

### Deferred Events (nicht-kritisch, queued)

Werden in `processQueue()` am Frame-Ende verarbeitet.

| Event | Producer | Consumer | Beschreibung |
|-------|----------|----------|--------------|
| `vfx:blood` | CombatVfxService | VFXService | Blut-VFX spawnen (`position`, `intensity`, `skipGroundDecal?`, `color?` aus `bloodColor` des Gegnertyps, sonst rot) |
| `vfx:projectile-impact` | ProjectileManager | VFXService, ScreenShakeService | Projektil-Einschlag VFX spawnen, einzige Quelle für Explosionen (`lat`, `lon`, `height`, `projectileType`, `targetLost`) |
| `vfx:muzzle-flash` | ProjectileManager (beim Abschuss) | VFXService | Muzzle-Flash VFX am Tower spawnen (`towerId`, `towerTypeId`) |
| `vfx:chain-lightning` | CombatEffectService (`emitChainLightningVfx()`, aufgerufen von TowerCombatService für den Lightning Tower) | VFXService → LightningBoltRenderer | Chain-Polyline rendern (`points` = Tip → primary → jumpN, `sourceTowerId`). Triggert pro Segment einen Bolt + lokalen Aufhell-Halo. |
| `audio:play` | ProjectileManager, TowerManager (Bau, Verkauf), HQDamageService, `OozeSounds` (Ooze) | AudioService | 3D Sound abspielen (`sound`, `lat`, `lon`, `height`, `volume?`) |
| `wave:completed` | WaveManager (`endWave()`) | GameStateSyncService, GameStateManager (Tower in Wachrichtung drehen), AIDataCollector, BackgroundMusicService, BloodMoonService, TrainingSession, AbilityManager (Ladungen je Welle), GameLoopFacade (Auto-Wave-Countdown), OnboardingService, MarkerVisualizationService | Welle abgeschlossen (`wave`, `credits`, `perfect`, `closeCall`, `hpLost`). Den Wave-Bonus bucht der GameStateManager im Update-Loop, nicht über dieses Event. Siehe Warnung unten. |

> **`wave:completed` ist kein verlässlicher „jede Welle"-Hook.**
>
> 1. **Beim Game Over wird es nicht emittiert.** `endWave()` läuft nur, wenn
>    die Welle regulär fertig wird. Fällt die Basis, setzt
>    `GameStateManager.triggerGameOver()` die Phase direkt auf `gameover`. Wer
>    *jede* Welle sehen muss, auch die, die den Run beendet hat, muss
>    an `StateSnapshotService.onWaveResult()` hängen; das ist der einzige
>    Punkt, den beide Pfade passieren. Der `LeakController` ist daran fast
>    gescheitert: sein Death-Backoff war über das Event schlicht unerreichbar.
> 2. **Reihenfolge gegen `game:over`.** Zerstört der letzte Leaker einer Welle
>    die Basis, feuern beide für dieselbe Wave-Nummer. Der Wave-Complete-Check
>    läuft zwar zuerst, aber `wave:completed` ist **deferred** und `game:over`
>    **immediate**: zugestellt wird der Game-Over-Pfad also zuerst, und das
>    Event kommt für eine bereits finalisierte Welle nach. Der Collector
>    verwirft es anhand der gemerkten Wave-Nummer.

### Debug Events

| Event | Producer | Consumer | Beschreibung |
|-------|----------|----------|--------------|
| `debug:sound` | SpatialAudioPlayback (deferred) | SoundDebugService | Sound-Debug-Events (`eventType`: play, stop, budget_exceeded, pool_exhausted, distance_culled; `soundId`, `timestamp`, `details?`) |
| `debug:add-credits` | DebugFacadeService | GameCommandsHandler → GameStateManager, RunStatsTracker (Cheat-Gold) | Credits hinzufügen (`amount`) |
| `debug:add-health` | DebugFacadeService | GameCommandsHandler → GameStateManager.adjustBaseHealth() (emittiert `health:changed`) | Health hinzufügen (`amount`) |
| `debug:complete-all-research` | DebugFacadeService | GameCommandsHandler → ResearchManager | Alle Forschungen sofort abschließen |
| `debug:max-upgrade-all-towers` | DebugFacadeService | GameCommandsHandler → GameStateManager.maxUpgradeAllTowers() | Alle Tower auf Max-Level setzen, emittiert je Tower `tower:upgraded` |
| `debug:ready-ability` | DebugFacadeService (Cheat "Abilities", **deferred**, eins je Fähigkeit) | GameCommandsHandler → ResearchManager.completeResearch() (Forschung samt Voraussetzungen, je `research:completed`), dann AbilityManager.refillCharges() | Fähigkeit sofort bereit (`abilityId`): freigeschaltet, alle Ladungen. Deferred, damit es im nächsten Sub-Step greift; in der Pause erst beim Weiterlaufen |
| `debug:jump-to-wave` | WaveDebuggerComponent (Abschnitt "Jump to wave") | GameCommandsHandler → GameStateManager.jumpToWave() (emittiert `wave:jumped`) | Nächster Start ist Welle `wave`, die Wellen davor übersprungen, mit `grantGold` samt ihrem Gold. Nur in Phase `setup`, siehe [WAVE_SYSTEM.md](WAVE_SYSTEM.md#jump-to-wave) |
| `debug:ready-hero` | DebugFacadeService (Cheat "Hero", **deferred**) | GameCommandsHandler → ResearchManager.completeResearch(), dann HeroManager.hire(0) | Forschung `mercenary-contract` samt Voraussetzungen, dann der Held umsonst angeheuert; ist er schon da, passiert nichts |
| `debug:remove-enemy` | EnemyDebugService (Enemy-Debug-Fenster: Entfernen-Knopf, „Clear All“ je Debug-Enemy) | EnemyManager, GameStateManager (Tower in Wachrichtung) | Einzelnen Enemy entfernen (`enemyId`) |
| `debug:start-custom-wave` | WaveDebuggerComponent | GameLoopFacade (`startCustomWave()`) | Custom Wave starten |
| `debug:spawn-enemy` | EnemyDebugService | EnemyManager | Enemy manuell spawnen (`enemyType`, `count?`, `path?`, `start?` für einen Punkt mitten auf dem Pfad, `speed?`, `paused?`, `health?`) |
| `debug:kill-all` | DebugFacadeService | WaveManager (stoppt Spawns, tötet ohne Credits), GameStateSyncService (`waveEnemiesLeft` auf 0), GameStateManager (Tower in Wachrichtung) | Alle Enemies töten |

### Command Events (UI → Game Engine)

> **Routing (2026-05-10):** Alle `command:*`-Subscriptions und die Cheat-Events
> `debug:add-credits`, `debug:add-health`, `debug:complete-all-research`,
> `debug:max-upgrade-all-towers` (seit 2026-09-13 auch `debug:ready-ability`, seit 2026-09-14
> `debug:jump-to-wave` und `debug:ready-hero`) liegen in
> `GameCommandsHandler` (`managers/game-commands.handler.ts`).
> Vorher hingen die 11 Listener direkt am `GameStateManager`. Der Handler hält keinen State
> und delegiert an den GameStateManager bzw. dessen `towerManager` und `researchManager`.
> Die übrigen `debug:*`-Events abonnieren EnemyManager, WaveManager, GameStateManager, GameLoopFacade,
> GameStateSyncService und SoundDebugService direkt.

| Event | Producer | Consumer | Beschreibung |
|-------|----------|----------|--------------|
| `command:place-tower` | TowerPlacementService (der Trainings-Bot ruft `GameStateManager.placeTower()` direkt) | GameCommandsHandler → GameStateManager.placeTower() | Tower platzieren (`position`, `typeId`, `rotation?`, `plinthHeight?` für den Sockel, `plinthOverhang?` für seine Stützen) |
| `command:sell-tower` | TowerDefenseFacade (der Trainings-Bot ruft `GameStateManager.sellTower()` direkt) | GameCommandsHandler → GameStateManager.sellTower() | Tower verkaufen (`towerId`) |
| `command:upgrade-tower` | GameLoopFacade (`upgradeTower()`, auch für den Trainings-Bot per Callback) | GameCommandsHandler → GameStateManager.upgradeTower() (`TowerLifecycle`: Kosten, Tier-Gating, emittiert `tower:upgraded`) | Tower upgraden (`towerId`, `upgradeId`) |
| `command:set-targeting` | TowerDefenseComponent (Targeting-Knöpfe im Tower-Panel, `facade.emitCommand`) | GameCommandsHandler → setzt `targetingStrategy` bzw. `airSubStrategy` am Tower | Zielwahl eines Towers (`towerId`, `strategy?`, `airSubStrategy?`); ein weggelassenes Feld bleibt. Bis 2026-09-14 setzte die Komponente die Felder direkt, der Weg über den Bus macht die Wahl für das Replay aufzeichenbar |
| `command:set-hold-fire` | TowerDefenseComponent (Knopf "Hold fire" im Tower-Panel, `facade.emitCommand`) | GameCommandsHandler → GameStateManager.setTowerHoldFire() (`TowerLifecycle.setHoldFire`) | Feuerpause eines Towers an oder aus (`towerId`, `holdFire`): `Tower.holdFire`, der Renderer graut das Modell aus, eine Flamme geht sofort aus. Ein passiver Tower (Forschungszentrum, Raketensilo) bleibt unverändert |
| `command:start-wave` | GameLoopFacade | GameCommandsHandler → GameStateManager.startWave() bzw. beginWave() → WaveManager | Welle starten (`config?`) |
| `command:restart-game` | GameLoopFacade | GameCommandsHandler → GameStateManager.reset() | Spiel neu starten |
| `command:start-research` | TowerDefenseComponent (`facade.emitCommand`), TrainingSession | GameCommandsHandler → ResearchManager | Forschung starten (`researchId`) |
| `command:cancel-research` | TowerDefenseComponent (`facade.emitCommand`), TrainingSession | GameCommandsHandler → ResearchManager | Forschung abbrechen (`researchId`) |
| `command:queue-research` | TowerDefenseComponent (nur Spieler) | GameCommandsHandler → ResearchManager | In die Warteschlange (`researchId`), kostet nichts. Gestartet und bezahlt wird im Sub-Step nach `update()` (`ResearchManager.startQueued`), sobald ein Slot frei ist und das Gold reicht; der Kopf der Schlange wartet, nichts dahinter überholt. Bots nutzen weiter `command:start-research`, das bei vollen Slots ablehnt |
| `command:unqueue-research` | TowerDefenseComponent | GameCommandsHandler → ResearchManager | Aus der Warteschlange nehmen (`researchId`), keine Erstattung, weil nichts bezahlt war |
| `command:use-ability` | AbilityTargetingService (Klick im Zielmodus), TrainingSession (Bot-Aktion `use-ability`) | GameCommandsHandler → AbilityManager.use() | Fähigkeit einsetzen (`abilityId`, `target`); Antwort `ability:used` oder `ability:rejected` |
| `command:hire-hero` | HeroControlService.hire (Held-Knopf der Fähigkeitenleiste vor dem Anheuern) | GameCommandsHandler → HeroManager.hire() | Held anheuern (Forschung, Credits, Route); Antwort `hero:state-changed` oder `hero:rejected`. Bots senden ihn nie |
| `command:hero-move` | HeroControlService (Klick bei gewähltem Helden) | GameCommandsHandler → HeroManager.moveTo() | Held zum nächsten Routenpunkt im Umkreis von 30 m schicken (`target`), der Weg wird im Befehl berechnet |
| `command:hero-ammo` | HeroControlService (Taste V, Helden-Panel) | GameCommandsHandler → HeroManager.setAmmo() | Munition laden (`ammo`: `standard`, `explosive`, `rune`) |

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
| **GameEventBus** | Nein | Core System | Event Bus mit 67 Event-Typen (die Union `GameEvent` in `game-event-bus.ts`) |
| **VFXService** | Nein | Subscriber | Reagiert auf `vfx:*`, `enemy:split`, `ability:used`, `ability:impact`, `ability:state-changed`, `hero:level-up`, `game:reset` |
| **AudioService** | Nein | Subscriber | Reagiert auf `audio:play`, `ability:used`, `ability:impact`, `game:reset` |
| **ScreenShakeService** | Nein | Subscriber | Reagiert auf `vfx:projectile-impact`, `health:changed`, `ability:used` (nur mit `launch`), `ability:impact`, `enemy:died` (Boss) |
| **BackgroundMusicService** | Nein | Subscriber | Reagiert auf `wave:started`, `wave:completed`, `game:over`, `game:reset` |
| **BloodMoonService** | Nein | Subscriber | Reagiert auf `wave:started`, `wave:completed`, `game:over`, `game:reset`; schaltet den Blutmond-Look (`engine.bloodMoon`) |
| **ProjectileManager** | Nein | Producer | Emittiert `projectile:hit`, `vfx:*`, `audio:play` |
| **EnemyManager** | Nein | Mixed | Emittiert `enemy:spawned`, `enemy:died`, `enemy:reached-base`, `enemy:leaking`, `enemy:split`, `worm:spawned`, `dot:damage`; reagiert auf `debug:spawn-enemy` und `debug:remove-enemy` |
| **WaveManager** | Nein | Mixed | Emittiert `wave:started`, `wave:completed`; reagiert auf `enemy:died`, `enemy:reached-base`, `enemy:leaking`, `debug:kill-all` |
| **TowerManager** | Nein | Producer | Emittiert `tower:placed`, `tower:sold`, `tower:selected`, `tower:deselected`, `audio:play` |
| **ResearchManager** | Nein | Producer | Emittiert `research:*` |
| **GameCommandsHandler** | Nein | Subscriber | Reagiert auf `command:*` und die sieben `debug:*`-Cheats (Credits, Health, Research, Max Up, Fähigkeiten, Held, Wellensprung), sucht den Tower heraus und ruft den GameStateManager; emittiert selbst nichts |
| **AbilityManager** | Nein | Mixed | Emittiert `ability:used`, `ability:impact`, `ability:resolved`, `ability:rejected`, `ability:state-changed`; reagiert auf `research:completed` (Freischaltung) und `wave:completed` (Ladungen) |
| **CombatEffectService** | Ja | Mixed | Reagiert auf `projectile:hit`, `dot:damage`, emittiert `vfx:chain-lightning` |
| **DamageApplicationService** | Ja | Producer | Emittiert `tower:kill`, bei Schüssen des Helden `hero:kill` |
| **HeroManager** | Nein | Mixed | Emittiert `hero:state-changed`, `hero:rejected`, `hero:level-up`; reagiert auf `research:completed`, `hero:kill` |
| **HQDamageService** | Ja | Mixed | Reagiert auf `health:changed`, emittiert `audio:play` |
| **GameStateSyncService** | Ja | Subscriber | Synchronisiert Game State mit Angular UI |
| **GameStateManager** | Ja | Adapter | Orchestriert Manager, emittiert `game:started`, `game:over`, `game:reset`, `wave:jumped`; über seine Klassen in `managers/game-state/` außerdem `credits:changed`, `health:changed`, `tower:upgraded`. Reagiert auf `enemy:died`, `enemy:reached-base`, `enemy:leaking`, `research:completed`, `wave:completed`, `debug:remove-enemy`, `debug:kill-all` |
| **UI-Dienste** | Ja, außer RunStatsTracker | Subscriber | RunStatsTracker (Bilanz fürs Game-Over), BestWaveService (Bestwelle je Ort), OnboardingService (Tipps), RefusalHintService (Hinweis bei `ability:rejected`, `hero:rejected`), MarkerVisualizationService (Spawn-Portal), LeakVignetteComponent, BossBarComponent, BossIntroService, BloodMoonBannerComponent; Events je Dienst in den Tabellen oben |
| **ReplayRecorder** | Nein | Subscriber (`onAny` nur während einer aufgenommenen Welle, sonst typisiert `wave:started`, `command:start-wave`, `wave:jumped`) | Nimmt die laufende Welle für das Replay auf: startet bei `wave:started`, liest Spawns, Tode, Lecks, `projectile:hit`, gebaute und verkaufte Tower, die Effekt-Events (`vfx:*`, `audio:play`, `ability:*`, `health:changed`, `enemy:split`, `hero:level-up`) und jedes `command:*`; `wave:started` der nächsten Welle und `wave:jumped` verwerfen die Aufnahme. Emittiert nichts. Der `ReplayPlayer` spielt die Effekt-Events später auf einem eigenen Bus ab. Siehe [REPLAY.md](REPLAY.md) |

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

`onAny` hört vor den typisierten Listenern desselben Events. Ein Wurf in
einem Catch-all-Listener wird gefangen und geloggt wie bei den typisierten:
er bricht `emit` nicht ab. Ohne Catch-all-Listener (`catchAllListenerCount`
0) bleibt `emit` auf seinem schnellen Pfad. Neben dem Event-Debugger nutzt es
der `ReplayRecorder`, damit jedes `command:*` im Log landet, auch eines, das
es beim Schreiben des Recorders noch nicht gab; er hängt nur dort, solange er
eine gerenderte Welle aufnimmt.

---

## Best Practices

### Immediate vs Deferred

| Verwende Immediate | Verwende Deferred |
|--------------------|-------------------|
| Game State Änderungen | VFX, Audio |
| Damage, Credits | UI Notifications |
| Kritische Logik | Nicht-kritische Effekte |

### Subscription Cleanup

```typescript
// SubscriptionBag für automatisches Cleanup
const bag = new SubscriptionBag();
bag.add(eventBus.on('enemy:died', handler1));
bag.add(eventBus.on('tower:placed', handler2));

// Bei Destroy
bag.disposeAll();
```

---

## Dateien

| Datei | Beschreibung |
|-------|--------------|
| `game-engine/game-event-bus.ts` | Event Bus Core (GameEvent Union, Subscriptions, processQueue) |
| `game-engine/vfx.service.ts` | VFX Event Handler, Zielmarker und Einschläge der Fähigkeiten |
| `game-engine/audio.service.ts` | Audio Event Handler, Einschlagsounds der Fähigkeiten |
| `game-engine/background-music.service.ts` | Phasen-basiertes Crossfade-System |
| `game-engine/screen-shake.service.ts` | Screen-Shake bei nahen Einschlägen, HQ-Schaden, Boss-Tod und Fähigkeiten |
| `game-engine/blood-moon.service.ts` | Blutmond-Look an und aus |
| `game-engine/index.ts` | Barrel Exports |
| `components/debug-window/event-debugger.component.ts` | Debug Panel |

---

## Performance

Geschätzt, nicht gemessen (so auch der Kommentar über `GameEventBus`):

- Event Emission: ~50-100ns pro Event
- Typische Last: ~50 Events/Frame @ 60 FPS
- Overhead: ~5μs/Frame (0.03% des 16ms Budgets)

---

## Siehe auch

- [ARCHITECTURE.md](ARCHITECTURE.md) - Gesamt-Architektur
- [WAVE_SYSTEM.md](WAVE_SYSTEM.md) - Wave Events
- [PROJECTILES.md](PROJECTILES.md) - Projektil Events
