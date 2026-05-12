# Tower Creation Guide

**Stand:** 2026-05-12

Anleitung zum Erstellen neuer Tower-Typen mit optionalen rotierenden Teilen.

---

## Übersicht

Tower werden über die Konfigurationsdatei `configs/tower-types.config.ts` definiert. Das System unterstützt:

- Verschiedene 3D-Modelle (GLB, FBX)
- Rotierende Turret-Teile (z.B. Geschütztürme)
- Eigene Projektiltypen
- **Damage/Armor-Matrix** (`damageType` Pflichtfeld, Phase 5.x — 8 Schadenstypen: physical, pierce, siege, magic, fire, ice, poison, lightning)
- **25-Level-Upgrade-System** mit Tier-Gating (Phase 5.16, alle Combat-Tower nutzen `STD_DAMAGE/SPEED/RANGE_UPGRADE`)
- Separate Preview-Skalierung für die UI
- Air/Ground Targeting (5 Targeting-Strategien inkl. `air-priority` mit Air-Sub-Strategy)
- Animierte Tower-Modelle (GLTF-Animationen, optional PingPong-Loop)
- Projektil-Angriffe mit optionalen mehreren Fire Points (Dual-Gatling)
- Beam-Angriffe (Fire Tower, `attackType: 'beam'`)
- Melee-Angriffe (Tentacle Tower, `attackType: 'melee'`)
- **Chain-Hitscan-Angriffe** (Lightning Tower, `attackType: 'chain'` — Primary + N Jumps mit `chainFalloff` zwischen Hits, eigener `LightningBoltRenderer`)
- Passive Buildings (Research Center, `attackType: 'passive'`)

---

## Aktuelle Tower-Typen

| Tower | attackType | damageType | Schaden | Reichweite | Feuerrate | Kosten | Besonderheiten |
|-------|------------|------------|---------|------------|-----------|--------|----------------|
| Archer | projectile | physical | 25 | 60m | 1.0/s | 45 | Animiert (PingPong), Air+Ground |
| Dual-Gatling | projectile | pierce | 10 | 50m | 5.0/s | 90 | Rotierender Turret, 2 Fire-Points |
| Cannon | projectile | siege | 55 | 80m | 0.5/s | 150 | Splash, default `highest-hp` |
| Magic | projectile | magic | 40 | 70m | 1.5/s | 140 | Stark gegen ethereal |
| Rocket | projectile | siege | 40 | 100m | 0.5/s | 120 | **Nur Luft-Ziele** |
| Ice | projectile | ice | 5 | 60m | 0.33/s | 90 | Slow-Effekt, Air+Ground, Splash |
| Fire | **beam** | fire | 35 DPS | 25m (Detection) | — | 110 | Flammenkegel, nur Boden, `wide-burn` modifiziert `beamWidth` statt `range` |
| Tentacle | **melee** | physical | 30 | 25m | 1.5/s | 80 | GPU Bezier-Rendering (`meleeStrikeDuration: 250`) |
| Poison | projectile | poison | 5 | 55m | 1.0/s | 100 | DoT (poison-glob), Splash |
| Lightning | **chain** | lightning | 35 | 65m | 0.8/s | 130 | Hitscan-Kette (`maxJumps: 2`, `chainFalloff: 0.7`, `jumpRange: 15m`). Idle-Crackle am Turm-Tip + lokale Aufhell-Halos pro Hit (additive Sprites). Air+Ground. |
| Research Center | **passive** | — | 0 | 0 | 0 | 75 | Kein Combat — siehe Research-System |

---

## Schritt-für-Schritt: Neuen Tower hinzufügen

### 1. TowerTypeId erweitern

