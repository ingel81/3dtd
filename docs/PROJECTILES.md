# Projektil-System

**Stand:** 2026-09-15

## Architektur

### Entity: `projectile.entity.ts`
Das Projektil-Entity verwaltet Position, Bewegung und Flugbahn.

**Wichtige Properties:**
- `direction` - Normalisierter Richtungsvektor im lokalen Frame (-X = Ost, +Z = Nord, Meter; Längengrad mit cos(lat) skaliert). Bei Spawn berechnet, bei Homing/Arc-Projektilen alle 3 Sub-Steps neu (`DIRECTION_RECALC_EVERY_N`). Nur Optik (Mesh-Rotation, Schweif), die Bewegung läuft über lat/lon
- `flightHeight` - Aktuelle Flughöhe (interpoliert mit Parabel-Bogen oder linear)
- `flightProgress` - Fortschritt entlang der Flugbahn (0-1)
- `isHoming` - Ob das Projektil zielverfolgend ist (Rockets)
- `hasArcTrajectory` - Ob das Projektil eine Bogenbahn hat (Arrows, Cannonballs)
- `targetLost` - Ob das Ziel während des Flugs gestorben ist

**Wichtige Methoden:**
- `calculateDirectionVector(startPos, startHeight)` - Berechnet normalisierten Richtungsvektor von Start zu Ziel
- `calculateFlightHeight()` - Berechnet Flughöhe (Parabel-Bogen für Arrow/Cannonball, linear für andere)
- `getTargetHeight()` - Gibt Zielhöhe zurück (Enemy-TerrainHeight + heightOffset + gemessene Modellmitte aus `getEnemyAimOffsetY`)
- `updateTowardsTarget(deltaTime)` - Bewegt Projektil Richtung Ziel, gibt `true` bei Treffer zurück
- `calculateArcTangentDirection()` - Berechnet Tangentenrichtung entlang der Parabel für Arc-Projektile

**Distanzberechnung:**
Verwendet `geoDistanceFast()` aus `utils/geo-utils.ts` (schnelle Approximation für kurze Distanzen < 200m).

