# Tower Creation Guide

**Stand:** 2026-01-12

Anleitung zum Erstellen neuer Tower-Typen mit optionalen rotierenden Teilen.

---

## Übersicht

Tower werden über die Konfigurationsdatei `configs/tower-types.config.ts` definiert. Das System unterstützt:

- Verschiedene 3D-Modelle (GLB, FBX)
- Rotierende Turret-Teile (z.B. Geschütztürme)
- Eigene Projektiltypen
- Upgrade-System
- Separate Preview-Skalierung für die UI

---

## Schritt-für-Schritt: Neuen Tower hinzufügen

### 1. TowerTypeId erweitern

```typescript
// configs/tower-types.config.ts
export type TowerTypeId = 'archer' | 'cannon' | 'magic' | 'sniper' | 'dual-gatling' | 'NEW_TYPE';
```

### 2. Model-URL definieren

```typescript
const NEW_MODEL_URL = '/assets/models/towers/new_tower.glb';
```

### 3. Tower-Konfiguration hinzufügen

```typescript
'new-tower': {
  id: 'new-tower',
  name: 'New Tower',
  modelUrl: NEW_MODEL_URL,
  scale: 2.0,              // Skalierung in der Welt
  previewScale: 3.0,       // Optional: Separate Skalierung für UI-Preview
  heightOffset: 0,         // Vertikaler Offset über dem Terrain
  shootHeight: 5,          // Höhe des Schussursprungs (für LOS)
  rotationY: 0,            // Initiale Y-Rotation in Radians
  damage: 50,
  range: 60,
  fireRate: 1.0,           // Schüsse pro Sekunde
  projectileType: 'arrow', // Projektiltyp-ID
  cost: 100,
  sellValue: 60,
  upgrades: [],
},
```

### 4. Projektiltyp hinzufügen (falls neu)

```typescript
// configs/projectile-types.config.ts
export type ProjectileTypeId = '...' | 'new-projectile';
export type ProjectileVisualType = '...' | 'new-visual';

// In PROJECTILE_TYPES:
'new-projectile': {
  id: 'new-projectile',
  speed: 100,
  visualType: 'new-visual',
  scale: 0.3,
},
```

### 5. Projektil-Renderer implementieren (falls neuer Visual Type)

In `three-engine/renderers/three-projectile.renderer.ts`:

```typescript
// Manager hinzufügen
private newProjectileManager: ProjectileInstanceManager;

// In constructor oder initialize:
this.newProjectileManager = this.createNewProjectileManager();

// Manager-Methode:
private createNewProjectileManager(): ProjectileInstanceManager {
  const geometry = new THREE.CylinderGeometry(0.1, 0.1, 1, 8);
  const material = new THREE.MeshBasicMaterial({ color: 0xffff00 });
  // ... siehe bullet-Implementierung als Beispiel
}

// In getManager():
case 'new-visual':
  return this.newProjectileManager;
```

---

## Rotierende Tower-Teile (Turrets)

### Voraussetzungen

Das 3D-Modell muss ein benanntes Mesh enthalten:
- **Name:** `turret_top`
- Dieses Teil rotiert automatisch in Richtung der Feinde

### Wie es funktioniert

1. **Model-Struktur:** Das Modell besteht aus statischer Basis und rotierendem Teil
2. **Mesh-Erkennung:** Der Renderer findet `turret_top` automatisch beim Laden
3. **Rotation:** `updateRotation()` dreht nur den Turret-Teil

### Koordinatensystem-Konvertierung

Die Turret-Rotation muss zwischen Geo-Koordinaten und Three.js konvertieren:

```
Geo-Koordinaten:
- atan2(dLon, dLat): 0=Nord, π/2=Ost

Three.js:
- rotation.y = 0: Blickrichtung -Z (Nord)
- rotation.y = -π/2: Blickrichtung +X (Ost)

Konvertierung: threeJsRotation = -geoHeading
```

### Model-Offset (rotationY)

Wenn das Turret-Modell nicht in -Z-Richtung zeigt (Three.js Standard), muss `rotationY` gesetzt werden:

