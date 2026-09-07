# 3DTD - Dokumentation

Technische Dokumentation zum Tower Defense auf Google Maps 3D Tiles.

Die Statusspalte sagt, wie weit man einem Dokument trauen darf:
**Aktuell** = beschreibt den laufenden Stand · **Plan** = beschreibt etwas noch
nicht Gebautes · **Historisch** = überholt, nur noch als Herkunft interessant.

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
| [STATUS_EFFECTS.md](STATUS_EFFECTS.md) | Aktuell | Status-Effekt-System (Slow, Burn, Poison; Freeze reserviert) |
| [WAVE_SYSTEM.md](WAVE_SYSTEM.md) | Aktuell | Wave-Management, Sub-Step-Spawner, Mixed Waves, Game Phases |
| [STATIC_WAVE_FALLBACK.md](STATIC_WAVE_FALLBACK.md) | Aktuell | Debug-Pfad ohne Director: `STATIC_WAVE_PROFILES`, UI-Toggle, Post-W30-Loop |
| [LOCATION_SYSTEM.md](LOCATION_SYSTEM.md) | Aktuell | Location Dialog, Geocoding, Spawn-Generierung |
| [PROJECTILES.md](PROJECTILES.md) | Aktuell | Projektil-System, Flugbahnen, Konfiguration |
| [SPATIAL_AUDIO.md](SPATIAL_AUDIO.md) | Aktuell | 3D Audio, positionsabhängige Sounds, Hintergrundmusik |
| [MODEL_PREVIEW.md](MODEL_PREVIEW.md) | Aktuell | 3D Model Previews in der Sidebar (Renderer-Capacity-Strategie) |
| [PARTICLE_SYSTEM.md](PARTICLE_SYSTEM.md) | Aktuell | Partikel, Decals, Floating Text, VFX-Subsysteme |
| [INSTANCED_ENEMY_RENDERING.md](INSTANCED_ENEMY_RENDERING.md) | Aktuell | GPU Instancing mit VAT (Draw-Call-Reduktion) |
| [HANDOVER_ROUTE_GRID_GPU_LOS.md](HANDOVER_ROUTE_GRID_GPU_LOS.md) | Aktuell | GPU-Cubemap-LOS-Pipeline (Ground + Air produktiv) |
| [TILES_LOADING_BUG.md](TILES_LOADING_BUG.md) | Aktuell | 3D-Tiles Loading Bug + Tile-Quality-Aware Route Protection |
| [DEVWORLD.md](DEVWORLD.md) | Aktuell | Offline-Entwicklungsumgebung, Terrain-Presets (`?devworld`) |
| [MASTER_GAME_DESIGN.md](game-design/MASTER_GAME_DESIGN.md) | Aktuell | Game Design: Schadenstypen, Rüstung, Damage-Matrix, Balance |

## Wave Director & AI

> Der Wave-Director ist seit dem aktuellen Stand **regelbasiert und vollständig
> clientseitig**. Das ONNX-Modell ist Opt-in im Debug-Fenster, kein Python-Server
> im Spielbetrieb. Begründung und Messungen: AI_WAVE_DIRECTOR_PLAN.md.

| Dokument | Status | Beschreibung |
|----------|--------|--------------|
| **[AI_WAVE_DIRECTOR_PLAN.md](AI_WAVE_DIRECTOR_PLAN.md)** | **Aktuell** | **Einstiegspunkt:** Regel-Director, Gate-Controller, warum das Modell ersetzt wurde, was vom RL-Aufbau bleibt |
| [BOT_SYSTEM.md](BOT_SYSTEM.md) | Aktuell | Strategy-Pattern-Bots (Placement, Upgrade, Wave, Research) — der Gegenspieler im Training |
| [HANDOVER_PLAYTEST_PHASE5.16.md](HANDOVER_PLAYTEST_PHASE5.16.md) | Aktuell | Balance-Stand: Wave-Curriculum, Endgame-Knobs, Gold-Budget |
| [PHASE_5.11_RANGES.md](PHASE_5.11_RANGES.md) | Aktuell (Teil) | Range-Templates, Decoder-Constraints, Reward-Tuning. Die Template-/Decoder-Mechanik gilt weiter; die Aussagen zum Modell als Director sind überholt |
| [HANDOVER_TRAINING_REFRESH.md](HANDOVER_TRAINING_REFRESH.md) | Aktuell | Refresh des Trainings-Backends: Befunde, Grundsatzentscheidungen, Messbetrieb |
| [AI_TRAINING_BACKEND.md](../training-backend/docs/AI_TRAINING_BACKEND.md) | Aktuell | Python Training Backend: PPO, State-Encoder, Reward, Decoder-Constraints, A/B-Directors |
| [AI_MODEL_EXPORT.md](../training-backend/docs/AI_MODEL_EXPORT.md) | Aktuell | ONNX-Export (`npm run export-ai`) — nur für den Opt-in-Pfad nötig |
| [AI_TRAINING_SESSION_NOTES.md](../training-backend/docs/AI_TRAINING_SESSION_NOTES.md) | Historisch/Log | Entwicklungsgeschichte v1 → v3.5 + Phase-5.x-Index |

## Analysen & Berichte

