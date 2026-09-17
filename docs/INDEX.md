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
| [ARCHITECTURE.md](ARCHITECTURE.md) | Aktuell | System-Architektur, Component-System, Renderer, Services (`combat/`, `debug/`, `facade/`, `infrastructure/`, `location/`, `onboarding/`, `world/`) |
| [EVENT_SYSTEM.md](EVENT_SYSTEM.md) | Aktuell | Event Bus, Event-Typen, Manager-Kommunikation |
| [SIGNAL-STORE-ARCHITECTURE.md](SIGNAL-STORE-ARCHITECTURE.md) | Aktuell | Signal Store (6 Sub-Stores: Game/UI/Engine/Location/Research/Debug), Facade Pattern, Persistence |
| [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) | Aktuell | UI/UX Design Guidelines, Farbschema, Komponenten-Styling |
| [TODO.md](../TODO.md) | Aktuell | Die eine Liste offener Arbeit: vor dem Merge, Entscheidungen, Bugs, Features, Messungen, Konzepte, Ideen, Aufräumen |
| [PLAYTEST.md](PLAYTEST.md) | Aktuell (laufende Liste) | Nur offene Nachtests (Pakete mit Klickwegen und URLs) und die Eichtabelle der Korridor-Fingerprints; erledigte Pakete wandern ins Archiv |
| [DONE.md](../DONE.md) | Aktuell | Changelog, neueste zuerst |

## Features & Systeme

| Dokument | Status | Beschreibung |
|----------|--------|--------------|
| [TOWER_CREATION.md](TOWER_CREATION.md) | Aktuell | Neue Tower erstellen, rotierende Turrets, Sound-Integration |
| [ENEMY_CREATION.md](ENEMY_CREATION.md) | Aktuell | Enemies erstellen, Animationen, Audio-System |
| [STATUS_EFFECTS.md](STATUS_EFFECTS.md) | Aktuell | Status-Effekt-System (Slow, Burn, Poison, Freeze als Halt, Stun) |
| [WAVE_SYSTEM.md](WAVE_SYSTEM.md) | Aktuell | Wave-Management, Sub-Step-Spawner, Mixed Waves, Game Phases |
| [ABILITIES.md](ABILITIES.md) | Aktuell | Spieler-Fähigkeiten (Nuklearschlag aus dem Missile Silo, Frostbombe, EMP, Orbitallaser), Fähigkeitenleiste: Ladungen, Zielmodus, Einschlag in Sub-Steps, Leck-Buchung im Gate, Bot-Strategie |
| [HERO.md](HERO.md) | Aktuell | Held (Söldner): Forschung und Anheuern, Routengraph mit Dijkstra, Posten und Leine, Munition als Schadensart, Stufen, virtueller Tower im Fairness-Gate, Modell-Naht, Bedienung (G, V) |
| [REPLAY.md](REPLAY.md) | Aktuell | Replay der letzten Welle: warum Präsentations-Aufnahme statt Re-Simulation, Aufnahme in Typed Arrays mit Speichergrenze, Player über die Live-Renderer, Bedienung, Grenzen |
| [STATIC_WAVE_FALLBACK.md](STATIC_WAVE_FALLBACK.md) | Aktuell | Debug-Pfad ohne Director: `STATIC_WAVE_PROFILES`, UI-Toggle, Post-W30-Loop |
| [LOCATION_SYSTEM.md](LOCATION_SYSTEM.md) | Aktuell | Location Dialog, Geocoding, Spawn-Generierung |
| [ROUTE_CORRIDOR.md](ROUTE_CORRIDOR.md) | Aktuell | Breite des Routenkorridors: Freiraum je Seite aus den Tiles, OSM-Breite als Rückfall, Laufweg (Korridor endet vor Autos, Traufen, Hecken), Brücken, Tunnel, Bau hinter dem Ladescreen und Einfrieren (`CorridorBuild`), Seitenversatz der Gegner und ihre Bögen an Ecken, `__corridor.*`, `__routes.describe()` |
| [PROJECTILES.md](PROJECTILES.md) | Aktuell | Projektil-System, Flugbahnen, Konfiguration |
| [SPATIAL_AUDIO.md](SPATIAL_AUDIO.md) | Aktuell | 3D Audio, positionsabhängige Sounds, Hintergrundmusik |
| [MODEL_PREVIEW.md](MODEL_PREVIEW.md) | Aktuell | 3D Model Previews in der Sidebar (Renderer-Capacity-Strategie) |
| [PARTICLE_SYSTEM.md](PARTICLE_SYSTEM.md) | Aktuell | Partikel, Decals, Floating Text, VFX-Subsysteme |
| [INSTANCED_ENEMY_RENDERING.md](INSTANCED_ENEMY_RENDERING.md) | Aktuell | GPU Instancing mit VAT (Draw-Call-Reduktion) |
| [ENEMY_MODEL_BUDGET.md](ENEMY_MODEL_BUDGET.md) | Aktuell | Gegnermodelle vermessen (VAT-Vertices, VAT-Speicher, Clips, Vorkommen in Wellen), Budget je Klasse, Optimierungsliste. Tabellen per `npm run model-budget` |
| [SPAWN_PORTAL.md](SPAWN_PORTAL.md) | Aktuell | Spawn-Portal: Ebene und Ausrichtung an der Route, Verdeckung der Gegner per Clip in ihren Shadern, Vorschau beim Setzen, Drehen mit R samt Kurs in URL und Favoriten, Drehbereich, Lufteinheiten, Asset, Licht, Sigillen, Beschwörungskreis |
| [LOS_PIPELINE.md](LOS_PIPELINE.md) | Aktuell | Sichtlinien der Tower auf dem Route-Grid: eine GPU-Cubemap je Tower-Tip, drei Leser (Build-Vorschau, Auswahl, Kampf-Cache), Farben der Zellplatten, Regeln für jeden Eingriff am Cube, Abläufe |
| [DEVWORLD.md](DEVWORLD.md) | Aktuell | Offline-Entwicklungsumgebung, Terrain-Presets (`?devworld`) |

