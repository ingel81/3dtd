# Erledigte Features & Fixes

Fixes:
 [x] **CesiumIonAuthPlugin Import-Pfad aktualisiert**
     - Warning: "Plugin has been moved to 3d-tiles-renderer/core/plugins"
     - Fix: Import-Pfad in three-tiles-engine.ts von `'3d-tiles-renderer/plugins'` auf `'3d-tiles-renderer/core/plugins'` geändert

Allgemein:
 [x] **Koordinaten-Paste im Location-Dialog**
     - Eingabefelder für HQ-Koordinaten akzeptieren kombinierte lat/lon beim Paste
     - Unterstützte Formate: Dezimal (49.123, 9.456), DMS, Cardinal (N/S/E/W), Google Maps URLs
     - Automatisches Parsen und Aufspliten in Lat/Lon-Felder
 [x] **Route-Animation (Knight Rider Effekt)**
     - Animierte Visualisierung der Gegner-Route beim Spielstart
     - Leuchtende rote/orange Dashes laufen von Spawn → HQ
     - 3 Durchläufe, dann Fade-Out
     - Line2 + LineMaterial für dicke Linien (5px)
     - dashOffset-Animation für Bewegungseffekt
     - Pulsierender Glow + Farbshift für Eyecatcher-Effekt
     - Debug-Button im Dev-Menü zum manuellen Auslösen
     - RouteAnimationService in services/route-animation.service.ts
 [x] **Route-Animation Timing & Optik optimiert**
     - Animation auf 1/3 der Zeit verkürzt
     - Sanfteres Ein-/Ausfaden mit minimalen Unterschieden in der Rottönung
     - Animation stoppt erst nach dem Ausblenden (nicht vorher)

Bug:
 [x] Feuer am HQ bei Damage durch Gegner funktioniert jetzt zuverlässig
 [x] Gegner laufen am HQ angekommen die letzte Etappe in der Luft
     - Fix: Gegner bleiben am Boden und laufen ins Gebäude rein
 [x] ist ein turm selektiert und man macht mit der LMB ein Pan und lässt los, wird der turm deselektiert. das soll nicht sein
     - Fix: Pointerdown mit capture tracken, Pixel-Distanz prüfen (> 5px = Pan)
     - Direkte Mesh-Raycasting für Tower-Selektion (statt Terrain-basiert)
 [x] Tower Selektion/Deselektion funktionierte nicht zuverlässig nach erstem Select
     - Fix: Frischen THREE.Raycaster() pro Aufruf erstellen
     - Grund: LoS-Raycasting korrumpierte den geteilten Raycaster-Zustand

Performance:
 [x] **Animationen laufen langsamer bei niedrigen FPS** - Gefixt
     - Ursache war hardcoded 16ms statt echter deltaTime
     - Fix: Echte deltaTime Berechnung in three-tiles-engine.ts
 [x] **Straßen-Overlay FPS-Drop gefixt** (35 FPS → 144 FPS)
     - Problem: 200-600 separate THREE.Line Objekte mit je geklontem Material
     - Jede Straße = 1 Draw Call → 200-600 Draw Calls
     - Fix: Alle Straßensegmente in ein THREE.LineSegments mit Merged BufferGeometry
     - Ergebnis: 1 Draw Call statt 600+, ~10x bessere Performance
     - Datei: tower-defense.component.ts, renderStreets()
 [x] **Straßen-Rendering in großen Städten optimiert** (Berlin: 14s → <1s)
     - Problem: renderStreets() rief getTerrainHeightAtGeo() für jeden Node auf
     - Bei Berlin: 12 MB Straßendaten = ~50.000 Nodes = 50.000 Raycasts pro Render
     - renderStreets wurde 5x aufgerufen (onTilesLoaded) = ~75 Sekunden total
     - Fix: Route-Korridor-Filterung
       1. Volle Straßendaten laden (für A* Pathfinding)
       2. Route berechnen
       3. Nur Straßen im 100m-Korridor um Route behalten
       4. Rest verwerfen vor dem Rendering
     - Ergebnis: 5000 → 150 Straßen, 50.000 → 1.500 Nodes
     - Dateien: osm-street.service.ts (filterStreetsNearRoutes), tower-defense.component.ts
 [x] **A* Graph-Caching**
     - Problem: buildGraph() wurde bei jedem findPath() Aufruf neu erstellt
     - Fix: Graph einmal bauen und cachen (getOrBuildGraph)
     - Datei: osm-street.service.ts

