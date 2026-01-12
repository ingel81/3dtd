# Erledigte Features & Fixes

Allgemein:
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
