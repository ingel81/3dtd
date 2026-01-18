# Spatial Audio System

## Übersicht

Das Spatial Audio System verwendet Three.js Audio (Web Audio API) für positionsabhängige Sounds.
Sounds werden leiser je weiter die Kamera entfernt ist - ohne harten Cutoff.

## Architektur

```
ThreeTilesEngine
    └── spatialAudio: SpatialAudioManager
            ├── AudioListener (an Kamera)
            ├── activeSounds[] (One-Shots)
            ├── activeLoops Map (Loops)
            ├── audioPool[] (PositionalAudio Pool)
            └── bufferCache Map (LRU Cache)

GameObject (Enemy, Tower, ...)
    └── AudioComponent (dünner Wrapper)
            └── loopHandles Map → delegiert an SpatialAudioManager
```

### SpatialAudioManager (`managers/spatial-audio.manager.ts`)

Zentrale Klasse für 3D-Audio. Verwaltet sowohl One-Shot-Sounds als auch Loops.

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

**One-Shot Sounds abspielen:**
```typescript
// Mit lokalen Koordinaten (THREE.Vector3)
spatialAudio.playAt('arrow', position);

// Mit Geo-Koordinaten
spatialAudio.playAtGeo('arrow', lat, lon, height);

// Globaler Sound (keine Position)
spatialAudio.playGlobal('music');
```

**Loop Sounds (zentral verwaltet):**
```typescript
// Loop erstellen - gibt Handle zurück
const handle = await spatialAudio.createLoop('zombie_walk', position, {
  volumeMultiplier: 1.0,
  randomStart: true,
});

// Position aktualisieren (inkl. automatisches Distance-Culling)
spatialAudio.updateLoopPosition(handle, newPosition);

// Manuell pausieren/fortsetzen
spatialAudio.pauseLoop(handle);
spatialAudio.resumeLoop(handle);  // false wenn Budget erschöpft

// Loop stoppen
spatialAudio.stopLoop(handle);

// Status abfragen
spatialAudio.isLoopPaused(handle);
```

### AudioComponent (`game-components/audio.component.ts`)

Dünner Wrapper für GameObjects (Enemy, Tower, etc.). Delegiert Loop-Verwaltung an SpatialAudioManager.

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
- `play(id, loop?, volumeMultiplier?)` - Sound abspielen
- `stop(id)` - Sound stoppen
- `stopAll()` - Alle Sounds stoppen
- `update(deltaTime)` - Positionen updaten (automatisch via GameObject)

**Interne Struktur:**
- `loopHandles: Map<string, string>` - Mapping localId → SpatialAudioManager Handle
- Delegiert alle Loop-Operationen an SpatialAudioManager
- Distance-Culling und Enemy-Budget werden zentral verwaltet

## Sound Budget System

Um Performance zu gewährleisten, begrenzt das System die Anzahl gleichzeitiger Enemy-Sounds.

**Konstanten (audio.config.ts):**
```typescript
const AUDIO_LIMITS = {
  maxEnemySounds: 12,
  maxAudibleDistance: 500,  // Sounds pausieren jenseits dieser Distanz
};
const ENEMY_SOUND_PATTERNS = ['zombie', 'tank', 'enemy', 'wallsmasher', ...];
```

**Methoden in SpatialAudioManager:**
```typescript
canPlayEnemySound(): boolean      // Prüfen ob Budget verfügbar
registerEnemySound(): boolean     // Budget reservieren (false wenn voll)
unregisterEnemySound(): void      // Budget freigeben
getEnemySoundStats(): { current, max }
isEnemySound(soundId): boolean    // Pattern-Matching
```

**Automatisches Budget-Management:**
- Bei `createLoop()`: Budget wird sofort reserviert (Race-Condition-sicher)
- Bei Distance-Culling Pause: Budget wird freigegeben
- Bei Resume: Budget wird erneut angefragt (kann fehlschlagen)
- Bei `stopLoop()`: Budget wird freigegeben

## LRU Buffer Cache

Der Buffer-Cache verhindert unbegrenztes Wachstum des Audio-Speichers.