```typescript
// configs/tower-types.config.ts
export type TowerTypeId =
  | 'archer' | 'cannon' | 'magic' | 'dual-gatling' | 'rocket'
  | 'ice' | 'fire' | 'tentacle' | 'poison' | 'lightning' | 'research-center'
  | 'NEW_TYPE';
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
  scale: 2.0,                    // Skalierung in der Welt
  previewScale: 3.0,             // Optional: Separate Skalierung für UI-Preview
  heightOffset: 0,               // Vertikaler Offset über dem Terrain
  shootHeight: 5,                // Höhe des Schussursprungs (für LOS)
  rotationY: 0,                  // Initiale Y-Rotation in Radians (visuelles Alignment)
  turretBarrelOffset: 0,         // Optional: Turret-Barrel-Orientierung im Model Space (default: 0 = -Z/Nord)
  damage: 50,
  range: 60,
  fireRate: 1.0,                 // Schüsse pro Sekunde
  projectileType: 'arrow',       // Projektiltyp-ID

  cost: 100,
  // Verkaufswert wird automatisch berechnet: SELL_RATIO (0.75) × (cost + investierte Upgrades)

  // Optional: Targeting (defaults: canTargetGround=true, canTargetAir=false)
  canTargetAir: false,
  canTargetGround: true,

  // Optional: Animationen
  hasAnimations: false,          // GLTF-Animationen vorhanden
  animationPingPong: false,      // Animation vorwärts dann rückwärts (smooth loop)

  // Optional: Beam Attack (statt Projektile)
  // attackType: 'beam',
  // damagePerSecond: 35,        // DPS für Beam-Tower
  // beamRange: 20,              // Länge des Beams/Kegels in Metern
  // beamWidth: 5,               // Breite des Kegels am Ende in Metern

  upgrades: [],
},
```

### Vollständige TowerTypeConfig-Felder

| Feld | Typ | Default | Beschreibung |
|------|-----|---------|--------------|
| `id` | TowerTypeId | - | Eindeutige ID |
| `name` | string | - | Anzeigename |
| `modelUrl` | string | - | Pfad zum 3D-Modell |
| `scale` | number | - | Welt-Skalierung |
| `previewScale` | number | `scale * 0.4` | UI-Preview-Skalierung |
| `heightOffset` | number | - | Vertikaler Offset |
| `shootHeight` | number | - | Schussursprung-Höhe (LOS) |
| `rotationY` | number | 0 | Y-Rotation in Radians (visuell) |
| `turretBarrelOffset` | number | 0 | Barrel-Orientierung im Model Space |
| `damage` | number | - | Schaden pro Schuss (0 bei beam) |
| `range` | number | - | Erkennungsreichweite in Metern |
| `fireRate` | number | - | Schüsse pro Sekunde (0 bei beam) |
| `projectileType` | ProjectileTypeId | - | Projektiltyp |
| `cost` | number | - | Baukosten |
| `upgrades` | TowerUpgrade[] | - | Verfügbare Upgrades |
| `canTargetAir` | boolean | false | Kann Luft-Einheiten angreifen |
| `canTargetGround` | boolean | true | Kann Boden-Einheiten angreifen |
| `hasAnimations` | boolean | false | GLTF-Animationen vorhanden |
| `animationPingPong` | boolean | false | Animation vorwärts/rückwärts abspielen |
| `attackType` | AttackType | 'projectile' | 'projectile', 'beam', 'melee', 'chain' oder 'passive' |
| `damagePerSecond` | number | - | DPS für Beam-Tower |
| `beamRange` | number | - | Beam/Kegel-Länge in Metern |
| `beamWidth` | number | - | Kegel-Breite am Ende in Metern |
| `defaultTargeting` | TargetingStrategy | - | Standard-Targeting-Strategie |
| `firePoints` | { x, z }[] | - | Mehrere Feuer-Positionen (z.B. Dual-Gatling) |
| `meleeStrikeDuration` | number | 250 | Melee-Angriffs-Dauer in ms (z.B. Tentacle) |
| `maxJumps` | number | - | **Chain-only:** Anzahl zusaetzlicher Ziele nach Primary (Lightning: 2 → 3 Hits) |
| `chainFalloff` | number | - | **Chain-only:** Schaden-Multiplier pro Jump (Lightning: 0.7 → 100%/70%/49%) |
| `jumpRange` | number | - | **Chain-only:** Max. Distanz zwischen zwei Chain-Links in Metern |
| `damageType` | DamageType | - | Pflichtfeld: physical/pierce/siege/magic/fire/ice/poison/lightning |

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

### Model-Offset (rotationY vs turretBarrelOffset)

Zwei verschiedene Offsets:

