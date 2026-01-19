# Changelog

Chronologische Liste aller erledigten Features und Fixes (neueste zuerst).

---

## 2026-01-20

- [x] **Codebase auf Englisch umgestellt** - Vollständige Übersetzung
      ~20 Dateien: UI-Strings, Tooltips, Error-Messages, Loading-States, Kommentare
      Services, Components, HTML-Templates, Config-Dateien

---

## 2026-01-19

- [x] **TowerDefenseComponent Aufteilung abgeschlossen** - Keine weitere Aufteilung nötig
      ~1797 Zeilen, davon Großteil Signal-Proxies, Lifecycle-Hooks und Service-Delegierungen
      21 Services injiziert, Komponente fungiert korrekt als Orchestrator

- [x] **Event Debug Panel Position Fix** - Panel springt nicht mehr beim Öffnen
      `constrainToViewport()` mit `requestAnimationFrame` verzögert, damit DOM korrekte Größe hat

- [x] **Browser Geolocation API** - Automatische Standortermittlung implementiert
      `GeolocationService` mit Fallback-Kaskade: Browser GPS/WLAN → IP-API (ip-api.com)

- [x] **World Dice** - Random Street Generator
      Wikidata SPARQL für zufällige Stadt + Overpass API für Straße
      Würfel-Button in Header + Location-Dialog

- [x] **World Dice Loading Feedback** - Loading Overlay beim Würfeln
      Steps: "Würfle Stadt..." (mit Detail) → "Lade Karte..." (mit Stadtname)

- [x] **Location Sharing via URL** - Shareable Links funktionieren
      URL-Parameter `?l=lat,lon&s=spawns` aktiv, Share-Button kopiert Link

### Game Engine - Event Bus System (Phase 10 abgeschlossen)

- [x] **game:over Event (Phase 10a)**
      - `onGameOverCallback` aus GameStateManager entfernt
      - GameStateManager emittiert `game:over` Event mit `reason: 'base-destroyed' | 'quit'`
      - `getEventBus()` Getter hinzugefügt für externe Subscriptions
      - TowerDefenseComponent subscribed zu `game:over` Event
      - LocationChangeCoordinatorService: `onGameOver` aus Interface entfernt

- [x] **EventBusDebugPanel (Phase 10b)**
      - Neue Komponente: `event-debugger.component.ts`
      - Zeigt alle Events in Echtzeit via `eventBus.onAny()`
      - Filter nach Kategorie: enemy, tower, wave, game, vfx, audio
      - Farbcodierte Event-Typen mit Timestamp
      - Pause/Resume und Clear-Funktion
      - **Resizable Panel** mit persistierter Größe
      - Button in QuickActions (cell_tower Icon)
      - GameEventBus erweitert um `onAny()` und `debugListeners`

- [x] **DraggableDebugPanel Resize-Feature**
      - `[resizable]` Input (default: false)
      - `[size]` Input und `(sizeChange)` Output
      - Resize-Handle unten rechts (drag_indicator Icon)
      - Min-Size: 300x200px, Viewport-Constraints
      - DebugWindowService: `WindowSize` Interface, `updateSize()`, `getSize()`
      - Größe wird im localStorage persistiert (v4)

- [x] **Event Cleanup**
      - `damage:dealt` Event entfernt (redundant mit `projectile:hit`)
      - Lint-Fixes: eslint-disable für legitimes `any`, unused vars

- [x] **Event Bus Core implementiert**
      - `GameEventBus` mit 20 Event-Typen (discriminated unions)
      - Immediate Events (`emit`) für game-kritische Aktionen
      - Deferred Events (`emitDeferred`) für VFX/Audio
      - `processQueue()` am Frame-Ende
      - WeakMap-basiertes Subscription-Tracking

- [x] **Manager auf Event-System umgestellt**
      - `ProjectileManager`: emittiert `projectile:hit`, `vfx:projectile-impact`
      - `EnemyManager`: emittiert `enemy:died`, `enemy:reached-base`
      - `WaveManager`: emittiert `wave:started`, `wave:completed`
      - Alle drei: `@Injectable` entfernt, Constructor Injection
      - Provider aus TowerDefenseComponent entfernt

- [x] **Services event-driven**
      - `VFXService`: subscribed zu `vfx:projectile-impact`
      - `CombatEffectService`: subscribed zu `projectile:hit`
      - `handleProjectileHit()` aus GameStateManager entfernt

- [x] **Audio via Events (Phase 7)**
      - `AudioService`: subscribed zu `audio:play` Events
      - Event-Typ `audio:play` auf Geo-Koordinaten erweitert (`lat`, `lon`, `height`)
      - `ProjectileManager`: emittiert `audio:play` statt direktem `spatialAudio.playAtGeo()`
      - `HQDamageService`: emittiert `audio:play`, `initialize()` um `eventBus` erweitert
      - Neue Datei: `src/app/game-engine/audio.service.ts` (56 LOC)