## Game Design

| Dokument | Status | Beschreibung |
|----------|--------|--------------|
| [MASTER_GAME_DESIGN.md](game-design/MASTER_GAME_DESIGN.md) | Aktuell | Game Design: Schadenstypen, Rüstung, Damage-Matrix, Balance |
| [BALANCE_PROPOSAL_2026-09.md](game-design/BALANCE_PROPOSAL_2026-09.md) | Bericht | Balance-Vorschlag vom 2026-09-11: Upgrade-Kurven, Cannon, Matrix-Spreizung, Boss-Takt ab W31, mit Rechenwegen. Im Sprint 2026-09-11 umgesetzt; die offenen Fragen stehen am Ende |
| [PLAYER_AGENCY_CONCEPT.md](game-design/PLAYER_AGENCY_CONCEPT.md) | Bericht | Spieler aktiver einbinden: die Entscheidungen vom 2026-09-12 (Abschnitt 7) und was beim Bau von Nuklearschlag und Held festgelegt wurde (8, 9). Das Konzept davor (Abschnitte 0 bis 6) liegt im Archiv |
| [COMBAT_HEATMAP_STUDY.md](game-design/COMBAT_HEATMAP_STUDY.md) | Bericht | Machbarkeitsstudie Kampfzonen. Schicht 1 (Kampfspuren) ist umgesetzt, siehe PARTICLE_SYSTEM.md; Schicht 2 (Heatmap) nicht |

## Wave Director & AI

> Der Wave-Director ist **regelbasiert und vollständig clientseitig**. Das
> ONNX-Modell ist Opt-in im Debug-Fenster (nur mit einem Modell passender
> Eingangsbreite), kein Python-Server im Spielbetrieb.
> Begründung und Messungen: AI_WAVE_DIRECTOR_PLAN.md.

| Dokument | Status | Beschreibung |
|----------|--------|--------------|
| **[AI_WAVE_DIRECTOR_PLAN.md](AI_WAVE_DIRECTOR_PLAN.md)** | **Aktuell** | **Einstiegspunkt:** Regel-Director, Gate-Controller, warum das Modell ersetzt wurde, was vom RL-Aufbau bleibt |
| [BOT_SYSTEM.md](BOT_SYSTEM.md) | Aktuell | Strategy-Pattern-Bots (Placement, Upgrade, Wave, Research), der Gegenspieler im Training |
| [training-backend/README.md](../training-backend/README.md) | Aktuell | Backend starten, Ordner, Befehle |
| [AI_TRAINING_BACKEND.md](../training-backend/docs/AI_TRAINING_BACKEND.md) | Aktuell | Python Training Backend: PPO, State-Encoder, Reward, Decoder-Constraints, A/B-Directors |
| [AI_MODEL_EXPORT.md](../training-backend/docs/AI_MODEL_EXPORT.md) | Aktuell | ONNX-Export (`npm run export-ai`), nur für den Opt-in-Pfad nötig |
| [AI_TRAINING_SESSION_NOTES.md](../training-backend/docs/AI_TRAINING_SESSION_NOTES.md) | Historisch/Log | Entwicklungsgeschichte v1 → v3.5 + Phase-5.x-Index |

## Analysen & Berichte

| Dokument | Status | Beschreibung |
|----------|--------|--------------|

## Pläne (nicht umgesetzt)

