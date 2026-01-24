# Tower Defense - Dokumentation

**Stand:** 2026-01-25

Dieses Verzeichnis enthaelt die technische Dokumentation fuer das Tower Defense Minispiel.

---

## Dokumente

### Kern-Dokumentation

| Dokument | Beschreibung |
|----------|--------------|
| [ARCHITECTURE.md](ARCHITECTURE.md) | System-Architektur, Component-System, Renderer, Services |
| [EVENT_SYSTEM.md](EVENT_SYSTEM.md) | Event Bus, Event-Typen, Manager-Kommunikation |
| [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) | UI/UX Design Guidelines, Farbschema, Komponenten-Styling |
| [TODO.md](../../../TODO.md) | Offene Aufgaben und bekannte Bugs |
| [DONE.md](../../../DONE.md) | Abgeschlossene Features und Fixes |

### Archiv (historische Referenz)

| Dokument | Beschreibung |
|----------|--------------|
| [PERFORMANCE_REPORT.md](archive/PERFORMANCE_REPORT.md) | Performance-Analyse & Optimierungen |
| [EXPERT_REVIEW_2026.md](archive/EXPERT_REVIEW_2026.md) | Code-Analyse (7 KI-Experten) |
| [FRAME_TIMING_FIXES.md](archive/FRAME_TIMING_FIXES.md) | Frame-Timing Probleme |
| [GOD_REFACTOR.md](archive/GOD_REFACTOR.md) | God Object Refactoring Plan |

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
| [BOT_SYSTEM.md](BOT_SYSTEM.md) | Strategy-Based Bot System fuer AI Training |

---

## Schnellnavigation

### Ich will...

| Ziel | Dokument |
|------|----------|
| ...die Gesamtarchitektur verstehen | [ARCHITECTURE.md](ARCHITECTURE.md) |
| ...das Event-System verstehen | [EVENT_SYSTEM.md](EVENT_SYSTEM.md) |
| ...wissen welche Services es gibt | [ARCHITECTURE.md](ARCHITECTURE.md) → Services |
| ...das UI stylen | [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) |
| ...einen Bug fixen | [TODO.md](../../../TODO.md) |
| ...wissen was schon fertig ist | [DONE.md](../../../DONE.md) |
| ...einen neuen Tower erstellen | [TOWER_CREATION.md](TOWER_CREATION.md) |
| ...einen neuen Enemy erstellen | [ENEMY_CREATION.md](ENEMY_CREATION.md) |
| ...rotierende Turrets bauen | [TOWER_CREATION.md](TOWER_CREATION.md) → Rotierende Tower-Teile |
| ...das Tower-Placement verstehen | [TOWER_CREATION.md](TOWER_CREATION.md) → Tower-Placement-System |
| ...Enemy-Animationen konfigurieren | [ENEMY_CREATION.md](ENEMY_CREATION.md) → Animation-System |
| ...Status-Effekte verstehen | [STATUS_EFFECTS.md](STATUS_EFFECTS.md) |
| ...Waves konfigurieren | [WAVE_SYSTEM.md](WAVE_SYSTEM.md) |
| ...das Location-System anpassen | [LOCATION_SYSTEM.md](LOCATION_SYSTEM.md) |
| ...Sounds hinzufügen | [SPATIAL_AUDIO.md](SPATIAL_AUDIO.md) |
| ...neue Projektiltypen erstellen | [PROJECTILES.md](PROJECTILES.md) |
| ...Model Previews anpassen | [MODEL_PREVIEW.md](MODEL_PREVIEW.md) |
| ...Partikel-Effekte anpassen | [PARTICLE_SYSTEM.md](PARTICLE_SYSTEM.md) |
| ...DevWorld konfigurieren | [DEVWORLD.md](DEVWORLD.md) |
| ...das Bot-System verstehen | [BOT_SYSTEM.md](BOT_SYSTEM.md) |

---

## Dateistruktur (Kurzübersicht)

```
src/app/
├── tower-defense.component.ts   # Haupt-Spielkomponente
├── ai/                          # AI System (Wave Director, Bots, Training)
├── devworld/                    # DevWorld Offline-Umgebung (Terrain, Streets, Buildings)
├── game-engine/                 # Event Bus, VFX/Audio Services (framework-agnostic)
├── services/                    # Angular Services (UI-Bindings)
├── managers/                    # Manager (Enemy, Tower, Wave, etc. - event-driven)
├── entities/                    # Enemy, Tower, Projectile Entities
├── game-components/             # Transform, Health, Movement, Combat, etc.
├── configs/                     # Tower/Projectile/Audio/Visual Configs
├── components/                  # UI Sub-Components
├── three-engine/                # Three.js Engine + Renderer
└── docs/                        # Diese Dokumentation
```

Für die vollständige Dateistruktur siehe [ARCHITECTURE.md](ARCHITECTURE.md).
