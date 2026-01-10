# Tower Defense - Dokumentation

**Stand:** 2026-01-10

Dieses Verzeichnis enthält die technische Dokumentation für das Tower Defense Minispiel.

---

## Dokumente

### Kern-Dokumentation

| Dokument | Beschreibung |
|----------|--------------|
| [ARCHITECTURE.md](ARCHITECTURE.md) | System-Architektur, Component-System, Renderer, Services |
| [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) | UI/UX Design Guidelines, Farbschema, Komponenten-Styling |
| [TODO.md](TODO.md) | Offene Aufgaben und bekannte Bugs |
| [DONE.md](DONE.md) | Abgeschlossene Features und Fixes |

### Feature-Dokumentation

| Dokument | Beschreibung |
|----------|--------------|
| [LOCATION_SYSTEM.md](LOCATION_SYSTEM.md) | Location Dialog, Geocoding, Spawn-Generierung |
| [PROJECTILES.md](PROJECTILES.md) | Projektil-System, Flugbahnen, Konfiguration |
| [SPATIAL_AUDIO.md](SPATIAL_AUDIO.md) | 3D Audio System, Positionsabhängige Sounds |
| [MODEL_PREVIEW.md](MODEL_PREVIEW.md) | 3D Model Previews in der Sidebar |

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
| ...das Location-System anpassen | [LOCATION_SYSTEM.md](LOCATION_SYSTEM.md) |
| ...Sounds hinzufügen | [SPATIAL_AUDIO.md](SPATIAL_AUDIO.md) |
| ...neue Projektiltypen erstellen | [PROJECTILES.md](PROJECTILES.md) |
| ...Model Previews anpassen | [MODEL_PREVIEW.md](MODEL_PREVIEW.md) |

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
