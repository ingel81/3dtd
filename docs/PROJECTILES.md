# Projektil-System

**Stand:** 2026-09-11

## Architektur

### Entity: `projectile.entity.ts`
Das Projektil-Entity verwaltet Position, Bewegung und Flugbahn.

**Wichtige Properties:**
- `direction` - Normalisierter Richtungsvektor im lokalen Frame (-X = Ost, +Z = Nord, Meter; Längengrad mit cos(lat) skaliert). Bei Spawn berechnet, bei Homing/Arc-Projektilen kontinuierlich aktualisiert. Nur Optik (Mesh-Rotation, Schweif), die Bewegung läuft über lat/lon
- `flightHeight` - Aktuelle Flughöhe (interpoliert mit Parabel-Bogen oder linear)
- `flightProgress` - Fortschritt entlang der Flugbahn (0-1)
- `isHoming` - Ob das Projektil zielverfolgend ist (Rockets)
- `hasArcTrajectory` - Ob das Projektil eine Bogenbahn hat (Arrows, Cannonballs)
- `targetLost` - Ob das Ziel während des Flugs gestorben ist

**Wichtige Methoden:**
- `calculateDirectionVector(startPos, startHeight)` - Berechnet normalisierten Richtungsvektor von Start zu Ziel
- `calculateFlightHeight()` - Berechnet Flughöhe (Parabel-Bogen für Arrow/Cannonball, linear für andere)
- `getTargetHeight()` - Gibt Zielhöhe zurück (Enemy-TerrainHeight + heightOffset + 3m Kopfhöhe)
- `updateTowardsTarget(deltaTime)` - Bewegt Projektil Richtung Ziel, gibt `true` bei Treffer zurück
- `calculateArcTangentDirection()` - Berechnet Tangentenrichtung entlang der Parabel für Arc-Projektile

**Distanzberechnung:**
Verwendet `geoDistanceFast()` aus `utils/geo-utils.ts` (schnelle Approximation fuer kurze Distanzen < 200m).

**Flugbahn-Berechnung:**
```typescript
// Arrow: Leichter Parabel-Bogen (maxArcHeight = min(distance * 0.05, 10))
// Cannonball: Hoher Parabel-Bogen (maxArcHeight = min(distance * 0.15, 25))
const baseHeight = startHeight + (targetHeight - startHeight) * progress;
const arcOffset = maxArcHeight * 4 * progress * (1 - progress);
return baseHeight + arcOffset;

// Homing (Rocket) und andere (Bullet, Arcane-Orb, Ice-Shard): Linear
return startHeight + (targetHeight - startHeight) * progress;
```

### Manager: `projectile.manager.ts`
Verwaltet Lifecycle und Updates aller Projektile.

**Spawn:**
```typescript
const spawnHeight = terrainHeight + tower.typeConfig.heightOffset + tower.typeConfig.shootHeight;
const projectile = new Projectile(..., spawnHeight);
```

**Wichtige Methoden:**
- `spawn(tower, targetEnemy)` - Erstellt neues Projektil und spielt Sound ab
- `playProjectileSound(tower, projectileType)` - Emittiert Audio-Event an Tower-Position

**Update:**
- Position wird jeden Frame aktualisiert
- Homing-Projektile (Rockets) und Arc-Projektile (Arrows, Cannonballs) aktualisieren Rotation kontinuierlich
- Reguläre Projektile behalten fixe Rotation (einmal bei Spawn berechnet)
- Trail-Partikel: ein Spawn-Gate pro 0,5 m Flugstrecke (`TRAIL_SPAWN_DISTANCE_M`). Die Gates
  eines Frames werden im Abstand von 0,5 m entlang der Flugrichtung nach hinten gelegt, nicht
  alle auf die aktuelle Position (eine Rakete fliegt bei 60 FPS 2 m pro Frame)

### Renderer: `three-projectile.renderer.ts`
GPU-Instancing für effizientes Rendering vieler Projektile.

**Arrow-Modell:**
- Geladen aus: `/assets/models/projectiles/arrow.glb`
- Modell ist sehr klein (~0.8m), daher Scale: 8
- Fallback auf ConeGeometry falls Modell nicht lädt