Allgemein:
 [x] Soundlaustärke abhängig von Kamerentfernung (kein cutoff - natürliches Verhalten)
     - SpatialAudioManager mit Three.js PositionalAudio implementiert
     - Sounds werden automatisch leiser bei Entfernung (inverse distance model)
     - Siehe docs/SPATIAL_AUDIO.md

Gegner:
 [x] **Spawn-Verhalten optimiert**
     - Gegner spawnen verzögert (konfigurierbar via Slider)
     - "Gegner sammeln sich..." Phase optional (Gathering Mode)
     - Verzögerter Start: Gegner laufen nacheinander los statt im Pulk
 [x] Blutsystem (Gegner hinterlassen Blutflecken bei Treffer und Tod)
     - ThreeEffectsRenderer.spawnBloodSplatter() für Partikel-Effekte
     - ThreeEffectsRenderer.spawnBloodDecal() für persistente Blutflecken am Boden
     - Bei Treffer: kleine Blut-Partikel (15) + kleiner Decal (0.8m)
     - Bei Tod: große Blut-Partikel (40) + großer Decal (2.0m)
     - Decals faden nach 20s aus (über 10s)

Projektile:
 [x] Sichtbarkeit (erledigt)
 [x] **Line-of-Sight für Projektile**
     - Projektile erreichen Ziel nur bei bestehender Sichtverbindung zum Gegner

Türme:
 [x] Sollen selektiert werden können
     - Klick auf Tower selektiert ihn (15m Click-Radius)
     - Selection Ring Animation mit Pulse-Effekt
     - Radius-Anzeige wird eingeblendet
     - Bug-Fix: geoToLocalSimple statt geoToLocal für korrekte Distanzberechnung
 [x] Tower-Details in Sidebar bei Selektion
     - TOWER Section zeigt: Name, Schaden, Reichweite, Feuerrate, Kills
     - Verkaufen-Button (50% Erstattung)
     - Upgrade-Button (disabled, "Bald verfuegbar")
 [x] Benötigen eine Radius-Anzeige wenn selektiert (diese soll wirklich satt auf dem Terrain liegen)
     - TerrainRaycaster: Direktes Raycasting für lokale X,Z Koordinaten
     - createTerrainDiscGeometryRaycast() + createTerrainEdgePointsRaycast()
     - Passt sich automatisch an Terrain-Höhen an
 [x] Hex-Grid Line-of-Sight Visualisierung
     - Flat-Top Hexagon-Grid über Turm-Reichweite
     - Grün = sichtbar, Rot = blockiert (durch Gebäude)
     - LineOfSightRaycaster raycastet von Turm-Spitze zu Hex-Zellen
     - hasLineOfSight() API für Targeting-Entscheidungen
     - Gebäude-Verdeckung funktioniert via 3D-Tiles Mesh-Intersection
 [x] **Tower LOS-Prüfung von Hülle statt Mitte**
     - Tower prüfen LOS ab ihrer äußeren Hülle, nicht vom Mittelpunkt
     - Relevant wenn Tower auf Gebäuden steht