- **`rotationY`**: Visuelle Rotation des gesamten Modells (Alignment)
- **`turretBarrelOffset`**: Barrel-Orientierung im Model Space (für Zielberechnung)

Wenn das Turret-Modell nicht in -Z-Richtung zeigt (Three.js Standard), müssen diese Werte gesetzt werden:

```typescript
// Beispiel: Dual-Gatling - Barrels zeigen auf +X
rotationY: -Math.PI / 2,         // -90° visuelles Alignment
turretBarrelOffset: -Math.PI / 2, // Barrels zeigen +X im Model Space
```

Der Renderer verwendet `turretBarrelOffset` für die Zielberechnung:

```typescript
const turretModelOffset = -(data.typeConfig.turretBarrelOffset ?? 0);
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
  archer: { ... },             // 1. Position
  'dual-gatling': { ... },     // 2. Position
  cannon: { ... },             // 3. Position
  magic: { ... },              // 4. Position
  rocket: { ... },             // 5. Position
  ice: { ... },                // 6. Position
  fire: { ... },               // 7. Position
  tentacle: { ... },           // 8. Position
  poison: { ... },             // 9. Position
  'research-center': { ... },  // 10. Position (passives Building, kein Combat)
};
```

---

## Tower Upgrade System (Phase 5.16)

Alle Combat-Tower nutzen seit Phase 5.16 ein **standardisiertes 25-Level-Upgrade-Schema**.
Tier-Gating in der UI: T1 = L1–5, T2 = L6–10, T3 = L11–15, T4 = L16–20, T5 = L21–25.

### Standard-Upgrades (`tower-types.config.ts`)

```typescript
const UPGRADE_BASE_COST = 50;
const UPGRADE_COST_SCALING = 1.40;   // L24 ≈ 4000× baseCost — späte Levels bewusst exorbitant
const UPGRADE_MAX_LEVEL = 25;

const UPGRADE_DAMAGE_MULTIPLIER = 1.10;    // +10%/Level kompoundierend (L25 ≈ 10.8×)
const UPGRADE_SPEED_MULTIPLIER = 1.07;     // +7%/Level (L25 ≈ 5.4×)
const UPGRADE_RANGE_MULTIPLIER = 1.04;     // +4%/Level (L25 ≈ 2.7×)
const UPGRADE_BEAM_WIDTH_MULTIPLIER = 1.05; // Fire only (L25 ≈ 3.4×)
```

Vorgefertigte Konstanten: `STD_DAMAGE_UPGRADE`, `STD_SPEED_UPGRADE`, `STD_RANGE_UPGRADE`, `STD_BEAM_WIDTH_UPGRADE` — werden direkt in `upgrades: [...]` referenziert. Research Center ist die einzige Ausnahme (eigenes `research-slots`-Upgrade).

### Upgrade-Konfiguration (Interface)

```typescript
// TowerUpgrade Interface
export interface TowerUpgrade {
  id: UpgradeId;             // 'speed' | 'damage' | 'range' | 'beam-width' | 'research-slots'
  name: string;
  description: string;
  cost: number;              // Basiskosten für Level 1
  costScaling?: number;      // Kostenmultiplikator pro Level (default: 1.0 = flache Kosten)
  maxLevel: number;
  effect: {
    stat: 'fireRate' | 'damage' | 'range' | 'beamWidth' | 'research-slots';
    multiplier: number;      // z.B. 2.0 = verdoppelt
  };
}
```

Beispiel:

```typescript
upgrades: [
  {
    id: 'speed',
    name: 'Rapid Fire',
    description: 'Doubles the fire rate',
    cost: 90,                     // Basiskosten
    costScaling: 2.0,             // Verdoppelt pro Level
    maxLevel: 4,
    effect: {
      stat: 'fireRate',
      multiplier: 2.0,
    },
  },
],
```

### Verfügbare Stats

```typescript
stat: 'fireRate' | 'damage' | 'range' | 'beamWidth' | 'research-slots'
```

