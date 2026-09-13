# Spatial Audio System

## Übersicht

Das Spatial Audio System verwendet Three.js Audio (Web Audio API) für positionsabhängige Sounds.
Sounds werden leiser je weiter die Kamera entfernt ist - ohne harten Cutoff.

## Architektur

```
ThreeTilesEngine
    └── spatialAudio: SpatialAudioManager  (Facade)
            ├── AudioListener (an Kamera)
            ├── pool: AudioPoolManager           (PositionalAudio Lifecycle, Panner-Updates)
            ├── bufferCache: AudioBufferCache    (LRU Cache, 50 Buffers)
            ├── playback: SpatialAudioPlayback   (playAt, playAtGeo, playGlobal, One-Shots,
            │                                     Projektil-Budget, Voice-Stealing)
            ├── loops: SpatialAudioLoops         (Loops per Handle, zentral verwaltet)
            └── enemyBudget: EnemySoundBudget    (Zähler für Enemy-Sounds, nur Loops)

GameObject (Enemy, Tower, ...)
    └── AudioComponent (dünner Wrapper)
            └── loopHandles Map → delegiert an SpatialAudioManager
```

### SpatialAudioManager (`managers/audio/spatial-audio.manager.ts`)

Facade-Klasse fuer 3D-Audio. Delegiert an fünf Helper:

- `AudioBufferCache` (`audio-buffer-cache.ts`): LRU-Cache, Buffer-Loading.
- `AudioPoolManager` (`audio-pool.manager.ts`): `PositionalAudio` erzeugen und
  aufräumen, Panner-Updates.
- `SpatialAudioPlayback` (`spatial-audio-playback.ts`): `playAt`, `playAtGeo`,
  `playGlobal`, One-Shot-Verwaltung, Anti-Flood-Fenster, Polyphony-Caps,
  Projektil-Budget, Voice-Stealing.
- `SpatialAudioLoops` (`spatial-audio-loops.ts`): Loops per Handle, Pausieren
  außerhalb der Hörweite, Enemy-Budget pro Loop.
- `EnemySoundBudget` (`enemy-sound-budget.ts`): Obergrenze gleichzeitig hörbarer
  Enemy-Sounds.

Die Manager-Klasse selbst kümmert sich um: Sound-Registrierung, Master-Bus und
Master-Lautstärke, Context-Recovery, EventBus-Wiring.

**Master-Bus:** Der Konstruktor hängt `listener.gain` um:
`listener.gain → preGain (0,6, etwa −4,4 dB) → DynamicsCompressor → destination`
(Threshold −6 dB, Knee 6, Ratio 12, Attack 1 ms, Release 100 ms). Ohne ihn summieren
sich gleichzeitige Sounds über ±1 und Web Audio clippt hart. Die Hintergrundmusik
hängt am selben Listener und läuft durch denselben Bus, das Main Theme
(`HTMLAudioElement`) nicht. `setMasterVolume(0..1)` gilt für neue One-Shots und
sofort für laufende Loops.

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
- `update(deltaTime)` - Loop-Positionen nachführen, ohne Loop ein No-op. Läuft über
  `GameObject.update()`; der `EnemyManager` ruft es direkt und nur für Gegner mit
  `hasAudioLoops`, das die Komponente über `LoopFlagSink` aktuell hält

**Interne Struktur:**
- `loopHandles: Map<string, string>` - Mapping localId → SpatialAudioManager Handle
- Delegiert alle Loop-Operationen an SpatialAudioManager
- Distance-Culling und Enemy-Budget werden zentral verwaltet

## Sound Budget System

Um Performance und Audio-Klarheit zu gewährleisten, begrenzt das System die Anzahl
gleichzeitiger Enemy-Loops, Projektil-One-Shots und One-Shots insgesamt (`playAt`,
`playAtGeo`). `playGlobal()` läuft an allen Budgets vorbei.