**Flugbahn-Berechnung:**
```typescript
// Arrow: Leichter Parabel-Bogen (maxArcHeight = min(distance * 0.05, 10))
// Cannonball: Hoher Parabel-Bogen (maxArcHeight = min(distance * 0.15, 25))
const baseHeight = startHeight + (targetHeight - startHeight) * progress;
const arcOffset = maxArcHeight * 4 * progress * (1 - progress);
return baseHeight + arcOffset;

// Homing (Rocket) und andere (Bullet, Arcane-Orb, Ice-Shard, Poison-Glob, Chaos-Orb): Linear
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
- `spawn(tower, targetEnemy, heading?, aimPoint?)` - Erstellt das Projektil (bei `firePoints` versetzt und um `heading` gedreht), legt Instanz und Trail-Streak an, spielt den Sound und emittiert `vfx:muzzle-flash`. `aimPoint` ist das Ziel statt der Gegnerposition, bei einem Körper entlang der Route (Ooze) dessen nächster Punkt
- `spawnShot(origin, originHeight, targetEnemy, typeId, damage, damageType, ...)` - Schuss ohne Tower (der Held, siehe unten): gleiche Flugbahn, Treffer, Trail und Sound, kein Mündungsfeuer
- `playProjectileSound(projectileType, lat, lon, height)` (privat) - Emittiert das `audio:play`-Event, beim Tower an seiner Position, beim Held am Startpunkt des Schusses

**Update:**
- `update(deltaTime)` bewegt die Projektile pro Sub-Step und emittiert bei Treffer `projectile:hit`
  (ist das Ziel schon tot, nur bei Splash) und `vfx:projectile-impact`
- `presentFrame()` schiebt Position, Rotation, Trail-Partikel und Streak einmal pro gerendertem
  Frame an den Renderer
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
| Chaos | 500 |
| Shell (Explosive rounds des Helden) | 100 |

Ist ein Pool voll, bleibt ein neues Projektil unsichtbar (`add()` findet keinen Slot), die
Simulation läuft trotzdem. `commitToGPU()` lädt einmal pro Frame nur den gezeichneten Bereich der
Instanz-Matrizen hoch (`addUpdateRange(0, activeCount * 16)`), nicht den ganzen Puffer.

**Rotation:**
- Verwendet Quaternion: `setFromUnitVectors(+Y, direction)`
- Dreht das Modell von +Y Richtung zur Zielrichtung
- Bei regulären Projektilen nur bei Spawn gesetzt
- Bei Homing/Arc-Projektilen jeden Frame aktualisiert

## Konfiguration: `projectile-types.config.ts`

| Typ | Speed | Scale | Visual Type | Splash | Trail |
|-----|-------|-------|-------------|--------|-------|
| arrow | 80 m/s | 8 | arrow (GLB Model) | - | - |
| cannonball | 50 m/s | 0.5 | cannonball (Sphere) | 6m, max. 8 Ziele | Grauer Rauch (normal blending) |
| arcane-orb | 100 m/s | 0.4 | magic (Shader Orb) | - | Violett-Cyan-Funken als Spirale (additive, `trailType: 'spiral'`) |
| ice-shard | 90 m/s | 0.4 | ice (Shader Orb) | 8m | Eis-Partikel (additive) |
| bullet | 150 m/s | 0.15 | bullet (Cylinder) | - | Gelber Tracer (additive) |
| rocket | 120 m/s | 1.0 | rocket (Merged Mesh) | - | Dünne graue Rauchspur (normal blending), Düsenglühen als kurzer Streak |
| poison-glob | 70 m/s | 0.5 | poison (Shader Orb) | 8m | Grüne Partikel (additive) |
| chaos-orb | 90 m/s | 0.4 | chaos (Shader Orb) | - | Schwarz-violette Rauchspur (normal blending), kein Streak |
| hero-round | 180 m/s | 0.12 | bullet (Cylinder) | - | Goldener Tracer, ein Partikel je Tor (additive). Standard rounds des Helden |
| hero-shell | 140 m/s | 0.15 | shell (Cylinder) | - (Explosion nur Optik) | Orange-roter Tracer, dünner Rauch (normal blending). Explosive rounds des Helden |
| hero-rune | 120 m/s | 0.16 | magic (Shader Orb) | - | Violett-Cyan-Funken ohne Spirale (additive). Rune rounds des Helden |

**Visuelle Typen** (`ProjectileVisualType`):
- `arrow` - GLB-Modell aus `/assets/models/projectiles/arrow.glb`
- `cannonball` - SphereGeometry, dunkelgrau metallisch
- `magic` - SphereGeometry mit ShaderMaterial (Arcane Orb: violetter Körper, cyanfarbene Zellen und Rand, Custom GLSL Shader)
- `ice` - SphereGeometry mit ShaderMaterial (blau/cyan/weiß Orb, gleicher Shader wie magic mit anderen Farben)
- `bullet` - CylinderGeometry, gelb/golden leuchtend
- `rocket` - `createRocketGeometry()`: Düse, Körper, Nasenkegel und 4 Finnen zu einer Geometrie gemergt, Teilfarben als Vertex-Farben (weißer Körper, rote Nase und Finnen, dunkle Düse). 4,2 m lang, 1,6 m Finnenspannweite, zentriert auf die Projektilposition, weiterhin 1 Draw Call für alle Raketen
- `poison` - SphereGeometry mit ShaderMaterial (grün)
- `chaos` - SphereGeometry mit dem Orb-Shader, fast schwarzer Kern mit violetten und magenta Highlights (additive: der dunkle Kern fällt weg, das Schwarz kommt aus der Rauchspur)
- `shell` - CylinderGeometry wie `bullet`, orange-rot leuchtend; die Explosive rounds des Helden ([HERO.md](HERO.md))

Die Schüsse des Helden sind Projektile ohne Tower: `ProjectileManager.spawnShot`,
`sourceTowerType` ist `null`, `sourceTowerId` ist `hero`. Splash eines solchen Schusses
träfe Boden und Luft; seine drei Typen haben keinen. Auf einen Körper entlang der Route
(die Ooze) fliegt er wie ein Tower-Schuss zum `aimPoint`, dem nächsten Körperpunkt.

**Schweif-Ansatz** (`tailOffset`, optional): Meter hinter der Mesh-Mitte, an denen Trail-Partikel
und Trail-Streak ansetzen. Rakete: 2,1 m, also die Düse. Nur Optik, Default 0 (Mitte).

**Trail-Streak-Länge** (`length` in `TRAIL_STYLES`, `trail-streak.renderer.ts`): Meter hinter
dem Kopf, dort wird der Streak abgeschnitten. Rakete 6 m, Pfeil 17 m, Bullet 17,5 m, Arcane Orb
32 m, Ice Shard 25,5 m, Kanonenkugel 9 m, Shell (Explosive rounds des Helden) 14 m; Standard und
Rune rounds des Helden nehmen die Streaks von `bullet` und `magic`. Bis 2026-09-12 bestand er aus
einer festen Zahl von Positionen, eine pro gerendertem Frame, und wurde bei 30 FPS oder
2x-Spielgeschwindigkeit doppelt, bei 4x viermal so lang. Poison-Glob und Chaos-Orb haben keinen
Streak: `TrailStreakRenderer.initPools()` legt nur für `rocket`, `arrow`, `magic`, `ice`,
`cannonball`, `bullet` und `shell` einen Pool an.

**Splash-Damage-Konfiguration:**
```typescript
splashRadius?: number;          // Radius in Metern (0 oder undefined = kein Splash)
splashDamageFalloff?: boolean;  // Damage skaliert mit Distanz (Default: true)
splashMaxTargets?: number;      // Höchstens so viele Splash-Opfer, die nächsten zuerst (Default: alle)
```

Splash trifft nur Ziele, die der Quell-Tower auch anvisieren darf (`Projectile.sourceTowerType`,
Air über `canTargetAirEffective` inkl. Forschung, Boden über `canTargetGround`). Cannon- und
Poison-Splash lassen Flieger also aus, Ice-Splash trifft beide Ebenen.

**Trail-Particle-Konfiguration** (`TrailParticleConfig`, in `projectile-types.config.ts`):

| Feld | Beschreibung |
|------|--------------|
| `enabled` | Trail aktiv |
| `spawnChance` | 0–1 Wahrscheinlichkeit pro Frame |
| `countPerSpawn` | Partikel pro Spawn-Event |
| `colorMin` / `colorMax` | RGB 0–1, zufällig in diesem Bereich |
| `sizeMin` / `sizeMax` | Größenbereich |
| `lifetimeMin` / `lifetimeMax` | Lebensdauer in Sekunden |
| `velocityX/Y/Z` | Geschwindigkeitsbereich pro Achse |
| `spawnOffset` | Verteilungsradius um Projektil-Mitte |
| `blending` | `'additive'` (Default, Feuer/Glow) oder `'normal'` (Rauch) |
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
chaos:            { projectileType: 'chaos-orb' }
'research-center':{ projectileType: 'arrow',    attackType: 'passive' } // Passive Building, kein Combat
'missile-silo':   { projectileType: 'arrow',    attackType: 'passive' } // Passive Building, kein Combat
```

