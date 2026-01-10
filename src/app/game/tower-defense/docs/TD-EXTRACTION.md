# Tower Defense Extraction Plan

**Ziel:** Tower Defense aus nervbox-player extrahieren in eigenständiges Angular-Projekt
**Quelle:** `/home/joerg/projects/nervbox/nervbox/nervbox-player`
**Ziel:** `/home/joerg/projects/3dtd`
**Projektname:** 3DTD
**Stand:** 2026-01-10

---

## Übersicht

| Aspekt | Details |
|--------|---------|
| **Quelldateien** | 64 Dateien (54 TypeScript, 8 Docs, 2 andere) |
| **Assets** | 12 Dateien (~55MB) - Models, Sounds, Texturen |
| **Angular Version** | Neueste (21.x oder höher) |
| **Backend** | Keins - komplett standalone |
| **Externe APIs** | Google Maps 3D Tiles, OpenStreetMap Nominatim |

---

## Phase 1: Git & Projekt-Setup

### 1.1 Git konfigurieren

```bash
cd /home/joerg/projects/3dtd
git config user.name "ingel81"
git config user.email "ingel81@sgeht.net"
```

### 1.2 Angular-Projekt erstellen

```bash
cd /home/joerg/projects/3dtd

# Neuestes Angular installieren (global, falls nötig)
npm install -g @angular/cli@latest

# Projekt erstellen
ng new 3DTD --directory=. \
  --style=scss \
  --routing=true \
  --ssr=false \
  --skip-git=true \
  --standalone=true
```

---

## Phase 2: Dependencies

### 2.1 NPM Pakete installieren

```bash
# Angular Material
ng add @angular/material

# Three.js + 3D Tiles
npm install three@0.182.0 @types/three@0.182.0
npm install 3d-tiles-renderer@0.4.19
```

### 2.2 package.json Dependencies (Ziel)

```json
{
  "dependencies": {
    "@angular/animations": "^21.0.0",
    "@angular/cdk": "^21.0.0",
    "@angular/common": "^21.0.0",
    "@angular/core": "^21.0.0",
    "@angular/forms": "^21.0.0",
    "@angular/material": "^21.0.0",
    "@angular/platform-browser": "^21.0.0",
    "@angular/router": "^21.0.0",
    "3d-tiles-renderer": "^0.4.19",
    "three": "^0.182.0",
    "@types/three": "^0.182.0",
    "rxjs": "~7.8.0"
  }
}
```

---

## Phase 3: Projekt-Struktur

```
3dtd/
├── src/
│   ├── app/
│   │   ├── app.ts                    # Root Component
│   │   ├── app.config.ts             # Provider Config
│   │   ├── app.routes.ts             # Routing
│   │   │
│   │   ├── core/
│   │   │   └── services/
│   │   │       └── config.service.ts # Standalone (kein Backend)
│   │   │
│   │   └── game/
│   │       └── tower-defense/        # <-- TD Code hierhin
│   │
│   ├── environments/
│   │   ├── environment.ts            # Google Maps API Key
│   │   └── environment.prod.ts
│   │
│   └── styles.scss
│
├── public/
│   └── assets/
│       └── games/
│           └── tower-defense/        # <-- Assets hierhin
│
├── CLAUDE.md                         # Projekt-Regeln
└── README.md
```

---

## Phase 4: Code-Migration

### 4.1 TD-Code kopieren

```bash
# TD-Ordner kopieren
cp -r /home/joerg/projects/nervbox/nervbox/nervbox-player/src/app/components/mini-games/games/tower-defense/* \
      /home/joerg/projects/3dtd/src/app/game/tower-defense/
```

### 4.2 Assets kopieren

```bash
# Assets kopieren
cp -r /home/joerg/projects/nervbox/nervbox/nervbox-player/public/assets/games/tower-defense/* \
      /home/joerg/projects/3dtd/public/assets/games/tower-defense/
```

### 4.3 Theme kopieren

```bash
cp /home/joerg/projects/nervbox/nervbox/nervbox-player/src/custom-theme.scss \
   /home/joerg/projects/3dtd/src/custom-theme.scss
```

---

## Phase 5: Service-Anpassungen

### 5.1 Standalone ConfigService erstellen

**Datei:** `src/app/core/services/config.service.ts`

```typescript
import { Injectable, signal } from '@angular/core';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class ConfigService {
  readonly googleMapsApiKey = signal(environment.googleMapsApiKey);
  readonly loaded = signal(true);
}
```

### 5.2 ApiService entfernen

In `tower-defense.component.ts`:
- **Zeile 26 löschen:** `import { ApiService } from '...';`
- **Zeile ~1634 löschen:** `private readonly api = inject(ApiService);`

### 5.3 Import-Pfade anpassen

In `tower-defense.component.ts`:
```typescript
// ALT:
import { ConfigService } from '../../../../core/services/config.service';

// NEU:
import { ConfigService } from '../../../core/services/config.service';
```

