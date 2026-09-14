# 3DTD - Dokumentation

Technische Dokumentation zum Tower Defense auf Google Maps 3D Tiles.

Die Statusspalte sagt, wie weit man einem Dokument trauen darf:
**Aktuell** = beschreibt den laufenden Stand · **Plan** / **Konzept** = beschreibt
etwas noch nicht Gebautes · **Bericht** = Befund zu einem Zeitpunkt, mit Datum ·
**Historisch** = überholt, nur noch als Herkunft interessant.

---

## Kern-Dokumentation

| Dokument | Status | Beschreibung |
|----------|--------|--------------|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Aktuell | System-Architektur, Component-System, Renderer, Services (`combat/`, `debug/`, `facade/`, `infrastructure/`, `location/`, `world/`) |
| [EVENT_SYSTEM.md](EVENT_SYSTEM.md) | Aktuell | Event Bus, Event-Typen, Manager-Kommunikation |
| [SIGNAL-STORE-ARCHITECTURE.md](SIGNAL-STORE-ARCHITECTURE.md) | Aktuell | Signal Store (6 Sub-Stores: Game/UI/Engine/Location/Research/Debug), Facade Pattern, Persistence |
| [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) | Aktuell | UI/UX Design Guidelines, Farbschema, Komponenten-Styling |
| [TODO.md](../TODO.md) | Aktuell | Offene Aufgaben und bekannte Bugs |
| [DONE.md](../DONE.md) | Aktuell | Changelog, neueste zuerst |

## Features & Systeme

| Dokument | Status | Beschreibung |
|----------|--------|--------------|
| [TOWER_CREATION.md](TOWER_CREATION.md) | Aktuell | Neue Tower erstellen, rotierende Turrets, Sound-Integration |
| [ENEMY_CREATION.md](ENEMY_CREATION.md) | Aktuell | Enemies erstellen, Animationen, Audio-System |
| [STATUS_EFFECTS.md](STATUS_EFFECTS.md) | Aktuell | Status-Effekt-System (Slow, Burn, Poison, Freeze als Halt, Stun) |
| [WAVE_SYSTEM.md](WAVE_SYSTEM.md) | Aktuell | Wave-Management, Sub-Step-Spawner, Mixed Waves, Game Phases |
| [ABILITIES.md](ABILITIES.md) | Aktuell | Spieler-Fähigkeiten (Nuklearschlag, Frostbombe, EMP, Orbitallaser), Fähigkeitenleiste: Ladungen, Zielmodus, Einschlag in Sub-Steps, Leck-Buchung im Gate, Bot-Strategie |
| [HERO.md](HERO.md) | Aktuell | Held (Söldner): Forschung und Anheuern, Routengraph mit Dijkstra, Posten und Leine, Munition als Schadensart, Stufen, virtueller Tower im Fairness-Gate, Modell-Naht, Bedienung (G, V) |
| [REPLAY.md](REPLAY.md) | Aktuell | Replay der letzten Welle: warum Präsentations-Aufnahme statt Re-Simulation, Aufnahme in Typed Arrays mit Speichergrenze, Player über die Live-Renderer, Bedienung, Grenzen |
| [STATIC_WAVE_FALLBACK.md](STATIC_WAVE_FALLBACK.md) | Aktuell | Debug-Pfad ohne Director: `STATIC_WAVE_PROFILES`, UI-Toggle, Post-W30-Loop |
| [LOCATION_SYSTEM.md](LOCATION_SYSTEM.md) | Aktuell | Location Dialog, Geocoding, Spawn-Generierung |
| [ROUTE_CORRIDOR.md](ROUTE_CORRIDOR.md) | Aktuell | Breite des Routenkorridors: Freiraum je Seite aus den Tiles, OSM-Breite als Rückfall, Dach-Check, Brücken, Tunnel, Nachmessen (`CorridorRefit`), Seitenversatz der Gegner, `__corridor.*`, `__routes.describe()` |
| [PROJECTILES.md](PROJECTILES.md) | Aktuell | Projektil-System, Flugbahnen, Konfiguration |
| [SPATIAL_AUDIO.md](SPATIAL_AUDIO.md) | Aktuell | 3D Audio, positionsabhängige Sounds, Hintergrundmusik |
| [MODEL_PREVIEW.md](MODEL_PREVIEW.md) | Aktuell | 3D Model Previews in der Sidebar (Renderer-Capacity-Strategie) |
| [PARTICLE_SYSTEM.md](PARTICLE_SYSTEM.md) | Aktuell | Partikel, Decals, Floating Text, VFX-Subsysteme |
| [INSTANCED_ENEMY_RENDERING.md](INSTANCED_ENEMY_RENDERING.md) | Aktuell | GPU Instancing mit VAT (Draw-Call-Reduktion) |
| [ENEMY_MODEL_BUDGET.md](ENEMY_MODEL_BUDGET.md) | Aktuell | Gegnermodelle vermessen (VAT-Vertices, VAT-Speicher, Clips, Vorkommen in Wellen), Budget je Klasse, Optimierungsliste. Tabellen per `npm run model-budget` |
| [HANDOVER_ROUTE_GRID_GPU_LOS.md](HANDOVER_ROUTE_GRID_GPU_LOS.md) | Aktuell | GPU-Cubemap-LOS-Pipeline (Ground + Air produktiv) |
| [TILES_LOADING_BUG.md](TILES_LOADING_BUG.md) | Aktuell | 3D-Tiles Loading Bug + Tile-Quality-Aware Route Protection |
| [DEVWORLD.md](DEVWORLD.md) | Aktuell | Offline-Entwicklungsumgebung, Terrain-Presets (`?devworld`) |