**Konstanten:**
```typescript
private readonly MAX_CACHED_BUFFERS = 20;  // ~20 Sounds max in Memory
```

**Funktionsweise:**
- `bufferAccessOrder[]` trackt Zugriffs-Reihenfolge (älteste zuerst)
- Bei jedem `registerSound()`: URL wird "touched" (ans Ende verschoben)
- Nach dem Laden: `evictOldestBuffers()` entfernt älteste Einträge
- Buffers die gerade laden werden nicht evicted

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
  rolloffFactor?: number;    // Default: 1.5
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
  arrow: { url: '/assets/sounds/arrow_01.mp3', refDistance: 50, volume: 0.5 },
  bullet: { url: '/assets/sounds/gatling_0.mp3', refDistance: 40, volume: 0.25 },
  rocket: { url: '/assets/sounds/rocket_launch.mp3', refDistance: 60, ... },
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

// Abspielen in Enemy.startMoving()
this.audio.play('moving', true);
```

### HQ Damage Sound
```typescript
spatialAudio.registerSound('hq-damage', '/assets/sounds/small_hq_explosion.mp3', {
  refDistance: 40, rolloffFactor: 1, volume: 1.4,
});
spatialAudio.playAtGeo('hq-damage', hqLat, hqLon, hqHeight);
```

## Performance-Optimierungen

### PositionalAudio-Pooling
- **Pool von 20 vorallozierten PositionalAudio-Objekten** (wächst bis max. 50)
- Sowohl One-Shots als auch Loops nutzen den Pool
- Bei Rückgabe: `buffer` und `source` werden auf null gesetzt für sauberen Zustand
- Reduziert Garbage Collection Pressure erheblich

### Zentrale Loop-Verwaltung
- Alle Loops in `SpatialAudioManager.activeLoops` Map
- Distance-Culling zentral in `updateLoopPosition()`
- Enemy-Budget zentral verwaltet (keine doppelte Buchführung)

### LRU Buffer Cache
- Maximal 20 Audio-Buffers im Speicher (~30MB Limit)
- Älteste Buffers werden automatisch evicted
- Verhindert Memory-Wachstum bei vielen verschiedenen Sounds

### Distance-based Culling
- Sounds jenseits von 500m werden automatisch pausiert
- Bei Pause: Enemy-Budget wird freigegeben
- Bei Resume: Budget wird erneut angefragt

### Memory Leak Prevention
- **setTimeout-Referenzen**: Alle Timer werden getrackt und bei Cleanup gecleaned
- **Container-Cleanup**: `stopAll()` entfernt alle Container aus der Scene
- **Audio-Disconnect**: Alle Audio-Nodes werden ordentlich disconnected
- **Pool-Reset**: Buffer/Source werden bei Rückgabe genullt

### Race Condition Fix
- Enemy-Sound-Budget wird SOFORT in `createLoop()` reserviert (vor await-Calls)
- Verhindert Budget-Überschreitung bei parallelen Sound-Anfragen

## Wichtige Hinweise

1. **AudioContext Resume**: Browser blockieren Audio bis zur ersten User-Interaktion.
   Der Manager ruft `resumeContext()` automatisch auf.

2. **Performance**: One-Shots werden nach dem Abspielen automatisch aufgeräumt.
   Loops müssen explizit via `stop()` oder `stopLoop()` beendet werden.

3. **Stereo-Panning**: Three.js AudioListener sorgt automatisch für Stereo-Effekte
   basierend auf der Position relativ zur Kamera.

4. **Sound Budget**: Max. 12 gleichzeitige Enemy-Sounds. Budget wird bei
   Distance-Culling temporär freigegeben.

## Assets

Alle Sound-Dateien befinden sich in:
```
public/assets/sounds/
├── arrow_01.mp3                    # Pfeil-Schuss-Sound
├── gatling_0.mp3                   # Gatling-Schuss-Sound
├── rocket_launch.mp3               # Raketen-Start-Sound
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
// One-Shot
engine.spatialAudio.playAtGeo('explosion', lat, lon, height);

// Loop (über AudioComponent)
this.audio.registerSound('engine', '/assets/sounds/engine.mp3', { loop: true });
this.audio.play('engine', true);
```