**Instancing-Limits (Pool-Größen, siehe `three-projectile.renderer.ts`):**
| Typ | Max Instanzen |
|-----|---------------|
| Arrow | 500 |
| Cannonball | 200 |
| Magic (Arcane Orb) | 500 |
| Ice | 500 |
| Bullet | 1000 |
| Rocket | 100 |
| Poison | 500 |

**Rotation:**
- Verwendet Quaternion: `setFromUnitVectors(+Y, direction)`
- Dreht das Modell von +Y Richtung zur Zielrichtung
- Bei regulären Projektilen nur bei Spawn gesetzt
- Bei Homing/Arc-Projektilen jeden Frame aktualisiert

## Konfiguration: `projectile-types.config.ts`

| Typ | Speed | Scale | Visual Type | Splash | Trail |
|-----|-------|-------|-------------|--------|-------|
| arrow | 80 m/s | 8 | arrow (GLB Model) | - | - |
| cannonball | 50 m/s | 0.5 | cannonball (Sphere) | 10m | Grauer Rauch (normal blending) |
| arcane-orb | 100 m/s | 0.4 | magic (Shader Orb) | - | Violett-Cyan-Funken als Spirale (additive, `trailType: 'spiral'`) |
| ice-shard | 90 m/s | 0.4 | ice (Shader Orb) | 8m | Eis-Partikel (additive) |
| bullet | 150 m/s | 0.15 | bullet (Cylinder) | - | Gelber Tracer (additive) |
| rocket | 120 m/s | 1.0 | rocket (Cylinder) | - | Warmer Exhaust (additive) |
| poison-glob | 70 m/s | 0.5 | poison (Shader Orb) | 8m | Grüne Partikel (additive) |

**Visuelle Typen** (`ProjectileVisualType`):
- `arrow` - GLB-Modell aus `/assets/models/projectiles/arrow.glb`
- `cannonball` - SphereGeometry, dunkelgrau metallisch
- `magic` - SphereGeometry mit ShaderMaterial (Arcane Orb: violetter Körper, cyanfarbene Zellen und Rand, Custom GLSL Shader)
- `ice` - SphereGeometry mit ShaderMaterial (blau/cyan/weiss Orb, gleicher Shader wie magic mit anderen Farben)
- `bullet` - CylinderGeometry, gelb/golden leuchtend
- `rocket` - CylinderGeometry, weiss/hellgrau
- `poison` - SphereGeometry mit ShaderMaterial (grün)

**Splash-Damage-Konfiguration:**
```typescript
splashRadius?: number;          // Radius in Metern (0 oder undefined = kein Splash)
splashDamageFalloff?: boolean;  // Damage skaliert mit Distanz (Default: true)
```

**Trail-Particle-Konfiguration** (`TrailParticleConfig`, in `projectile-types.config.ts`):

| Feld | Beschreibung |
|------|--------------|
| `enabled` | Trail aktiv |
| `spawnChance` | 0–1 Wahrscheinlichkeit pro Frame |
| `countPerSpawn` | Partikel pro Spawn-Event |
| `colorMin` / `colorMax` | RGB 0–1 — random in dem Bereich |
| `sizeMin` / `sizeMax` | Größenbereich |
| `lifetimeMin` / `lifetimeMax` | Lebensdauer in Sekunden |
| `velocityX/Y/Z` | Geschwindigkeitsbereich pro Achse |
| `spawnOffset` | Verteilungsradius um Projektil-Mitte |
| `blending` | `'additive'` (Default — Feuer/Glow) oder `'normal'` (Rauch) |
| `trailType` | `'default'` oder `'spiral'` (rotierende Bahn, Arcane Orb) |
| `spiralRadius` / `spiralSpeed` | nur für `'spiral'` |

## Tower-Projektil-Verknüpfung

Definiert in `tower-types.config.ts`:

