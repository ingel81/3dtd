# Expert Review Report - Januar 2026

> Umfassende Codebase-Analyse durch 7 spezialisierte KI-Agenten

## Executive Summary

Das Projekt zeigt eine **solide Grundarchitektur** mit guter Trennung von Concerns. Die Hauptprobleme liegen bei:
- **Hardcoded Values** - Game Balance Werte verstreut im Code
- **Code-Duplikation** - Besonders Geo-Berechnungen
- **Performance-Hotspots** - Object Allocations in Update-Loops
- **Veraltete Dokumentation** - Inkonsistenzen zwischen Docs und Code

**Gesamtbewertung: 6.5/10** - Funktional und gut strukturiert, aber mit technischen Schulden.

---

## Beteiligte Experten

| Expert | Fokusbereich | Haupterkenntnisse |
|--------|--------------|-------------------|
| Game Engine Architekt | ECS, Manager, Lifecycle | Solide Basis, aber GameStateManager ist God-Object (~800 Zeilen) |
| Three.js Experte | Rendering, WebGL | Gute Patterns, aber Memory-Leak-Risiken bei Model-Cleanup |
| Code Quality Engineer | Konsistenz, SOLID, DRY | TowerDefenseComponent zu gross (~2280 Zeilen) |
| Config & Data-Driven | Hardcoded Values | 5.4/10 - Viele Werte direkt im Code |
| Asset Management | Loading, Caching | 5.4/10 - Fragmentiertes Caching (3 separate Loader) |
| Performance Guru | Hot Paths, Memory | Kritische Allocations in Render-Loops |
| Dokumentations-Experte | Docs vs Code | Veraltet, Redundanzen, fehlende Docs |

---

## 1. Architektur-Analyse

### 1.1 Staerken

- **Klare Manager-Hierarchie**: EnemyManager, TowerManager, ProjectileManager mit einheitlicher EntityManager-Basis
- **Config-System vorhanden**: tower-types.config.ts und projectile-types.config.ts sind gut strukturiert
- **Component-Based Design**: TransformComponent, HealthComponent, MovementComponent etc.
- **Angular Signals**: Moderne reaktive State-Verwaltung
- **Zone.js Optimierung**: Game Loop laeuft ausserhalb Angular Zone

### 1.2 Schwachstellen

| Problem | Betroffene Dateien | Prioritaet |
|---------|-------------------|------------|
| **GameStateManager ist God-Object** (~800 Zeilen) | `game-state.manager.ts` | HOCH |
| **TowerDefenseComponent zu gross** (~2280 Zeilen) | `tower-defense.component.ts` | HOCH |
| **EntityPoolService ist Placeholder** (kein echtes Pooling) | `entity-pool.service.ts` | MITTEL |
| **Kein zentrales Event-System** | Ueberall Callbacks | MITTEL |

### 1.3 Empfehlung: GameStateManager aufteilen

```
game-state.manager.ts (Orchestrierung nur ~200 Zeilen)
  -> combat.manager.ts (Damage Resolution, Status Effects)
  -> effects.manager.ts (VFX, SFX Triggers)
  -> fire-intensity.manager.ts (Base Fire Visual)
```

---

## 2. Code-Duplikation

### 2.1 Haversine-Distanzberechnung (5x dupliziert!)

Identischer Code in:
- `enemy.manager.ts:299-314`
- `tower.manager.ts:180-193`
- `game-state.manager.ts:469-484`
- `projectile.entity.ts:337-349`
- `movement.component.ts:297-309`

**Loesung**: Zentrale `GeoUtilsService` erstellen:

```typescript
@Injectable({ providedIn: 'root' })
export class GeoUtilsService {
  /** Haversine distance in meters */
  haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371000;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  /** Fast flat-earth approximation (accurate < 200m) */
  fastDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const METERS_PER_DEGREE_LAT = 111320;
    const dLat = lat2 - lat1;
    const dLon = lon2 - lon1;
    const metersPerDegreeLon = METERS_PER_DEGREE_LAT * Math.cos(lat1 * 0.0174533);
    const dx = dLon * metersPerDegreeLon;
    const dy = dLat * METERS_PER_DEGREE_LAT;
    return Math.sqrt(dx * dx + dy * dy);
  }
}
```

