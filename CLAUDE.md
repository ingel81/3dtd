# CLAUDE.md - 3DTD

## Projekt

3DTD - Standalone Tower Defense auf Google Maps 3D Tiles

## Befehle

```bash
npm start       # Development Server (http://localhost:4200)
npm run build   # Production Build
```

## Architektur

- Angular 21 Standalone Components
- Three.js + 3DTilesRendererJS für 3D-Rendering
- Kein Backend - komplett clientseitig
- Google Maps API Key in environment.ts

## Projektstruktur

```
src/app/
├── app.ts                      # Root Component (AppComponent)
├── app.config.ts               # Provider Config
├── app.routes.ts               # Routing
├── tower-defense.component.ts  # Haupt-Spielkomponente
├── components/                 # UI Components (compass, game-header, game-sidebar, etc.)
├── configs/                    # Tower & Projectile Type Configs
├── core/services/              # Config Service
├── docs/                       # Dokumentation
├── entities/                   # Enemy, Tower, Projectile
├── game/tower-defense/shaders/ # Shader Code
├── game-components/            # ECS Components (transform, health, etc.)
├── managers/                   # 8 Manager (enemy, tower, projectile, wave, etc.)
├── models/                     # Type Definitions
├── services/                   # 17 Angular Services
├── styles/                     # Theme & Global Styles
└── three-engine/               # 3D Rendering (renderers/)
```

## Wichtig

- **Kein `npm start` ohne Befehl**
- **Keine Commits ohne Befehl**
- **Keine Co-Authored-By Zeile in Commits**
- **API Keys nie committen** (environment.ts ist in .gitignore)

## Dokumentation

**Pflichtlektüre je nach Aufgabe!** Detaillierte Dokumentation befindet sich in `src/app/docs/`:

| Dokument | Beschreibung |
|----------|--------------|
| [INDEX.md](src/app/docs/INDEX.md) | Übersicht aller Dokumentationen |
| [ARCHITECTURE.md](src/app/docs/ARCHITECTURE.md) | System-Architektur & Design |
| [DESIGN_SYSTEM.md](src/app/docs/DESIGN_SYSTEM.md) | UI Design System |
| [LOCATION_SYSTEM.md](src/app/docs/LOCATION_SYSTEM.md) | Standort-System |
| [SPATIAL_AUDIO.md](src/app/docs/SPATIAL_AUDIO.md) | 3D Audio System |
| [PROJECTILES.md](src/app/docs/PROJECTILES.md) | Projektil-System |
| [MODEL_PREVIEW.md](src/app/docs/MODEL_PREVIEW.md) | 3D Model Preview |
| [TODO.md](src/app/docs/TODO.md) | Offene Aufgaben |
| [DONE.md](src/app/docs/DONE.md) | Erledigte Aufgaben |

**Hinweis zu TODO/DONE:** Diese Listen werden automatisch gepflegt. Einträge werden jedoch **nur auf menschlichen Zuruf** von TODO nach DONE verschoben.

## Tech Stack

| Teil | Technologie |
|------|-------------|
| Framework | Angular 21 |
| 3D Engine | Three.js 0.182 |
| 3D Tiles | 3DTilesRendererJS 0.4.19 |
| UI | Angular Material 21 |
| Maps | Google Maps 3D Tiles API |
| Geocoding | OpenStreetMap Nominatim |
