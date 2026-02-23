# Projektil-System

## Architektur

### Entity: `projectile.entity.ts`
Das Projektil-Entity verwaltet Position, Bewegung und Flugbahn.

**Wichtige Properties:**
- `direction` - Normalisierter Richtungsvektor (bei Spawn berechnet; bei Homing/Arc-Projektilen kontinuierlich aktualisiert)
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

// Homing (Rocket) und andere (Bullet, Fireball, Ice-Shard): Linear
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
- Trail-Partikel werden jeden Frame gespawnt falls konfiguriert

### Renderer: `three-projectile.renderer.ts`
GPU-Instancing für effizientes Rendering vieler Projektile.

**Arrow-Modell:**
- Geladen aus: `/assets/models/projectiles/arrow.glb`
- Modell ist sehr klein (~0.8m), daher Scale: 8
- Fallback auf ConeGeometry falls Modell nicht lädt

**Instancing-Limits:**
| Typ | Max Instanzen |
|-----|---------------|
| Arrow | 500 |
| Cannonball | 200 |
| Magic | 500 |
| Ice | 500 |
| Bullet | 1000 |
| Rocket | 100 |

**Rotation:**
- Verwendet Quaternion: `setFromUnitVectors(+Y, direction)`
- Dreht das Modell von +Y Richtung zur Zielrichtung
- Bei regulären Projektilen nur bei Spawn gesetzt
- Bei Homing/Arc-Projektilen jeden Frame aktualisiert

## Konfiguration: `projectile-types.config.ts`

| Typ | Speed | Scale | Visual Type | Splash | Trail |
|-----|-------|-------|-------------|--------|-------|
| arrow | 80 m/s | 8 | arrow (GLB Model) | - | - |
| cannonball | 50 m/s | 0.5 | cannonball (Sphere) | 10m | Rauch (normal blending) |
| fireball | 100 m/s | 0.4 | magic (Shader Orb) | - | Feuer-Spirale (additive) |
| ice-shard | 90 m/s | 0.4 | ice (Shader Orb) | 12m | Eis-Partikel (additive) |
| bullet | 150 m/s | 0.15 | bullet (Cylinder) | - | Gelber Tracer (additive) |
| rocket | 120 m/s | 1.0 | rocket (Cylinder) | - | Feuer-Exhaust (additive) |

**Visuelle Typen:**
- `arrow` - GLB-Modell aus `/assets/models/projectiles/arrow.glb`
- `cannonball` - SphereGeometry, dunkelgrau metallisch
- `magic` - SphereGeometry mit ShaderMaterial (rot/orange Orb, Custom GLSL Shader)
- `ice` - SphereGeometry mit ShaderMaterial (blau/cyan/weiss Orb, gleicher Shader wie magic mit anderen Farben)
- `bullet` - CylinderGeometry, gelb/golden leuchtend
- `rocket` - CylinderGeometry, weiss/hellgrau

## Tower-Projektil-Verknüpfung

Definiert in `tower-types.config.ts`:

```typescript
archer:       { projectileType: 'arrow' }
cannon:       { projectileType: 'cannonball' }
magic:        { projectileType: 'fireball' }
'dual-gatling': { projectileType: 'bullet' }
rocket:       { projectileType: 'rocket' }
ice:          { projectileType: 'ice-shard' }
fire:         { projectileType: 'fireball', attackType: 'beam' }  // Beam-Tower, kein Projektil
tentacle:     { projectileType: 'arrow', attackType: 'melee' }  // Melee-Tower, kein Projektil
```

## Sound

Jeder Projektiltyp hat eigene Sound-Konfiguration in `PROJECTILE_SOUNDS`:

| Projektil | Sound-Datei | Volume | refDistance |
|-----------|-------------|--------|------------|
| arrow | `/assets/sounds/towers/archer/shoot.mp3` | 0.5 | 50 |
| cannonball | `/assets/sounds/towers/cannon/shoot.mp3` | 0.6 | 70 |
| fireball | `/assets/sounds/towers/magic/cast.mp3` | 0.45 | 55 |
| ice-shard | `/assets/sounds/towers/ice/cast.mp3` | 0.4 | 50 |
| bullet | `/assets/sounds/towers/gatling/shoot.mp3` | 0.25 | 40 |
| rocket | `/assets/sounds/towers/rocket/launch.mp3` | 0.7 | 60 |

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
- Ice/andere: Kleine Explosion (8 Partikel)
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
        ├── magic/cast.mp3      # Feuerball-Sound
        ├── ice/cast.mp3        # Eis-Sound
        ├── gatling/shoot.mp3   # Kugel-Sound
        └── rocket/launch.mp3   # Raketen-Sound
```

## Bekannte Einschränkungen

- [ ] Line-of-Sight Check fehlt (Projektile treffen durch Gebäude)