- [x] **TowerManager refactored (Phase 8)**
      - `@Injectable()` entfernt, Constructor Injection `(eventBus, osmService)`
      - Emittiert `tower:placed` mit cost, neue `sell()` Methode emittiert `tower:sold`
      - Event-Typ `tower:placed` auf `GeoPosition` geändert (statt Vector3)
      - GameStateManager: `inject(OsmStreetService)` + manuelle TowerManager-Erstellung
      - Provider aus TowerDefenseComponent entfernt
      - **Alle 4 Entity-Manager jetzt framework-agnostic!**

- [x] **health:changed Event (Phase 9)**
      - GameStateManager emittiert `health:changed` statt direkter HQDamageService-Aufrufe
      - HQDamageService subscribed zu `health:changed` (Fire-Intensity + Damage-Sound)
      - Direkter `updateFireIntensity()` Aufruf aus Game-Loop entfernt
      - HQDamageService jetzt vollständig event-driven

- [x] **Architektur-Prinzip umgesetzt**
      - Angular nur fuer UI, Game Engine framework-agnostic
      - Hybrid: Events fuer Broadcasts, Spatial Grid fuer Queries
      - Dokumentation: [EVENT_SYSTEM.md](EVENT_SYSTEM.md)

### Refactoring
- [x] **Koordinaten-Typen vereinheitlicht**
      - Alle Typen auf `GeoPosition` ({lat, lon, height?}) konsolidiert
      - `LocationCoords` Interface entfernt (war identisch zu GeoPosition)
      - `latitude/longitude` überall zu `lat/lon` geändert (~50 Stellen)
      - `SpawnPoint` Interfaces konsolidiert (marker-visualization.service.ts als Quelle)
      - Betroffene Dateien: location.types.ts, wave.manager.ts, tower-placement.service.ts,
        street-rendering.service.ts, location-change-coordinator.service.ts, tower-defense.component.ts, u.a.

- [x] **LocationChangeCoordinatorService extrahiert**
      - Neue Datei: `src/app/services/location-change-coordinator.service.ts` (406 Zeilen)
      - `onApplyNewLocation()` von 215 auf 60 Zeilen reduziert
      - 7 Step-Methoden für Location-Change-Sequenz
      - Callback-Pattern für Component-Interaktion
      - TowerDefenseComponent: 1.954 → 1.799 Zeilen (-155)
      - GOD Object Refactoring Phase 2 komplett abgeschlossen

### Bugfixes
- [x] **Route Overlay "Routen anzeigen"** funktioniert wieder korrekt
      - Problem: Bei fehlendem Terrain (`originTerrainY === null`) wurde `showPathFromSpawn()` beendet ohne Route Line zu erstellen
      - Fix: Fallback auf `0` statt `return` - Route Line wird immer erstellt
      - Datei: `path-route.service.ts`

- [x] **Wave Debug Panel Delay** wirkt sich jetzt auf laufende Welle aus
      - Problem: `spawnDelay` wurde einmal zu Beginn der Welle gespeichert und nie aktualisiert
      - Fix: Neues `getSpawnDelay?: () => number` in `WaveConfig` - wird bei jedem Spawn aufgerufen
      - Dateien: `wave.manager.ts`, `tower-defense.component.ts`

- [x] **Route-Grid Animation beschleunigt sich mit jeder Wave**
      - Game Loop wurde bei jeder Wave erneut gestartet ohne den alten zu stoppen
      - Mehrere Loops liefen parallel → `updateAnimation()` wurde N-mal pro Frame aufgerufen
      - Fix: Guard in `startGameLoop()` verhindert mehrfache Loops

### UI
- [x] **Scrollbar Styling für Debug Panels**
      - Neue Theme-Konstanten: `TD_SCROLLBAR_STYLES`, `TD_SCROLLBAR_WEBKIT`
      - Dunkles Theme passend zum WC3-Style (Frame-Farben)
      - Cross-browser: Firefox (scrollbar-color) + Webkit (::-webkit-scrollbar)
      - Angewendet auf: event-debugger, sound-debugger, draggable-debug-panel

- [x] **Text-Selektion in UI deaktiviert**
      - `user-select: none` auf body
      - Input/Textarea bleiben selektierbar

### Architektur
- [x] **Game Loop Refactoring - Immer laufend**
      - **Problem**: Game Loop stoppte bei Wave-Ende → Projektile froren ein, Türme drehten nicht zu Idle
      - **Lösung**: Kein separater Game Loop mehr, alles über Engine-Callback `onEngineUpdate()`
      - Phase kontrolliert WAS passiert, nicht OB der Loop läuft
      - `startGameLoop()` komplett entfernt
      - `gameState.update()` refactored: Projektile + Tower-Idle immer, Rest nur während Wave
      - `killAllEnemies()` vereinfacht: Wave endet automatisch via `checkWaveComplete()`

---

## 2026-01-18

### Pathfinding
- [x] **Gewichtetes Pathfinding nach Straßentyp**
      - Primäre Straßen (primary, secondary, tertiary) bevorzugt
      - Residential/Service Straßen mit höherem Gewicht bestraft
      - Sauberer A* Algorithmus mit Typ-basiertem Weighting