## Game Design

| Dokument | Status | Beschreibung |
|----------|--------|--------------|
| [MASTER_GAME_DESIGN.md](game-design/MASTER_GAME_DESIGN.md) | Aktuell | Game Design: Schadenstypen, Rüstung, Damage-Matrix, Balance |
| [BALANCE_PROPOSAL_2026-09.md](game-design/BALANCE_PROPOSAL_2026-09.md) | Bericht | Balance-Vorschlag vom 2026-09-11: Upgrade-Kurven, Cannon, Matrix-Spreizung, Boss-Takt ab W31, mit Rechenwegen. Im Sprint 2026-09-11 umgesetzt; die offenen Fragen stehen am Ende |
| [PLAYER_AGENCY_CONCEPT.md](game-design/PLAYER_AGENCY_CONCEPT.md) | Konzept (Teil umgesetzt) | Spieler aktiver einbinden: Fähigkeiten, Held, Varianten mit Aufwand. Abschnitt 7 hält die Entscheidung vom 2026-09-12 fest (Nuklearschlag zuerst), Abschnitt 8 die Umsetzung vom 2026-09-13 |
| [COMBAT_HEATMAP_STUDY.md](game-design/COMBAT_HEATMAP_STUDY.md) | Bericht | Machbarkeitsstudie Kampfzonen. Schicht 1 (Kampfspuren) ist umgesetzt, siehe PARTICLE_SYSTEM.md; Schicht 2 (Heatmap) nicht |
| [UX_DISCUSSION_NOTES.md](game-design/UX_DISCUSSION_NOTES.md) | Bericht | Diskussionsnotizen: Turmdrehung nach Wegfall des Ziels, Color Grading |

## Wave Director & AI

> Der Wave-Director ist **regelbasiert und vollständig clientseitig**. Das
> ONNX-Modell ist Opt-in im Debug-Fenster, kein Python-Server im Spielbetrieb.
> Begründung und Messungen: AI_WAVE_DIRECTOR_PLAN.md.

