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
spatialAudio.registerSound('arrow', '/assets/sounds/towers/archer/shoot.mp3', {
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
this._audio.registerSound('moving', '/assets/sounds/enemies/zombie/ambient.mp3', {
  volume: 0.4,
  loop: true,
  refDistance: 25,
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

Um Performance zu gewährleisten, begrenzt das System die Anzahl gleichzeitiger Enemy- und Projektil-Sounds.

**Konstanten (audio.config.ts):**
```typescript
const AUDIO_LIMITS = {
  maxEnemySounds: 12,
  maxProjectileSounds: 40,
  maxEffectSounds: 10,
  maxAudibleDistance: 500,  // Sounds pausieren jenseits dieser Distanz
};
const ENEMY_SOUND_PATTERNS = ['zombie', 'tank', 'enemy', 'wallsmasher', 'big_arm', 'herbert'];
```

**Methoden in SpatialAudioManager:**
```typescript
canPlayEnemySound(): boolean           // Prüfen ob Enemy-Budget verfügbar
registerEnemySound(): boolean          // Enemy-Budget reservieren (false wenn voll)
unregisterEnemySound(): void           // Enemy-Budget freigeben
getEnemySoundStats(): { current, max } // Enemy-Budget Status
isEnemySound(soundId): boolean         // Pattern-Matching (Enemy)
isProjectileSound(soundId): boolean    // ID-Matching (Projectile)
getProjectileSoundStats(): { current, max } // Projektil-Budget Status
getSoundPoolStats(): SoundPoolStats    // Gesamtstatistik (Debug)
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
private readonly MAX_CACHED_BUFFERS = 50;  // ~50 Sounds max in Memory
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
Der `ProjectileManager` registriert Sounds aus `PROJECTILE_SOUNDS` (definiert in `projectile-types.config.ts`) und emittiert `audio:play` Events via `GameEventBus`. Der `AudioService` empfängt diese Events und spielt die Sounds über `SpatialAudioManager.playAtGeo()` ab.

```typescript
// In projectile-types.config.ts
const PROJECTILE_SOUNDS = {
  arrow: { url: '/assets/sounds/towers/archer/shoot.mp3', refDistance: 50, volume: 0.5 },
  bullet: { url: '/assets/sounds/towers/gatling/shoot.mp3', refDistance: 40, volume: 0.25 },
  rocket: { url: '/assets/sounds/towers/rocket/launch.mp3', refDistance: 60, volume: 0.7 },
  cannonball: { url: '/assets/sounds/towers/cannon/shoot.mp3', refDistance: 70, volume: 0.6 },
  'ice-shard': { url: '/assets/sounds/towers/ice/cast.mp3', refDistance: 50, volume: 0.4 },
};

// Sound wird bei spawn() via Event abgespielt
this.eventBus.emitDeferred({
  type: 'audio:play',
  sound: soundId,
  lat: pos.lat, lon: pos.lon, height,
});
```

### Enemy-Sounds (Loop)
Der `EnemyManager` initialisiert AudioComponent bei spawn():

```typescript
// In enemy.manager.ts spawn()
enemy.audio.initialize(this.tilesEngine.spatialAudio);

// Sound-Definition in enemy-types.ts
zombie: {
  movingSound: '/assets/sounds/enemies/zombie/ambient.mp3',
  movingSoundVolume: 0.4,
  movingSoundRefDistance: 25,
  randomSoundStart: true,
}

// Abspielen in Enemy.startMoving()
this.audio.play('moving', true);
```

### HQ Damage Sound
```typescript
// Konfiguriert in audio.config.ts (GAME_SOUNDS.hqDamage)
spatialAudio.registerSound('hq_damage', '/assets/sounds/effects/explosion.mp3', {
  refDistance: 40, rolloffFactor: 1, volume: 1.4,
});
spatialAudio.playAtGeo('hq_damage', hqLat, hqLon, hqHeight);
```

## Performance-Optimierungen

### PositionalAudio-Erzeugung
- **PositionalAudio-Pooling ist deaktiviert** - Three.js Audio-Objekte unterstützen kein zuverlässiges Reuse nach Play/Stop-Zyklen
- Stattdessen werden immer frische PositionalAudio-Objekte erzeugt (sie sind lightweight)
- Bei Cleanup: `disconnect()` und Entfernung aus Parent für saubere Freigabe

### Zentrale Loop-Verwaltung
- Alle Loops in `SpatialAudioManager.activeLoops` Map
- Distance-Culling zentral in `updateLoopPosition()`
- Enemy-Budget zentral verwaltet (keine doppelte Buchführung)

### LRU Buffer Cache
- Maximal 50 Audio-Buffers im Speicher (Buffers werden per URL geteilt)
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
- **Audio-Cleanup**: PositionalAudio wird bei Rückgabe gestoppt, aus Parent entfernt und disconnected

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

4. **Sound Budget**: Max. 12 gleichzeitige Enemy-Sounds, max. 40 Projektil-Sounds.
   Enemy-Budget wird bei Distance-Culling temporär freigegeben.

## Assets

Alle Sound-Dateien befinden sich in:
```
public/assets/sounds/
├── towers/
│   ├── archer/shoot.mp3            # Pfeil-Schuss-Sound
│   ├── gatling/shoot.mp3           # Gatling-Schuss-Sound
│   ├── rocket/launch.mp3           # Raketen-Start-Sound
│   ├── cannon/shoot.mp3            # Kanonen-Schuss-Sound
│   ├── ice/cast.mp3                # Eis-Zauber-Sound
│   ├── magic/cast.mp3              # Magie-Zauber-Sound
│   └── fire/flame_loop.mp3         # Flammenwerfer-Loop-Sound
├── enemies/
│   ├── zombie/ambient.mp3          # Zombie-Bewegungs-Sound
│   ├── tank/moving.mp3             # Tank-Bewegungs-Sound
│   ├── wallsmasher/attack.mp3      # Wallsmasher-Angriff-Sound
│   ├── wallsmasher/spawn.mp3       # Wallsmasher-Spawn-Sound
│   ├── herbert/spawn.mp3           # Herbert-Spawn-Sound
│   └── herbert/random-01..13.mp3   # Herbert-Random-Sounds
└── effects/
    ├── explosion.mp3               # HQ-Schadens-Sound
    └── building_placed.mp3         # Gebäude-Platziert-Sound
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
