# Offene TODOs

> **Philosophie:** Engine first, Game second.
> Erst die Engine stabil, performant und testbar machen - dann Features bauen.


** NEU **

- Attributions: Skybox (day.webp, night.webp) Quelle ermitteln und eintragen
- Attributions: stone-wall.jpg Quelle ermitteln und eintragen
- Attributions: Sound Effects Quellen ergänzen (alle außer Tentacle Slime)


> **Phase 1 (Engine Foundation) und Phase 2 (Engine Performance) abgeschlossen** → siehe DONE.md

---

---

# PHASE 4: GAME FEATURES

> **Ziel:** Spielbares, poliertes Tower Defense

## 4.1a Visual Feintuning

- [ ] **Muzzle Flash feintunen**
      Grundsätzlich sichtbar, aber Intensität/Größe/Dauer anpassen
      Prüfen: nur bei Projectile-Towern (Archer, Cannon, Gatling, Rocket), NICHT bei Ice/Magic/Fire

- [ ] **Explosions-Partikel feintunen**
      Sprite-Sheet Partikel (Flash→Fireball→Rauch) — Timing, Größe, Farben polieren
      Betrifft Cannon- und Rocket-Einschläge

- [ ] **Screen Shake Performance untersuchen**
      Aktuell deaktiviert wegen Performance-Bedenken
      Messen: tatsächlicher FPS-Impact, ggf. nur bei nahen Explosionen aktivieren
      Dateien: `screen-shake.service.ts`, Display Options Toggle

- [ ] **Freeze-Effect Performance prüfen**
      Instanced Enemies: gelöst via `aTintColor` Shader-Attribut (kein Material-Cloning)
      Classic Renderer (nur Boss-Fallback): klont noch Materials pro Enemy
      → Wird obsolet wenn Boss-Fallback entfernt wird (siehe BACKLOG)

- [ ] **Wave Preview Model: Pinguin** - Kamera-Position und Modell-Größe anpassen

- [ ] **Wave Preview Model: Herbert** - Kamera-Position und Modell-Größe anpassen

- [ ] **Color Grading Anwendungsfall klären**
      Feature funktioniert (Dark Fantasy, Noir, Warm Sunset)
      Brainstorming: als Gameplay-Element? (z.B. Nacht-Modus, Wetter), oder rein kosmetisch?
      Aktuell nur im Debug-Panel zugänglich — evtl. in Settings verschieben

## 4.1b Visual Settings (Performance-Toggles)

- [ ] **VFX Settings Menu** — Visuelle Effekte einzeln ein/ausschaltbar
      Freeze-Tint, Muzzle Flash, Trail-Streaks, Sprite-Sheet Partikel,
      Screen Shake, Bloom, Color-Grading
      Ziel: Low-End-Geräte können teure Effekte deaktivieren

## 4.2 Gameplay Features

- [ ] **Range-Upgrade System implementieren**
      Tower-Upgrades die Range erhöhen
      ⚠️ LOS-Zellen müssen bei Range-Upgrade neu berechnet werden!

---

# PHASE 5: DAMAGE & ARMOR SYSTEM

> **Ziel:** Strategische Tiefe durch Schadens-/Rüstungstypen
> **Konzept:** [DAMAGE_ARMOR_SYSTEM.md](docs/DAMAGE_ARMOR_SYSTEM.md)
> **Reihenfolge:** Erst Tower-Schadenstypen, dann Enemy-Rüstungen

## 5.1 Infrastruktur

- [ ] **DamageType und ArmorType Types definieren**
      Types: `physical`, `pierce`, `siege`, `magic`, `fire`, `ice`, `chaos`
      Armor: `unarmored`, `light`, `medium`, `heavy`, `fortified`, `ethereal`

- [ ] **Schadensmatrix implementieren**
      `calculateDamage(base, damageType, armorType)` in CombatEffectService
      Erstmal alle Multiplikatoren = 1.0 (neutral)

## 5.2 Tower-Schadenstypen

- [ ] **damageType zu Tower-Configs hinzufügen**
      Archer/Gatling: `physical`, Sniper: `pierce`, Cannon/Rocket: `siege`
      Magic: `magic`, Ice: `ice`

- [ ] **Neue Tower mit neuen Schadenstypen**
      Flame Tower (`fire`), Tesla Tower (`magic`), Chaos Tower (`chaos`)

- [ ] **UI: Schadenstyp im Tower-Panel anzeigen**
      Icon + Label: "⚔️ Physical Damage"

## 5.3 Enemy-Rüstungstypen

- [ ] **armorType zu Enemy-Configs hinzufügen**
      Zombie: `light`, Bat/Penguin: `unarmored`, Tank: `heavy`
      Wallsmasher: `medium`, Herbert: `fortified`

- [ ] **Schadensmatrix aktivieren**
      Multiplikatoren gemäß Konzept-Doc

- [ ] **Neue Enemies mit speziellen Rüstungen**
      Ghost (`ethereal`), Golem (`fortified`), Dragon (`heavy` + Air)

- [ ] **UI: Rüstungstyp im Wave-Preview anzeigen**
      "🛡️ Heavy Armor - Weak to Siege"