**Konstanten (`configs/audio.config.ts`):**
```typescript
export const AUDIO_LIMITS = {
  maxEnemySounds: 12,           // Loop-only Budget fuer Enemy-Ambient (walk/roar)
  maxProjectileSounds: 25,      // Per-Kategorie-Cap fuer Projektil-Class One-Shots
  maxConcurrentOneShots: 30,    // Cap über alle One-Shots. Bei Überschreitung stoppt
                                // Voice-Stealing den ältesten One-Shot (weicher als Reject).
  maxEffectSounds: 10,          // wird derzeit nirgends gelesen
  maxAudibleDistance: 500,      // Sounds pausieren jenseits dieser Distanz
} as const;

export const ENEMY_SOUND_PATTERNS = [
  'zombie', 'tank', 'enemy', 'wallsmasher', 'big_arm', 'herbert', 'mammouth',
] as const;

export const PROJECTILE_SOUND_IDS = [
  'arrow', 'bullet', 'rocket', 'cannonball', 'ice-shard', 'arcane-orb',
  'chaos-orb', 'poison-glob',
] as const;
```

Per-Sound-Anti-Flood-Fenster und Polyphony-Cap werden zur Laufzeit aus der
Buffer-Dauer abgeleitet (kurze Combat-Samples → locker, lange Spawn-Samples
→ strikt). Override pro Sound via `SpatialSoundConfig.minIntervalMs` /
`maxInstances` beim `registerSound()`. Der `ProjectileManager` registriert alle
Projektil-Sounds mit `minIntervalMs: 10` und `maxInstances: 12`, weil Schuss-Samples bis
etwa 1 s lang sind und die Heuristik sie sonst auf 4 Instanzen begrenzt. Beide Grenzen
zählen pro `AudioBuffer`, nicht pro Sound-ID: eine Datei, die unter vielen IDs
registriert ist (eine pro Gegner oder Tower), teilt sich ein Limit.

Reihenfolge der Prüfungen in `SpatialAudioPlayback.playAt()`: Distanz (über 500 m
verworfen), Anti-Flood, Polyphony-Cap, Projektil-Budget (voll: der neue Sound wird
verworfen), globaler Cap (voll: der älteste One-Shot wird gestoppt).

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
- Bei `createLoop()`: Budget wird sofort reserviert (Race-Condition-sicher). Liegt der
  Punkt schon beim Anlegen jenseits von 500 m, gibt `createLoop()` `null` zurück und
  es entsteht kein Loop.
- Bei Distance-Culling Pause: Budget wird freigegeben
- Bei Resume: Budget wird erneut angefragt (kann fehlschlagen)
- Bei `stopLoop()`: Budget wird freigegeben, sofern der Loop nicht pausiert war

## LRU Buffer Cache

Der Buffer-Cache verhindert unbegrenztes Wachstum des Audio-Speichers.

**Konstanten:**
```typescript
private readonly MAX_CACHED_BUFFERS = 50;  // ~50 Sounds max in Memory
```

**Funktionsweise:**
- Separierte Klasse `AudioBufferCache` (`managers/audio/audio-buffer-cache.ts`)
- Laden mit bis zu drei Wiederholungen im Abstand von 1 s; geräumt wird nach jedem
  abgeschlossenen Laden
- `accessTimestamps: Map<string, number>` trackt Zugriffs-Zeitpunkte (inkrementierender Counter)
- Bei jedem Zugriff: Timestamp wird aktualisiert
- Bei Überschreitung: Ältester Eintrag (niedrigster Timestamp) wird evicted
- Buffers die gerade laden werden nicht evicted

## Hintergrundmusik (BackgroundMusicService)

Hintergrundmusik laeuft separat zu Spatial Audio und ist **nicht-positional**
(globale Lautstaerke), siehe `game-engine/background-music.service.ts`. Details:

- **Two-Channel A/B Crossfade-System** (zwei `THREE.Audio` Kanaele) fuer
  Build- und Wave-Musik, in `MusicMixer` (`game-engine/music-mixer.ts`);
  Laden und Cache der Tracks in `MusicBufferLoader` (`music-buffer-loader.ts`).
  Der Service selbst entscheidet nur, was wann läuft.
- **Phasen-Logik**: `wave:started` crossfadet auf einen Wave-Track, `wave:completed`
  zurück auf einen Build-Track (je 1,5 s, `phaseFadeDuration`), `game:over` fadet aus,
  `game:reset` stoppt sofort.