| Stat | Beschreibung | Multiplier-Beispiel |
|------|--------------|---------------------|
| `fireRate` | Schüsse pro Sekunde | 2.0 = doppelt so schnell |
| `damage` | Schaden pro Schuss (bzw. DPS bei beam) | 1.5 = +50% Schaden |
| `range` | Reichweite in Metern | 1.3 = +30% Reichweite |
| `beamWidth` | Fire-Tower-Kegel-Breite (eigener Stat seit Phase 5.16) | 1.3 = +30% breitere Flamme |
| `research-slots` | Research-Center: zusätzliche Slots (Multiplier ungenutzt, Level entscheidet) | 1.0 |

### Cost Scaling

Upgrades unterstützen optionales Cost Scaling über das Feld `costScaling`:

```typescript
export function getUpgradeCost(upgrade: TowerUpgrade, currentLevel: number): number {
  const scaling = upgrade.costScaling ?? 1.0;
  return Math.round(upgrade.cost * Math.pow(scaling, currentLevel));
}
```

**Formel:** `baseCost * costScaling^currentLevel`

| costScaling | Level 0 (Kosten) | Level 1 | Level 2 | Level 3 |
|-------------|-------------------|---------|---------|---------|
| 1.0 (default) | baseCost | baseCost | baseCost | baseCost |
| 1.5 | baseCost | baseCost * 1.5 | baseCost * 2.25 | baseCost * 3.375 |
| 1.8 | baseCost | baseCost * 1.8 | baseCost * 3.24 | baseCost * 5.83 |
| 2.0 | baseCost | baseCost * 2 | baseCost * 4 | baseCost * 8 |

**Beispiel Dual-Gatling Speed Upgrade (cost: 90, costScaling: 2.0, maxLevel: 4):**
- Level 1: 90 Credits
- Level 2: 180 Credits
- Level 3: 360 Credits
- Level 4: 720 Credits
- **Total: 1350 Credits**

### Multi-Level Upgrades

Upgrades mit `maxLevel > 1` können mehrfach gekauft werden. Der Effekt-Multiplier wird pro Level angewendet:

```typescript
{
  id: 'damage',
  maxLevel: 3,
  cost: 120,
  costScaling: 1.7,
  effect: { stat: 'damage', multiplier: 1.5 },
}
```

**Effekt:**
- Level 1: Schaden x 1.5 (Kosten: 120)
- Level 2: Schaden x 1.5 x 1.5 = 2.25 (Kosten: 204)
- Level 3: Schaden x 1.5^3 = 3.375 (Kosten: 347)

**Hinweis:** Multiplier werden multipliziert, nicht addiert!

### Upgrade anwenden (Code)

Die Tower-Entity hat eingebaute Upgrade-Methoden:

```typescript
// Tower entity methods
tower.getAvailableUpgrades(): TowerUpgrade[]    // Noch nicht maximierte Upgrades
tower.getUpgradeLevel(upgradeId): number         // Aktuelles Level
tower.canUpgrade(upgradeId): boolean             // Noch upgradebar?
tower.applyUpgrade(upgradeId): boolean           // Upgrade anwenden
tower.getNextUpgradeCost(upgradeId): number      // Kosten für nächstes Level (mit Scaling)
tower.getTotalUpgradeCost(): number              // Gesamte investierte Upgrade-Kosten
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

### Beispiele aus dem Codebase (Phase 5.16)

#### Standard-Combat-Tower (Archer / Dual-Gatling / Cannon / Magic / Rocket / Ice / Tentacle / Poison)

Alle nutzen die identischen drei Standard-Upgrades:

```typescript
upgrades: [STD_DAMAGE_UPGRADE, STD_SPEED_UPGRADE, STD_RANGE_UPGRADE],
```

Damit hat jeder Combat-Tower drei Tracks à 25 Levels mit `cost: 50`, `costScaling: 1.40`, sowie Multiplikatoren `1.10` (Damage), `1.07` (Fire Rate), `1.04` (Range).

#### Fire Tower (Beam-Spezialfall)

Fire nutzt einen eigenen `beam-width`-Track statt `speed` (kein fireRate bei Beam-Towern):

```typescript
upgrades: [STD_DAMAGE_UPGRADE, STD_RANGE_UPGRADE, STD_BEAM_WIDTH_UPGRADE],
```

- `damage`-Stat wird auf `damagePerSecond` angewendet (Beam-DPS)
- `range` skaliert die Detection-Range
- `beam-width` skaliert nur `beamWidth` (Kegelbreite)

#### Research Center (Sonderfall)

```typescript
upgrades: [
  {
    id: 'research-slots' as UpgradeId,
    name: 'Research Wing',
    description: 'Adds an additional research slot',
    cost: 120,
    costScaling: 1.8,
    maxLevel: 2, // Level 1→2 Slots, Level 2→3 Slots
    effect: { stat: 'research-slots', multiplier: 1 },
  },
],
```

---

## Targeting-Strategien

Combat-Tower wählen ihr Ziel über eine `TargetingStrategy`. `defaultTargeting` im Config setzt den Startwert; der Spieler kann pro Tower in der Sidebar wechseln.

| Strategy | Beschreibung |
|----------|--------------|
| `closest` | Nächstgelegener Feind (Default falls `defaultTargeting` fehlt) |
| `lowest-hp` | Schwächster Feind |
| `highest-hp` | Stärkster Feind (z.B. Cannon, Rocket Default) |
| `first` | Feind, der der Basis am nächsten ist (z.B. Archer, Ice, Poison Default) |
| `air-priority` | Bevorzugt fliegende Ziele; Sub-Strategy via `defaultAirSubStrategy` |

`AirSubStrategy` (`closest` / `lowest-hp` / `highest-hp`) entscheidet, welches Air-Target gewählt wird, wenn `air-priority` aktiv ist und mehrere Air-Units in Reichweite sind.

---

## Beam Attack System (Fire Tower)

Der Fire Tower verwendet einen Beam-Angriff statt Projektile:

```typescript
fire: {
  attackType: 'beam',           // Beam statt Projektil
  damage: 0,                    // Nicht verwendet bei beam
  damagePerSecond: 35,          // 35 DPS an alle Feinde im Kegel
  range: 25,                    // Erkennungsreichweite (kurz - Flammenwerfer)
  beamRange: 20,                // Flammenstrahl-Länge
  beamWidth: 5,                 // Kegel-Breite am Ende
  fireRate: 0,                  // Nicht verwendet bei beam
  projectileType: 'fireball',   // Fallback Visual Type
}
```

**Unterschiede zu Projektil-Towern:**
- `damage` und `fireRate` sind 0 (nicht verwendet)
- Stattdessen `damagePerSecond` für kontinuierlichen Schaden
- `beamRange` und `beamWidth` definieren den Schadenskegel
- Alle Feinde im Kegel erhalten gleichzeitig Schaden

---

## Checkliste: Neuer Tower

- [ ] TowerTypeId erweitert
- [ ] Model in `/public/assets/models/towers/` abgelegt
- [ ] Tower-Config in `TOWER_TYPES` hinzugefügt
- [ ] `attackType` gesetzt falls Beam-/Melee-/Chain-Tower
- [ ] `canTargetAir`/`canTargetGround` gesetzt falls nicht default
- [ ] `damageType` gewählt + Damage-Matrix-Eintrag pruefen (`combat/damage-matrix.config.ts`)
- [ ] Projektiltyp vorhanden (oder neuen erstellt) — bei `chain`/`beam` Fallback-`projectileType` ok
- [ ] Bei `chain`: `maxJumps`, `chainFalloff`, `jumpRange` gesetzt
- [ ] Sound-Datei in `/public/assets/sounds/` (optional)
- [ ] Sound in `PROJECTILE_SOUNDS` registriert (optional)
- [ ] Bei rotierendem Turret: `turret_top` Mesh im Model benannt
- [ ] Bei rotierendem Turret: `turretBarrelOffset` für Barrel-Orientierung gesetzt
- [ ] Bei Animationen: `hasAnimations` und ggf. `animationPingPong` gesetzt
- [ ] Reihenfolge in `TOWER_TYPES` nach Wunsch angepasst

---

## Beispiel: Dual-Gatling Tower

Vollständiges Beispiel eines Towers mit rotierendem Turret:

```typescript
'dual-gatling': {
  id: 'dual-gatling',
  name: 'Dual-Gatling Tower',
  modelUrl: '/assets/models/towers/gatling.glb',
  scale: 2.5,
  previewScale: 5.5,
  heightOffset: 2.4,
  shootHeight: 2.1,
  rotationY: -1.5708,            // -90° visuelles Alignment
  turretBarrelOffset: -1.5708,   // Barrels zeigen +X im Model Space
  firePoints: [
    { x: -0.9, z: 0 },           // linker Barrel-Cluster
    { x:  0.9, z: 0 },           // rechter Barrel-Cluster (alternierend pro Schuss)
  ],
  damageType: 'pierce',
  damage: 10,
  range: 50,
  fireRate: 5.0,                 // Schnellfeuer
  projectileType: 'bullet',
  cost: 90,
  upgrades: [STD_DAMAGE_UPGRADE, STD_SPEED_UPGRADE, STD_RANGE_UPGRADE],
},
```

Model-Anforderungen:
- Mesh `turret_base`: Statische Basis
- Mesh `turret_top`: Rotierender Turret (wird automatisch erkannt)

---

## Beispiel: Fire Tower (Beam Attack)

Vollständiges Beispiel eines Beam-Towers:

```typescript
fire: {
  id: 'fire',
  name: 'Fire Tower',
  modelUrl: '/assets/models/towers/fire.glb',
  scale: 8,
  previewScale: 9.8,
  heightOffset: 3.8,
  shootHeight: 1.25,
  rotationY: 3.0892,             // ~177°
  turretBarrelOffset: 0.436,     // ~25° Barrel-Korrektur

  attackType: 'beam',
  damageType: 'fire',
  damage: 0,
  damagePerSecond: 35,
  range: 25,
  beamRange: 20,
  beamWidth: 5,
  fireRate: 0,
  projectileType: 'fireball',

  cost: 110,
  canTargetAir: false,
  canTargetGround: true,
  // Fire nutzt damage + range (Detection) + beam-width — kein fireRate (Beam-basiert)
  upgrades: [STD_DAMAGE_UPGRADE, STD_RANGE_UPGRADE, STD_BEAM_WIDTH_UPGRADE],
},
```

---

## Beispiel: Lightning Tower (Chain Attack)

Vollständiges Beispiel eines `chain`-Towers — Hitscan-Kette zwischen mehreren Enemies,
gerendert über den dedizierten `LightningBoltRenderer` (Pool von 192 Bolts mit
Vertex-Shader-generierter Jagged-Polyline) plus additive Aufhell-Halos pro Hit
(Workaround weil Photorealistic 3D Tiles dynamische Lichter ignorieren — siehe
[[feedback_tiles_dynamic_lights]] im Memory).

```typescript
lightning: {
  id: 'lightning',
  name: 'Lightning Tower',
  modelUrl: '/assets/models/towers/lightning.glb',
  scale: 11,
  previewScale: 14,
  heightOffset: 0,
  shootHeight: 9.65,
  rotationY: 0,

  attackType: 'chain',          // Hitscan, kein Projektil
  damageType: 'lightning',
  damage: 35,                   // Primary-Hit-Damage
  range: 65,                    // Primary-Target-Acquisition-Range
  fireRate: 0.8,                // 0.8 Schuss/s
  projectileType: 'fireball',   // Fallback, fuer chain ungenutzt

  maxJumps: 2,                  // Primary + 2 = 3 Total-Hits
  chainFalloff: 0.7,            // 100% → 70% → 49%
  jumpRange: 15,                // Max. Meter zwischen Chain-Links

  cost: 130,
  canTargetAir: true,
  canTargetGround: true,
  upgrades: [STD_DAMAGE_UPGRADE, STD_SPEED_UPGRADE, STD_RANGE_UPGRADE],
},
```

VFX-Integration:
- `TowerCombatService` emittiert `vfx:chain-lightning` mit `points`-Polyline (Tip → primary → jumpN)
- `VFXService.handleChainLightning` spawnt einen Bolt pro Segment im `LightningBoltRenderer`
- `registerIdleCrackle()` hält durchgehende Mikro-Bolts am Turm-Tip
- Pro Hit triggert ein additiver Sprite-Halo am Endpunkt (Opacity faded `(1-age)²`)

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
