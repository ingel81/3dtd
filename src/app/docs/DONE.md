# Changelog

Chronologische Liste aller erledigten Features und Fixes (neueste zuerst).

---

## 2026-01-17

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
