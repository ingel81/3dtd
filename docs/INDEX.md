# Tower Defense - Dokumentation

**Stand:** 2026-05-12

Dieses Verzeichnis enthaelt die technische Dokumentation fuer das Tower Defense Minispiel.

---

## Dokumente

### Kern-Dokumentation

| Dokument | Beschreibung |
|----------|--------------|
| [ARCHITECTURE.md](ARCHITECTURE.md) | System-Architektur, Component-System, Renderer, Services (mit `combat/`, `debug/`, `facade/`, `infrastructure/`, `location/`, `world/` Subfoldern) |
| [EVENT_SYSTEM.md](EVENT_SYSTEM.md) | Event Bus, Event-Typen, Manager-Kommunikation |
| [SIGNAL-STORE-ARCHITECTURE.md](SIGNAL-STORE-ARCHITECTURE.md) | Signal Store (6 Sub-Stores: Game/UI/Engine/Location/Research/Debug), Facade Pattern, Persistence |
| [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) | UI/UX Design Guidelines, Farbschema, Komponenten-Styling |
| [TODO.md](../TODO.md) | Offene Aufgaben und bekannte Bugs |
| [DONE.md](../DONE.md) | Abgeschlossene Features und Fixes |

### Feature-Dokumentation

| Dokument | Beschreibung |
|----------|--------------|
| [TOWER_CREATION.md](TOWER_CREATION.md) | Neue Tower erstellen, rotierende Turrets, Sound-Integration |
| [ENEMY_CREATION.md](ENEMY_CREATION.md) | Enemies erstellen, Animationen, Audio-System |
| [STATUS_EFFECTS.md](STATUS_EFFECTS.md) | Status-Effekt-System (Slow, Burn, Poison; Freeze reserviert) |
| [WAVE_SYSTEM.md](WAVE_SYSTEM.md) | Wave-Management, Sub-Step-Spawner, Mixed Waves, Game Phases |
| [STATIC_WAVE_FALLBACK.md](STATIC_WAVE_FALLBACK.md) | Static-Curriculum-Fallback (AI-off Debug-Pfad): STATIC_WAVE_PROFILES, UI-Toggle, Post-W30-Loop |
| [LOCATION_SYSTEM.md](LOCATION_SYSTEM.md) | Location Dialog, Geocoding, Spawn-Generierung |
| [PROJECTILES.md](PROJECTILES.md) | Projektil-System, Flugbahnen, Konfiguration |
| [SPATIAL_AUDIO.md](SPATIAL_AUDIO.md) | 3D Audio System, Positionsabhängige Sounds, Hintergrundmusik |
| [MODEL_PREVIEW.md](MODEL_PREVIEW.md) | 3D Model Previews in der Sidebar (mit Renderer-Capacity-Strategie) |
| [PARTICLE_SYSTEM.md](PARTICLE_SYSTEM.md) | Partikel-System, Decals, Floating Text, VFX-Subsysteme |
| [TILES_LOADING_BUG.md](TILES_LOADING_BUG.md) | 3D-Tiles Loading Bug Analyse & Tile-Quality-Aware Route Protection |
| [DEVWORLD.md](DEVWORLD.md) | DevWorld Offline-Entwicklungsumgebung, Terrain-Presets |
| [MASTER_GAME_DESIGN.md](game-design/MASTER_GAME_DESIGN.md) | Konsolidiertes Game Design (Schadenstypen, Ruestung, Damage-Matrix, Balance) |
| [INSTANCED_ENEMY_RENDERING.md](INSTANCED_ENEMY_RENDERING.md) | GPU Instancing mit VAT fuer Enemy-Rendering (Draw Call Reduktion) |

### AI & Bot System

| Dokument | Beschreibung |
|----------|--------------|
| **[PHASE_5.11_RANGES.md](PHASE_5.11_RANGES.md)** | **Aktuelle Architektur:** Range-Based Templates, 4 Continuous-Params, Wave-Duration-Cap, plus Phase-5.11b/5.14/5.16-Erweiterungen |
| **[HANDOVER_PLAYTEST_PHASE5.16.md](HANDOVER_PLAYTEST_PHASE5.16.md)** | **Aktueller Balance-Stand:** Wave-Curriculum, Endgame-Knobs, Gold-Budget — Companion zu Phase 5.11 |
| [HANDOVER_ROUTE_GRID_GPU_LOS.md](HANDOVER_ROUTE_GRID_GPU_LOS.md) | **Geplant:** GPU-Cubemap-basierter LOS-Rewrite fuer Route-Cell-Grid (Status: Plan, nicht implementiert) |
| [HANDOVER_MERGE_LOCAL_VS_ORIGIN.md](HANDOVER_MERGE_LOCAL_VS_ORIGIN.md) | **Offener Merge lokal ↔ origin/main** (2026-08-23) — Divergenz, Kollisionen pro Bereich, Vorgehen |
| [AI_WAVE_DIRECTOR_PLAN.md](AI_WAVE_DIRECTOR_PLAN.md) | AI Wave Director - konsolidierte Gesamtuebersicht (verlinkt 5.11 + 5.16) |
| [BOT_SYSTEM.md](BOT_SYSTEM.md) | Strategy-Based Bot System fuer AI Training (8 Strategien inkl. Research) |
| [PHASE_5.10_TEMPLATES.md](PHASE_5.10_TEMPLATES.md) | _Historical:_ Template-Based (superseded by 5.11) |
| [AI_TRAINING_BACKEND.md](../training-backend/docs/AI_TRAINING_BACKEND.md) | Python Training Backend - PPO, State 156, 4-Term Reward, Decoder-Constraints |
| [AI_TRAINING_SESSION_NOTES.md](../training-backend/docs/AI_TRAINING_SESSION_NOTES.md) | Entwicklungsgeschichte v1→v3.5 + Phase-5.x-Index |
| [AI_MODEL_EXPORT.md](../training-backend/docs/AI_MODEL_EXPORT.md) | ONNX Model Export (`npm run export-ai`) |