### 2.2 Placement-Constraints (2x dupliziert)

Identische Werte in:
- `tower.manager.ts:23-27`
- `tower-placement.service.ts:38-42`

```typescript
// Beide Dateien haben:
MIN_DISTANCE_TO_STREET = 10;
MAX_DISTANCE_TO_STREET = 50;
MIN_DISTANCE_TO_BASE = 30;
MIN_DISTANCE_TO_SPAWN = 30;
MIN_DISTANCE_TO_OTHER_TOWER = 8;
```

**Loesung**: `placement.config.ts` erstellen und an beiden Stellen importieren.

---

## 3. Hardcoded Values

### 3.1 Game Balance (KRITISCH)

| Datei:Zeile | Wert | Beschreibung |
|-------------|------|--------------|
| `game-state.manager.ts:39` | `100` | Start baseHealth |
| `game-state.manager.ts:40` | `70` | Start credits |
| `game-state.manager.ts:140` | `50` | Wave completion bonus |
| `game-state.manager.ts:233` | `10` | Enemy damage to base |
| `game-state.manager.ts:315-316` | `0.5, 3000` | Ice slow effect (50%, 3000ms) |
| `game-state.manager.ts:523-526` | `20, 40, 60` | Fire intensity thresholds |

### 3.2 Audio (MITTEL)

| Datei:Zeile | Beschreibung |
|-------------|--------------|
| `projectile.manager.ts:10-41` | PROJECTILE_SOUNDS komplett hardcoded |
| `spatial-audio.manager.ts:53` | MAX_ENEMY_SOUNDS = 12 |

### 3.3 Timing (MITTEL)

| Datei:Zeile | Wert | Beschreibung |
|-------------|------|--------------|
| `enemy.manager.ts:148` | `2000` | Death animation duration |
| `wave.manager.ts:81-82` | `300, 500` | Spawn delays |
| `tower.entity.ts:37` | `300` | LOS_RECHECK_INTERVAL |

### 3.4 Vorgeschlagene Config-Struktur

```
src/app/configs/
├── index.ts
├── tower-types.config.ts      # Existiert
├── projectile-types.config.ts # Existiert (+ Sounds hinzufuegen)
├── game-balance.config.ts     # NEU
├── placement.config.ts        # NEU
├── audio.config.ts            # NEU
├── visual-effects.config.ts   # NEU
└── timing.config.ts           # NEU
```

### 3.5 Beispiel: game-balance.config.ts

```typescript
export const GAME_BALANCE = {
  player: {
    startHealth: 100,
    startCredits: 70,
  },
  waves: {
    completionBonus: 50,
    gatheringDelay: 500,
    defaultSpawnDelay: 300,
  },
  combat: {
    enemyBaseDamage: 10,
    deathAnimationDuration: 2000,
  },
  effects: {
    iceSlow: { amount: 0.5, duration: 3000 },
  },
  fireIntensity: {
    tiny: 60,
    small: 60,
    medium: 40,
    large: 20,
  },
} as const;
```

---

## 4. Performance-Analyse

### 4.1 Kritische Hotspots

| Hotspot | Datei:Zeile | Problem | Impact |
|---------|-------------|---------|--------|
| Object Allocation | `three-projectile.renderer.ts:71-94` | `new Vector3()` pro Frame | HOCH |
| Object Allocation | `three-effects.renderer.ts:1372` | `velocity.clone()` pro Partikel | HOCH |
| Array Creation | `enemy.manager.ts:267-269` | `getAlive()` erstellt Array jeden Frame | MITTEL |
| Haversine in Loop | `enemy.manager.ts:299-314` | Math.sin/cos in jedem Frame | HOCH |
| O(n) Range-Check | `enemy.manager.ts:284-294` | `getEnemiesInRadius` ohne Spatial Index | HOCH |

### 4.2 Loesung: Reusable Vectors