| Dokument | Status | Beschreibung |
|----------|--------|--------------|
| [ENGINE_DEEP_REVIEW_2026-05-16.md](ENGINE_DEEP_REVIEW_2026-05-16.md) | Bericht | Engine-Review über `src/app/`, Dependencies, Tests |
| [PERF_BUG_ANALYSIS_2026-05-28.md](PERF_BUG_ANALYSIS_2026-05-28.md) | Bericht | Performance- und Bug-Deep-Dive: Render-Loop, Instancing, VFX, Game-Loop, Leaks |
| [HANDOVER_MERGE_LOCAL_VS_ORIGIN.md](HANDOVER_MERGE_LOCAL_VS_ORIGIN.md) | Bericht | Merge-Divergenz lokal ↔ origin/main (2026-08-23) |

## Pläne (nicht umgesetzt)

| Dokument | Status | Beschreibung |
|----------|--------|--------------|
| [MULTIPLAYER_CONCEPT.md](MULTIPLAYER_CONCEPT.md) | Plan | PvE-Coop und PvP: Machbarkeit, Determinismus-Blocker, Server-Entwurf, zwei durchentworfene Zielmodi. Kein Code |
| [ELECTRON_DESKTOP_PLAN.md](ELECTRON_DESKTOP_PLAN.md) | Plan | Windows-Desktop-Build via Electron. PoC abgeschlossen und zurückgebaut |

## Historisch

| Dokument | Ersetzt durch |
|----------|---------------|
| [PHASE_5.10_TEMPLATES.md](PHASE_5.10_TEMPLATES.md) | [PHASE_5.11_RANGES.md](PHASE_5.11_RANGES.md) — Übergang von 16-Softmax zu Templates |
| `training-backend/PHASE5.5_TRAINING_RUNBOOK.md` | [AI_WAVE_DIRECTOR_PLAN.md](AI_WAVE_DIRECTOR_PLAN.md) — historisches Restart-Runbook, liegt bewusst nur unter `training-backend/` |

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
| ...einen neuen Tower erstellen | [TOWER_CREATION.md](TOWER_CREATION.md) |
| ...einen neuen Enemy erstellen | [ENEMY_CREATION.md](ENEMY_CREATION.md) |
| ...rotierende Turrets bauen | [TOWER_CREATION.md](TOWER_CREATION.md) → Rotierende Tower-Teile |
| ...das Tower-Placement verstehen | [TOWER_CREATION.md](TOWER_CREATION.md) → Tower-Placement-System |
| ...Enemy-Animationen konfigurieren | [ENEMY_CREATION.md](ENEMY_CREATION.md) → Animation-System |
| ...Status-Effekte verstehen | [STATUS_EFFECTS.md](STATUS_EFFECTS.md) |
| ...Waves konfigurieren / Mixed Waves bauen | [WAVE_SYSTEM.md](WAVE_SYSTEM.md) |
| ...verstehen, wer die Wellen aussucht | [AI_WAVE_DIRECTOR_PLAN.md](AI_WAVE_DIRECTOR_PLAN.md) |
| ...den Fairness-Cap / das Gate verstehen | [AI_WAVE_DIRECTOR_PLAN.md](AI_WAVE_DIRECTOR_PLAN.md) → Gate-Controller |
| ...wissen, warum das ONNX-Modell nicht mehr läuft | [AI_WAVE_DIRECTOR_PLAN.md](AI_WAVE_DIRECTOR_PLAN.md) → Warum die Regeln |
| ...ohne Director durchspielen (Static-Fallback) | [STATIC_WAVE_FALLBACK.md](STATIC_WAVE_FALLBACK.md) |
| ...das Bot-System verstehen | [BOT_SYSTEM.md](BOT_SYSTEM.md) |
| ...den Balance-Stand verstehen | [HANDOVER_PLAYTEST_PHASE5.16.md](HANDOVER_PLAYTEST_PHASE5.16.md) |
| ...ein Training fahren | [AI_TRAINING_BACKEND.md](../training-backend/docs/AI_TRAINING_BACKEND.md) |
| ...ein neues Modell exportieren | [AI_MODEL_EXPORT.md](../training-backend/docs/AI_MODEL_EXPORT.md) |
| ...das Location-System anpassen | [LOCATION_SYSTEM.md](LOCATION_SYSTEM.md) |
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
├── tower-defense.component.ts   # Haupt-Spielkomponente
├── ai/
│   ├── core/                    # Regel-Director, Gate-Controller, Templates, Encoder
│   └── training/                # Bots + Strategien, WebSocket-Client
├── devworld/                    # Offline-Umgebung (Terrain, Streets, Buildings)
├── game-engine/                 # Event Bus, VFX/Audio/Music (framework-agnostisch)
├── services/                    # Angular Services (Facades, UI-Bindings)
├── store/                       # Signal Stores
├── managers/                    # Manager (Enemy, Tower, Wave, Research — event-driven)
├── entities/                    # Enemy, Tower, Projectile
├── game-components/             # Transform, Health, Movement, Combat, ...
├── configs/                     # Tower/Enemy/Projectile/Combat/Research/Audio/Wave-Curriculum
├── components/                  # UI Sub-Components
├── workers/                     # Web Workers (Pathfinding)
└── three-engine/                # Three.js Engine + Renderers
```

Vollständige Dateistruktur: [ARCHITECTURE.md](ARCHITECTURE.md).