### Loading & UX
- [x] **3D-Tiles Stats im Loading Screen**
      - Zeigt "Warte auf 3D-Kacheln (X Kacheln geladen)"
      - Retry-Mechanismus für sporadische 0-Tiles Probleme
      - Detaillierte Debug-Logs für Troubleshooting
- [x] **Detaillierter Loading-Screen**
      - Separater Loading-Step "Warte auf 3D-Kacheln"
      - Benutzerfreundliche Fehlermeldungen für OSM und WebGL
      - Zeigt einzelne Schritte: Route, Assets, Tiles
- [x] **Console-Trenner bei Location-Wechsel**
      - `═══════ Location Change: [Name] ═══════` zur besseren Übersicht
- [x] **Internationale Nominatim-Suche**
      - `accept-language: *` Header für weltweite Ergebnisse
      - Nicht mehr auf deutsche Ergebnisse beschränkt
- [x] **Robustes Location-Loading**
      - Error-Handling für fehlgeschlagene OSM-Requests
      - Graceful Degradation bei Netzwerkproblemen

### Bugfixes
- [x] **Retry-Mechanismus für 3D-Tiles Loading nach F5**
      - Fix für sporadisches "0 Kacheln geladen" Problem
      - Max 50 Retries á 200ms (10 Sekunden gesamt)
      - Force-Update bei persistentem Problem
      - Siehe [TILES_LOADING_BUG.md](TILES_LOADING_BUG.md) für Details
- [x] **Zombie-Textur Dateiname korrigiert**

### Refactoring
- [x] **Asset-Struktur vereinheitlicht und reorganisiert**
      - Konsistente Ordnerstruktur für Models, Textures, Audio
      - Alle Assets unter `assets/` mit klarer Hierarchie

### Performance: Assets
- [x] **Skybox WebP Conversion** - 48MB → 0.6MB (99% Reduktion!)
      - 8192×4096 JPEG → 4096×2048 WebP
      - `kloppenheim_06_puresky.webp`: 124KB (vorher 19MB)
      - `qwantani_night_puresky.webp`: 532KB (vorher 29MB)

### Audio System Refactoring
- [x] **Sound-Systeme konsolidiert** - Zentrale Loop-Verwaltung im SpatialAudioManager
      - `AudioComponent.activeLoops` → `SpatialAudioManager.activeLoops`
      - Neue API: `createLoop()`, `updateLoopPosition()`, `pauseLoop()`, `resumeLoop()`, `stopLoop()`
      - AudioComponent ist jetzt dünner Wrapper mit `loopHandles` Map
      - Distance-Culling und Enemy-Budget zentral verwaltet
      - Audio-Pool wird jetzt auch für Loops genutzt (vorher nur One-Shots)
- [x] **LRU Audio Buffer Cache** - Begrenzt auf 20 Buffers
      - `bufferAccessOrder[]` für LRU-Tracking
      - `evictOldestBuffers()` entfernt älteste Einträge bei Überschreitung
      - Verhindert unbegrenztes Wachstum (~30MB decoded Audio)

### 🔴 Performance Prio 1: Kritisch (alle erledigt)

- [x] **Shadow Flags entfernen** - GPU-Zyklen verschwendet für nie gerenderte Shadows
- [x] **Event Listener Cleanup** - Memory Leak bei Location-Wechsel behoben
- [x] **Timeout Cleanup bei Reset** - Timeouts feuern nicht mehr nach Game-Reset
- [x] **RxJS takeUntilDestroyed** - Subscription Leaks behoben
- [x] **Three.js Named Imports** - Tree-Shaking ermöglicht, -400KB Bundle
- [x] **herbert_talk.mp3 gelöscht** - 1.6MB unbenutzte Datei entfernt
- [x] **localStorage → IndexedDB** - StreetCacheService für große Caches
- [x] **OnPush ChangeDetection** - Alle 16 Components umgestellt
- [x] **Distance Audio Culling** - Sounds pausieren bei 500m+ Entfernung
- [x] **Material Pooling** - Shared Materials pro Enemy-Typ statt Clone pro Instanz

### UI/UX
- [x] **Tooltips im Baumenü nach links**
  - `matTooltipPosition="left"` für Tower-Cards und Upgrade-Buttons
  - Verhindert Überlappen mit rechtem Bildschirmrand

### Camera & Controls
- [x] **Shift + WASD/Pfeiltasten für schnelleres Panning**
  - Normal: 80 m/s, mit Shift: 200 m/s
  - `KeyboardPanService` trackt jetzt Shift-Modifier

### Air Tower Visualisierung
- [x] **Air Tower zeigen alle Zellen in Reichweite grün**
  - Pure Air Tower (`canTargetAir && !canTargetGround`) überspringen LOS-Checks
  - `isPureAirTower` Parameter in `registerTower()` und `createPlacementPreview()`
  - Sowohl nach dem Bauen als auch im Baumodus (Preview) korrekt