```typescript
archer:           { projectileType: 'arrow' }
cannon:           { projectileType: 'cannonball' }
magic:            { projectileType: 'arcane-orb' }
'dual-gatling':   { projectileType: 'bullet' }     // alterniert zw. firePoints
rocket:           { projectileType: 'rocket' }
ice:              { projectileType: 'ice-shard' }
fire:             { projectileType: 'arrow',    attackType: 'beam' }    // Beam-Tower, kein Projektil
tentacle:         { projectileType: 'arrow',    attackType: 'melee' }   // Melee-Tower, kein Projektil
poison:           { projectileType: 'poison-glob' }
lightning:        { projectileType: 'arrow',    attackType: 'chain' }   // Chain-Tower, kein Projektil
'research-center':{ projectileType: 'arrow',    attackType: 'passive' } // Passive Building, kein Combat
```

## Sound

Jeder Projektiltyp hat eigene Sound-Konfiguration in `PROJECTILE_SOUNDS`:

| Projektil | Sound-Datei | Volume | refDistance |
|-----------|-------------|--------|------------|
| arrow | `/assets/sounds/towers/archer/shoot.mp3` | 0.5 | 50 |
| cannonball | `/assets/sounds/towers/cannon/shoot.mp3` | 0.6 | 70 |
| arcane-orb | `/assets/sounds/towers/magic/cast.mp3` | 0.45 | 55 |
| ice-shard | `/assets/sounds/towers/ice/cast.mp3` | 0.4 | 50 |
| bullet | `/assets/sounds/towers/gatling/shoot.mp3` | 0.25 | 40 |
| rocket | `/assets/sounds/towers/rocket/launch.mp3` | 0.7 | 60 |
| poison-glob | `/assets/sounds/towers/poison/poison_spit.mp3` | 0.4 | 50 |

Sounds werden als Events ueber den `GameEventBus` emittiert (`audio:play`), nicht direkt abgespielt.

## Visuelle Effekte

Implementiert in `three-effects.renderer.ts`, gesteuert ueber `vfx.service.ts` (Event-basiert):

### Blood Splatter (Partikel)
- Standard: 20 Partikel (konfigurierbar via `count` Parameter)
- Intensity-basiert (VFX Service bestimmt Count)
- Partikel fallen nach unten (Gravitation)

### Blood Decals (Bodenflecken)
- Standard: 1.0m Durchmesser (konfigurierbar via `size` Parameter)
- Intensity >= 10: 0.8m, Intensity >= 30: 2.0m (via VFX Service)
- Faden nach 20s aus (ueber 10s)
- Max 100 Decals gleichzeitig

### Projektil-Impact-Effekte
- Rockets: Grosse Explosion (50 Partikel)
- Cannonball: Mittlere Explosion (35 Partikel)
- Bullet: Minimaler Impact (2 Partikel)
- Poison: Kleiner Impact (6 Partikel)
- Arcane Orb (Magic): Violett-cyanfarbener Funken-Burst (14 runde Partikel, `spawnArcaneBurstAtGeo`, gleiche Bewegung wie der Ice-Burst, keine Feuer-Atlas-Explosion)
- Ice-Shard: Kleine Explosion (8 Partikel)
- Arrow: Kein Impact-Effekt

### Floating Text
- Zeigt Belohnung bei Kill (+Credits)
- Steigt nach oben und fadet aus
- Max 50 Texte gleichzeitig

## Assets

```
public/assets/
├── models/
│   └── projectiles/
│       └── arrow.glb           # Pfeil-3D-Modell
└── sounds/
    └── towers/
        ├── archer/shoot.mp3    # Pfeil-Sound
        ├── cannon/shoot.mp3    # Kanonen-Sound
        ├── magic/cast.mp3      # Arcane-Orb-Sound
        ├── ice/cast.mp3        # Eis-Sound
        ├── gatling/shoot.mp3   # Kugel-Sound
        └── rocket/launch.mp3   # Raketen-Sound
```

## Bekannte Einschränkungen

- [ ] Line-of-Sight Check für Air-Targets fehlt — Tower schießen visuell durch Gebäude auf Air-Units. Ground-LOS existiert bereits via `tower.visibleCells`/`losReady`. Siehe TODO.md.