| Dokument | Status | Beschreibung |
|----------|--------|--------------|
| **[AI_WAVE_DIRECTOR_PLAN.md](AI_WAVE_DIRECTOR_PLAN.md)** | **Aktuell** | **Einstiegspunkt:** Regel-Director, Gate-Controller, warum das Modell ersetzt wurde, was vom RL-Aufbau bleibt |
| [HANDOVER_RULE_DIRECTOR.md](HANDOVER_RULE_DIRECTOR.md) | Bericht | Umstellung vom ONNX-Netz auf den Regel-Director (2026-09-07): die Messreihe dahinter, Einstieg für ein späteres Training |
| [BOT_SYSTEM.md](BOT_SYSTEM.md) | Aktuell | Strategy-Pattern-Bots (Placement, Upgrade, Wave, Research), der Gegenspieler im Training |
| [HANDOVER_PLAYTEST_PHASE5.16.md](HANDOVER_PLAYTEST_PHASE5.16.md) | Aktuell | Balance-Stand: Wave-Curriculum, Endgame-Knobs, Gold-Budget |
| [PHASE_5.11_RANGES.md](PHASE_5.11_RANGES.md) | Aktuell (Teil) | Range-Templates, Decoder-Constraints, Reward-Tuning. Die Template-/Decoder-Mechanik gilt weiter; die Aussagen zum Modell als Director sind überholt |
| [HANDOVER_TRAINING_REFRESH.md](HANDOVER_TRAINING_REFRESH.md) | Aktuell | Refresh des Trainings-Backends: Befunde, Grundsatzentscheidungen, Messbetrieb |
| [training-backend/README.md](../training-backend/README.md) | Aktuell | Backend starten, Ordner, Befehle |
| [AI_TRAINING_BACKEND.md](../training-backend/docs/AI_TRAINING_BACKEND.md) | Aktuell | Python Training Backend: PPO, State-Encoder, Reward, Decoder-Constraints, A/B-Directors |
| [AI_MODEL_EXPORT.md](../training-backend/docs/AI_MODEL_EXPORT.md) | Aktuell | ONNX-Export (`npm run export-ai`), nur für den Opt-in-Pfad nötig |
| [AI_TRAINING_SESSION_NOTES.md](../training-backend/docs/AI_TRAINING_SESSION_NOTES.md) | Historisch/Log | Entwicklungsgeschichte v1 → v3.5 + Phase-5.x-Index |

## Analysen & Berichte

| Dokument | Status | Beschreibung |
|----------|--------|--------------|
| [REVIEW_FIX_2026-09-14.md](REVIEW_FIX_2026-09-14.md) | Bericht (Playtest offen) | Fix-Session nach dem Playtest 2026-09-14 auf `sprint/night-2026-09-14`: Änderungen je Thema mit Revert-Probe, Entscheidungen, Review-Befunde, nummerierte Playtest-Liste ab 501 |
| [REVIEW_SPRINT_2026-09-14.md](REVIEW_SPRINT_2026-09-14.md) | Bericht (Playtest offen) | Nachtschicht 2 auf `sprint/night-2026-09-14`: Änderungen je Feature mit Commit-Bereichen und Revert-Probe, Entscheidungen, Review-Befunde, nummerierte Playtest-Liste ab 301 |
| [REVIEW_SPRINT_2026-09-13.md](REVIEW_SPRINT_2026-09-13.md) | Bericht (Playtest offen) | Nachtschicht auf `sprint/night-2026-09-13`: Änderungen, Entscheidungen, Review-Befunde, nummerierte Playtest-Liste ab 101 |
| [REVIEW_SPRINT_2026-09-12.md](REVIEW_SPRINT_2026-09-12.md) | Bericht (Playtest läuft) | Zweite Sprint-Runde auf `sprint/todo-2026-09-11`: Änderungen, Review-Befunde, nummerierte Playtest-Liste mit Ergebnissen |
| [REVIEW_SPRINT_2026-09-11.md](REVIEW_SPRINT_2026-09-11.md) | Bericht | Erste Sprint-Runde: Änderungen, Entscheidungen, TODO-Stand. TODO.md 1.6 verweist darauf |
| [ROUTE_GEOMETRY_ANALYSIS.md](ROUTE_GEOMETRY_ANALYSIS.md) | Bericht | Route vs. Straße (Playtest 2026-09-10): Kette Overpass bis Zelle, Herleitung des Korridors, Lücken in der LOS-Anzeige. Der aktuelle Stand des Korridors steht in ROUTE_CORRIDOR.md |
| [PERF_BUG_ANALYSIS_2026-05-28.md](PERF_BUG_ANALYSIS_2026-05-28.md) | Bericht | Performance- und Bug-Deep-Dive: Render-Loop, Instancing, VFX, Game-Loop, Leaks. Nachträge: Raycast-Messung, Kamera-Raycast-Cache, Benchmarks (`npm run bench`) |

## Pläne (nicht umgesetzt)

| Dokument | Status | Beschreibung |
|----------|--------|--------------|
| [ROUTE_ALIGNED_CELLS_CONCEPT.md](ROUTE_ALIGNED_CELLS_CONCEPT.md) | Konzept | Zellen parallel zur Route statt Nord-Ost-Raster: Abhängigkeiten, Knicke, Kreuzungen, Varianten mit Aufwand, Empfehlung. Kein Code |
| [MULTIPLAYER_CONCEPT.md](MULTIPLAYER_CONCEPT.md) | Plan | PvE-Coop und PvP: Machbarkeit, Determinismus-Blocker, Server-Entwurf, zwei durchentworfene Zielmodi. Kein Code |
| [ELECTRON_DESKTOP_PLAN.md](ELECTRON_DESKTOP_PLAN.md) | Plan | Windows-Desktop-Build via Electron. PoC abgeschlossen und zurückgebaut |