```typescript
// Beispiel: Turret-Barrels zeigen in Model-Space auf +X
rotationY: -Math.PI / 2,  // -90° um korrekt auszurichten
```

Der Renderer verwendet diesen Wert automatisch für die Zielberechnung:

```typescript
const turretModelOffset = -(data.typeConfig.rotationY ?? 0);
const threeJsTargetRotation = -heading + turretModelOffset;
const localRotation = threeJsTargetRotation - parentRotation;
```

### Reset bei Idle

Tower ohne Ziel drehen automatisch zur Basisposition zurück:

```typescript
// game-state.manager.ts
if (target) {
  this.tilesEngine?.towers.updateRotation(tower.id, heading);
  // ... fire
} else {
  this.tilesEngine?.towers.resetRotation(tower.id);
}
```

---

## Sound-Integration

### Projektil-Sounds registrieren

In `managers/projectile.manager.ts`:

```typescript
const PROJECTILE_SOUNDS = {
  arrow: {
    url: '/assets/sounds/arrow_01.mp3',
    refDistance: 50,
    rolloffFactor: 1,
    volume: 0.5,
  },
  bullet: {
    url: '/assets/sounds/gatling_0.mp3',
    refDistance: 40,
    rolloffFactor: 1.2,
    volume: 0.25,  // Niedriger bei hoher Feuerrate
  },
} as const;
```

Sounds werden automatisch bei `playProjectileSound()` abgespielt, wenn der Projektiltyp in `PROJECTILE_SOUNDS` existiert.

---

## UI-Integration

### Preview-Skalierung

Tower in der Sidebar können eine separate Skalierung haben:

```typescript
previewScale: 4.0,  // Größer in der UI-Preview
scale: 2.5,         // Normal in der Welt
```

Falls `previewScale` nicht gesetzt ist, wird `scale * 0.4` verwendet.

### Reihenfolge im Baumenü

Die Reihenfolge entspricht der Reihenfolge der Keys in `TOWER_TYPES`:

```typescript
export const TOWER_TYPES = {
  archer: { ... },       // 1. Position
  'dual-gatling': { ... }, // 2. Position
  cannon: { ... },       // 3. Position
  // ...
};
```

---

## Tower Upgrade System

Towers können Upgrades haben, die ihre Stats verbessern (Feuerrate, Schaden, Reichweite).

### Upgrade-Konfiguration

```typescript
// In TowerTypeConfig
upgrades: [
  {
    id: 'speed',                  // Eindeutige ID (verwendet für UI)
    name: 'Schnellfeuer',         // Display-Name
    description: 'Verdoppelt die Feuerrate',  // Beschreibung für Tooltip
    cost: 25,                     // Upgrade-Kosten in Credits
    maxLevel: 1,                  // Max. Stufe (1 = einmalig, 3 = 3x upgradebar)
    effect: {
      stat: 'fireRate',           // Welcher Stat wird verbessert
      multiplier: 2.0,            // Multiplikator (2.0 = verdoppelt)
    },
  },
  {
    id: 'damage',
    name: 'Verstärkte Munition',
    description: '+50% Schaden',
    cost: 30,
    maxLevel: 3,                  // 3 Stufen möglich
    effect: {
      stat: 'damage',
      multiplier: 1.5,            // +50% pro Stufe
    },
  },
],
```

### Verfügbare Stats

```typescript
stat: 'fireRate' | 'damage' | 'range'
```

| Stat | Beschreibung | Multiplier-Beispiel |
|------|--------------|---------------------|
| `fireRate` | Schüsse pro Sekunde | 2.0 = doppelt so schnell |
| `damage` | Schaden pro Schuss | 1.5 = +50% Schaden |
| `range` | Reichweite in Metern | 1.3 = +30% Reichweite |

### Multi-Level Upgrades

Upgrades mit `maxLevel > 1` können mehrfach gekauft werden:

```typescript
{
  id: 'damage',
  maxLevel: 3,
  cost: 30,
  effect: { stat: 'damage', multiplier: 1.5 },
}
```