## Sound

Jeder Projektiltyp hat eigene Sound-Konfiguration in `PROJECTILE_SOUNDS`
(`projectile-types.config.ts`). Diese Tabelle ist die einzige Liste der Projektil-Sounds;
[SPATIAL_AUDIO.md](SPATIAL_AUDIO.md) und [TOWER_CREATION.md](TOWER_CREATION.md) verweisen
hierher.

| Projektil | Sound-Datei | Volume | refDistance | rolloffFactor |
|-----------|-------------|--------|------------|---------------|
| arrow | `assets/sounds/towers/archer/shoot.mp3` | 0.5 | 50 | 1 |
| cannonball | `assets/sounds/towers/cannon/shoot.mp3` | 0.6 | 70 | 1 |
| arcane-orb | `assets/sounds/towers/magic/cast.mp3` | 0.45 | 55 | 1.1 |
| ice-shard | `assets/sounds/towers/ice/cast.mp3` | 0.4 | 50 | 1 |
| bullet | `assets/sounds/towers/gatling/shoot.mp3` | 0.25 | 40 | 1.2 |
| rocket | `assets/sounds/towers/rocket/launch.mp3` | 0.7 | 60 | 1 |
| poison-glob | `assets/sounds/towers/poison/poison_spit.mp3` | 0.4 | 50 | 1 |
| chaos-orb | `assets/sounds/towers/chaos/cast.mp3` | 0.5 | 55 | 1.1 |
| hero-round | `assets/sounds/hero/round_shot.mp3` | 0.22 | 35 | 1.2 |
| hero-shell | `assets/sounds/hero/shell_shot.mp3` | 0.3 | 40 | 1.2 |
| hero-rune | `assets/sounds/hero/rune_shot.mp3` | 0.3 | 40 | 1.2 |

