# Tower Defense - Dokumentation

**Stand:** 2026-01-30

Dieses Verzeichnis enthaelt die technische Dokumentation fuer das Tower Defense Minispiel.

---

## Dokumente

### Kern-Dokumentation

| Dokument | Beschreibung |
|----------|--------------|
| [ARCHITECTURE.md](ARCHITECTURE.md) | System-Architektur, Component-System, Renderer, Services |
| [EVENT_SYSTEM.md](EVENT_SYSTEM.md) | Event Bus, Event-Typen, Manager-Kommunikation |
| [SIGNAL-STORE-ARCHITECTURE.md](SIGNAL-STORE-ARCHITECTURE.md) | Signal Store (4 Sub-Stores), Facade Pattern, Persistence |
| [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) | UI/UX Design Guidelines, Farbschema, Komponenten-Styling |
| [TODO.md](../TODO.md) | Offene Aufgaben und bekannte Bugs |
| [DONE.md](../DONE.md) | Abgeschlossene Features und Fixes |

### Feature-Dokumentation

| Dokument | Beschreibung |
|----------|--------------|
| [TOWER_CREATION.md](TOWER_CREATION.md) | Neue Tower erstellen, rotierende Turrets, Sound-Integration |
| [ENEMY_CREATION.md](ENEMY_CREATION.md) | Enemies erstellen, Animationen, Audio-System |
| [STATUS_EFFECTS.md](STATUS_EFFECTS.md) | Status-Effekt-System (Slow, Freeze, Burn) |
| [WAVE_SYSTEM.md](WAVE_SYSTEM.md) | Wave-Management, Spawning, Game Phases |
| [LOCATION_SYSTEM.md](LOCATION_SYSTEM.md) | Location Dialog, Geocoding, Spawn-Generierung |
| [PROJECTILES.md](PROJECTILES.md) | Projektil-System, Flugbahnen, Konfiguration |
| [SPATIAL_AUDIO.md](SPATIAL_AUDIO.md) | 3D Audio System, Positionsabhängige Sounds |
| [MODEL_PREVIEW.md](MODEL_PREVIEW.md) | 3D Model Previews in der Sidebar |
| [PARTICLE_SYSTEM.md](PARTICLE_SYSTEM.md) | Partikel-System, Blut, Feuer, Trail-Effekte |
| [TILES_LOADING_BUG.md](TILES_LOADING_BUG.md) | 3D-Tiles Loading Bug Analyse & Workarounds |
| [DEVWORLD.md](DEVWORLD.md) | DevWorld Offline-Entwicklungsumgebung, Terrain-Presets |
| [DAMAGE_ARMOR_SYSTEM.md](DAMAGE_ARMOR_SYSTEM.md) | Konzept: Schadenstypen & Ruestungssystem (geplant) |
| [REBALANCING.md](REBALANCING.md) | Balancing-Plan (Tower, Rewards, Economy, AI, Bot) |

### AI & Bot System

| Dokument | Beschreibung |
|----------|--------------|
| [AI_WAVE_DIRECTOR_PLAN.md](AI_WAVE_DIRECTOR_PLAN.md) | AI Wave Director - Gesamtuebersicht (Frontend + Backend) |
| [BOT_SYSTEM.md](BOT_SYSTEM.md) | Strategy-Based Bot System fuer AI Training |
| [AI_TRAINING_BACKEND.md](../training-backend/docs/AI_TRAINING_BACKEND.md) | Python Training Backend - PPO, Dashboard, Reward |
| [AI_TRAINING_SESSION_NOTES.md](../training-backend/docs/AI_TRAINING_SESSION_NOTES.md) | Entwicklungsgeschichte (v1→v2→v3) |
| [AI_MODEL_EXPORT.md](../training-backend/docs/AI_MODEL_EXPORT.md) | ONNX Model Export |

### Archiv (historische Referenz)

| Dokument | Beschreibung |
|----------|--------------|
| [MIGRATION-NEXT-STEPS.md](archive/MIGRATION-NEXT-STEPS.md) | Signal-Migration Handoff (abgeschlossen 30.01.2026) |
| [REFACTORING-PLAN.md](archive/REFACTORING-PLAN.md) | God Object Refactoring Plan (abgeschlossen 01/2026) |
| [EVENTBUS-ANALYSIS.md](archive/EVENTBUS-ANALYSIS.md) | EventBus Analyse & Hard Dependencies |
| [PERFORMANCE_REPORT.md](archive/PERFORMANCE_REPORT.md) | Performance-Analyse & Optimierungen |
| [EXPERT_REVIEW_2026.md](archive/EXPERT_REVIEW_2026.md) | Code-Analyse (7 KI-Experten) |
| [FRAME_TIMING_FIXES.md](archive/FRAME_TIMING_FIXES.md) | Frame-Timing Probleme |
| [GOD_REFACTOR.md](archive/GOD_REFACTOR.md) | God Object Refactoring (urspruenglicher Plan) |
| [2026-01-27_review.md](archive/2026-01-27_review.md) | Performance & Wartbarkeit Review |

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
| ...Waves konfigurieren | [WAVE_SYSTEM.md](WAVE_SYSTEM.md) |
| ...das Location-System anpassen | [LOCATION_SYSTEM.md](LOCATION_SYSTEM.md) |
| ...Sounds hinzufuegen | [SPATIAL_AUDIO.md](SPATIAL_AUDIO.md) |
| ...neue Projektiltypen erstellen | [PROJECTILES.md](PROJECTILES.md) |
| ...Model Previews anpassen | [MODEL_PREVIEW.md](MODEL_PREVIEW.md) |
| ...Partikel-Effekte anpassen | [PARTICLE_SYSTEM.md](PARTICLE_SYSTEM.md) |
| ...DevWorld konfigurieren | [DEVWORLD.md](DEVWORLD.md) |
| ...das Bot-System verstehen | [BOT_SYSTEM.md](BOT_SYSTEM.md) |
| ...das AI-System verstehen | [AI_WAVE_DIRECTOR_PLAN.md](AI_WAVE_DIRECTOR_PLAN.md) |
| ...das Balancing anpassen | [REBALANCING.md](REBALANCING.md) |
| ...das Schadens-/Ruestungssystem verstehen | [DAMAGE_ARMOR_SYSTEM.md](DAMAGE_ARMOR_SYSTEM.md) |

---

## Dateistruktur (Kurzuebersicht)

```
src/app/
├── tower-defense.component.ts   # Haupt-Spielkomponente
├── ai/                          # AI System (Wave Director, Bots, Training)
├── devworld/                    # DevWorld Offline-Umgebung (Terrain, Streets, Buildings)
├── game-engine/                 # Event Bus, VFX/Audio Services (framework-agnostic)
├── services/                    # Angular Services (Facades, UI-Bindings)
├── store/                       # Signal Stores (Game, UI, Engine, Location)
├── managers/                    # Manager (Enemy, Tower, Wave, etc. - event-driven)
├── entities/                    # Enemy, Tower, Projectile Entities
├── game-components/             # Transform, Health, Movement, Combat, etc.
├── configs/                     # Tower/Projectile/Audio/Visual Configs
├── components/                  # UI Sub-Components
└── three-engine/                # Three.js Engine + Renderer
```

Fuer die vollstaendige Dateistruktur siehe [ARCHITECTURE.md](ARCHITECTURE.md).