| Dokument | Status | Beschreibung |
|----------|--------|--------------|
| [ROUTE_ALIGNED_CELLS_CONCEPT.md](ROUTE_ALIGNED_CELLS_CONCEPT.md) | Konzept (nicht geplant) | Zellen parallel zur Route statt Nord-Ost-Raster: Abhängigkeiten, Knicke, Kreuzungen, Varianten mit Aufwand, Empfehlung. Kein Code |
| [RUN_DUMP_PLAN.md](RUN_DUMP_PLAN.md) | Plan | Ein ganzer Lauf als Datei fürs Balancing: Inhalt, Bestand im Code, Anforderungen des Users, Balance-Fragen, die darauf warten |
| [MULTIPLAYER_CONCEPT.md](MULTIPLAYER_CONCEPT.md) | Plan | PvE-Coop und PvP: Machbarkeit, Determinismus-Blocker, Server-Entwurf, zwei durchentworfene Zielmodi. Kein Code |
| [ELECTRON_DESKTOP_PLAN.md](ELECTRON_DESKTOP_PLAN.md) | Plan | Windows-Desktop-Build via Electron. PoC abgeschlossen und zurückgebaut |

## Archiv

Überholte Dokumente liegen unter [archive/](archive/). Sie werden nicht mehr
nachgeführt; Pfade und Zahlen darin gelten für ihren Zeitpunkt.

