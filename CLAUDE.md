# CLAUDE.md - 3DTD

## Projekt

3DTD - Standalone Tower Defense auf Google Maps 3D Tiles

## Befehle

```bash
npm start       # Development Server (http://localhost:4200)
npm run build   # Production Build
npm run lint    # Linting
```

## Architektur

- Angular 21 Standalone Components
- Three.js + 3DTilesRendererJS für 3D-Rendering
- Kein Backend - komplett clientseitig
- Google Maps API Key in environment.ts

## Projektstruktur

```
src/app/
├── app.component.ts       # Root Component
├── app.config.ts          # Provider Config
├── app.routes.ts          # Routing (lädt TD lazy)
├── core/
│   └── services/
│       └── config.service.ts  # API Key Provider
└── game/
    └── tower-defense/     # TD Game Code
        ├── tower-defense.component.ts
        ├── services/      # 9 Angular Services
        ├── managers/      # Game Manager
        ├── entities/      # Enemy, Tower, Projectile
        ├── three-engine/  # 3D Engine
        └── ...
```

## Wichtig

- **Kein `npm start` ohne Befehl**
- **Keine Commits ohne Befehl**
- **API Keys nie committen** (environment.ts ist in .gitignore)

## Tech Stack

| Teil | Technologie |
|------|-------------|
| Framework | Angular 21 |
| 3D Engine | Three.js 0.182 |
| 3D Tiles | 3DTilesRendererJS 0.4.19 |
| UI | Angular Material 21 |
| Maps | Google Maps 3D Tiles API |
| Geocoding | OpenStreetMap Nominatim |
