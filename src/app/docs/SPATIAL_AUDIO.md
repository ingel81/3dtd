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
spatialAudio.registerSound('arrow', '/assets/sounds/arrow_01.mp3', {
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
this._audio.registerSound('moving', '/assets/sounds/zombie-sound-2-357976.mp3', {
  volume: 0.4,
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

**Methoden:**
- `registerSound(id, url, options)` - Sound registrieren (vor initialize)
- `initialize(spatialAudio)` - SpatialAudioManager setzen
- `play(id, loop?)` - Sound abspielen
- `stop(id)` - Sound stoppen
- `setVolume(id, volume)` - Lautstärke anpassen
- `stopAll()` - Alle Sounds stoppen
- `destroy()` - Cleanup aller Sounds

**Features:**
- Sounds werden im Konstruktor registriert, später initialisiert
- Loop-Sounds folgen automatisch der GameObject-Position
- Cleanup bei destroy()

## Sound Budget System

Um Performance zu gewährleisten, begrenzt das System die Anzahl gleichzeitiger Enemy-Sounds.

**Konstanten:**
```typescript
const MAX_ENEMY_SOUNDS = 12;  // Max concurrent enemy movement sounds
const ENEMY_SOUND_PATTERNS = ['zombie', 'tank', 'enemy'];
```

**Methoden in SpatialAudioManager:**
```typescript
// Prüfen ob ein Sound abgespielt werden kann
canPlayEnemySound(): boolean

// Sound registrieren (erhöht Zähler)
registerEnemySound(): void

// Sound abmelden (verringert Zähler)
unregisterEnemySound(): void

// Debug-Statistiken
getEnemySoundStats(): { current: number, max: number }
```

**Verwendung:**
Das Budget wird automatisch bei Enemy-Sounds geprüft. Wenn das Maximum erreicht ist,
werden neue Enemy-Sounds nicht abgespielt, bis andere Enemies zerstört werden.

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
    url: '/assets/sounds/arrow_01.mp3',
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
  movingSound: '/assets/sounds/zombie-sound-2-357976.mp3',
  movingSoundVolume: 0.4,
  movingSoundRefDistance: 30,
  randomSoundStart: true,
}

tank: {
  movingSound: '/assets/sounds/tank-moving-143104.mp3',
  movingSoundVolume: 0.3,
  movingSoundRefDistance: 50,
  randomSoundStart: true,
}

// Abspielen in Enemy.startMoving()
this.audio.play('moving', true);
```

### HQ Damage Sound
Der `GameStateManager` spielt einen Sound wenn das HQ Schaden nimmt:

```typescript
// In game-state.manager.ts
// Sound-Registration
spatialAudio.registerSound('hq-damage', '/assets/sounds/small_hq_explosion.mp3', {
  refDistance: 40,
  rolloffFactor: 1,
  volume: 1.4,
});

// Abspielen bei HQ-Schaden
spatialAudio.playAtGeo('hq-damage', hqLat, hqLon, hqHeight);
```

## Performance-Optimierungen

Das Spatial Audio System wurde umfassend optimiert:

### PositionalAudio-Pooling
- **Pool von 20 vorallozierten PositionalAudio-Objekten**
- Reduziert Garbage Collection Pressure erheblich
- Bei 100 Arrow-Sounds/Sekunde: 0 neue Objekte statt 100/s
- Pool wächst dynamisch bis max. 50 Objekte

### Memory Leak Fixes
- **setTimeout-Referenzen**: Alle Timer werden getrackt und bei Cleanup gecleaned
- **Container-Cleanup**: stopAll() entfernt jetzt alle Container aus der Scene
- **Audio-Disconnect**: Alle Audio-Nodes werden ordentlich disconnected
- **Enemy Timer**: Zombie-Timer werden bei destroy() ordentlich gestoppt

### Race Condition Fix
- Enemy-Sound-Budget wird SOFORT registriert (vor await-Calls)
- Verhindert Budget-Überschreitung bei parallelen Sound-Anfragen

### Algorithmus-Optimierungen
- **stop()**: O(n²) → O(n) durch direktes Filtern statt indexOf+splice
- **update()**: Position-Caching bereits optimal (1x Berechnung für alle Loops)

### Error Recovery
- **Retry-Mechanismus**: 3 Versuche bei Buffer-Ladefehlern mit 1s Delay
- Besseres Logging für Debugging

### Code-Vereinheitlichung
- Enemy-Sound-Erkennung zentralisiert in SpatialAudioManager
- Verwendet ENEMY_SOUND_PATTERNS aus audio.config.ts

## Wichtige Hinweise

1. **AudioContext Resume**: Browser blockieren Audio bis zur ersten User-Interaktion.
   Der Manager ruft `resumeContext()` automatisch auf.

2. **Performance**: Sounds werden nach dem Abspielen automatisch aufgeräumt.
   Für Loops muss `stop()` manuell aufgerufen werden.
   PositionalAudio-Objekte werden in einen Pool zurückgelegt für Wiederverwendung.

3. **Stereo-Panning**: Three.js AudioListener sorgt automatisch für Stereo-Effekte
   basierend auf der Position relativ zur Kamera.

4. **Sound Budget**: Max. 12 gleichzeitige Enemy-Sounds zur Performance-Optimierung.
   Budget wird race-condition-safe verwaltet.

## Assets

Alle Sound-Dateien befinden sich in:
```
public/assets/sounds/
├── arrow_01.mp3                    # Pfeil-Schuss-Sound
├── zombie-sound-2-357976.mp3       # Zombie-Bewegungs-Sound
├── tank-moving-143104.mp3          # Tank-Bewegungs-Sound
└── small_hq_explosion.mp3          # HQ-Schadens-Sound
```

## Beispiel: Neuen Sound hinzufügen

1. Sound-Datei in `public/assets/sounds/` ablegen

2. Sound registrieren (z.B. in einem Manager):
```typescript
engine.spatialAudio.registerSound('explosion', '/assets/sounds/explosion.mp3', {
  refDistance: 100,
  rolloffFactor: 0.5,
  volume: 0.8,
});
```

3. Sound abspielen:
```typescript
engine.spatialAudio.playAtGeo('explosion', enemy.position.lat, enemy.position.lon, height);
```