| Dokument | Ersetzt durch / Anlass |
|----------|------------------------|
| [PHASE_5.10_TEMPLATES.md](archive/PHASE_5.10_TEMPLATES.md) | [PHASE_5.11_RANGES.md](archive/PHASE_5.11_RANGES.md), Übergang von 16-Softmax zu Templates |
| [ROUTE_GEOMETRY_ANALYSIS.md](archive/ROUTE_GEOMETRY_ANALYSIS.md) | [ROUTE_CORRIDOR.md](ROUTE_CORRIDOR.md); Herleitung des Korridors aus den Playtests 2026-09-10 bis -12 |
| [HANDOVER_ROUTE_GRID_GPU_LOS.md](archive/HANDOVER_ROUTE_GRID_GPU_LOS.md) | [LOS_PIPELINE.md](LOS_PIPELINE.md); Sackgassen, Diagnose-Werkzeuge und GPU-Probe der LOS-Anläufe (2026-05-15) |
| [TILES_LOADING_BUG.md](archive/TILES_LOADING_BUG.md) | Untersuchung der Tile-Ladefehler (2026-05-08); der Ablauf heute steht in ARCHITECTURE.md (`tile-loading-tracker.ts`) |
| [PHASE_5.11_RANGES.md](archive/PHASE_5.11_RANGES.md) | [AI_WAVE_DIRECTOR_PLAN.md](AI_WAVE_DIRECTOR_PLAN.md); Range-Templates und Decoder, die Mechanik gilt weiter |
| [HANDOVER_PLAYTEST_PHASE5.16.md](archive/HANDOVER_PLAYTEST_PHASE5.16.md) | [HANDOVER_TRAINING_REFRESH.md](archive/HANDOVER_TRAINING_REFRESH.md); Balance-Pass von Phase 5.16 |
| [UX_DISCUSSION_NOTES.md](archive/UX_DISCUSSION_NOTES.md) | Diskussionsnotizen zu Turmdrehung und Color Grading, beide entschieden |
| [ENGINE_DEEP_REVIEW_2026-05-16.md](archive/ENGINE_DEEP_REVIEW_2026-05-16.md) | Engine-Review über `src/app/`, Dependencies, Tests (Stand 2026-05-16) |
| [HANDOVER_MERGE_LOCAL_VS_ORIGIN.md](archive/HANDOVER_MERGE_LOCAL_VS_ORIGIN.md) | Merge-Divergenz lokal ↔ origin/main (2026-08-23) |
| [PLAYTEST_2026-09.md](archive/PLAYTEST_2026-09.md) | [PLAYTEST.md](PLAYTEST.md), [TODO.md](../TODO.md); Playtest-Liste vom 15. und 16.09. mit Ergebnissen, Punkte 601 bis 748, D1 bis D6, E1 bis E19 |
| [REVIEW_FIX_2026-09-14.md](archive/REVIEW_FIX_2026-09-14.md) | Fix-Session nach dem Playtest 2026-09-14: Änderungen je Thema, Entscheidungen, Review-Befunde, Playtest-Liste 501 bis 570 |
| [REVIEW_SPRINT_2026-09-14.md](archive/REVIEW_SPRINT_2026-09-14.md) | Nachtschicht 2: Änderungen je Feature mit Revert-Probe, Entscheidungen, Review-Befunde, Playtest-Liste 301 bis 440 |
| [REVIEW_SPRINT_2026-09-13.md](archive/REVIEW_SPRINT_2026-09-13.md) | Nachtschicht 1: Änderungen, Entscheidungen, Review-Befunde, Playtest-Liste 101 bis 258 |
| [REVIEW_SPRINT_2026-09-12.md](archive/REVIEW_SPRINT_2026-09-12.md) | Zweite Sprint-Runde: Änderungen, Review-Befunde, Playtest-Liste 1 bis 56 mit Ergebnissen |
| [REVIEW_SPRINT_2026-09-11.md](archive/REVIEW_SPRINT_2026-09-11.md) | Erste Sprint-Runde: Änderungen, Entscheidungen, TODO-Stand (in DONE.md 2026-09-12 übernommen) |
| [HANDOVER_RULE_DIRECTOR.md](archive/HANDOVER_RULE_DIRECTOR.md) | [AI_WAVE_DIRECTOR_PLAN.md](AI_WAVE_DIRECTOR_PLAN.md); Umstellung vom ONNX-Netz auf den Regel-Director (2026-09-07), die Messreihe dahinter, Einstieg für ein späteres Training |
| [HANDOVER_TRAINING_REFRESH.md](archive/HANDOVER_TRAINING_REFRESH.md) | [AI_WAVE_DIRECTOR_PLAN.md](AI_WAVE_DIRECTOR_PLAN.md); Refresh des Trainings-Backends bis 2026-09-07: Befunde, Grundsatzentscheidungen, Messhistorie |
| [PERF_BUG_ANALYSIS_2026-05-28.md](archive/PERF_BUG_ANALYSIS_2026-05-28.md) | [ARCHITECTURE.md](ARCHITECTURE.md) (Raycast-Messung, Benchmarks); Performance- und Bug-Deep-Dive vom 2026-05-28 mit Nachträgen bis 2026-09-14 |
| [PLAYER_AGENCY_CONCEPT_2026-09-11.md](archive/PLAYER_AGENCY_CONCEPT_2026-09-11.md) | [ABILITIES.md](ABILITIES.md), [HERO.md](HERO.md), [PLAYER_AGENCY_CONCEPT.md](game-design/PLAYER_AGENCY_CONCEPT.md) (Abschnitte 7 bis 9); das Konzept Abschnitte 0 bis 6 mit Varianten, Vergleich, MVP und offenen Fragen |
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
| ...wissen, was offen ist (Bugs, Entscheidungen, Features) | [TODO.md](../TODO.md) |
| ...wissen, was schon fertig ist | [DONE.md](../DONE.md) |
| ...wissen, was im Spiel noch nachzutesten ist | [PLAYTEST.md](PLAYTEST.md) |
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
| ...den Balance-Stand verstehen | [BALANCE_PROPOSAL_2026-09.md](game-design/BALANCE_PROPOSAL_2026-09.md), [economy-chart.html](economy-chart.html), [WAVE_SYSTEM.md](WAVE_SYSTEM.md) |
| ...ein Training fahren | [AI_TRAINING_BACKEND.md](../training-backend/docs/AI_TRAINING_BACKEND.md) |
| ...ein neues Modell exportieren | [AI_MODEL_EXPORT.md](../training-backend/docs/AI_MODEL_EXPORT.md) |
| ...das Location-System anpassen | [LOCATION_SYSTEM.md](LOCATION_SYSTEM.md) |
| ...verstehen, wie breit Route und Zellkorridor sind | [ROUTE_CORRIDOR.md](ROUTE_CORRIDOR.md) |
| ...das Spawn-Portal verstehen (Drehen, Look, Sigillen) | [SPAWN_PORTAL.md](SPAWN_PORTAL.md) |
| ...Sounds hinzufügen | [SPATIAL_AUDIO.md](SPATIAL_AUDIO.md) |
| ...neue Projektiltypen erstellen | [PROJECTILES.md](PROJECTILES.md) |
| ...Model Previews anpassen | [MODEL_PREVIEW.md](MODEL_PREVIEW.md) |
| ...Partikel-/Decal-/Floating-Text-Effekte anpassen | [PARTICLE_SYSTEM.md](PARTICLE_SYSTEM.md) |
| ...DevWorld konfigurieren | [DEVWORLD.md](DEVWORLD.md) |
| ...das Schadens-/Rüstungssystem verstehen | [MASTER_GAME_DESIGN.md](game-design/MASTER_GAME_DESIGN.md) |
| ...das GPU-instanzierte Enemy-Rendering verstehen | [INSTANCED_ENEMY_RENDERING.md](INSTANCED_ENEMY_RENDERING.md) |
| ...die GPU-LOS-Pipeline verstehen | [LOS_PIPELINE.md](LOS_PIPELINE.md) |

---

## Dateistruktur

Ordner mit Zweck und die wichtigsten Dateien: [ARCHITECTURE.md](ARCHITECTURE.md), Abschnitt 10 "Dateistruktur".
