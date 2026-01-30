# GameEventBus Analyse — Abhängigkeiten & Verbesserungen

> **ARCHIVIERT** — Analyse ist historisch. Viele Punkte wurden im Refactoring (01/2026) behoben. Aktuelle Architektur: siehe [ARCHITECTURE.md](../ARCHITECTURE.md) und [EVENT_SYSTEM.md](../EVENT_SYSTEM.md).

## Zusammenfassung
- 10 harte Abhängigkeiten gefunden
- 5 fehlende Event-Nutzungen
- 2 falsche/suboptimale Nutzungen

## Aktuelle Event-Nutzung (Matrix)

| Datei | Emits | Subscribes | Direkte Imports |
|-------|-------|------------|-----------------|
| enemy.manager.ts | enemy:spawned, enemy:died, enemy:reached-base | – | EntityPoolService, GlobalRouteGridService, ThreeTilesEngine |
| tower.manager.ts | tower:placed, tower:sold, tower:selected, tower:deselected, audio:play | – | OsmStreetService, ThreeTilesEngine |
| wave.manager.ts | wave:started, wave:completed (deferred) | – | EnemyManager |
| game-state.manager.ts | health:changed, game:over | enemy:reached-base, enemy:died | TowerManager, EnemyManager, ProjectileManager, WaveManager, TowerCombatService, CombatEffectService, HQDamageService, GlobalRouteGridService, u.a. |
| projectile.manager.ts | projectile:hit, projectile:missed (deferred), vfx:projectile-impact (deferred), audio:play (deferred) | – | EntityPoolService, ThreeTilesEngine |
| spatial-audio.manager.ts | debug:sound (deferred) | – | GameEventBus |
| tower-combat.service.ts | – | – | TowerManager, EnemyManager, ProjectileManager, CombatEffectService, GlobalRouteGridService |
| combat-effect.service.ts | – | projectile:hit | TowerManager, EnemyManager, GlobalRouteGridService |
| tower-placement.service.ts | – | – | GameStateManager, GlobalRouteGridService, OsmStreetService, AssetManagerService |
| tower-defense.component.ts | – | tower:selected, debug:start-custom-wave, game:over, tower:placed/sold/upgraded | GameStateManager, viele Services/Debugs |

## Harte Abhängigkeiten (Detail)

### 1. wave.manager.ts → EnemyManager
- **Was:** `enemyManager.spawn()`, `enemyManager.clear()`, `enemyManager.getAliveCount()`
- **Warum problematisch:** Wave-Logik ist direkt an EnemyManager gekoppelt; erschwert Tests/Mocks.
- **Vorschlag:** WaveManager emittiert Spawn-/Reset-Events (z.B. `wave:spawn-enemy`, `wave:reset`) und EnemyManager subscribed.
- **Aufwand:** Mittel

### 2. combat-effect.service.ts → EnemyManager
- **Was:** `enemyManager.kill()` direkt nach Schaden
- **Warum problematisch:** Kampf-Logik koppelt Schaden/Death direkt an Manager; Event-Flow wird umgangen.
- **Vorschlag:** Event „enemy:damage“ oder „enemy:kill-request“ emittieren, EnemyManager verarbeitet.
- **Aufwand:** Mittel

### 3. combat-effect.service.ts → TowerManager
- **Was:** `towerManager.getById()` um Kills zu zählen
- **Warum problematisch:** Tight coupling; Kills zählen könnte auch als Event erfolgen.
- **Vorschlag:** Event `enemy:died`/`combat:kill` an Tower-Stats-Tracker; TowerManager/Stats-Service subscribed.
- **Aufwand:** Niedrig–Mittel

### 4. tower-combat.service.ts → ProjectileManager
- **Was:** `projectileManager.spawn()`
- **Warum problematisch:** Combat-Service hängt direkt am ProjectileManager.
- **Vorschlag:** Event `projectile:spawned` (neu) und ProjectileManager subscribed.
- **Aufwand:** Mittel

### 5. tower-combat.service.ts → CombatEffectService
- **Was:** Beam-Damage ruft `combatEffectService.applyBeamDamage()` direkt
- **Warum problematisch:** Beam-Logik kennt Effekt-Service; erschwert Austausch/Testing.
- **Vorschlag:** Event `combat:beam-damage` oder Nutzung vorhandener Damage-Events.
- **Aufwand:** Mittel

### 6. tower-placement.service.ts → GameStateManager
- **Was:** `gameState.placeTower()`, `gameState.towers()`, `gameState.deselectAll()`
- **Warum problematisch:** UI-Placement hängt direkt an GameStateManager; schwerer austauschbar.
- **Vorschlag:** UI sendet `tower:place-request` Event; GameStateManager/TowerManager entscheidet.
- **Aufwand:** Mittel