```typescript
// VORHER (schlecht):
update(id: string, position: THREE.Vector3): void {
  const oldPos = new THREE.Vector3();      // ALLOCATION jeden Frame!
  const oldRot = new THREE.Quaternion();   // ALLOCATION jeden Frame!
  const oldScale = new THREE.Vector3();    // ALLOCATION jeden Frame!
  this.matrix.decompose(oldPos, oldRot, oldScale);
}

// NACHHER (gut):
private static readonly _tempPos = new THREE.Vector3();
private static readonly _tempRot = new THREE.Quaternion();
private static readonly _tempScale = new THREE.Vector3();

update(id: string, position: THREE.Vector3): void {
  this.matrix.decompose(
    ProjectileInstanceManager._tempPos,
    ProjectileInstanceManager._tempRot,
    ProjectileInstanceManager._tempScale
  );
}
```

### 4.3 Loesung: Spatial Partitioning

Aktuell: O(n) fuer jeden Range-Check
Mit Grid: O(1) fuer lokale Queries

```typescript
class SpatialGrid {
  private cellSize = 50; // 50m Zellen
  private cells = new Map<string, Set<Enemy>>();

  getInRadius(centerLat: number, centerLon: number, radius: number): Enemy[] {
    // Nur relevante Zellen pruefen statt alle Enemies
  }
}
```

### 4.4 Positive Performance-Patterns (bereits vorhanden)

- Projektile nutzen `InstancedMesh` - sehr gut!
- Frustum Culling fuer Enemy-Animationen
- UI-Updates sind throttled (100ms Intervall)
- Game Loop laeuft ausserhalb Angular Zone
- Sound Budget System (max 12 Enemy-Sounds)

---

## 5. Three.js & Rendering

### 5.1 Anti-Patterns gefunden

| Problem | Datei:Zeile | Loesung |
|---------|-------------|---------|
| Raycaster wird pro Call neu erstellt | `three-tiles-engine.ts:882` | Root Cause fixen, Instanz wiederverwenden |
| Selection Ring Geometry nicht geteilt | `three-tower.renderer.ts:389` | Shared Geometry erstellen |
| Model Templates nicht disposed | `three-tower.renderer.ts:1479` | Geometry/Material disposal hinzufuegen |

### 5.2 Memory Leak Risiken

1. **Animation Mixer**: Cleanup ist gut, aber Mixer wird nicht auf null gesetzt
2. **Model Template Cache**: Wird gecleared, aber Inhalte nicht disposed
3. **Health Bar Textures**: Korrekt disposed, aber bei Enemy-Type-Wechsel nicht

### 5.3 Fehlende Optimierungen

- **Kein LOD-System** fuer Entities
- **Kein Texture Atlas** fuer aehnliche Modelle
- **Tiles werden jeden Frame geupdated** auch wenn Kamera statisch

---

## 6. Asset Management

### 6.1 Bewertung: 5.4/10

| Kategorie | Score | Problem |
|-----------|-------|---------|
| Organisation | 7/10 | Gute Struktur, aber Duplikate |
| Model Loading | 6/10 | 3 separate Caches (Tower, Enemy, Preview) |
| Texture Management | 4/10 | Keine Atlases, keine Kompression |
| Audio Management | 7/10 | Guter Cache, aber viele kleine Dateien |
| LOD System | 1/10 | Nicht vorhanden |

### 6.2 Empfehlung: Globaler Asset Manager

```typescript
@Injectable({ providedIn: 'root' })
export class AssetManagerService {
  private gltfLoader = new GLTFLoader();
  private modelCache = new Map<string, GLTF>();
  private audioCache = new Map<string, AudioBuffer>();

  readonly loadingProgress = signal(0);

  async preloadAll(): Promise<void> {
    // Zentrales Loading mit Progress
  }
}
```

---

## 7. Dokumentation

### 7.1 Inkonsistenzen (Docs vs Code)

| Problem | Datei | Korrektur |
|---------|-------|-----------|
| "17 Services" dokumentiert, 19 existieren | CLAUDE.md:38 | Aktualisieren |
| "8 Manager" dokumentiert, 7 existieren | CLAUDE.md:36 | Aktualisieren |
| Dateistruktur falsch (`game/` Subfolder) | ARCHITECTURE.md:728-813 | Korrigieren |
| Model-Pfade veraltet | src/app/README.md | Komplett ueberarbeiten |
| 3 Docs fehlen in Tabelle | CLAUDE.md:54-65 | Ergaenzen |