**Effekt:**
- Level 1: Schaden × 1.5 (Kosten: 30)
- Level 2: Schaden × 1.5 × 1.5 = 2.25 (Kosten: 30)
- Level 3: Schaden × 1.5³ = 3.375 (Kosten: 30)

**Hinweis:** Multiplier werden multipliziert, nicht addiert!

### Upgrade anwenden (UI)

**Aktuell:** Upgrade-System ist im Code vorbereitet, aber **UI fehlt noch**.

**Geplant:**
- Tower Selection Panel zeigt verfügbare Upgrades
- Button "Upgrade kaufen" (wenn genug Credits)
- Visuelles Feedback (Tower-Level-Anzeige)

**TODO:** Siehe [TODO.md - Range-Upgrade System](TODO.md)

### Upgrade anwenden (Code)

```typescript
// In TowerManager oder GameStateManager
applyUpgrade(tower: Tower, upgradeId: UpgradeId): boolean {
  const upgrade = tower.typeConfig.upgrades.find(u => u.id === upgradeId);
  if (!upgrade) return false;

  // Check Credits
  if (this.credits() < upgrade.cost) return false;

  // Check Max Level
  const currentLevel = tower.upgradeLevel[upgradeId] ?? 0;
  if (currentLevel >= upgrade.maxLevel) return false;

  // Apply Upgrade
  tower.upgradeLevel[upgradeId] = currentLevel + 1;
  this.credits.update(c => c - upgrade.cost);

  // Update Stats
  switch (upgrade.effect.stat) {
    case 'fireRate':
      tower.combat.fireRate *= upgrade.effect.multiplier;
      break;
    case 'damage':
      tower.combat.damage *= upgrade.effect.multiplier;
      break;
    case 'range':
      tower.combat.range *= upgrade.effect.multiplier;
      // TODO: LOS-Grid neu berechnen bei Range-Upgrade
      break;
  }

  return true;
}
```

### Range-Upgrade Spezialfall

**Problem:** Range-Upgrades erfordern **LOS-Grid Neuberechnung**.

**Warum:**
- LOS-Grid speichert Sichtbarkeits-Zellen basierend auf aktueller Range
- Bei Range-Upgrade müssen neue Zellen berechnet werden

**Lösung (geplant):**
```typescript
case 'range':
  const oldRange = tower.combat.range;
  tower.combat.range *= upgrade.effect.multiplier;

  // LOS-Grid für diesen Tower neu berechnen
  this.towerPlacementService.recalculateLosGrid(tower.id, tower.combat.range);
  break;
```

**Siehe:** [TODO.md - Range-Upgrade System implementieren](TODO.md)

### Beispiele

#### Archer Tower (Single Upgrade)

```typescript
upgrades: [
  {
    id: 'speed',
    name: 'Schnellfeuer',
    description: 'Verdoppelt die Feuerrate',
    cost: 25,
    maxLevel: 1,
    effect: { stat: 'fireRate', multiplier: 2.0 },
  },
],
```

- **Effekt:** Archer schießt 2× pro Sekunde statt 1×
- **Kosten:** 25 Credits (einmalig)

#### Magic Tower (Multi-Level)

```typescript
upgrades: [
  {
    id: 'damage',
    name: 'Arkane Macht',
    description: 'Erhöht magischen Schaden',
    cost: 50,
    maxLevel: 3,
    effect: { stat: 'damage', multiplier: 1.5 },
  },
],
```

- **Level 1:** 40 → 60 Schaden (+50%)
- **Level 2:** 60 → 90 Schaden (+50%)
- **Level 3:** 90 → 135 Schaden (+50%)
- **Total:** 40 → 135 Schaden (+237.5%)
- **Kosten:** 150 Credits (3× 50)

---

## Checkliste: Neuer Tower

- [ ] TowerTypeId erweitert
- [ ] Model in `/public/assets/models/towers/` abgelegt
- [ ] Tower-Config in `TOWER_TYPES` hinzugefügt
- [ ] Projektiltyp vorhanden (oder neuen erstellt)
- [ ] Sound-Datei in `/public/assets/sounds/` (optional)
- [ ] Sound in `PROJECTILE_SOUNDS` registriert (optional)
- [ ] Bei rotierendem Turret: `turret_top` Mesh im Model benannt
- [ ] Bei rotierendem Turret: `rotationY` für Model-Offset gesetzt
- [ ] Reihenfolge in `TOWER_TYPES` nach Wunsch angepasst