### Performance & Storage
- [x] **Straßen-Cache von LocalStorage auf IndexedDB migriert**
  - `StreetCacheService` (bereits implementiert) jetzt in `OsmStreetService` integriert
  - Unterstützt 50-100+ MB statt 5-10 MB localStorage Limit
  - LRU-Eviction (max. 5 Locations gecacht)

### Bugfix
- [x] **Grid/Tower-Visualisierung Flashing - präventiver Fix**
  - `animationTime` wird jetzt gewrappt um Float-Präzisionsprobleme bei langen Sessions zu vermeiden
  - Problem war schwer reproduzierbar (1x aufgetreten)

### Monetarisierung
- [x] **Ad-Banner System implementiert**
  - `AdBannerComponent` mit WC3-Style Design
  - Monetag Vignette Banner Integration (Zone 10479931)
  - Ads werden nur in Production geladen (`environment.production`)
  - Adblocker-Detection mit Bait-Element-Methode
  - Fallback-Panel bei Adblocker: Ko-fi Spenden-Button + GitHub Star
  - Komponente in Sidebar integriert (über Footer)
  - Kontextabhängige Größe vorbereitet (compact-Mode für aktive Wellen)

### Code Quality
- [x] **Environment-basierte Ad-Konfiguration**
  - Kein Ad-Script in index.html (dynamisches Laden)
  - Nur Production-Builds zeigen Werbung
  - Development bleibt werbefrei für bessere DX

### Performance & Privacy
- [x] **Self-hosted Fonts (kein Google CDN)**
  - `@fontsource/roboto` und `material-icons` npm Packages
  - Fonts werden lokal aus dem Bundle geladen
  - Keine externen Requests zu Google (DSGVO-konform)
  - Schnelleres Laden (kein DNS-Lookup, kein Roundtrip)

### DevOps
- [x] **FTP-Deploy optimiert (nur geänderte Dateien)**
  - `dangerous-clean-slate: false` statt true
  - FTP-Action speichert State in `.ftp-deploy-sync-state.json`
  - Nur neue/geänderte Dateien werden hochgeladen
  - Alte Dateien mit alten Hashes werden automatisch gelöscht
  - Deutlich schnellere Deploys nach initialem Sync

---

## 2026-01-17

### Neue Features
- [x] **Magic Tower mit animiertem Orb**
  - Neues `magic_tower.glb` Model mit `tower_top` Orb-Teil
  - Hover-Animation: sanftes Auf/Ab-Schweben (Amplitude 0.006, Speed 0.6 Hz)
  - Idle-Rotation: langsame kontinuierliche Drehung wenn kein Ziel (0.3 rad/s)
  - Zufälliger Phasen-Offset pro Tower für desynchronisierte Animationen
  - `tower_top` zu erkannten Turret-Part-Namen hinzugefügt
  - Sound bereits konfiguriert (`magic_cast.mp3` für fireball)

### Bugfixes
- [x] **Platzierte Tower bleiben grün nach Build-Preview**
  - `cloneModel()` im AssetManager klont jetzt alle Materialien tief
  - Verhindert Shared-State zwischen Model-Instanzen
  - Betrifft: Build-Preview, platzierte Tower, Baumenü-Previews