---

# PHASE 6: AI WAVE DIRECTOR

> **Ziel:** Adaptive KI die spannende, faire Wellen generiert
> **Voraussetzung:** Phase 5 (Damage/Armor) abgeschlossen — erst Spielinhalt, dann Training
> **Plan:** [AI_WAVE_DIRECTOR_PLAN.md](docs/AI_WAVE_DIRECTOR_PLAN.md)

## 6.1 Training UI

- [ ] **Dashboard Header Styling verbessern**
      Status/Header Metriken besser stylen
      Model Metrics (Entropy, Grad Norm, etc.) als eigene Gruppe rechts
      Dezenter als Hauptmetriken, nach "Game Over" Bereich
      Dateien: `training-backend/dashboard/static/index.html`, `style.css`

## 6.2 Build & Deployment

> Training-Code nicht in Prod Bundle

- [ ] **Build Configuration**
      `angular.json`: fileReplacements für Training-Code
      Production: Training-Module wird zu leerem Stub
      Bundle Size Check: AI < 300KB

- [ ] **Model Conversion Script**
      PyTorch → TensorFlow.js Format
      Für Browser-Inference ohne Backend
      Kopiert nach `public/assets/ai/`

- [ ] **Model Validation**
      `scripts/validate-model.js`
      Prüft: Format, Größe, Basis-Inference
      Läuft vor Commit (optional)

## 6.3 Training & Tuning ⏸️ PAUSIERT

> Das eigentliche Training

- [~] **Training Run v3.5** ← PAUSIERT
      5267+ Episoden, 40.1% Sweet Spot erreicht
      Reward-Formel auf ~1/3 reduziert
      Tower-Limit: 50, Episode-Length: 100
      Dashboard auf http://localhost:3002

- [ ] **Model Selection**
      Beste Version auswählen
      Gegen alle Bots testen
      Dokumentieren welches Model deployed

- [ ] **Playtesting**
      Interne Tests mit echten Spielern
      Feedback sammeln
      Reward Function anpassen wenn nötig

## 6.4 Training Feintuning

> Erkenntnisse aus Testspielen gegen exportiertes ONNX-Model

- [ ] **HP-Skalierung erweitern**
      `HEALTH_MULTIPLIER_MAX`: 20 → 100
      Problem: Im Endgame kann AI HP nicht mehr skalieren (Cap erreicht)
      Dateien: `config.py`, `wave-director.service.ts`

- [ ] **Bot Tower-Limit entfernen**
      `strategist.maxTowers`: 50 → 0 (unlimited)
      Problem: Training sieht nie Endgame-DPS-Levels
      Datei: `tower-bot.interface.ts`

- [ ] **Kill-Time Range erweitern**
      `KILL_TIME_MAX`: 5.0 → 8.0
      Mehr Spielraum für HP-Skalierung bei hoher DPS
      Datei: `config.py`

- [ ] **Wave-Schedule System implementieren**
      Feste Typen für bestimmte Waves (z.B. Wave 7, 14, 21 = Air)
      AI bestimmt nur Parameter (HP, Count, Delay), nicht Typ
      Spieler kann sich auf Air/Boss-Waves vorbereiten
      Frontend: `wave-director.service.ts`
      Backend: `server.py` (forced_type im State)

- [ ] **Enemy Properties System** (SPÄTER - wenn neue Gegner kommen)
      Statt Typ-Encoding: Property-basiertes Encoding
      Properties: `isAir`, `isTanky`, `isSwarm`, `isBoss`
      Vorteil: Neue Gegner funktionieren ohne Neutraining
      Voraussetzung: Properties in `EnemyTypeConfig` definieren
      ```typescript
      // Neue Felder in enemy-types.ts:
      isTanky?: boolean;   // Viel HP, langsam (tank, wallsmasher)
      isSwarm?: boolean;   // Wenig HP, viele (penguin)
      isBoss?: boolean;    // Boss-Einheit (herbert)
      // isAirUnit existiert bereits
      ```
      State-Vektor: +6 Features (5 Properties + force_active)
      Model lernt Konzepte statt spezifische Typen

## 6.5 AI-Training Anpassung für Damage/Armor

- [ ] **State-Vektor erweitern: dpsByDamageType**
      Aufschlüsselung der DPS nach Schadenstyp

- [ ] **Enemy-Properties für Rüstung**
      AI lernt: "Nur Physical-Tower → Heavy Enemies effektiv"

---

# BACKLOG

> Langfristig, bei Bedarf

## Training Backend Refactoring

- [ ] **training-backend Struktur verbessern**
      Aktuell alles flach, besser in Module aufteilen:
      - `core/` - model.py, trainer.py, reward.py
      - `utils/` - logger (tui_logger + auto_logger mergen)
      - `scripts/` - export, analyze (bereits teilweise)
      Import-Pfade in server.py anpassen

## Performance - Advanced

- [ ] **Object-Pooling für Projektile** - Pool-Größe: 500 pro Typ
      ⚠️ GPU-Instancing existiert bereits — Entity-Pooling (JS-Objekte) nochmal prüfen ob GC-Druck messbar ist