- **Loop-Crossfade**: 2 s vor Track-Ende (`loopCrossfadeDuration`) startet derselbe
  Track auf dem anderen Kanal mit Crossfade. Das ergibt nahtlose Loops ohne die Lücke
  von nativem `loop: true`.
- **Main Theme**: Wird per statischer `BackgroundMusicService.playMainTheme()`
  via `HTMLAudioElement` schon vor Engine-Init abgespielt. Optionale
  Track-Felder `startOffset` (Startzeit in s) und `loop`. `onLoadingComplete()`
  löst einen **sequenziellen** Übergang aus: Main-Theme langsam ausfaden
  (`mainThemeFadeOutDuration`, 3 s) → Stille (`mainThemeGapDuration`, 0,6 s) →
  Build-Musik einfaden, ohne überlappenden Crossfade. Ist das Main Theme schon zu Ende
  (es läuft mit `loop: false`), folgt nach der Stille direkt die Build-Musik.
- **Track-Auswahl**: `pickRandom()` schliesst den zuletzt gespielten Track aus,
  sodass beim Wechsel ein neuer Track gewaehlt wird.
- **Persistenz**: `td_music_enabled` (localStorage) merkt User-Toggle.
- **Tracks**: `configs/background-music.config.ts` (1 Main, 1 Build, 4 Wave).
  Lautstärke = Track-`volume` (Default 0,5) × `masterVolume` 0,4 × Nutzer-Lautstärke
  (`setVolume`).

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
  distanceModel?: 'linear' | 'inverse' | 'exponential'; // Default: 'inverse'
  volume?: number;           // Default: 1.0
  loop?: boolean;            // Default: false
  minIntervalMs?: number;    // Anti-Flood: -1 = Heuristik aus Buffer-Dauer (5%, 10–80 ms)
  maxInstances?: number;     // Polyphony-Cap: -1 = Heuristik (kurz=8, mittel=4, lang=2)
}
```

Die Defaults stehen in `SPATIAL_AUDIO_DEFAULTS` (`audio.config.ts`). `AudioComponent`
setzt beim Registrieren eigene Werte, wenn nichts angegeben ist: `refDistance` 30,
`rolloffFactor` 1, `volume` 0.5.

## Integration

### Projektil-Sounds (One-Shot)
Der `ProjectileManager` registriert die Sounds aus `PROJECTILE_SOUNDS` (`projectile-types.config.ts`) und emittiert in `spawn()` ein `audio:play`-Event an der Tower-Position. Der `AudioService` empfängt es und spielt den Sound über `SpatialAudioManager.playAtGeo()` ab. `PROJECTILE_SOUND_IDS` in `audio.config.ts` muss genau diese Schlüssel enthalten, sonst zählt ein Sound nicht gegen `maxProjectileSounds`; `projectile-types.config.spec.ts` prüft das.

```typescript
// In projectile-types.config.ts, ein Eintrag pro Projektiltyp
export const PROJECTILE_SOUNDS: Record<ProjectileTypeId, ProjectileSoundConfig> = {
  arrow:         { url: 'assets/sounds/towers/archer/shoot.mp3',       refDistance: 50, rolloffFactor: 1,   volume: 0.5 },
  bullet:        { url: 'assets/sounds/towers/gatling/shoot.mp3',      refDistance: 40, rolloffFactor: 1.2, volume: 0.25 },
  rocket:        { url: 'assets/sounds/towers/rocket/launch.mp3',      refDistance: 60, rolloffFactor: 1,   volume: 0.7 },
  cannonball:    { url: 'assets/sounds/towers/cannon/shoot.mp3',       refDistance: 70, rolloffFactor: 1,   volume: 0.6 },
  'ice-shard':   { url: 'assets/sounds/towers/ice/cast.mp3',           refDistance: 50, rolloffFactor: 1,   volume: 0.4 },
  'arcane-orb':  { url: 'assets/sounds/towers/magic/cast.mp3',         refDistance: 55, rolloffFactor: 1.1, volume: 0.45 },
  'poison-glob': { url: 'assets/sounds/towers/poison/poison_spit.mp3', refDistance: 50, rolloffFactor: 1,   volume: 0.4 },
  'chaos-orb':   { url: 'assets/sounds/towers/magic/cast.mp3',         refDistance: 55, rolloffFactor: 1.1, volume: 0.5 },
};