### 7.2 Fehlende Dokumentation

- `ENEMY_CREATION.md` - Analog zu TOWER_CREATION.md
- Status-Effekt-System (models/status-effects.ts)
- Wave-System und WaveManager

### 7.3 Redundanzen

Die Projektstruktur wird 4x beschrieben (CLAUDE.md, ARCHITECTURE.md, src/app/README.md, INDEX.md) - alle unterschiedlich!

**Empfehlung**: ARCHITECTURE.md als Single Source of Truth definieren.

---

## 8. Koordinaten-Typen Inkonsistenz

Drei verschiedene Formate im Code:

```typescript
// Format 1: GeoPosition (models/game.types.ts)
interface GeoPosition { lat: number; lon: number; height?: number; }

// Format 2: latitude/longitude (location-management.service.ts)
interface { latitude: number; longitude: number; }

// Format 3: Inline Objects
{ lat: number, lon: number }
```

**Empfehlung**: `GeoPosition` durchgaengig verwenden, Adapter fuer externe APIs.

---

## 9. Sprach-Inkonsistenz

Deutsche und englische Strings gemischt:

| Stelle | Sprache |
|--------|---------|
| `TOWER_TYPES.archer.upgrades[0].name: 'Schnellfeuer'` | Deutsch |
| `ENEMY_TYPES.bat.name: 'Fledermaus'` | Deutsch |
| `location-management.service.ts: 'Unbekannt'` | Deutsch |
| Code-Kommentare | Gemischt |

**Empfehlung**: Konsistent waehlen oder i18n-System vorbereiten.

---

## 10. Priorisierter Massnahmenkatalog

### Prioritaet 1: Quick Wins (4-5h Aufwand)

| # | Massnahme | Aufwand |
|---|-----------|---------|
| 1 | GeoUtilsService erstellen (5x Duplikation entfernen) | 1h |
| 2 | Reusable Vectors in ProjectileRenderer | 30min |
| 3 | game-balance.config.ts erstellen | 2h |
| 4 | Placement-Constraints deduplizieren | 30min |
| 5 | PROJECTILE_SOUNDS in Config verschieben | 30min |

### Prioritaet 2: Mittelfristig (3-4 Tage)

| # | Massnahme | Aufwand |
|---|-----------|---------|
| 6 | GameStateManager aufteilen | 1-2 Tage |
| 7 | Entity Object Pooling implementieren | 3-4h |
| 8 | Spatial Partitioning (Grid) | 2-3h |
| 9 | Globaler Asset Manager | 4h |
| 10 | Dokumentation aktualisieren | 2h |

### Prioritaet 3: Langfristig (1-2 Wochen)

| # | Massnahme | Aufwand |
|---|-----------|---------|
| 11 | TowerDefenseComponent aufteilen | 2-3 Tage |
| 12 | Event-System einfuehren | 2-3 Tage |
| 13 | LOD-System fuer Entities | 1 Tag |
| 14 | i18n-System | 4h+ |

---

## Fazit

Das Projekt hat eine **gute Basis-Architektur** mit modernen Angular-Patterns. Die technischen Schulden sind ueberschaubar und koennen schrittweise abgebaut werden.

**Kritischste Punkte:**
1. Hardcoded Game Balance Werte erschweren Balancing
2. Code-Duplikation bei Geo-Berechnungen
3. Performance-Probleme bei vielen Entities (fehlende Spatial Partitioning)
4. Veraltete Dokumentation

**Quick Wins mit hohem ROI:**
- GeoUtilsService erstellen (1h Aufwand, 5 Dateien bereinigt)
- game-balance.config.ts (2h Aufwand, Balancing wird einfacher)
- Reusable Vectors (30min Aufwand, deutlich weniger GC)

---

*Report erstellt: Januar 2026*
*Analysiert mit: 7 spezialisierten KI-Agenten*