## Archiv

Überholte Dokumente liegen unter [archive/](archive/). Sie werden nicht mehr
nachgeführt; Pfade und Zahlen darin gelten für ihren Zeitpunkt.

| Dokument | Ersetzt durch / Anlass |
|----------|------------------------|
| [PHASE_5.10_TEMPLATES.md](archive/PHASE_5.10_TEMPLATES.md) | [PHASE_5.11_RANGES.md](PHASE_5.11_RANGES.md), Übergang von 16-Softmax zu Templates |
| [ENGINE_DEEP_REVIEW_2026-05-16.md](archive/ENGINE_DEEP_REVIEW_2026-05-16.md) | Engine-Review über `src/app/`, Dependencies, Tests (Stand 2026-05-16) |
| [HANDOVER_MERGE_LOCAL_VS_ORIGIN.md](archive/HANDOVER_MERGE_LOCAL_VS_ORIGIN.md) | Merge-Divergenz lokal ↔ origin/main (2026-08-23) |
| `training-backend/PHASE5.5_TRAINING_RUNBOOK.md` | [AI_WAVE_DIRECTOR_PLAN.md](AI_WAVE_DIRECTOR_PLAN.md), historisches Restart-Runbook, liegt bewusst unter `training-backend/` |

## Werkzeuge (HTML, lokal im Browser öffnen)

| Datei | Zweck |
|-------|-------|
| [wave-planner.html](wave-planner.html) | Wave-Planer, arbeitet gegen `wave-planner-plan.json` |
| [economy-chart.html](economy-chart.html) | Gold-/Economy-Kurve über die Waves |
| [tower-stats-chart.html](tower-stats-chart.html) | Tower-Werte im Vergleich |

---

## Schnellnavigation