// ProjectileManager.playProjectileSound(), aufgerufen in spawn()
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

// Sound-Definition in configs/enemy-types.config.ts
zombie: {
  movingSound: 'assets/sounds/enemies/zombie/ambient.mp3',
  movingSoundVolume: 0.4,
  movingSoundRefDistance: 25,
  randomSoundStart: true,
}

// Abspielen in Enemy.startMoving()
this.audio.play('moving', true);
```

### Ooze-Sounds (Loop am Körper, One-Shots in Spielzeit)
Die Ooze hat kein Modell und keinen `movingSound`. Ihre Sounds spielt `OozeSounds`
(`managers/ooze-sounds.ts`), angetrieben von `OozeBodies`; Werte in `OOZE_SOUNDS`
(`audio.config.ts`).

- **Synthese:** `utils/ooze-sound.ts` erzeugt Blubber-Loop (3 s, Ende läuft nahtlos in den
  Anfang), Splat (0,9 s) und Schlürfen (1,1 s) mit festem Seed als WAV-Data-URL
  (`utils/pcm-wav.ts`, derselbe Schreiber wie die UI-Töne in `alert-tone.ts`). Erzeugt und
  registriert beim ersten Spawn einer Ooze, danach gecacht.
- **Loop:** `createLoop('ooze_bubble', …)` je Ooze. `presentFrame` setzt ihn einmal pro Frame
  auf den Punkt des Körpers, der dem Listener am nächsten ist (`RouteBody.nearest`), am
  Boden. Liegt der Punkt beim Start weiter als 500 m weg, startet der Loop erst, wenn er in
  Hörweite kommt. Die ID passt auf kein `ENEMY_SOUND_PATTERNS`: Der Loop zählt nicht zum
  Enemy-Budget, zwölf Zombies können den Boss nicht stumm schalten.
- **Pause:** `GameStateManager` meldet Pause und Weiterspielen über
  `EnemyManager.holdSounds()`; die Ooze-Loops pausieren und laufen danach weiter. Die Loops
  anderer Gegner und der Flammen laufen in der Pause weiter wie bisher.
- **One-Shots:** Splat beim Kill am Körperpunkt nächst dem Listener, Schlürfen alle 3 m
  Körper, die in die HQ fließen (der erste Meter sofort). Beide gehen als `audio:play`
  (deferred) aus dem Sub-Step, also in Spielzeit: In der Pause kommt nichts, bei hoher
  Spielgeschwindigkeit begrenzt `minIntervalMs: 600` (Wandzeit) das Schlürfen.

### HQ Damage Sound
`HQDamageService.initialize()` registriert `GAME_SOUNDS.hqDamage` (`audio.config.ts`)
und emittiert bei `health:changed` mit negativem `delta` ein `audio:play`-Event an der
Basis, höchstens alle 150 ms (`DAMAGE_SOUND_COOLDOWN`).
```typescript
spatialAudio.registerSound('hq_damage', 'assets/sounds/effects/explosion.mp3', {
  refDistance: 40, rolloffFactor: 1, volume: 1.4,
});
eventBus.emitDeferred({ type: 'audio:play', sound: 'hq_damage', lat, lon, height });
```

## Performance-Optimierungen

### PositionalAudio-Erzeugung
- **PositionalAudio-Pooling ist deaktiviert** - Three.js Audio-Objekte unterstützen kein zuverlässiges Reuse nach Play/Stop-Zyklen
- Stattdessen werden immer frische PositionalAudio-Objekte erzeugt (sie sind lightweight)
- Bei Cleanup: `disconnect()` und Entfernung aus Parent für saubere Freigabe

### Zentrale Loop-Verwaltung
- Alle Loops in `SpatialAudioLoops` (Handle → Loop), erreichbar über `SpatialAudioManager`
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
- `AudioComponent.play()` hält pro Loop-ID ein Token, solange `createLoop()`
  noch läuft. `stop()`, `stopAll()`, `onDestroy()` und ein neueres `play()`
  derselben ID machen es ungültig; ein Loop, der danach ankommt, wird sofort
  per `stopLoop()` beendet. Vorher blieb ein Loop, dessen Gegner während des
  Ladens entfernt wurde, ohne Besitzer und spielte dauerhaft.

## Wichtige Hinweise

1. **AudioContext Resume**: Browser blockieren Audio bis zur ersten User-Interaktion.
   Der Manager ruft `resumeContext()` vor jedem Abspielen auf. Wird der Tab wieder
   sichtbar (`visibilitychange`), versucht er ein Resume und entfernt One-Shots, deren
   Cleanup-Timer im Hintergrund-Tab nicht rechtzeitig lief (`revalidateActiveSounds`).

2. **Performance**: One-Shots werden nach dem Abspielen automatisch aufgeräumt.
   Loops müssen explizit via `stop()` oder `stopLoop()` beendet werden.

3. **Stereo-Panning**: Three.js AudioListener sorgt automatisch für Stereo-Effekte
   basierend auf der Position relativ zur Kamera.

4. **Sound Budget**: Max. 12 gleichzeitige Enemy-Sounds, max. 25 Projektil-Sounds,
   max. 30 globale One-Shots. Enemy-Budget wird bei Distance-Culling temporär freigegeben.

## Assets

Sound-Dateien befinden sich unter `public/assets/sounds/` (Auszug — nicht
vollstaendig). Hintergrundmusik liegt separat unter `public/assets/music/`:
```
public/assets/sounds/
├── towers/
│   ├── archer/shoot.mp3               # Pfeil-Schuss-Sound
│   ├── gatling/shoot.mp3              # Gatling-Schuss-Sound
│   ├── rocket/launch.mp3              # Raketen-Start-Sound
│   ├── cannon/shoot.mp3               # Kanonen-Schuss-Sound
│   ├── ice/cast.mp3                   # Eis-Zauber-Sound
│   ├── magic/cast.mp3                 # Magie-Zauber-Sound
│   ├── poison/poison_spit.mp3         # Poison-Glob-Schuss-Sound
│   ├── fire/flame_loop.mp3            # Flammenwerfer-Loop-Sound
│   ├── tentacle/tentacle-01.mp3       # Tentacle-Strike-Sound
│   └── lightning/lightning_chain.mp3  # Lightning-Chain-Sound
├── enemies/
│   ├── zombie/ambient.mp3             # Zombie-Bewegungs-Loop
│   ├── tank/moving.mp3                # Tank-Bewegungs-Loop
│   ├── golem/golem_walk_loop.mp3      # Stone-Golem-Bewegungs-Loop
│   ├── hornet/hornet.mp3              # Hornet-Summ-Loop
│   ├── rat/rat_swarm.mp3              # Ratten-Schwarm-Loop
│   ├── wallsmasher/attack.mp3         # Wallsmasher-Angriff-Sound
│   ├── wallsmasher/spawn.mp3          # Wallsmasher-Spawn-Sound
│   ├── herbert/spawn.mp3              # Herbert-Spawn-Sound
│   ├── herbert/random-01..13.mp3      # Herbert-Random-Sounds
│   ├── mammouth/mammouth01.mp3        # Mammouth-Random-Sound
│   ├── bear/bear01.mp3                # Bear-Random-Sound
│   └── dragon/dragon01.mp3            # Dragon-Random-Sound
└── effects/
    ├── explosion.mp3                  # HQ-Schadens-Sound
    ├── building_placed.mp3            # Tower-Platziert-Sound
    └── building_selled.mp3            # Tower-Verkauft-Sound
```

Ohne Datei, im Code synthetisiert: die UI-Töne (`utils/alert-tone.ts`) und die Ooze-Sounds
(`utils/ooze-sound.ts`), beide als WAV-Data-URL über `utils/pcm-wav.ts`.

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
