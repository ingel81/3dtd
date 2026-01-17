# Tower Defense - Dokumentation

**Stand:** 2026-01-16

Dieses Verzeichnis enthält die technische Dokumentation für das Tower Defense Minispiel.

---

## Dokumente

### Kern-Dokumentation

| Dokument | Beschreibung |
|----------|--------------|
| [ARCHITECTURE.md](ARCHITECTURE.md) | System-Architektur, Component-System, Renderer, Services |
| [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) | UI/UX Design Guidelines, Farbschema, Komponenten-Styling |
| [EXPERT_REVIEW_2026.md](EXPERT_REVIEW_2026.md) | **NEU** Umfassende Code-Analyse (7 KI-Experten) |
| [TODO.md](TODO.md) | Offene Aufgaben und bekannte Bugs |
| [DONE.md](DONE.md) | Abgeschlossene Features und Fixes |

### Feature-Dokumentation

| Dokument | Beschreibung |
|----------|--------------|
| [TOWER_CREATION.md](TOWER_CREATION.md) | Neue Tower erstellen, rotierende Turrets, Sound-Integration |
| [ENEMY_CREATION.md](ENEMY_CREATION.md) | **NEU** Neue Enemies erstellen, Animationen, Audio-System |
| [STATUS_EFFECTS.md](STATUS_EFFECTS.md) | **NEU** Status-Effekt-System (Slow, Freeze, Burn) |
| [WAVE_SYSTEM.md](WAVE_SYSTEM.md) | **NEU** Wave-Management, Spawning, Game Phases |
| [LOCATION_SYSTEM.md](LOCATION_SYSTEM.md) | Location Dialog, Geocoding, Spawn-Generierung |
| [PROJECTILES.md](PROJECTILES.md) | Projektil-System, Flugbahnen, Konfiguration |
| [SPATIAL_AUDIO.md](SPATIAL_AUDIO.md) | 3D Audio System, Positionsabhängige Sounds |
| [MODEL_PREVIEW.md](MODEL_PREVIEW.md) | 3D Model Previews in der Sidebar |
| [FRAME_TIMING_FIXES.md](FRAME_TIMING_FIXES.md) | Frame-Timing Probleme und Lösungen |
| [PARTICLE_SYSTEM.md](PARTICLE_SYSTEM.md) | Partikel-System, Blut, Feuer, Trail-Effekte |

---

## Schnellnavigation

### Ich will...

| Ziel | Dokument |
|------|----------|
| ...die Gesamtarchitektur verstehen | [ARCHITECTURE.md](ARCHITECTURE.md) |
| ...wissen welche Services es gibt | [ARCHITECTURE.md](ARCHITECTURE.md) → Services |
| ...das UI stylen | [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) |
| ...einen Bug fixen | [TODO.md](TODO.md) |
| ...wissen was schon fertig ist | [DONE.md](DONE.md) |
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
| ...Frame-Timing Bugs fixen | [FRAME_TIMING_FIXES.md](FRAME_TIMING_FIXES.md) |
| ...Partikel-Effekte anpassen | [PARTICLE_SYSTEM.md](PARTICLE_SYSTEM.md) |
| ...technische Schulden verstehen | [EXPERT_REVIEW_2026.md](EXPERT_REVIEW_2026.md) |
| ...Code-Qualitaet verbessern | [EXPERT_REVIEW_2026.md](EXPERT_REVIEW_2026.md) → Massnahmenkatalog |

---

## Dateistruktur (Kurzübersicht)

```
tower-defense/
├── tower-defense.component.ts   # Haupt-Komponente (~3150 Zeilen)
├── services/                    # 13 Services (4 existierend + 9 neu)
│   ├── game-ui-state.service.ts
│   ├── camera-control.service.ts
│   ├── marker-visualization.service.ts
│   ├── path-route.service.ts
│   ├── input-handler.service.ts
│   ├── tower-placement.service.ts
│   ├── location-management.service.ts
│   ├── height-update.service.ts
│   ├── engine-initialization.service.ts
│   └── ... (existierende Services)
├── three-engine/                # Three.js Engine + Renderer
├── managers/                    # Game State, Enemy, Tower, Projectile, Wave
├── entities/                    # Enemy, Tower, Projectile Entities
├── game-components/             # Transform, Health, Movement, Combat, etc.
├── configs/                     # Tower/Projectile Type Configs
├── components/                  # UI Sub-Components
└── docs/                        # Diese Dokumentation
```

Für die vollständige Dateistruktur siehe [ARCHITECTURE.md](ARCHITECTURE.md).