- [ ] **Tower-Model-LOD-System** - Three.js LOD: High/Medium/Low
- [ ] **BVH für Terrain Raycasts** - 50ms → 0.5ms (weniger kritisch, siehe Hinweis in PERFORMANCE_REPORT)
- [ ] **Web Worker Offloading** - Pathfinding + weitere rechenintensive Logik
      Pathfinding: 200-600ms → 0ms Main Thread
      Auch prüfen: Collision-Checks, Wave-Director-Inference, Audio-Decoding
- [ ] **Klassischen ThreeEnemyRenderer-Fallback entfernen**
      Boss-Features (Name über Health Bar, spezielle Farbe) direkt im instanced System implementieren.
      Aktuell nutzt kein Enemy-Typ den Fallback — `bossName` wird nirgends gesetzt.
      Dateien: `instanced-enemy.renderer.ts`, `three-enemy.renderer.ts`
- [ ] **Tower GPU Instancing** - Schwierig wegen Rotationen
- [ ] **Konfigurierbares FPS-Limit** (60/30/unlimited)
      Reduziert GPU-Last bei guter Hardware, mehr Budget fuer 3D-Tiles-Streaming
      Stelle: `three-tiles-engine.ts` → `startRenderLoop()`
      ~20 Zeilen Core, optional UI-Setting in localStorage

## Visual Effects - Advanced

- [ ] **Advanced-Explosion-Staging** - 2-Stage Explosionen
- [ ] **Terrain-Decals bei Waffenbeschuss** — Scorch Marks, Krater-Optik, Einschusslöcher, Burn Areas
      Basiert auf existierendem GPU-Instanced Decal System (Blood/Ice Decals)
      Neue Shader in `decal-shaders.ts`, Configs in `visual-effects.config.ts`
      Dateien: `decal-instance.manager.ts`, `three-effects.renderer.ts`, `vfx.service.ts`

## Mobile Support & Accessibility

- [ ] **Mobile-Qualitäts-Presets**
      Low (1.0 pixelRatio, 50% Partikel), Medium, High (Retina)
      Auto-Detect via `navigator.userAgent`
- [ ] **Mobile Breakpoints hinzufügen**
      Breakpoints: 768px (Tablet), 480px (Mobile)
- [ ] **Touch-Targets auf 44px vergrößern**
      Mobile usability (Apple/Google Guidelines)
- [ ] **ARIA-Labels zu Icon-Buttons**
      Accessibility (Screen Reader)

## Terrain & Routing Experimente

- [ ] **OSM bridge/tunnel Tags abfragen** - `bridge=yes`/`tunnel=yes`/`layer=*` in Overpass-Query mitabfragen, im Street-Interface speichern, bei Höhenkorrektur berücksichtigen (bridge → Korrektur überspringen)
- [ ] **Laterales Sampling nur auf Routen** - Aktuell wird getGroundHeightEstimate für alle gefilterten Straßen aufgerufen (4 Extra-Raycasts pro Punkt). Optimierung: nur für Straßen die tatsächlich Routen sind das teure laterale Sampling nutzen, restliche Straßen im Korridor mit einfachem Raycast + Smoothing rendern
- [ ] **Gewässer von OSM laden** - `natural=water`, `waterway=river/stream/canal` über Overpass abfragen. Gewässer als unpassierbare Zonen ins Routing einbeziehen → Brücken werden natürliche Chokepoints (Engstellen). Optional: Gewässerflächen visuell auf der Karte darstellen

## Tower-Ideen

> Siehe auch: [DAMAGE_ARMOR_SYSTEM.md](docs/DAMAGE_ARMOR_SYSTEM.md)

- [ ] Flame Tower (`fire`)
- [ ] Tesla Tower (`magic`) - Kettenblitz
- [ ] Chaos Tower (`chaos`) - Teuer, voller Schaden vs alle

## Enemy-Ideen

> Siehe auch: [DAMAGE_ARMOR_SYSTEM.md](docs/DAMAGE_ARMOR_SYSTEM.md)

- [ ] **MechaCat** - Roboter-Katze als neuer Gegner-Typ
      Model bereits vorhanden: `public/assets/models/enemies/candidates/mechacat_01.glb`
- [ ] **Ghost** - `ethereal` Rüstung, nur Magic/Chaos wirkt
- [ ] **Skeleton** - `unarmored`, Swarm
- [ ] **Golem** - `fortified`, Boss
- [ ] **Dragon** - `heavy` + Air, fliegender Boss

---

# EASY WINS / CLEANUP

> Kleine Aufräumarbeiten, schnell erledigt


---

# BEKANNTE ISSUES

> Beobachten, bei Reproduktion fixen

- [ ] **3D-Tiles Loading bei F5** - sporadisch "0 Kacheln geladen" nach Reload
      Fix: Retry-Mechanismus + Force-Update, siehe [TILES_LOADING_BUG.md](docs/TILES_LOADING_BUG.md)
- [ ] Nominatim-Geocoding gibt oft Straßen-Koordinaten statt Gebäude-Koordinaten