### 7. game-state.manager.ts → TowerManager/EnemyManager/ProjectileManager/WaveManager
- **Was:** direkte Kontrolle über Manager im Update-Loop und Reset
- **Warum problematisch:** zentraler God-Object; Manager-Kommunikation läuft über Methoden statt Events.
- **Vorschlag:** Event-gesteuerte Koordination (z.B. `game:reset`, `wave:completed` → Listener kümmern sich um Cleanup)
- **Aufwand:** Hoch

### 8. game-state.manager.ts → HQDamageService
- **Was:** `hqDamage.triggerGameOverEffects()` direkt
- **Warum problematisch:** visuelle Effekte können über `game:over` Event laufen.
- **Vorschlag:** HQDamageService subscribed auf `game:over` (teilweise schon via health:changed), GameStateManager nur emit.
- **Aufwand:** Niedrig–Mittel

### 9. tower-defense.component.ts → gameState.enemyManager (Debug)
- **Was:** direkte Aufrufe `enemyManager.spawn/remove` für Debug-Tools
- **Warum problematisch:** UI-Komponente kennt Manager-Details.
- **Vorschlag:** Debug-Events (`debug:spawn-enemy`, `debug:remove-enemy`) und Debug-Service subscribed.
- **Aufwand:** Niedrig–Mittel

### 10. tower-combat.service.ts → GlobalRouteGridService
- **Was:** direkte LOS/visibility Queries
- **Warum problematisch:** Combat hängt direkt an Grid-Implementierung.
- **Vorschlag:** Abstraktion/Adapter oder Event-basiertes „visibility updated“.
- **Aufwand:** Mittel

## Fehlende Event-Nutzung

### 1. Credits-Änderungen (Event vorhanden, nicht genutzt)
- **Aktuell:** `GameStateManager` ändert `credits` direkt (z.B. bei Kill, Tower-Kauf, Wave-Bonus, Verkauf)
- **Besser:** `credits:changed` emitten und UI/Services subscriben
- **Benefit:** Konsistente, zentrale Credits-Logik + bessere Testbarkeit

### 2. VFX-Events werden umgangen
- **Aktuell:** `CombatEffectService` ruft `tilesEngine.effects.spawnExplosion/blood/...` direkt
- **Besser:** `vfx:blood` / `vfx:explosion` / `vfx:projectile-impact` via EventBus (VFXService)
- **Benefit:** Saubere Trennung von Combat-Logik und Rendering

### 3. Game-Lifecycle-Events (game:started/paused/resumed) fehlen
- **Aktuell:** Keine Emission dieser Events in `GameStateManager`
- **Besser:** Lifecycle-Aktionen emitten, UI/Audio/Stats subscriben
- **Benefit:** Einheitlicher State-Flow ohne direkte Coupling-Calls

### 4. Tower-Upgrades
- **Aktuell:** `tower:upgraded` wird in den analysierten Dateien nirgends emitted
- **Besser:** Upgrades emitten, damit UI/Stats/VFX reagieren können
- **Benefit:** Trennung von Upgrade-Logik und UI/Effekten

### 5. Debug-Funktionen (Spawn/Kill/Reset)
- **Aktuell:** Debug-UI ruft Manager direkt
- **Besser:** `debug:*` Events (z.B. `debug:spawn-enemy`, `debug:kill-all`)
- **Benefit:** Debug-Modus ohne direkte Manager-Abhängigkeit

## Falsche/Suboptimale Nutzung

### 1. audio:play wird synchron emitted
- **Problem:** `tower.manager.ts` nutzt `eventBus.emit({ type: 'audio:play' })`
- **Fix:** `eventBus.emitDeferred(...)` (Audio ist als deferred markiert)

### 2. VFX-Events nicht deferred
- **Problem:** Direkte VFX-Calls umgehen das Deferred-Queueing (Frame-Stabilität)
- **Fix:** VFX über `emitDeferred` via VFXService

## Empfohlene Refactoring-Reihenfolge

1. **credits:changed Events** (niedriges Risiko, hohe Klarheit)
2. **audio:play auf emitDeferred umstellen**
3. **VFX-Effekte über EventBus routen**
4. **Tower-Upgrade & Game-Lifecycle Events ergänzen**
5. **Wave/Combat → Event-basierte Requests** (spawn/kill/beam-damage)
6. **UI/Debug → Event-Commands statt direkter Manager-Calls**
7. **Schrittweise Entkopplung GameStateManager (God-Object reduzieren)**