### Code Quality & Architektur
- [x] **Globaler Asset Manager** - 4 separate Model-Caches konsolidiert
  - Neuer `AssetManagerService` mit zentralem GLTFLoader/FBXLoader
  - Reference Counting fuer korrekte GPU-Resource Disposal (Memory Leak gefixt!)
  - Betroffene: ThreeTowerRenderer, ThreeEnemyRenderer, ModelPreviewService, TowerPlacementService
  - ~218 Zeilen duplizierter Code entfernt
  - Siehe: [EXPERT_REVIEW_2026.md#62-empfehlung-globaler-asset-manager](EXPERT_REVIEW_2026.md#62-empfehlung-globaler-asset-manager)

### Bugfixes
- [x] **Wave endet nicht wenn alle Gegner tot sind**
  - Root Cause: `kill()` dekrementierte `aliveCount` nur wenn `enemy.alive` true war
  - Problem: `takeDamage()` setzte bereits `alive=false` bevor `kill()` aufgerufen wurde
  - Fix: `aliveCount` wird jetzt immer in `kill()` dekrementiert (killingEnemies Set verhindert doppelte Zählung)
- [x] **Gegneranzahl zeigte gespawnte statt lebende Gegner**
  - Gleiche Ursache wie oben - `aliveCount` wurde bei Kills nicht reduziert
  - Fix behebt beide Bugs gleichzeitig

### Performance Optimierungen
- [x] **Splash-Damage via Grid-Lookup optimiert**
  - `GlobalRouteGrid.getEnemiesInRadius()` nutzt Zellen-basierte Suche
  - O(cells_in_radius) statt O(all_enemies) mit Haversine-Distanz
  - Betrifft: Cannon (16m), Ice-Shard (12m) Splash-Damage
  - `EnemyManager.getEnemiesInRadius()` als @deprecated markiert
- [x] **Reusable Vectors in ThreeEffectsRenderer**
  - `tempVelocity` als Klassenvariable statt `velocity.clone()` pro Partikel
  - 3 Hotspots in update() optimiert (Effect-Particles, Trail-Additive, Trail-Normal)
  - ~99% weniger GC-Druck bei Partikel-Updates
- [x] **Cached getAlive() Result im EnemyManager**
  - Array wird gecacht und nur bei spawn/kill/remove/clear invalidiert
  - getAliveCount() nutzt jetzt direkt das Signal statt Array-Allokation
- [x] **Fast-Distance statt Haversine fuer lokale Berechnungen**
  - `geoDistanceFast()` Wrapper in geo-utils.ts hinzugefuegt
  - projectile.entity.ts: 2x geoDistance → geoDistanceFast
  - ellipsoid-sync.ts: haversineDistance → fastDistance (6x schneller)
  - Flat-Earth Approximation ausreichend genau fuer <200m Game-Distanzen

### Sound System Audit & Performance Fixes
- [x] **Kritische Memory Leaks behoben**
  - setTimeout-Referenzen werden jetzt getrackt und bei Cleanup gecleaned
  - stopAll() entfernt jetzt ordentlich alle Container aus der Scene
  - Audio.disconnect() wird bei jedem Cleanup aufgerufen
  - Enemy Timer (randomSoundTimer) werden bei destroy() robuster gestoppt
- [x] **PositionalAudio-Pooling implementiert**
  - Pool von 20 vorallozierten PositionalAudio-Objekten (wächst bis 50)
  - Reduziert Garbage Collection Pressure erheblich
  - Bei 100 Arrow-Sounds/Sekunde: 0 neue Objekte statt 100/s
- [x] **Race Condition im Budget-System gefixt**
  - Enemy-Sound-Budget wird sofort registriert (vor await-Calls)
  - Verhindert Budget-Überschreitung bei parallelen Sound-Anfragen
  - Alle Early-Exit-Pfade cleanen jetzt ordentlich das Budget
- [x] **Algorithmus-Optimierungen**
  - stop() Methode: O(n²) → O(n) durch direktes Filtern statt indexOf+splice
  - update() bereits optimal (Position wird 1x berechnet für alle Loops)
- [x] **Error Recovery verbessert**
  - Retry-Mechanismus: 3 Versuche bei Buffer-Ladefehlern mit 1s Delay
  - Besseres Logging für Debugging
- [x] **Code-Vereinheitlichung**
  - Enemy-Sound-Erkennung zentralisiert in SpatialAudioManager
  - Nutzt ENEMY_SOUND_PATTERNS aus audio.config.ts (inkl. herbert)
  - Duplizierte isEnemySound() Methode in AudioComponent entfernt
- [x] **Dokumentation aktualisiert**
  - SPATIAL_AUDIO.md mit Performance-Optimierungen-Sektion erweitert

### Dokumentation (Phase 2 - Lücken schließen)
- [x] **Geo-Utils vollständig dokumentiert** (ARCHITECTURE.md Sektion 8.1)
  - haversineDistance vs fastDistance erklärt
  - Wann welche Funktion verwenden (Hot-Path vs Einmalig)
  - Performance-Vergleich (7x schneller bei fastDistance)
  - Beispiele und Migration-Guide
  - "Jedes Mal ein Thema" → Jetzt klar dokumentiert
- [x] **Blood & Fire Effects ausführlich dokumentiert** (ARCHITECTURE.md Sektion 11)
  - Blood Decal System: Instanced Rendering, Custom Shader, Config
  - Fire Effects: Intensitätsstufen, Partikel+Sound+Licht, Lifecycle
  - Performance-Details (500 Decals = 2 Draw Calls statt 700)
  - Konfiguration in visual-effects.config.ts
- [x] **Tower Upgrade System dokumentiert** (TOWER_CREATION.md)
  - Upgrade-Konfiguration (Stats, Multi-Level, Kosten)
  - Code-Beispiele für applyUpgrade()
  - Range-Upgrade Spezialfall (LOS-Grid Neuberechnung)
  - Praktische Beispiele (Archer Single, Magic Multi-Level)
- [x] **ARCHITECTURE.md Animation-Sektion gekürzt**
  - Von 40 auf 25 Zeilen reduziert
  - Verweise auf ENEMY_CREATION.md für Details
  - Fokus auf Architektur-Übersicht

### Dokumentation (Phase 1 - Neue Docs)
- [x] **ENEMY_CREATION.md erstellt**
  - Analog zu TOWER_CREATION.md
  - Enemy-Typen erstellen mit Animationen, Audio, Visual Effects
  - Run-Animation-System, Air Units, Boss Enemies dokumentiert
  - Checkliste und Troubleshooting
- [x] **STATUS_EFFECTS.md erstellt**
  - Status-Effekt-System vollständig dokumentiert
  - Slow-Effect Stacking-Verhalten erklärt
  - Freeze und Burn (geplant) beschrieben
  - Performance-Optimierungen dokumentiert
- [x] **WAVE_SYSTEM.md erstellt**
  - Wave-Management und Spawning-System dokumentiert
  - Gathering-Phase, Spawn-Modi (each/random)
  - Progressive Difficulty, Boss Waves
  - Testing und Debugging
- [x] **ARCHITECTURE.md Dateistruktur korrigiert**
  - `game/` Subfolder-Fehler behoben (Zeilen 728-813)
  - Korrekte Ordnerstruktur (kein game/ Subfolder)
  - Config-Dateien und Utils ergänzt
  - Docs-Liste aktualisiert
- [x] **INDEX.md aktualisiert**
  - Drei neue Dokumentationen hinzugefügt
  - Schnellnavigation erweitert
- [x] **TODO.md aktualisiert**
  - Erledigte Dokumentations-Tasks entfernt

### Magic Tower
- [x] **Magic Tower implementiert**
  - Grundgerüst mit Stats: 40 DMG, 70 Range, 1.5 Feuerrate, 150 Credits
  - Upgrade: "Arkane Macht" (+50% Schaden, 3 Stufen)
  - Custom GLSL Shader für magische Projektile:
    - Pulsierender Glow-Effekt (wirbelnde Voronoi + FBM Patterns)
    - Farbverlauf: Violett → Cyan → Weiß
    - Fresnel Edge-Glow, Additive Blending
  - Trail-Partikel (violett-cyan, additive)
  - Sound-Config vorbereitet (magic_cast.mp3)
  - Verwendet Archer-Model als Placeholder

### Performance
- [x] **Instanced Decal Rendering**
  - Blood/Ice Decals auf InstancedMesh umgestellt
  - Custom Shader für Decals (fade-out, color tinting)
  - ~250 Draw Calls → 2 Draw Calls (1 Blood-Pool, 1 Ice-Pool)
  - Decal-Farben und Settings in visual-effects.config.ts ausgelagert

### LOS & Tower Placement
- [x] **LOS Berechnung performanter machen**
  - Progressive LOS Preview: 25 Zellen pro Frame statt alle auf einmal
  - Radiiert vom Turm-Zentrum nach außen (visuell ansprechend)
  - Debounced bei 150ms um FPS-Drops zu vermeiden
- [x] **Keine LOS Berechnung bei ungültiger Position**
  - LOS Preview wird nur berechnet wenn Turm-Position valid ist
  - Bei "zu nah an Straße" etc. wird Preview übersprungen

### UI Improvements
- [x] **Tower Info Panel redesigned**
  - Stats als 2x2 Kacheln mit Icons (Schaden, Reichweite, Feuerrate, Kills)
  - Upgrade-Button größer und prominenter mit Gold-Gradient
  - Verkaufen-Button subtiler (transparent, rot bei Hover)
  - Baumenü versteckt wenn Tower selektiert (CSS display:none)
- [x] **Range Indicator vereinfacht**
  - Doppelter Ring (weiß + gold) durch einzelnen Gold-Ring ersetzt

### Fixes
- [x] **Game Over Cleanup**
  - Tower-Overlays und LOS-Visualisierungen korrekt bei Game Over
  - Particle Pool Exhaustion bei HQ Explosion gefixt (stopFireImmediate)
- [x] **Game Restart nach Game Over**
  - GlobalRouteGrid wird bei Restart neu initialisiert
  - Debug-Visualisierung wird korrekt neu erstellt
  - Enemies werden aus Grid entfernt bei clear()

---

## 2026-01-16

### Dokumentation
- [x] **DONE.md zu Changelog umstrukturiert**
  - Chronologische Sortierung (neueste zuerst)
  - Datumsabschnitte für bessere Übersicht
- [x] **CLAUDE.md aktualisiert**
  - TODO/DONE Beschreibung erweitert (Changelog-Format erklärt)
  - Service/Manager-Anzahl war bereits korrekt (19/7)
  - Dokumentations-Tabelle bereits vollständig
- [x] **src/app/README.md gelöscht**
  - Komplett veraltet (POC-Status, falsche Tower-Liste, alte APIs)
  - Ersetzt durch CLAUDE.md und docs/

### Effects & Explosions
- [x] **Projektile fliegen weiter wenn Ziel stirbt**
  - Projektil speichert letzte Zielposition wenn Gegner mid-flight stirbt
  - Flugbahn wird fortgesetzt zur letzten bekannten Position
  - Explosion am Boden (terrainHeight + 1)
  - Kein Damage-Handler bei Ground-Impact (nur visueller Effekt)
  - Betrifft alle Projektiltypen (Cannon, Rocket, Ice, etc.)
- [x] **Explosionshöhe für Air Units korrigiert**
  - Ice/Fire Explosionen erscheinen jetzt auf korrekter Höhe bei Luftgegnern
  - Berechnung: terrainHeight + heightOffset (+ 2 nur für Bodeneinheiten)
  - Fledermäuse: Explosion auf 15m Flughöhe statt am Boden
- [x] **HQ Explosion bei Zerstörung**
  - Massive 3-Phasen-Explosion (1350 Partikel total)
  - Phase 1: 450 Partikel zentrale Explosion
  - Phase 2: 600 Partikel Ring-Expansion
  - Phase 3: 300 Partikel aufsteigende Glut
  - Bestehendes Feuer wird zu Inferno skaliert (nicht ersetzt)
  - Feuer bleibt permanent (auch während Game Over Screen)
  - Game Over Screen nach 3 Sekunden
- [x] **Explosionen bei Rocket/Cannon Treffern**
  - Rocket: 50 Partikel, Radius 8
  - Cannon: 35 Partikel, Radius 6
  - Konfigurierbar via EXPLOSION_PRESETS in visual-effects.config.ts

### Code Quality (Expert Review Quick Wins)
- [x] **visual-effects.config.ts erstellen** - Partikel/Decal-Configs zentralisiert
  - Neues `configs/visual-effects.config.ts` mit PARTICLE_LIMITS, DECAL_CONFIG, FIRE_INTENSITY, EXPLOSION_PRESETS, EFFECT_COLORS
  - Entfernt hardcoded Werte aus three-effects.renderer.ts
- [x] **audio.config.ts erstellen** - Sound-Configs zentralisiert
  - Neues `configs/audio.config.ts` mit AUDIO_LIMITS, ENEMY_SOUND_PATTERNS, SPATIAL_AUDIO_DEFAULTS, GAME_SOUNDS
  - Entfernt aus: spatial-audio.manager.ts, game-state.manager.ts
- [x] **game-balance.config.ts erstellen** - Game Balance Werte zentralisiert
  - Neues `configs/game-balance.config.ts` mit player, waves, combat, effects, fire
  - Entfernt hardcoded Werte aus game-state.manager.ts
- [x] **PROJECTILE_SOUNDS in Config verschoben**
  - Sound-Konfiguration von projectile.manager.ts nach projectile-types.config.ts
  - Saubere Config-Struktur mit Interface `ProjectileSoundConfig`
- [x] **placement.config.ts erstellen** - Placement-Constraints dedupliziert
  - Neues `configs/placement.config.ts` mit MIN/MAX_DISTANCE Konstanten
  - Entfernt aus: tower.manager.ts, tower-placement.service.ts
- [x] **Reusable Vectors in ProjectileRenderer** - Object Allocation in Update-Loop eliminiert
  - Statische `_tempPos`, `_tempRot`, `_tempScale` in ProjectileInstanceManager
  - Keine `new Vector3()`/`new Quaternion()` mehr pro Frame
- [x] **GeoUtilsService erstellen** - Haversine-Distanzberechnung 5x dedupliziert
  - Neues `utils/geo-utils.ts` mit `haversineDistance()`, `fastDistance()`, `geoDistance()`
  - Entfernt aus: enemy.manager.ts, tower.manager.ts, game-state.manager.ts, projectile.entity.ts, movement.component.ts

---

## Frühere Änderungen (undatiert)

### Tower
- [x] **ICE Tower mit Slow Effekt**
  - Splash Damage Type (Gegner im Radius betroffen)
  - Generelles Debuff-System mit Statuseffekten
  - Kann Air und Ground Targets treffen
  - Wenig Schaden, primär für Slow-Effekt
  - Blauer Ice Partikel-Effekt für Projektil-Trail
  - Eis-Explosion beim Auftreffen
  - Hellblaue Eis-Decals auf dem Boden (analog Blutflecken)

### LOS (Line of Sight)
- [x] **Statisches Pfad-LOS-Grid**
  - 2m Grid entlang Route (±7m Korridor)
  - Bei Tower-Platzierung vorberechnet
  - O(1) Lookup zur Laufzeit
  - Shader-basierte Visualisierung mit Pulsing-Animation
- [x] **Tower LOS-Prüfung von Hülle statt Mitte**
  - Tower prüfen LOS ab ihrer äußeren Hülle, nicht vom Mittelpunkt
  - Relevant wenn Tower auf Gebäuden steht
- [x] **Hex-Grid Line-of-Sight Visualisierung**
  - Flat-Top Hexagon-Grid über Turm-Reichweite
  - Grün = sichtbar, Rot = blockiert (durch Gebäude)
  - LineOfSightRaycaster raycastet von Turm-Spitze zu Hex-Zellen
  - hasLineOfSight() API für Targeting-Entscheidungen
  - Gebäude-Verdeckung funktioniert via 3D-Tiles Mesh-Intersection

### Rendering
- [x] **Rocket Tower Helligkeit angepasst** - War dunkler texturiert als andere Tower
- [x] **Partikeleffekte für Projektile**
  - Raketen: große Partikel + Explosion
  - Normale Projektile: kleinere Partikel, keine Explosion
  - Archer: keine Partikel
- [x] **Dual Gatling Bogen-Bug gefixt** - Schoss fälschlicherweise im Bogen statt geradeaus
- [x] **Leuchtspurmunition für Dual Gatling** - Dezente, kleine Leuchtspureffekte
- [x] **Cannon, Magic, Sniper Tower deaktiviert** - Vorübergehend aus dem Spiel genommen

### Performance
- [x] **Animationen laufen langsamer bei niedrigen FPS** - Gefixt
  - Ursache war hardcoded 16ms statt echter deltaTime
  - Fix: Echte deltaTime Berechnung in three-tiles-engine.ts
- [x] **Straßen-Overlay FPS-Drop gefixt** (35 FPS → 144 FPS)
  - Problem: 200-600 separate THREE.Line Objekte mit je geklontem Material
  - Fix: Alle Straßensegmente in ein THREE.LineSegments mit Merged BufferGeometry
  - Ergebnis: 1 Draw Call statt 600+, ~10x bessere Performance
- [x] **Straßen-Rendering in großen Städten optimiert** (Berlin: 14s → <1s)
  - Problem: renderStreets() rief getTerrainHeightAtGeo() für jeden Node auf
  - Fix: Route-Korridor-Filterung (nur Straßen im 100m-Korridor um Route)
  - Ergebnis: 5000 → 150 Straßen, 50.000 → 1.500 Nodes
- [x] **A* Graph-Caching**
  - Problem: buildGraph() wurde bei jedem findPath() Aufruf neu erstellt
  - Fix: Graph einmal bauen und cachen (getOrBuildGraph)

### UI
- [x] **Location Dialog Styling** - An TD-Style angepasst (gleicher Background, kein Purple)
- [x] **Info Overlay** als transparente Angular Component oben links
  - Zuschaltbar über Button in Quick Actions
  - Zeigt: FPS, Tiles, Aktive Gegner, Aktive Sounds, Straßen-Count
- [x] **Wave Debug Component optimiert**
  - Kamera Debug und Log Textarea entfernt
  - Heal HQ und Kill Wave Buttons repariert
  - Slider erweitert: Anzahl bis 5000, Speed bis 100 m/s
- [x] **Sidebar neu strukturiert** (WC3/Ancient Command Style)
  - WELLE Section: Wave-Nummer, Gegner-Count, "Naechste Welle" Button
  - BAUEN Section: Tower-Buttons mit Kosten
  - TOWER Section: Details bei Selektion (Name, Stats, Upgrade/Verkaufen)
  - DEBUG Section
- [x] **3D Model Previews in Sidebar**
  - ModelPreviewService mit geteiltem WebGL-Renderer
  - Tower-Grid: 2x2 Kacheln mit rotierenden 3D-Modellen
  - Enemy-Preview: Animierter Gegner (Walk-Animation)
  - Siehe docs/MODEL_PREVIEW.md

### Kamera
- [x] **Kamera zurücksetzen Button repariert**
- [x] **Initiale Position optimiert** - 45° Blickwinkel, Blickrichtung Norden, HQ im Zentrum
- [x] **Automatisches Framing von HQ + Spawns**
  - Initiale Kamera zeigt HQ und alle Spawn-Punkte im Bild
  - Dynamische Kamera-Positionierung seitlich zur HQ-Spawn-Achse
- [x] **Kompass-Overlay** - Oben rechts, rotiert mit Kamera-Heading

### Gegner
- [x] **Spawn-Verhalten optimiert**
  - Gegner spawnen verzögert (konfigurierbar via Slider)
  - "Gegner sammeln sich..." Phase optional (Gathering Mode)
- [x] **Blutsystem**
  - Blutflecken bei Treffer und Tod
  - Decals faden nach 20s aus

### Projektile
- [x] **Line-of-Sight für Projektile** - Projektile erreichen Ziel nur bei bestehender Sichtverbindung

### Türme
- [x] **Tower Selektion** - Klick auf Tower selektiert ihn, Selection Ring Animation
- [x] **Tower-Details in Sidebar** - Name, Schaden, Reichweite, Feuerrate, Kills, Verkaufen-Button
- [x] **Radius-Anzeige** - Terrain-konform via TerrainRaycaster

### Gameplay
- [x] **Location-System** - User kann eigene Location wählen (siehe docs/LOCATION_SYSTEM.md)
- [x] **Spawn-Punkte** - Zufällig 500m-1km vom HQ, muss auf Straße liegen

### Audio
- [x] **Spatial Audio** - Soundlautstärke abhängig von Kameraentfernung (siehe docs/SPATIAL_AUDIO.md)

### Allgemein
- [x] **Route-Animation (Knight Rider Effekt)**
  - Animierte Visualisierung der Gegner-Route beim Spielstart
  - Leuchtende rote/orange Dashes laufen von Spawn → HQ
- [x] **Koordinaten-Paste im Location-Dialog**
  - Unterstützte Formate: Dezimal, DMS, Cardinal, Google Maps URLs

### Bug Fixes
- [x] **CesiumIonAuthPlugin Import-Pfad aktualisiert**
- [x] **Feuer am HQ bei Damage** funktioniert jetzt zuverlässig
- [x] **Gegner laufen nicht mehr in der Luft** am HQ
- [x] **Tower Selektion bei Pan** - Kein Deselect mehr bei Mausbewegung
- [x] **Tower Selektion/Deselektion** - Frischer Raycaster pro Aufruf (LoS korrumpierte Zustand)
- [x] **WASD in Eingabefeldern** - Keyboard-Events werden in Input-Feldern nicht mehr abgefangen
