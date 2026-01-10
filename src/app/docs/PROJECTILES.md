# Projektil-System

## Architektur

### Entity: `projectile.entity.ts`
Das Projektil-Entity verwaltet Position, Bewegung und Flugbahn.

**Wichtige Properties:**
- `direction` - Normalisierter Richtungsvektor (einmal bei Spawn berechnet, bleibt fix)
- `flightHeight` - Aktuelle Flughöhe (interpoliert mit Parabel-Bogen)
- `flightProgress` - Fortschritt entlang der Flugbahn (0-1)

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

**Update:**
- Position wird jeden Frame aktualisiert
- Rotation bleibt fix (einmal bei Spawn berechnet)

### Renderer: `three-projectile.renderer.ts`
GPU-Instancing für effizientes Rendering vieler Projektile.

**Arrow-Modell:**
- Geladen aus: `/assets/games/tower-defense/models/arrow_01.glb`
- Modell ist sehr klein (~0.8m), daher Scale: 8
- Fallback auf ConeGeometry falls Modell nicht lädt

**Rotation:**
- Verwendet Quaternion: `setFromUnitVectors(+Y, direction)`
- Dreht das Modell von +Y Richtung zur Zielrichtung
- Rotation wird nur bei Spawn gesetzt, nicht während des Flugs

## Konfiguration: `projectile-types.config.ts`

| Typ | Speed | Scale | Visual |
|-----|-------|-------|--------|
| arrow | 80 m/s | 8 | GLB Model |
| cannonball | 50 m/s | 0.5 | Sphere |
| fireball | 100 m/s | 0.4 | Glowing Sphere |
| ice-shard | 90 m/s | 0.4 | Glowing Sphere |

## Sound

Arrow-Sound: `/assets/games/tower-defense/sounds/arrow_01.mp3`
- Abgespielt bei jedem Schuss
- Volume: 0.3

## Assets

```
public/assets/games/tower-defense/
├── models/
│   └── arrow_01.glb      # Pfeil-3D-Modell
└── sounds/
    └── arrow_01.mp3      # Schuss-Sound
```

## Bekannte Einschränkungen

- [ ] Line-of-Sight Check fehlt (Projektile treffen durch Gebäude)
- [ ] Verschiedene Sounds für verschiedene Projektiltypen fehlen