---

## Phase 6: Environment

### 6.1 environment.ts

```typescript
export const environment = {
  production: false,
  googleMapsApiKey: 'AIza...',  // Von nervbox übernehmen
};
```

### 6.2 API Key aus nervbox holen

```bash
grep -r "googleMapsApiKey" /home/joerg/projects/nervbox/nervbox/nervbox-player/src/environments/
```

---

## Phase 7: App-Konfiguration

### 7.1 app.config.ts

```typescript
import { ApplicationConfig, provideZoneChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideHttpClient } from '@angular/common/http';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    provideAnimationsAsync(),
    provideHttpClient(),
  ],
};
```

### 7.2 app.routes.ts

```typescript
import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./game/tower-defense/tower-defense.component')
        .then(m => m.TowerDefenseComponent),
  },
];
```

### 7.3 app.ts

```typescript
import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet],
  template: '<router-outlet></router-outlet>',
  styles: [`:host { display: block; width: 100vw; height: 100vh; }`],
})
export class AppComponent {}
```

---

## Phase 8: CLAUDE.md erstellen

```markdown
# CLAUDE.md - 3DTD

## Projekt
3DTD - Standalone Tower Defense auf Google Maps 3D Tiles

## Befehle
- `npm start` - Development Server
- `npm run build` - Production Build
- `npm run lint` - Linting

## Architektur
- Angular 21+ Standalone Components
- Three.js + 3DTilesRendererJS
- Kein Backend - komplett clientseitig
- Google Maps API Key in environment.ts

## Wichtig
- Kein `npm start` ohne Befehl
- Keine Commits ohne Befehl
- API Keys nie committen
```

---

## Phase 9: Build & Test

### 9.1 Erster Build

```bash
cd /home/joerg/projects/3dtd
npm run build
```

### 9.2 Development Server

```bash
npm start
# Browser öffnet http://localhost:4200
```

### 9.3 Verifikations-Checkliste

- [ ] App lädt ohne Fehler
- [ ] 3D Tiles werden geladen
- [ ] Location-Dialog öffnet
- [ ] Geocoding funktioniert (Nominatim)
- [ ] Türme platzierbar
- [ ] Gegner spawnen
- [ ] Sounds spielen

---

## Phase 10: Cleanup nervbox

### 10.1 TD aus nervbox entfernen

```bash
# TD-Ordner löschen
rm -rf /home/joerg/projects/nervbox/nervbox/nervbox-player/src/app/components/mini-games/games/tower-defense

# Assets löschen
rm -rf /home/joerg/projects/nervbox/nervbox/nervbox-player/public/assets/games/tower-defense
```

### 10.2 Referenzen entfernen

Suchen und entfernen in nervbox-player:
- `game-selection-dialog.component.ts` - TD-Eintrag entfernen
- `app.config.ts` - TD-Route entfernen (falls vorhanden)

### 10.3 Commits

```bash
# In 3DTD
cd /home/joerg/projects/3dtd
git add -A
git commit -m "feat: initial 3DTD extraction from nervbox"
git push -u origin main

# In nervbox
cd /home/joerg/projects/nervbox/nervbox
git add -A
git commit -m "chore: remove Tower Defense (moved to 3dtd repo)"
```

---

## Zusammenfassung

| Schritt | Beschreibung |
|---------|--------------|
| 1 | Git konfigurieren |
| 2 | Angular-Projekt erstellen (neueste Version) |
| 3 | Dependencies installieren |
| 4 | TD-Code + Assets kopieren |
| 5 | ConfigService standalone machen, ApiService entfernen |
| 6 | Environment mit API Key |
| 7 | App-Konfiguration (Routes, Providers) |
| 8 | CLAUDE.md erstellen |
| 9 | Build & Test |
| 10 | Cleanup nervbox |

**Geschätzte Zeit:** 30-60 Minuten

---

## Dateien-Inventar

### Zu kopierende TD-Dateien (54 TypeScript)

| Ordner | Anzahl | Beschreibung |
|--------|--------|--------------|
| `/services` | 13 | Angular Services |
| `/managers` | 7 | Game Manager |
| `/three-engine` | 6 | 3D Engine + Renderer |
| `/game-components` | 6 | ECS Components |
| `/entities` | 3 | Enemy, Tower, Projectile |
| `/core` | 2 | GameObject, Component Base |
| `/configs` | 2 | Type Configs |
| `/models` | 3 | TypeScript Types |
| `/components` | 3 | UI Components |
| `/styles` | 1 | Theme |
| Root | 1 | tower-defense.component.ts |
| `/docs` | 9 | Dokumentation |

### Zu kopierende Assets (12 Dateien)

| Typ | Dateien |
|-----|---------|
| 3D Models (.glb) | 6 |
| Sounds (.mp3) | 1 |
| Texturen (.jpg) | 3 |
| UI Mocks | 2 |