UI:
 [x] **Location Dialog Styling** - An TD-Style angepasst
     - Gleicher Background und Schatten wie Sidebar
     - Kein Purple mehr
 [x] **Info Overlay** als transparente Angular Component oben links
     - Zuschaltbar über neuen Button in Quick Actions (ℹ️ Icon)
     - Zeigt: FPS, Tiles, Aktive Gegner, Aktive Sounds, Straßen-Count
     - Multi-Layer Text-Shadow für Lesbarkeit auf allen Untergründen
     - Kein Background - komplett transparent
     - FPS/Tiles aus Header entfernt (nur noch im Overlay)
 [x] **Wave Debug Component optimiert**
     - Kamera Debug und Log Textarea entfernt
     - Heal HQ und Kill Wave Buttons repariert
     - Slider erweitert: Anzahl bis 5000, Speed bis 100 m/s + Number Inputs
     - Straßeninfo entfernt, Layer-Menü aufgeräumt
 [x] Sidebar rechts mit den Optionen wie "Start Welle" und "Tower platzieren" sowie Debug
     alles in eine einheitliche Sidebar bringen (WC3/Ancient Command Style)
 [x] Sidebar neu strukturiert in Sections:
     - WELLE Section: Wave-Nummer, Gegner-Count, "Naechste Welle" Button
     - BAUEN Section: Tower-Buttons mit Kosten
     - TOWER Section: Details bei Selektion (Name, Stats, Upgrade/Verkaufen)
     - DEBUG Section: wie bisher
 [x] FPS Anzeige
     - Im Header rechts neben den Stats
     - Aktualisiert jedes Frame vom Engine
 [x] 3D Model Previews in Sidebar
     - ModelPreviewService mit geteiltem WebGL-Renderer
     - Tower-Grid: 2x2 Kacheln mit rotierenden 3D-Modellen
     - Enemy-Preview: Animierter Gegner (Walk-Animation) in Wave-Section
     - Kosten-Badge als Overlay oben rechts
     - groundModel-Option fuer korrekte Charakter-Zentrierung
     - Siehe docs/MODEL_PREVIEW.md

Kamera:
 [x] **Kamera zurücksetzen Button repariert**
     - Verwendet gespeicherte Position + LookAt-Target
     - Stellt exakt die initiale Kameraposition wieder her
 [x] Initiale Position optimiert
     - 45 Grad Blickwinkel, Blickrichtung Norden, HQ im Zentrum
     - Initiale Position wird nach 2s gespeichert (wenn Tiles geladen)
     - Reset-Button stellt exakt diese gespeicherte Position wieder her
 [x] **Automatisches Framing von HQ + Spawns**
     - Initiale Kamera zeigt HQ und alle Spawn-Punkte im Bild
     - Dynamische Kamera-Positionierung seitlich zur HQ-Spawn-Achse
     - 20% Padding um die Punkte für gute Sichtbarkeit
     - 45° Iso-Perspektive beibehalten
     - CameraControlService.frameHqAndSpawns() Methode
 [x] **Kompass-Overlay**
     - Oben rechts im Spielfeld
     - Zeigt N/O/S/W Himmelsrichtungen
     - Rotiert mit Kamera-Heading
     - Nadel zeigt immer nach Norden
     - Dezentes Design passend zum TD-Style
 [x] **Kompass-Styling optimiert**
     - Subtileres, weniger aufdringliches Design

Gameplay:
 [x] User soll sich eine eigene Location durch Eingabe seines Ortes wählen können
     - Location-Dialog im Header (klickbarer Ortsname + Edit-Icon)
     - Autocomplete-Suche via Nominatim
     - Manuelle Koordinaten-Eingabe (Erweitert-Sektion)
     - Siehe docs/LOCATION_SYSTEM.md
 [x] Spawn-Punkte sollen in der Nähe gewürfelt werden
     - Random Spawn: 500m-1km vom HQ, muss auf Straße liegen
     - Pfad-Validierung: Nur erreichbare Punkte werden akzeptiert
     - Marker wird automatisch an Pfad-Start gesnapped
 [x] Während Development unsere aktuelle Location als Default (Erlenbach)