| Ich will... | Dokument |
|-------------|----------|
| ...die Gesamtarchitektur verstehen | [ARCHITECTURE.md](ARCHITECTURE.md) |
| ...das Event-System verstehen | [EVENT_SYSTEM.md](EVENT_SYSTEM.md) |
| ...den Signal Store verstehen | [SIGNAL-STORE-ARCHITECTURE.md](SIGNAL-STORE-ARCHITECTURE.md) |
| ...wissen, welche Services es gibt | [ARCHITECTURE.md](ARCHITECTURE.md) → Services |
| ...das UI stylen | [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) |
| ...einen Bug fixen | [TODO.md](../TODO.md) |
| ...wissen, was schon fertig ist | [DONE.md](../DONE.md) |
| ...den laufenden Playtest-Stand sehen | [REVIEW_FIX_2026-09-14.md](REVIEW_FIX_2026-09-14.md) → Playtest-Liste ab 501 zuerst, dann [REVIEW_SPRINT_2026-09-14.md](REVIEW_SPRINT_2026-09-14.md) → Playtest-Liste ab 301, offene Punkte der Nacht 1 in [REVIEW_SPRINT_2026-09-13.md](REVIEW_SPRINT_2026-09-13.md) und [REVIEW_SPRINT_2026-09-12.md](REVIEW_SPRINT_2026-09-12.md) |
| ...einen neuen Tower erstellen | [TOWER_CREATION.md](TOWER_CREATION.md) |
| ...einen neuen Enemy erstellen | [ENEMY_CREATION.md](ENEMY_CREATION.md) |
| ...wissen, wie teuer ein Gegnermodell ist | [ENEMY_MODEL_BUDGET.md](ENEMY_MODEL_BUDGET.md) |
| ...rotierende Turrets bauen | [TOWER_CREATION.md](TOWER_CREATION.md) → Rotierende Tower-Teile |
| ...das Tower-Placement verstehen | [TOWER_CREATION.md](TOWER_CREATION.md) → Tower-Placement-System |
| ...Enemy-Animationen konfigurieren | [ENEMY_CREATION.md](ENEMY_CREATION.md) → Animation-System |
| ...Status-Effekte verstehen | [STATUS_EFFECTS.md](STATUS_EFFECTS.md) |
| ...die Fähigkeiten (Nuklearschlag, Frost, EMP, Laser) verstehen | [ABILITIES.md](ABILITIES.md) |
| ...den Helden (Söldner) verstehen | [HERO.md](HERO.md) |
| ...Waves konfigurieren / Mixed Waves bauen | [WAVE_SYSTEM.md](WAVE_SYSTEM.md) |
| ...verstehen, wer die Wellen aussucht | [AI_WAVE_DIRECTOR_PLAN.md](AI_WAVE_DIRECTOR_PLAN.md) |
| ...den Fairness-Cap / das Gate verstehen | [AI_WAVE_DIRECTOR_PLAN.md](AI_WAVE_DIRECTOR_PLAN.md) → Gate-Controller |
| ...wissen, warum das ONNX-Modell nicht mehr läuft | [AI_WAVE_DIRECTOR_PLAN.md](AI_WAVE_DIRECTOR_PLAN.md) → Warum die Regeln |
| ...ohne Director durchspielen (Static-Fallback) | [STATIC_WAVE_FALLBACK.md](STATIC_WAVE_FALLBACK.md) |
| ...das Bot-System verstehen | [BOT_SYSTEM.md](BOT_SYSTEM.md) |
| ...den Balance-Stand verstehen | [HANDOVER_PLAYTEST_PHASE5.16.md](HANDOVER_PLAYTEST_PHASE5.16.md), [BALANCE_PROPOSAL_2026-09.md](game-design/BALANCE_PROPOSAL_2026-09.md) |
| ...ein Training fahren | [AI_TRAINING_BACKEND.md](../training-backend/docs/AI_TRAINING_BACKEND.md) |
| ...ein neues Modell exportieren | [AI_MODEL_EXPORT.md](../training-backend/docs/AI_MODEL_EXPORT.md) |
| ...das Location-System anpassen | [LOCATION_SYSTEM.md](LOCATION_SYSTEM.md) |
| ...verstehen, wie breit Route und Zellkorridor sind | [ROUTE_CORRIDOR.md](ROUTE_CORRIDOR.md) |
| ...Sounds hinzufügen | [SPATIAL_AUDIO.md](SPATIAL_AUDIO.md) |
| ...neue Projektiltypen erstellen | [PROJECTILES.md](PROJECTILES.md) |
| ...Model Previews anpassen | [MODEL_PREVIEW.md](MODEL_PREVIEW.md) |
| ...Partikel-/Decal-/Floating-Text-Effekte anpassen | [PARTICLE_SYSTEM.md](PARTICLE_SYSTEM.md) |
| ...DevWorld konfigurieren | [DEVWORLD.md](DEVWORLD.md) |
| ...das Schadens-/Rüstungssystem verstehen | [MASTER_GAME_DESIGN.md](game-design/MASTER_GAME_DESIGN.md) |
| ...das GPU-instanzierte Enemy-Rendering verstehen | [INSTANCED_ENEMY_RENDERING.md](INSTANCED_ENEMY_RENDERING.md) |
| ...die GPU-LOS-Pipeline verstehen | [HANDOVER_ROUTE_GRID_GPU_LOS.md](HANDOVER_ROUTE_GRID_GPU_LOS.md) |

---

## Dateistruktur (Kurzübersicht)

```
src/app/
├── tower-defense.component.*    # Haupt-Spielkomponente (.ts, .html, .scss)
├── ai/
│   ├── core/                    # Regel-Director, Gate-Controller, Templates, Encoder
│   └── training/                # Bots + Strategien, WebSocket-Client
├── devworld/                    # Offline-Umgebung (Terrain, Streets, Buildings)
├── game-engine/                 # Event Bus, VFX/Audio/Music/Screen Shake (framework-agnostisch)
├── services/                    # Angular Services (Facades, UI-Bindings)
├── store/                       # Signal Stores
├── managers/                    # Manager (Enemy, Tower, Wave, Research; event-driven)
├── entities/                    # Enemy, Tower, Projectile
├── game-components/             # Transform, Health, Movement, Combat, ...
├── configs/                     # Tower/Enemy/Projectile/Combat/Research/Audio/Wave-Curriculum
├── components/                  # UI Sub-Components
├── utils/                       # Route-Grid, Route-Korridor, Geo-Utils, ...
├── workers/                     # Web Workers (Pathfinding, Heartbeat)
└── three-engine/                # Three.js Engine + Renderers
```

Vollständige Dateistruktur: [ARCHITECTURE.md](ARCHITECTURE.md).