> Backend-spezifisches `training-backend/PHASE5.5_TRAINING_RUNBOOK.md` ist ein historisches Restart-Runbook und liegt bewusst nur unter `training-backend/`.

---

## Schnellnavigation

### Ich will...

| Ziel | Dokument |
|------|----------|
| ...die Gesamtarchitektur verstehen | [ARCHITECTURE.md](ARCHITECTURE.md) |
| ...das Event-System verstehen | [EVENT_SYSTEM.md](EVENT_SYSTEM.md) |
| ...den Signal Store verstehen | [SIGNAL-STORE-ARCHITECTURE.md](SIGNAL-STORE-ARCHITECTURE.md) |
| ...wissen welche Services es gibt | [ARCHITECTURE.md](ARCHITECTURE.md) → Services |
| ...das UI stylen | [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) |
| ...einen Bug fixen | [TODO.md](../TODO.md) |
| ...wissen was schon fertig ist | [DONE.md](../DONE.md) |
| ...einen neuen Tower erstellen | [TOWER_CREATION.md](TOWER_CREATION.md) |
| ...einen neuen Enemy erstellen | [ENEMY_CREATION.md](ENEMY_CREATION.md) |
| ...rotierende Turrets bauen | [TOWER_CREATION.md](TOWER_CREATION.md) → Rotierende Tower-Teile |
| ...das Tower-Placement verstehen | [TOWER_CREATION.md](TOWER_CREATION.md) → Tower-Placement-System |
| ...Enemy-Animationen konfigurieren | [ENEMY_CREATION.md](ENEMY_CREATION.md) → Animation-System |
| ...Status-Effekte verstehen | [STATUS_EFFECTS.md](STATUS_EFFECTS.md) |
| ...Waves konfigurieren / Mixed Waves bauen | [WAVE_SYSTEM.md](WAVE_SYSTEM.md) |
| ...ohne AI durchspielen (Static-Fallback) | [STATIC_WAVE_FALLBACK.md](STATIC_WAVE_FALLBACK.md) |
| ...das Location-System anpassen | [LOCATION_SYSTEM.md](LOCATION_SYSTEM.md) |
| ...Sounds hinzufuegen | [SPATIAL_AUDIO.md](SPATIAL_AUDIO.md) |
| ...neue Projektiltypen erstellen | [PROJECTILES.md](PROJECTILES.md) |
| ...Model Previews anpassen | [MODEL_PREVIEW.md](MODEL_PREVIEW.md) |
| ...Partikel-/Decal-/Floating-Text-Effekte anpassen | [PARTICLE_SYSTEM.md](PARTICLE_SYSTEM.md) |
| ...DevWorld konfigurieren | [DEVWORLD.md](DEVWORLD.md) |
| ...das Bot-System verstehen | [BOT_SYSTEM.md](BOT_SYSTEM.md) |
| ...die aktuelle AI-Architektur verstehen | [PHASE_5.11_RANGES.md](PHASE_5.11_RANGES.md) |
| ...den aktuellen Balance-Stand verstehen | [HANDOVER_PLAYTEST_PHASE5.16.md](HANDOVER_PLAYTEST_PHASE5.16.md) |
| ...das AI-Gesamtsystem verstehen | [AI_WAVE_DIRECTOR_PLAN.md](AI_WAVE_DIRECTOR_PLAN.md) |
| ...ein neues Modell exportieren | [AI_MODEL_EXPORT.md](../training-backend/docs/AI_MODEL_EXPORT.md) |
| ...das Schadens-/Ruestungssystem verstehen | [MASTER_GAME_DESIGN.md](game-design/MASTER_GAME_DESIGN.md) |
| ...das GPU-instanzierte Enemy-Rendering verstehen | [INSTANCED_ENEMY_RENDERING.md](INSTANCED_ENEMY_RENDERING.md) |
| ...den geplanten GPU-LOS-Rewrite einschaetzen | [HANDOVER_ROUTE_GRID_GPU_LOS.md](HANDOVER_ROUTE_GRID_GPU_LOS.md) |

---

## Dateistruktur (Kurzuebersicht)

```
src/app/
├── tower-defense.component.ts   # Haupt-Spielkomponente
├── ai/                          # AI System (Wave Director, Bots, Training)
├── devworld/                    # DevWorld Offline-Umgebung (Terrain, Streets, Buildings)
├── game-engine/                 # Event Bus, VFX/Audio/Music Services (framework-agnostic)
├── services/                    # Angular Services (Facades, UI-Bindings)
├── store/                       # Signal Stores (Game, UI, Engine, Location, Research)
├── managers/                    # Manager (Enemy, Tower, Wave, Research, etc. - event-driven)
├── entities/                    # Enemy, Tower, Projectile Entities
├── game-components/             # Transform, Health, Movement, Combat, etc.
├── configs/                     # Tower/Enemy/Projectile/Combat/Research/Audio Configs
├── components/                  # UI Sub-Components
├── workers/                     # Web Workers (Pathfinding)
└── three-engine/                # Three.js Engine + Renderers (instanced/decal/text/...)
```

Fuer die vollstaendige Dateistruktur siehe [ARCHITECTURE.md](ARCHITECTURE.md).
