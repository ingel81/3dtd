# Spatial Audio System

## Übersicht

Das Spatial Audio System verwendet Three.js Audio (Web Audio API) für positionsabhängige Sounds.
Sounds werden leiser je weiter die Kamera entfernt ist - ohne harten Cutoff.

## Architektur

```
ThreeTilesEngine
    └── spatialAudio: SpatialAudioManager
            └── AudioListener (an Kamera)

GameObject (Enemy, Tower, ...)
    └── AudioComponent
            └── verwendet SpatialAudioManager
```

### SpatialAudioManager (`managers/spatial-audio.manager.ts`)

Hauptklasse für 3D-Audio. Nutzt Three.js `AudioListener` und `PositionalAudio`.

**Initialisierung:**
```typescript
// Wird automatisch in ThreeTilesEngine erstellt
this.spatialAudio = new SpatialAudioManager(scene, camera);
this.spatialAudio.setGeoToLocal((lat, lon, h) => sync.geoToLocalSimple(lat, lon, h));
```

**Sound registrieren:**
```typescript
spatialAudio.registerSound('arrow', '/assets/sounds/arrow.mp3', {
  refDistance: 50,    // Volle Lautstärke bei 50m
  rolloffFactor: 1,   // Wie schnell der Sound abklingt
  volume: 0.5,        // Basis-Lautstärke
});
```

**Sound abspielen:**
```typescript
// Mit lokalen Koordinaten (THREE.Vector3)
spatialAudio.playAt('arrow', position);

// Mit Geo-Koordinaten
spatialAudio.playAtGeo('arrow', lat, lon, height);

// Globaler Sound (keine Position)
spatialAudio.playGlobal('music');
```

### AudioComponent (`game-components/audio.component.ts`)

Thin wrapper für GameObjects (Enemy, Tower, etc.). Verwaltet Sounds pro Entity.

**Verwendung in Entities:**
```typescript
// In Entity-Konstruktor
this._audio = this.addComponent(new AudioComponent(this), ComponentType.AUDIO);
this._audio.registerSound('moving', '/sounds/footsteps.mp3', {
  volume: 0.3,
  loop: true,
  refDistance: 30,
  randomStart: true,
});

// Initialisierung (durch Manager)
enemy.audio.initialize(tilesEngine.spatialAudio);

// Abspielen
enemy.audio.play('moving', true);  // Loop
enemy.audio.stop('moving');
```

**Features:**
- Sounds werden im Konstruktor registriert, später initialisiert
- Loop-Sounds folgen automatisch der GameObject-Position
- Cleanup bei destroy()

## Distanz-Modelle

| Modell | Beschreibung |
|--------|--------------|
| `inverse` | Standard. Natürliche Abschwächung (1/distance) |
| `linear` | Lineare Abschwächung bis maxDistance |
| `exponential` | Schnellere Abschwächung |

**Formel (inverse):**
```
volume = refDistance / (refDistance + rolloffFactor * (distance - refDistance))
```

## Konfiguration

```typescript
interface SpatialSoundConfig {
  refDistance?: number;      // Default: 50m
  rolloffFactor?: number;    // Default: 1
  maxDistance?: number;      // Default: 0 (kein Limit)
  distanceModel?: 'linear' | 'inverse' | 'exponential';
  volume?: number;           // Default: 1.0
  loop?: boolean;            // Default: false
}
```

## Integration

### Projektil-Sounds (One-Shot)
Der `ProjectileManager` spielt Sounds direkt über SpatialAudioManager:

```typescript
// In projectile.manager.ts
const PROJECTILE_SOUNDS = {
  arrow: {
    url: '/assets/games/tower-defense/sounds/arrow_01.mp3',
    refDistance: 50,
    volume: 0.5,
  },
};

// Sound wird bei spawn() automatisch abgespielt
this.tilesEngine.spatialAudio.playAtGeo('arrow', tower.lat, tower.lon, height);
```

### Enemy-Sounds (Loop)
Der `EnemyManager` initialisiert AudioComponent bei spawn():

```typescript
// In enemy.manager.ts spawn()
enemy.audio.initialize(this.tilesEngine.spatialAudio);

// Sound-Definition in enemy-types.ts
zombie: {
  movingSound: '/assets/sounds/zombie-sound.mp3',
  movingSoundVolume: 0.4,
  randomSoundStart: true,
}

// Abspielen in Enemy.startMoving()
this.audio.play('moving', true);
```

## Wichtige Hinweise

1. **AudioContext Resume**: Browser blockieren Audio bis zur ersten User-Interaktion.
   Der Manager ruft `resumeContext()` automatisch auf.

2. **Performance**: Sounds werden nach dem Abspielen automatisch aufgeräumt.
   Für Loops muss `stop()` manuell aufgerufen werden.

3. **Stereo-Panning**: Three.js AudioListener sorgt automatisch für Stereo-Effekte
   basierend auf der Position relativ zur Kamera.

## Assets

```
public/assets/games/tower-defense/
└── sounds/
    └── arrow_01.mp3      # Pfeil-Schuss-Sound
```

## Beispiel: Neuen Sound hinzufügen

1. Sound-Datei in `public/assets/games/tower-defense/sounds/` ablegen

2. Sound registrieren (z.B. in einem Manager):
```typescript
engine.spatialAudio.registerSound('explosion', '/assets/games/tower-defense/sounds/explosion.mp3', {
  refDistance: 100,
  rolloffFactor: 0.5,
  volume: 0.8,
});
```

3. Sound abspielen:
```typescript
engine.spatialAudio.playAtGeo('explosion', enemy.position.lat, enemy.position.lon, height);
```