---

## Beispiel: Dual-Gatling Tower

Vollständiges Beispiel eines Towers mit rotierendem Turret:

```typescript
'dual-gatling': {
  id: 'dual-gatling',
  name: 'Dual-Gatling Tower',
  modelUrl: '/assets/models/towers/turret_test.glb',
  scale: 2.5,
  previewScale: 4.0,
  heightOffset: 2.5,
  shootHeight: 2.5,
  rotationY: -Math.PI / 2,  // Model-Barrels zeigen auf +X
  damage: 10,
  range: 50,
  fireRate: 5.0,            // Schnellfeuer
  projectileType: 'bullet',
  cost: 100,
  sellValue: 60,
  upgrades: [
    {
      id: 'range',
      name: 'Erweiterter Radius',
      description: 'Erhöht die Reichweite um 50%',
      cost: 50,
      maxLevel: 1,
      effect: { stat: 'range', multiplier: 1.5 },
    },
  ],
},
```

Model-Anforderungen:
- Mesh `turret_base`: Statische Basis
- Mesh `turret_top`: Rotierender Turret (wird automatisch erkannt)

---

## Tower-Placement-System

Das Platzieren von Türmen wird durch den `TowerPlacementService` gesteuert.

### Features

- **3D-Model-Preview:** Zeigt das echte Tower-Model als Vorschau
- **Grün/Rot-Färbung:** Je nach Gültigkeit der Position
- **R-Taste Rotation:** Kontinuierliche Drehung bei gehaltenem R
- **Line-of-Sight Preview:** Zeigt Sichtfeld nach 300ms Stillstand
- **3D-Distanz-Berechnung:** Berücksichtigt Höhenunterschied zur Straße

### Platzierungsregeln

| Regel | Wert | Beschreibung |
|-------|------|--------------|
| `MIN_DISTANCE_TO_STREET` | 10m | Mindestabstand zur Straße (3D!) |
| `MAX_DISTANCE_TO_STREET` | 50m | Maximaler Abstand zur Straße |
| `MIN_DISTANCE_TO_BASE` | 30m | Mindestabstand zur Basis |
| `MIN_DISTANCE_TO_SPAWN` | 30m | Mindestabstand zu Spawns |
| `MIN_DISTANCE_TO_OTHER_TOWER` | 8m | Mindestabstand zu anderen Türmen |

### 3D-Distanz zur Straße

Die Distanz zur Straße wird in 3D berechnet, nicht nur horizontal:

```
3D-Distanz = sqrt(horizontalDist² + höhenDiff²)
```

**Beispiel:** Ein Tower auf einem 8m hohen Dach direkt neben der Straße:
- Horizontal: 5m (normalerweise zu nah!)
- Höhendifferenz: 8m
- 3D-Distanz: sqrt(25 + 64) ≈ 9.4m → **Immer noch zu nah**

Aber bei 6m horizontal und 8m hoch:
- 3D-Distanz: sqrt(36 + 64) = 10m → **Erlaubt!**

### Keyboard-Shortcuts im Build-Modus

| Taste | Aktion |
|-------|--------|
| R (gehalten) | Tower kontinuierlich drehen (180°/s) |
| ESC | Build-Modus abbrechen |
| Klick | Tower platzieren (wenn grün) |

### Context-Hint-Box

Im Build-Modus erscheint eine Hinweis-Box am unteren Bildschirmrand:
- Zeigt verfügbare Aktionen (R, Klick, ESC, Warten)
- Zeigt Fehlermeldung bei ungültiger Position
- WC3-Style Design mit Gold-Akzenten

Die `ContextHintComponent` ist wiederverwendbar:

```typescript
<app-context-hint
  [hints]="[{key: 'R', description: 'Drehen'}]"
  [warning]="'Zu nah an Straße'"
/>
```