Der `ProjectileManager` registriert jeden Eintrag beim `SpatialAudioManager` mit
`minIntervalMs: 10` und `maxInstances: 12` und spielt ihn beim Schuss über ein
`audio:play`-Event (deferred) an der Tower-Position, beim Held am Startpunkt des Schusses.
`PROJECTILE_SOUND_IDS` in `audio.config.ts` muss genau diese Schlüssel enthalten, sonst
zählt ein Sound nicht gegen das Projektil-Budget; `projectile-types.config.spec.ts` prüft
das. Budget und Abspielweg: [SPATIAL_AUDIO.md](SPATIAL_AUDIO.md#sound-budget-system).

## Visuelle Effekte

Einschläge, Blut, Decals und Floating Text beschreibt
[PARTICLE_SYSTEM.md](PARTICLE_SYSTEM.md): Explosion je Projektiltyp unter
[Explosionen](PARTICLE_SYSTEM.md#explosionen-feuer-atlas-zweistufig), welches Event welchen
Effekt auslöst unter [VFXService](PARTICLE_SYSTEM.md#vfxservice-event-bridge), die
Trail-Partikel unter [Konfiguration](PARTICLE_SYSTEM.md#konfiguration).

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
        ├── poison/poison_spit.mp3  # Gift-Sound
        └── rocket/launch.mp3   # Raketen-Sound
```

## Bekannte Einschränkungen

- [x] Raketen-Sound (2026-09-23 ersetzt durch ein mit ElevenLabs erzeugtes Abschuss-Zischen, Sound-Paket E22,
  im Spiel nachzuhören). Vorher: `rocket/launch.mp3` war ein tiefer Knall (87 % der Energie unter 150 Hz,
  spektraler Schwerpunkt ~200 Hz), fast wie `cannon/shoot.mp3`. Pitch oder Filter machen
  daraus kein Zischen, weil der Datei die Höhen fehlen. Gesucht ist ein CC0-Asset:
  Zischen/Fauchen mit Schwerpunkt 1-6 kHz, Attack unter 20 ms, 0,6-0,9 s, optional ein kurzer
  tiefer Anteil nur in den ersten ~80 ms, ca. -16 bis -14 LUFS, Peak ≤ -1 dBFS, mono. Es ersetzt
  die Datei am selben Pfad, danach `volume` (heute 0.7) gegen die anderen Tower abgleichen.