Input:
 [x] **WASD in Eingabefeldern blockiert** - Gefixt
     - Problem: WASD-Tasten für Kamera-Steuerung wurden auch in Eingabefeldern abgefangen
     - Fix: Keyboard-Events werden in Input-Feldern nicht mehr abgefangen

WaveDebugger:
 [x] **Anzahl-Slider auf 500 limitiert**
 [x] **Gegnertyp-Auswahl setzt Speed aus Config**
     - Bei Auswahl eines Gegnertyps wird dessen Config-Speed im Slider gesetzt
 [x] **Gegnertyp-Auswahl setzt Health aus Config**
     - Bei Auswahl eines Gegnertyps wird dessen Config-Health im Slider gesetzt
 [x] **Vorschaumodell bei Gegnertyp-Auswahl aktualisiert**
     - Preview-Canvas zeigt korrektes Modell bei Typwechsel

Rendering:
 [x] **Rocket Tower Helligkeit angepasst**
     - War dunkler texturiert als andere Tower
 [x] **Partikeleffekte für Projektile**
     - Raketen: große Partikel + Explosion
     - Normale Projektile: kleinere Partikel, keine Explosion
     - Archer: keine Partikel
 [x] **Dual Gatling Bogen-Bug gefixt**
     - Schoss fälschlicherweise im Bogen statt geradeaus
 [x] **Leuchtspurmunition für Dual Gatling**
     - Dezente, kleine Leuchtspureffekte implementiert
 [x] **Cannon, Magic, Sniper Tower deaktiviert**
     - Vorübergehend aus dem Spiel genommen

LOS:
 [x] **Statisches Pfad-LOS-Grid** ✓ Implementiert
     - 2m Grid entlang Route (±7m Korridor)
     - Bei Tower-Platzierung vorberechnet
     - O(1) Lookup zur Laufzeit
     - Shader-basierte Visualisierung mit Pulsing-Animation

Tower:
 [x] **ICE Tower mit Slow Effekt** ✓ Implementiert
     - Splash Damage Type (Gegner im Radius betroffen)
     - Generelles Debuff-System mit Statuseffekten
     - Kann Air und Ground Targets treffen
     - Wenig Schaden, primär für Slow-Effekt
     - Blauer Ice Partikel-Effekt für Projektil-Trail
     - Eis-Explosion beim Auftreffen
     - Hellblaue Eis-Decals auf dem Boden (analog Blutflecken)

Code Quality (Expert Review Quick Wins - 2026-01-16):
 [x] **GeoUtilsService erstellen** - Haversine-Distanzberechnung 5x dedupliziert
     - Neues `utils/geo-utils.ts` mit `haversineDistance()`, `fastDistance()`, `geoDistance()`
     - Entfernt aus: enemy.manager.ts, tower.manager.ts, game-state.manager.ts, projectile.entity.ts, movement.component.ts
 [x] **Reusable Vectors in ProjectileRenderer** - Object Allocation in Update-Loop eliminiert
     - Statische `_tempPos`, `_tempRot`, `_tempScale` in ProjectileInstanceManager
     - Keine `new Vector3()`/`new Quaternion()` mehr pro Frame
 [x] **placement.config.ts erstellen** - Placement-Constraints dedupliziert
     - Neues `configs/placement.config.ts` mit MIN/MAX_DISTANCE Konstanten
     - Entfernt aus: tower.manager.ts, tower-placement.service.ts
 [x] **PROJECTILE_SOUNDS in Config verschoben**
     - Sound-Konfiguration von projectile.manager.ts nach projectile-types.config.ts
     - Saubere Config-Struktur mit Interface `ProjectileSoundConfig`
 [x] **game-balance.config.ts erstellen** - Game Balance Werte zentralisiert
     - Neues `configs/game-balance.config.ts` mit player, waves, combat, effects, fireIntensity
     - Entfernt hardcoded Werte aus game-state.manager.ts
