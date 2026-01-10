# Projektil-System

## Architektur

### Entity: `projectile.entity.ts`
Das Projektil-Entity verwaltet Position, Bewegung und Flugbahn.

**Wichtige Properties:**
- `direction` - Normalisierter Richtungsvektor (einmal bei Spawn berechnet, bleibt fix)
- `flightHeight` - Aktuelle Flughöhe (interpoliert mit Parabel-Bogen)
- `flightProgress` - Fortschritt entlang der Flugbahn (0-1)

**Wichtige Methoden:**
- `calculateDirectionVector(startPos, startHeight)` - Berechnet normalisierten Richtungsvektor von Start zu Ziel
- `calculateFlightHeight()` - Berechnet Flughöhe mit Parabel-Bogen
- `getTargetHeight()` - Gibt Zielhöhe zurück (Enemy-Position + 3m Kopfhöhe)
- `calculateDistance(pos1, pos2)` - Haversine-Distanzberechnung zwischen zwei Geo-Positionen

**Flugbahn-Berechnung:**
```typescript
// Parabel-Bogen für natürliche Flugbahn
const baseHeight = startHeight + (targetHeight - startHeight) * progress;
const arcOffset = maxArcHeight * 4 * progress * (1 - progress);
return baseHeight + arcOffset;
```

### Manager: `projectile.manager.ts`
Verwaltet Lifecycle und Updates aller Projektile.

**Spawn:**
```typescript
const spawnHeight = terrainHeight + tower.typeConfig.heightOffset + 8;
const projectile = new Projectile(..., spawnHeight);
```

**Wichtige Methoden:**
- `playProjectileSound(tower, projectileType)` - Spielt räumlichen Sound an Tower-Position
- `calculateHeading(from, to)` - Berechnet Heading-Winkel zwischen zwei Positionen

**Update:**
- Position wird jeden Frame aktualisiert
- Rotation bleibt fix (einmal bei Spawn berechnet)

### Renderer: `three-projectile.renderer.ts`
GPU-Instancing für effizientes Rendering vieler Projektile.

**Arrow-Modell:**
- Geladen aus: `/assets/models/arrow_01.glb`
- Modell ist sehr klein (~0.8m), daher Scale: 8
- Fallback auf ConeGeometry falls Modell nicht lädt

**Instancing-Limits:**
| Typ | Max Instanzen |
|-----|---------------|
| Arrow | 500 |
| Cannonball | 200 |
| Magic | 500 |

**Rotation:**
- Verwendet Quaternion: `setFromUnitVectors(+Y, direction)`
- Dreht das Modell von +Y Richtung zur Zielrichtung
- Rotation wird nur bei Spawn gesetzt, nicht während des Flugs

## Konfiguration: `projectile-types.config.ts`

| Typ | Speed | Scale | Visual Type |
|-----|-------|-------|-------------|
| arrow | 80 m/s | 8 | arrow (GLB Model) |
| cannonball | 50 m/s | 0.5 | cannonball (Sphere) |
| fireball | 100 m/s | 0.4 | magic (Glowing Sphere) |
| ice-shard | 90 m/s | 0.4 | magic (Glowing Sphere) |

**Hinweis:** `fireball` und `ice-shard` verwenden beide `visualType: 'magic'` und werden identisch gerendert (Orange glühende Sphäre, Farbe 0xff6600). Es gibt aktuell KEINE visuelle Differenzierung zwischen diesen beiden Projektiltypen.

## Tower-Projektil-Verknüpfung

Definiert in `tower-types.config.ts`:

```typescript
archer: { projectileType: 'arrow' }
cannon: { projectileType: 'cannonball' }
magic:  { projectileType: 'fireball' }
sniper: { projectileType: 'arrow' }
```

## Sound

Arrow-Sound: `/assets/sounds/arrow_01.mp3`
- Abgespielt bei jedem Schuss (wird für alle Projektiltypen verwendet)
- Volume: 0.5
- refDistance: 50 (volle Lautstärke bei 50m)
- rolloffFactor: 1

## Visuelle Effekte

Implementiert in `three-effects.renderer.ts`:

### Blood Splatter (Partikel)
- Bei Treffer: 15 Partikel
- Bei Tod: 40 Partikel
- Partikel fallen nach unten (Gravitation)

### Blood Decals (Bodenflecken)
- Bei Treffer: 0.8m Durchmesser
- Bei Tod: 2.0m Durchmesser
- Faden nach 20s aus (über 10s)
- Max 100 Decals gleichzeitig

### Floating Text
- Zeigt Belohnung bei Kill (+Credits)
- Steigt nach oben und fadet aus
- Max 50 Texte gleichzeitig

## Assets

```
public/assets/
├── models/
│   └── arrow_01.glb      # Pfeil-3D-Modell
└── sounds/
    └── arrow_01.mp3      # Schuss-Sound
```

## Bekannte Einschränkungen

- [ ] Line-of-Sight Check fehlt (Projektile treffen durch Gebäude)
- [ ] Verschiedene Sounds für verschiedene Projektiltypen fehlen
- [ ] Keine visuelle Differenzierung zwischen fireball und ice-shard
