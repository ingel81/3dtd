# Tower Creation Guide

**Stand:** 2026-09-15

Anleitung zum Erstellen neuer Tower-Typen mit optionalen rotierenden Teilen.

---

## Übersicht

Tower werden über die Konfigurationsdatei `configs/tower-types.config.ts` definiert. Das System unterstützt:

- Verschiedene 3D-Modelle (GLB; einen FBX-Ladepfad gibt es nicht mehr)
- Rotierende Turret-Teile (z.B. Geschütztürme)
- Eigene Projektiltypen
- **Damage/Armor-Matrix** (`damageType` Pflichtfeld, Phase 5.x, 9 Schadenstypen: physical, pierce, siege, magic, fire, ice, poison, lightning, chaos)
- **Upgrade-System** mit Tier-Gating: Damage/Fire Rate 25 Stufen (ab L16 degressiv), Range 10 Stufen, Profil pro Tower über `combatUpgrades({ damage, rate })`
- Separate Preview-Skalierung für die UI
- Air/Ground Targeting (6 Targeting-Strategien inkl. `air-priority` mit Air-Sub-Strategy)
- Animierte Tower-Modelle (GLTF-Animationen, optional PingPong-Loop)
- Projektil-Angriffe mit optionalen mehreren Fire Points (Dual-Gatling)
- Beam-Angriffe (Fire Tower, `attackType: 'beam'`)
- Melee-Angriffe (Tentacle Tower, `attackType: 'melee'`)
- **Chain-Hitscan-Angriffe** (Lightning Tower, `attackType: 'chain'`: Primary + N Jumps mit `chainFalloff` zwischen Hits, eigener `LightningBoltRenderer`)
- Passive Buildings (Research Center, `attackType: 'passive'`)
- **Veteranen-Ränge** aus Kills, rein kosmetisch, mit Abzeichen über dem Tower (siehe [Veteranen-Ränge](#veteranen-ränge))

---

## Aktuelle Tower-Typen

| Tower | attackType | damageType | Schaden | Reichweite | Feuerrate | Kosten | Besonderheiten |
|-------|------------|------------|---------|------------|-----------|--------|----------------|
| Archer | projectile | physical | 25 | 30m | 1.0/s | 45 | Animiert (PingPong), Air+Ground |
| Dual-Gatling | projectile | pierce | 10 | 50m | 5.0/s | 90 | Rotierender Turret, 2 Fire-Points |
| Cannon | projectile | siege | 55 | 70m | 0.5/s | 150 | Splash 6m (max. 8 Ziele), default `first` |
| Magic | projectile | magic | 40 | 70m | 1.5/s | 140 | Stark gegen ethereal |
| Rocket | projectile | siege | 40 | 100m | 0.5/s | 120 | **Nur Luft-Ziele** |
| Ice | projectile | ice | 5 | 60m | 0.33/s | 90 | Slow-Effekt, Air+Ground, Splash |
| Fire | **beam** | fire | 35 DPS | 20m (= Flammenlänge) | – | 110 | Flammenkegel, nur Boden, 20 % der DPS als Burn-DoT (3 s), Upgrade `beam-width` statt `speed` |
| Tentacle | **melee** | physical | 30 | 25m | 1.5/s | 80 | GPU Bezier-Rendering |
| Poison | projectile | poison | 5 | 55m | 1.0/s | 100 | DoT (poison-glob), Splash |
| Lightning | **chain** | lightning | 35 | 65m | 0.8/s | 130 | Hitscan-Kette (`maxJumps: 2`, `chainFalloff: 0.7`, `jumpRange: 15m`). Idle-Crackle am Turm-Tip + lokale Aufhell-Halos pro Hit (additive Sprites). Air+Ground. |
| Chaos | projectile | chaos | 50 | 60m | 1.2/s | 200 | Generalist (1,0 gegen jede Rüstung), Air+Ground, Projektil `chaos-orb`. Kenney-Modell, der mittlere Kristall dreht sich (`turretNode: 'crystal'`) |
| Research Center | **passive** | – | 0 | 0 | 0 | 75 | Kein Combat, siehe Research-System |

Archer und Research Center sind von Anfang an baubar. Alle anderen Tower schaltet eine Forschung
mit einem `unlock-tower`-Effekt frei (`configs/research/research-tree.config.ts`, Chaos:
`chaos-rift`), geprüft in `ResearchStore.isTowerUnlocked`. Bis dahin zeigt das Baumenü die Karte
gesperrt, mit dem Namen der Forschung im Tooltip.

---

## Schritt-für-Schritt: Neuen Tower hinzufügen

### 1. TowerTypeId erweitern

```typescript
// configs/tower-types.config.ts
export type TowerTypeId =
  | 'archer' | 'cannon' | 'magic' | 'dual-gatling' | 'rocket'
  | 'ice' | 'fire' | 'tentacle' | 'poison' | 'lightning' | 'chaos' | 'research-center'
  | 'NEW_TYPE';
```

### 2. Model-URL definieren

```typescript
const NEW_MODEL_URL = 'assets/models/towers/new_tower.glb';
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
  footprintRadius: 3.5,          // Radius der Grundfläche (m), siehe "Sockel auf unebenem Grund"
  rotationY: 0,                  // Initiale Y-Rotation in Radians (visuelles Alignment)
  turretBarrelOffset: 0,         // Optional: Turret-Barrel-Orientierung im Model Space (default: 0 = Barrels zeigen +Z)
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
  // damagePerSecond: 35,        // DPS für Beam-Tower (Kegellänge = range)
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
| `footprintRadius` | number | - | Radius der Grundfläche in Metern: weitester Vertex des Sockels vom Modell-Ursprung bei `scale`. Bestimmt Höhe und Sockel auf unebenem Grund und die Breite des Sockels |
| `rotationY` | number | 0 | Y-Rotation in Radians (visuell) |
| `turretBarrelOffset` | number | 0 | Barrel-Orientierung im Model Space |
| `turretNode` | string | - | Name des Nodes, der sich zum Ziel dreht. Überschreibt die Standardnamen `turret_top`/`tower_top`/`top`, ohne Rückfall auf sie; fehlt der Node im Modell, dreht sich nichts und der Renderer warnt einmal pro Typ (Chaos: `crystal`) |
| `damage` | number | - | Schaden pro Schuss (0 bei beam) |
| `range` | number | - | Erkennungsreichweite in Metern, bei Beam-Towern zugleich die Kegellänge |
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
| `beamWidth` | number | - | Kegel-Breite am Ende in Metern |
| `defaultTargeting` | TargetingStrategy | `'closest'` | Standard-Targeting-Strategie |
| `defaultAirSubStrategy` | AirSubStrategy | `'closest'` | Auswahl unter Air-Zielen bei `air-priority` |
| `firePoints` | { x, z }[] | - | Mehrere Feuer-Positionen (z.B. Dual-Gatling) |
| `maxJumps` | number | - | **Chain-only:** Anzahl zusätzlicher Ziele nach Primary (Lightning: 2 → 3 Hits) |
| `chainFalloff` | number | - | **Chain-only:** Schaden-Multiplier pro Jump (Lightning: 0.7 → 100%/70%/49%) |
| `jumpRange` | number | - | **Chain-only:** Max. Distanz zwischen zwei Chain-Links in Metern |
| `damageType` | DamageType | - | Pflichtfeld: physical/pierce/siege/magic/fire/ice/poison/lightning/chaos |

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

Den Manager außerdem im Konstruktor mit `scene.add(...)` einhängen und in `count`, `commitToGPU()`,
`clear()` und `dispose()` aufnehmen, bei einem ShaderMaterial mit `uTime` auch in
`updateShaderUniforms()`. Einen Trail-Streak bekommt nur ein Visual Type mit Pool in
`TrailStreakRenderer.initPools()` (heute `rocket`, `arrow`, `magic`, `ice`, `cannonball`, `bullet`,
`shell`),
den Stil liefert `TRAIL_STYLES`.

---

## Rotierende Tower-Teile (Turrets)

### Voraussetzungen

Das 3D-Modell braucht einen benannten Node, der sich dreht:
- **Name:** `turret_top` (erkannt werden auch `tower_top` und `top`)
- Heißt der Teil anders, benennt ihn die Tower-Config über `turretNode`, die GLB bleibt
  unverändert (Chaos: `turretNode: 'crystal'`). Dann gilt nur dieser Name, die Standardnamen
  nicht mehr. Ein Test prüft, dass der Node im Modell existiert; fehlt er zur Laufzeit, warnt
  der Renderer einmal pro Tower-Typ. Der Turm dreht sich dann nicht, schießt aber weiter:
  `isTurretAligned` gilt ohne Turret-Teil als erfüllt.
- Dieses Teil rotiert automatisch in Richtung der Feinde
- Ohne Turret-Teil (Archer, Lightning, Tentacle) dreht `advanceTurretAim()` die Zielrichtung
  (`currentLocalRotation`) trotzdem mit, nur ohne Node. Ihr folgt der Blutmond-Scheinwerfer
  (`aimHeading()`), aufs Feuern wartet sie nicht

### Wie es funktioniert

1. **Model-Struktur:** Das Modell besteht aus statischer Basis und rotierendem Teil
2. **Mesh-Erkennung:** Der Renderer findet `turret_top` (oder, falls gesetzt, nur den `turretNode` der Config) beim Laden
3. **Rotation:** `updateRotation()` setzt die Zielrichtung, `advanceTurretAim()` dreht den Turret-Teil pro Sub-Step mit π rad/s (Game-Time) dorthin

### Koordinatensystem-Konvertierung

Die Turret-Rotation muss zwischen Geo-Koordinaten und Three.js konvertieren:

```
Geo-Koordinaten:
- geoHeading = atan2(dLon·cos(lat), dLat): 0=Nord, π/2=Ost (metrisch, `utils/geo-utils.ts`)

Szene (EllipsoidSync.geoToLocalSimple, Tower, Gegner und Scheinwerfer):
- Nord = +Z, Ost = -X
- rotation.y = 0: die +Z-Achse des Modells zeigt nach Nord
- rotation.y = -π/2: die +Z-Achse des Modells zeigt nach Ost (-X)

Konvertierung: threeJsRotation = -geoHeading
```

Der Blutmond-Scheinwerfer dreht seinen Kegel (entlang +Z) genauso:
`headingToSearchlightYaw()` gibt `-heading`.

### Model-Offset (rotationY vs turretBarrelOffset)

Zwei verschiedene Offsets:

- **`rotationY`**: Visuelle Rotation des gesamten Modells (Alignment)
- **`turretBarrelOffset`**: Barrel-Orientierung im Model Space (für Zielberechnung)

Wenn die Rohre des Turret-Modells nicht in +Z-Richtung zeigen, müssen diese Werte gesetzt werden:

```typescript
// Beispiel: Dual-Gatling - Barrels zeigen auf -X
rotationY: -Math.PI / 2,         // -90° visuelles Alignment
turretBarrelOffset: -Math.PI / 2, // Barrels zeigen -X im Model Space
```

Der Renderer verwendet `turretBarrelOffset` für die Zielberechnung:

```typescript
const turretModelOffset = -(data.typeConfig.turretBarrelOffset ?? 0);
const threeJsTargetRotation = -heading + turretModelOffset;
const localRotation = threeJsTargetRotation - parentRotation;
```

### Ohne Ziel: Richtung halten, nach der Welle Wachrichtung

Ein Projektil-Tower schießt erst, wenn der Turm auf 15° ausgerichtet ist
(`isTurretAligned`). Deshalb dreht er ohne Ziel nicht mehr in eine
Grundstellung zurück:

- **Während der Welle** ruft die Kampfschleife ohne Ziel `releaseTarget` auf.
  Der Turm beendet die laufende Drehung und hält die Richtung des letzten
  Ziels.
- **Wachrichtung:** `Tower.guardHeading` zeigt dorthin, wo eine Route in die
  Reichweite eintritt (`utils/tower-guard-heading.ts`). Bei mehreren Routen
  zählt der Eintritt, der am frühesten auf seiner Route liegt. Tritt keine
  Route in die Reichweite ein, ist der Wert `null` und der Turm behält seine
  Richtung. Berechnet vom `TowerManager` bei Platzierung, Reichweiten-Upgrade
  und Routenänderung.
- **Neu platziert** steht der Turm in der Pose, in der er platziert wurde (wie
  in der Vorschau). Nach 800 ms schwenkt er 75° nach links und rechts um diese
  Pose und dreht danach mit Zielgeschwindigkeit zur Wachrichtung
  (`create(..., initialHeading)` setzt nur das Ziel dieser Drehung).
- **Nach der Welle** dreht der `GameStateManager` auf `wave:completed` alle
  Tower mit `turnTowersToGuard` zur Wachrichtung (`setIdleHeading`, gleiche
  Drehgeschwindigkeit wie beim Zielen). Außerhalb einer Welle tut er das,
  sobald kein Gegner mehr lebt (nach `enemy:died`, `enemy:reached-base`,
  `debug:remove-enemy`), und nach einer Routenänderung.
  Nach einem Reichweiten-Upgrade dreht der Turm zwischen den Wellen sofort zur
  neuen Wachrichtung, in einer Welle erst nach deren Ende.
- **Magic** verhält sich seit 2026-09-13 wie die anderen Tower. Vorher drehte
  sich die Kugel ohne Ziel langsam weiter (0,3 rad/s, in Render-Frames statt
  in Game-Time) und erreichte die Wachrichtung nie. Da `isTurretAligned`
  dieselbe Drehung liest, hing die Zeit bis zum ersten Schuss auf ein neues
  Ziel davon ab, wo die Kugel gerade stand.

```typescript
// tower-combat.service.ts
if (target) {
  this.tilesEngine?.towers.updateRotation(tower.id, heading);
  // ... fire
} else {
  this.tilesEngine?.towers.releaseTarget(tower.id);
}
```

---

## Sound-Integration

### Projektil-Sounds registrieren

Jeder Projektiltyp braucht einen Eintrag in `PROJECTILE_SOUNDS`
(`configs/projectile-types.config.ts`, `Record<ProjectileTypeId, …>`, der Compiler meldet
fehlende). Liste, Werte, Registrierung und Budget stehen in
[PROJECTILES.md](PROJECTILES.md#sound). Beam-, Melee- und Chain-Tower haben kein Projektil,
ihre Sounds registriert der `TowerManager` in `initialize()`.

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
  lightning: { ... },          // 10. Position
  chaos: { ... },              // 11. Position
  'research-center': { ... },  // 12. Position (passives Building, kein Combat)
};
```

---

## Tower Upgrade System (Balance 2026-09)

Tier-Gating in der UI: T1 = L1–5, T2 = L6–10, T3 = L11–15, T4 = L16–20, T5 = L21–25
(`requiredUpgradeTier`).

### Standard-Tracks (`tower-types.config.ts`)

```typescript
const UPGRADE_BASE_COST = 50;
const UPGRADE_COST_SCALING = 1.25;     // pro Stufe und Track, für alle Tower gleich
const UPGRADE_MAX_LEVEL = 25;          // Damage und Fire Rate
const UPGRADE_LATE_FROM_LEVEL = 15;    // bis hier voller Multiplikator
const UPGRADE_LATE_GAIN_SHARE = 0.4;   // danach 40 % des Zuwachses
const UPGRADE_RANGE_MULTIPLIER = 1.03; // Range: 10 Stufen, max. ×1,344
const UPGRADE_RANGE_MAX_LEVEL = 10;
const UPGRADE_BEAM_WIDTH_MULTIPLIER = 1.03; // Fire only, ebenfalls 10 Stufen
```

Ein Combat-Tower bekommt seine Tracks über `combatUpgrades({ damage, rate })`: Damage- und
Fire-Rate-Track mit tower-eigenem Multiplikator `m` (Stufe 16–25: `1 + 0,4 × (m − 1)`), dazu
der gemeinsame Range-Track. Fire nutzt `degressiveUpgrade('damage', …)`, `RANGE_UPGRADE` und
`BEAM_WIDTH_UPGRADE`. Research Center ist die einzige Ausnahme (eigenes `research-slots`-Upgrade).

Werte werden nie kompoundiert, sondern aus Basiswert × `upgradeFactor(track, stufe)` berechnet.
Die Funktion ist die einzige Stelle mit der Upgrade-Formel: Tower-Entity, Beam-Werte, DPS-Modell
und Balance-Charts lesen sie.

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
  lateFromLevel?: number;    // letzte Stufe mit vollem multiplier (default: alle)
  lateMultiplier?: number;   // Multiplier jeder Stufe danach (default: multiplier)
}
```

Beispiel: der Fire-Rate-Track der Dual-Gatling, wie ihn
`degressiveUpgrade('speed', 'Fire Rate', 'fireRate', 1.06)` baut:

```typescript
{
  id: 'speed',
  name: 'Fire Rate',
  description: 'Increases fire rate (+6% per level up to L15, +2.4% after, compounding).',
  cost: 50,                     // UPGRADE_BASE_COST
  costScaling: 1.25,            // UPGRADE_COST_SCALING
  maxLevel: 25,                 // UPGRADE_MAX_LEVEL
  effect: { stat: 'fireRate', multiplier: 1.06 },
  lateFromLevel: 15,            // UPGRADE_LATE_FROM_LEVEL
  lateMultiplier: 1.024,        // 1 + 0,4 × (1,06 − 1)
},
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

**Beispiel Standard-Track (cost: 50, costScaling: 1.25), gleich für jeden Damage-, Fire-Rate-, Range- und Beam-Width-Track:**
- Level 1: 50 Credits
- Level 2: 63 Credits
- Level 3: 78 Credits
- Level 5: 122 Credits
- Level 10: 373 Credits
- Level 25: 10.588 Credits
- **Total L1–10: 1.664 Credits, L1–25: 52.740 Credits**

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

**Hinweis:** Multiplier werden multipliziert, nicht addiert. Mit `lateFromLevel` gilt ab der
Stufe danach `lateMultiplier` (`upgradeFactor`).

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
tower.getSellValue(): number                     // SELL_RATIO × (cost + Upgrade-Kosten)
```

### Range-Upgrade Spezialfall

Die sichtbaren Zellen eines Towers hängen an seiner Reichweite. Nach einem Range-Upgrade (auch
beim Debug-Max-Upgrade) ruft `TowerLifecycle` (`managers/game-state/tower-lifecycle.ts`) deshalb
`recomputeRangeAfterUpgrade(tower)` auf, von außen erreichbar als
`GameStateManager.recomputeTowerRangeAfterUpgrade(tower)`:

- `TowerPlacementService.recomputeTowerLOS(tower)` berechnet die LOS-Zellen neu
- `tower.rangeSquaredGeo` (Sleep-/Wake-Checks) und der Reichweitenring (`updateRangeIndicator`) folgen
- `TowerManager.refreshGuardHeading(tower)` rechnet die Wachrichtung neu; zwischen den Wellen
  dreht der Turm sofort dorthin

### Beispiele aus dem Codebase

#### Standard-Combat-Tower (alle außer Fire)

Jeder Combat-Tower bekommt sein eigenes Damage/Rate-Profil:

```typescript
upgrades: combatUpgrades({ damage: 1.07, rate: 1.02 }), // Cannon
```

Damit hat er einen Damage- und einen Fire-Rate-Track à 25 Stufen (ab L16 degressiv) und den
gemeinsamen Range-Track à 10 Stufen, alle mit `cost: 50`, `costScaling: 1.25`. Die Profile
aller Tower stehen in MASTER_GAME_DESIGN §3.2.

#### Fire Tower (Beam-Spezialfall)

Fire nutzt einen eigenen `beam-width`-Track statt `speed` (kein fireRate bei Beam-Towern):

```typescript
upgrades: [
  degressiveUpgrade('damage', 'Damage', 'damage', 1.06),
  RANGE_UPGRADE,
  BEAM_WIDTH_UPGRADE,
],
```

- `damage`-Stat wird auf `damagePerSecond` angewendet (Beam-DPS)
- `range` verlängert Erfassung und Flamme (beides ist dieselbe Zahl)
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
| `closest` | Nächstgelegener Feind (Tentacle; Default falls `defaultTargeting` fehlt) |
| `lowest-hp` | Schwächster Feind |
| `highest-hp` | Stärkster Feind |
| `first` | Feind, der der Basis am nächsten ist (Default aller anderen Combat-Tower) |
| `last` | Feind mit dem kürzesten zurückgelegten Weg (Gegenstück zu `first`, kein Tower hat es als Default) |
| `air-priority` | Bevorzugt fliegende Ziele; Sub-Strategy via `defaultAirSubStrategy` |

`AirSubStrategy` (`closest` / `lowest-hp` / `highest-hp`) entscheidet, welches Air-Target gewählt wird, wenn `air-priority` aktiv ist und mehrere Air-Units in Reichweite sind.

---

## Veteranen-Ränge

Tower sammeln mit ihren Kills Ränge. Rein kosmetisch: Kampf, Wirtschaft und Wave-Director lesen
sie nicht. Jeder Tower-Typ bekommt sie ohne eigene Config.

- **Kill:** zählt für den Tower, dessen Treffer dem Gegner die letzten HP nimmt
  (`DamageApplicationService`, `CombatComponent.kills`). Splash, Kettensprünge, Beam-Ticks und
  Schaden über Zeit zählen für den Tower, von dem sie kommen. Der Schlag einer Fähigkeit und das
  Projektil eines schon verkauften Towers zählen für keinen. Die Zuordnung läuft in den festen
  Sub-Steps der Spielzeit.
- **Leiter** (`configs/veteran-ranks.config.ts`, `VETERAN_RANKS`):

| Rang | ab Kills | Abzeichen |
|------|----------|-----------|
| Recruit | 0 | keins |
| Blooded | 10 | ein Winkel, silber |
| Veteran | 50 | zwei Winkel, silber |
| Elite | 150 | drei Winkel, silber |
| Champion | 400 | drei Winkel, gold |
| Legend | 1000 | Stern, gold |

- **Schwellen:** gemessen an den Trainingslogs vom 2026-08-28 (Strategist-Bot, rund 500 Läufe je
  Welle, Median der Kills der ganzen Verteidigung): 6 in W1, 117 bis W10 bei bis zu 10 Towern,
  171 bis W18, dann allein der W19-Schwarm rund 3.000, 4.257 bis W30 bei 20 Towern. Blooded kommt
  in den ersten Wellen, Veteran für die frühen Tower um W10, Elite kaum vor dem W19-Schwarm,
  Champion und Legend nur für die Tower, die die Schwärme tragen. W19 war damals `rat_tide`, heute
  ist es `skeleton_swarm` (bis 940 Skelette, mit den Minions bis 2.820 Körper).
- **Kein eigener Zustand:** Der Rang wird aus `kills` abgeleitet, wo er gebraucht wird
  (`veteranLevel`): im Tower-Panel und jeden Frame für das Abzeichen in der Welt. Ein Upgrade
  behält ihn, Verkaufen nimmt ihn mit dem Tower weg. Was die Kills wiederherstellt oder
  nachspielt, stellt auch den Rang wieder her, das Abzeichen eingeschlossen.
- **Abzeichen in der Welt:** `TowerBadgeRenderer` (`engine.towerBadges`,
  `three-engine/renderers/tower-badge/`), alle Abzeichen in einem Draw Call, gebaut wie die
  Lebensbalken der Gegner: eine `InstancedBufferGeometry` unter einem Mesh, Billboard im
  Vertex-Shader, Winkel und Stern als Distanzfelder im Fragment-Shader, dunkler Rand
  (`--td-panel-shadow`), Log-Depth und `colorspace_fragment`. Silber ist `--td-edge-highlight`,
  Gold `--td-gold-light`. Das Abzeichen steht über der Oberkante der Bounding Box des
  Tower-Modells, das schon auf Sockel und `heightOffset` steht, gemessen einmal, wenn das Abzeichen
  zuerst erscheint; lädt das Modell noch, misst ein späterer Frame. 24 CSS-Pixel groß, in der Welt
  zwischen 1,4 und 9 m gehalten, zwischen 700 und 1.100 m Kameraabstand ausgeblendet
  (`tower-badge-shaders.ts`). Der Tiefentest lässt Gebäude davor das Abzeichen verdecken.
- **Weg:** Die `GameLoopFacadeService` ruft jeden Frame `TowerManager.syncVeteranBadges`, der
  für jeden Tower den Rang aus `combat.kills` an `towerBadges.setRank` gibt; gleicher Rang ändert
  nichts. Das Abzeichen folgt damit den Kills, auch wenn sie ohne `tower:kill` gesetzt werden.
  Ein Tower unter dem ersten Rang belegt keinen Slot. `TowerManager.remove` und `clear` nehmen die Abzeichen weg, der
  Photo Mode blendet sie aus.
- **Tower-Panel:** Rangzeile unter den Stat-Kacheln, siehe
  [DESIGN_SYSTEM.md → Veteranen-Rang](DESIGN_SYSTEM.md#veteranen-rang).

---

## Beam Attack System (Fire Tower)

Der Fire Tower verwendet einen Beam-Angriff statt Projektile:

```typescript
fire: {
  attackType: 'beam',           // Beam statt Projektil
  damage: 0,                    // Nicht verwendet bei beam
  damagePerSecond: 35,          // 35 DPS an alle Feinde im Kegel
  range: 20,                    // Erfassung = Flammenlänge
  beamWidth: 5,                 // Kegel-Breite am Ende
  fireRate: 0,                  // Nicht verwendet bei beam
  projectileType: 'arrow',      // Fallback, für beam ungenutzt
}
```

**Unterschiede zu Projektil-Towern:**
- `damage` und `fireRate` sind 0 (nicht verwendet)
- Stattdessen `damagePerSecond` für kontinuierlichen Schaden
- `range` (Länge, mit Range-Upgrades) und `beamWidth` definieren den Schadenskegel. Der Tower
  erfasst nur Ziele innerhalb der Flamme, er zielt also nie auf etwas, das er nicht trifft
- Alle Feinde im Kegel erhalten gleichzeitig Schaden

---

## Checkliste: Neuer Tower

- [ ] TowerTypeId erweitert
- [ ] Model in `/public/assets/models/towers/` abgelegt
- [ ] Tower-Config in `TOWER_TYPES` hinzugefügt
- [ ] `footprintRadius` am Modell gemessen (weitester Vertex der Basis bei `scale`, aufgerundet)
- [ ] `attackType` gesetzt falls Beam-/Melee-/Chain-Tower
- [ ] `canTargetAir`/`canTargetGround` gesetzt falls nicht default
- [ ] `damageType` gewählt, Paarungen in `configs/combat/damage-matrix.config.ts` geprüft. Ein neuer
  Schadenstyp braucht eine Zeile in `DAMAGE_MATRIX` und Einträge in `DAMAGE_TYPE_UI` und
  `DAMAGE_ACCENT` (Tooltip-Farbe), der Compiler meldet fehlende
- [ ] Projektiltyp vorhanden (oder neuen erstellt), bei `chain`/`beam` genügt der Fallback-`projectileType`
- [ ] Bei `chain`: `maxJumps`, `chainFalloff`, `jumpRange` gesetzt
- [ ] Sound-Datei in `/public/assets/sounds/` (optional)
- [ ] Bei neuem Projektiltyp: Eintrag in `PROJECTILE_SOUNDS` (Pflicht, `Record<ProjectileTypeId, …>`)
- [ ] Bei rotierendem Turret: `turret_top` Mesh im Model benannt, oder `turretNode` in der Config gesetzt
- [ ] Bei rotierendem Turret: `turretBarrelOffset` für Barrel-Orientierung gesetzt
- [ ] Bei Animationen: `hasAnimations` und ggf. `animationPingPong` gesetzt
- [ ] Reihenfolge in `TOWER_TYPES` nach Wunsch angepasst
- [ ] Forschung mit `unlock-tower`-Effekt in `configs/research/research-tree.config.ts`
- [ ] Eintrag in `TOWER_TIER` (Build-Panel, `Record<TowerTypeId, number>`)
- [ ] Nur Schuss-Tower: Mündungsfeuer über einen Eintrag in `MUZZLE_FLASH_PROFILES`
  (`configs/visual-effects.config.ts`), ohne Eintrag kein Flash

---

## Beispiel: Dual-Gatling Tower

Vollständiges Beispiel eines Towers mit rotierendem Turret:

```typescript
'dual-gatling': {
  id: 'dual-gatling',
  name: 'Dual-Gatling Tower',
  modelUrl: 'assets/models/towers/gatling.glb',
  scale: 2.5,
  previewScale: 5.5,
  heightOffset: 2.4,
  shootHeight: 2.1,
  footprintRadius: 3.1,
  rotationY: -1.5708,            // -90° visuelles Alignment
  turretBarrelOffset: -1.5708,   // Barrels zeigen -X im Model Space
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
  upgrades: combatUpgrades({ damage: 1.04, rate: 1.06 }),
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
  modelUrl: 'assets/models/towers/fire.glb',
  scale: 8,
  previewScale: 9.8,
  heightOffset: 3.8,
  shootHeight: 1.25,
  footprintRadius: 5.3,
  rotationY: 3.0892,             // ~177°
  turretBarrelOffset: 0.436,     // ~25° Barrel-Korrektur

  attackType: 'beam',
  damageType: 'fire',
  damage: 0,
  damagePerSecond: 35,
  range: 20,
  beamWidth: 5,
  fireRate: 0,
  projectileType: 'arrow',

  cost: 110,
  canTargetAir: false,
  canTargetGround: true,
  // Fire nutzt damage + range (Flammenlänge) + beam-width, kein fireRate (Beam-basiert)
  upgrades: [degressiveUpgrade('damage', 'Damage', 'damage', 1.06), RANGE_UPGRADE, BEAM_WIDTH_UPGRADE],
},
```

---

## Beispiel: Lightning Tower (Chain Attack)

Vollständiges Beispiel eines `chain`-Towers: Hitscan-Kette zwischen mehreren Enemies,
gerendert über den dedizierten `LightningBoltRenderer` (bis zu 192 Bolts als Instanzen
eines Quad-Strips, ein Mesh und ein Draw Call; der Vertex-Shader erzeugt die
Jagged-Polyline aus Endpunkten und Seed pro Instanz) plus additive Aufhell-Halos pro Hit
(Workaround, weil die Photorealistic 3D Tiles dynamische Lichter nicht annehmen: Wer die
Umgebung aufhellen will, nimmt additive Sprites oder Decals, kein PointLight).

```typescript
lightning: {
  id: 'lightning',
  name: 'Lightning Tower',
  modelUrl: 'assets/models/towers/lightning.glb',
  scale: 11,
  previewScale: 14,
  heightOffset: 0,
  shootHeight: 9.65,
  footprintRadius: 3.7,
  rotationY: 0,

  attackType: 'chain',          // Hitscan, kein Projektil
  damageType: 'lightning',
  damage: 35,                   // Primary-Hit-Damage
  range: 65,                    // Primary-Target-Acquisition-Range
  fireRate: 0.8,                // 0.8 Schuss/s
  projectileType: 'arrow',      // Fallback, für chain ungenutzt

  maxJumps: 2,                  // Primary + 2 = 3 Total-Hits
  chainFalloff: 0.7,            // 100% → 70% → 49%
  jumpRange: 15,                // Max. Meter zwischen Chain-Links

  cost: 130,
  canTargetAir: true,
  canTargetGround: true,
  upgrades: combatUpgrades({ damage: 1.05, rate: 1.04 }),
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
- **Line-of-Sight Preview:** Zeigt das Sichtfeld an gültigen Positionen ohne Wartezeit; neu
  gebaut, wenn der Cursor mehr als 1 m wandert, sonst wird nur die Tower-Spitze nachgeführt

### Platzierungsregeln

Eine Regelquelle für Maus-Vorschau, Klick und Bots: `checkTowerPlacement`
(`utils/tower-placement-rules.ts`), Werte in `configs/placement.config.ts`.
Den Kontext (Spielbereich, HQ, Spawns, Tower, Routen) stellt der
`TowerPlacementService` zusammen: `validateTowerPosition` für eine Position,
`placementChecker()` für viele hintereinander (Kandidatensuche der Bots im
`StrategicPlacementService`). Die erste verletzte Regel liefert den Grund.

| Regel | Wert | Beschreibung |
|-------|------|--------------|
| Spielbereich | Bounds des Straßennetzes | Position innerhalb der geladenen Straßen |
| `MIN_DISTANCE_TO_BASE` | 30m | Mindestabstand zum HQ |
| `MIN_DISTANCE_TO_SPAWN` | 60m | Mindestabstand zu Spawns |
| `MIN_DISTANCE_TO_OTHER_TOWER` | 8m | Mindestabstand zu anderen Türmen |
| `MIN_DISTANCE_TO_ROUTE` | 10m | Mindestabstand zu den Gegnerrouten (Abstand zum Segment) |

Alle Abstände sind horizontal (Haversine zu HQ, Spawns und Towern, `distanceToSegment` zur
Route). Gebäude sind kein Hindernis: Der
Tower wird auf Dachhöhe gehoben und steht dann auf dem Dach.

### Sockel auf unebenem Grund

Ob ein Tower an einer Stelle stehen darf, entscheiden allein die Regeln oben. Wie hoch er dort
steht, entscheidet der Boden unter seiner Grundfläche (`footprintRadius`):

- **Abtastung:** `TowerPlacementService.resolveFootprint` liest senkrecht von oben die Säule jeder
  Probe, Boden und oberste Fläche: auf den 3D-Tiles über `TerrainQueries.raycastColumnSample`
  (`groundY` und `topY` der Säule, in `__raycastStats()` als `towerFootprint`), in DevWorld die
  oberste Fläche über `raycastDown` und den Boden über die Geländehöhe. Die Proben liegen in der
  Mitte, auf einem Ring bei halbem und einem bei vollem Radius, höchstens 2 m auseinander
  (`footprintSampleOffsets`, 19 bis 27 Proben je nach Tower, 49 beim Research Center). Neu
  geprobt wird wie die Validierung erst, wenn der Cursor 1 m gewandert ist.
- **Bauvorschau:** Sie probt zuerst die Mitte und den inneren Ring. Liegen die weniger als 0,2 m
  neben der Cursor-Fläche (`levelWithCursor`), gilt vorläufig ebener Grund, und der äußere Ring
  folgt erst, wenn der Cursor einen Frame lang innerhalb dieses Meters bleibt
  (`tickBuildPreviewViz`), spätestens beim Klick. Beim Überstreichen ebenen Grunds kostet eine
  Validierung damit 7 bis 10 statt 19 bis 27 Säulen (Research Center 17 statt 49). Uneben wird
  sofort alles geprobt. Das Ergebnis ist dasselbe; ein Sockel, den nur der äußere Ring verlangt
  (etwa an einer Dachkante), erscheint erst, wenn der Cursor ruht. Der Trainings-Bot probt
  immer alles (`resolveFootprint`).
- **Entscheidung** (`resolveTowerFootprint`, Werte in `PLINTH_CONFIG`): Jede Probe zählt mit der
  obersten Fläche ihrer Säule. Weichen die Proben weniger als 0,2 m voneinander ab
  (`MIN_UNEVENNESS`), bleibt der Tower auf der Fläche unter dem Cursor, ohne Sockel, wie früher.
  Sonst steht sein Fuß auf der höchsten Probe, die ihn heben darf (unten), und ein Sockel reicht
  bis zur tiefsten Probe. Proben mehr als 5 m über der Cursor-Fläche (`MAX_RISE`: Fassade, hohe
  Krone) oder mehr als 30 m darunter (`MAX_DROP`: Abbruch hinter einer Dachkante) zählen nicht.
- **Dach oder Boden:** Liegt die Cursor-Fläche mehr als 2,5 m über dem Boden (`ROOF_ABOVE_GROUND`,
  derselbe Wert wie `roofRise` im Routenraster), steht der Cursor auf einem Dach, Deck oder einer
  Brücke. Boden heißt: der Boden der eigenen Säule, oder, wo die Photogrammetrie unter einem Dach
  keinen Boden hat (`groundY` gleich `topY`), der Boden auf zwei gegenüberliegenden Seiten der
  Grundfläche. Dafür kommen acht Säulen rundherum dazu, 8 m jenseits der Grundfläche
  (`ROOF_PROBE_REACH`, `footprintSurroundingOffsets`), geprobt nur, wenn Dach- und Boden-Regel
  verschiedene Füße ergeben und die eigene Säule keinen Boden tief unten zeigt. Liegt bei einem
  gegenüberliegenden Paar der Boden beider Säulen mehr als 2,5 m tiefer, ist es ein Dach; ein Hang
  fällt nur auf einer Seite ab und bleibt Boden. Auf dem Dach hebt jede Probe den Tower: First
  eines Satteldachs, höherer Teil eines gestuften Dachs, auch Gaube oder Schornstein. Sonst steht
  der Cursor am Boden, und nur was der
  Boden allmählich erreicht, hebt ihn: Von der Mitte über benachbarte Proben darf jeder Schritt
  beliebig tief fallen, aber nur 0,5 m steigen (`MAX_STEP`), dazu die Steigung, die der Boden
  unter dem Cursor in Schrittrichtung hat. Die Steigung kommt aus gegenüberliegenden Proben des
  inneren Rings, je Paar aus der kleineren Seite, damit ein Auto auf einer Seite sie nicht
  verfälscht. Ein geparktes Auto, eine Hecke, eine Mauer oder eine Krone neben dem Tower heben ihn
  damit nicht, er steckt wie vor dem Sockel ein Stück darin; ein Hang oder eine geneigte Straße
  hebt ihn.
- **Grenzen:** Steht der Cursor selbst auf einem Auto, ist dessen Dach die Cursor-Fläche, und der
  Tower steht darauf. Eine Böschung oder Terrassenmauer, die erst neben dem Cursor steiler als
  `MAX_STEP` ansteigt, hebt ihn nicht, ebenso wenig die Hänge einer Mulde, in der der Cursor
  liegt (beide Seiten steigen, keine Steigung). Auf einem Parkdeck gilt die Dach-Regel, dort
  heben auch Autos. Zeigt die Säule unter einem Dach keinen Boden und erreichen die Säulen
  rundherum den tieferen Boden auf keinen zwei gegenüberliegenden Seiten (mitten auf einem Dach,
  das in jeder Richtung weiter als Radius + 8 m reicht), gilt die Boden-Regel: ein gleichmäßig
  geneigtes Dach hebt ihn über die Steigung trotzdem, ein höherer Dachteil oder Aufbau nicht.
  Umgekehrt gilt die Dach-Regel auf einem Damm, einer Kuppe oder einer Terrasse, die zu zwei
  gegenüberliegenden Seiten binnen Radius + 8 m um mehr als 2,5 m abfällt; dort heben auch Autos
  und Hecken.
- **Prüfen im Spiel:** `__footprintDebug()` in der Konsole (Dev-Build) zeigt für die letzte
  Validierung der Bauvorschau Cursor-Fläche, Boden und Oberkante der Cursor-Säule
  (`centreGroundY`, `centreTopY`: gleich, wo die Säule unter dem Dach keinen Boden zeigt), die
  Regel (`even`, `agree`: beide Regeln ergeben denselben Fuß, `roof-column`, `roof-surroundings`,
  `ground`, `level-inner-ring`: der äußere Ring ist noch nicht geprobt), Fuß, Sockel, tiefste und
  höchste Probe, die höchste, die die Boden-Regel erreicht, und den Boden der acht Säulen rundherum.
  Ohne Tippen während des Zielens: `__footprintDebug.watch()` einmal aufrufen, danach schreibt die
  Konsole eine Zeile, sobald der Cursor 0,3 s auf einer neu geprüften Stelle ruht (neu geprüft
  wird nach mehr als 1 m Weg), und eine bei jeder Platzierung: `rest` bzw. `placed`, Tower,
  `rule`, `centreGroundY`, `centreTopY`, `plinthHeight`, `footY`, `surfaceY` und Position.
  `__footprintDebug.watch(false)` beendet das; aus kostet es einen Null-Vergleich pro Frame.
- **Weg ins Spiel:** `command:place-tower` trägt `position.height` = Fuß (Oberkante des Sockels)
  und `plinthHeight`. Beides landet im `Tower` (`position.height`, `plinthHeight`). Alles, was
  von `position.height` ausgeht, beginnt damit am angehobenen Fuß: LOS-Registrierung
  (`TowerLosRegistry`), LOS-Vorschau, Schussursprung, Tip-Marker, Tentakel und Idle-Crackle.
  Der Trainings-Bot geht denselben Weg.
- **Darstellung:** `TowerPlinthRenderer` (`engine.plinths`, `three-engine/renderers/tower-plinth/`)
  baut pro Sockel ein Mesh: runde, leicht geböschte Säule, 0,2 m breiter als die Grundfläche,
  0,4 m tiefer als die tiefste Probe. Das Bruchsteinmauerwerk zeichnet ein
  `MeshStandardMaterial` mit `onBeforeCompile` prozedural in Weltkoordinaten (Steine als
  3D-Voronoi-Zellen, Kalkmörtel, Laufspuren, Moos in Fugen, oben und am Fuß). Als Standard-Material
  bekommt der Sockel dieselben Lichter wie die Tower-Modelle, Log-Depth und die Farbraum-Wandlung.
  Der `TowerManager` legt den Sockel mit dem Tower an und entfernt ihn beim Verkauf. Ein Klick
  auf den Sockel wählt den Tower. Die Bauvorschau zeigt den Sockel durchscheinend und grün oder
  rot getönt wie den Vorschau-Tower (`TowerPlinthPreview`).

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
  [hints]="[{key: 'R', description: 'Rotate'}]"
  [warning]="'Too close to route'"
/>
```
