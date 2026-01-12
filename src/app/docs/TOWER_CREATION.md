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
