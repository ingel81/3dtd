# Spatial Audio System

## Übersicht

Das Spatial Audio System verwendet Three.js Audio (Web Audio API) für positionsabhängige Sounds.
Sounds werden mit der Entfernung zur Kamera leiser (Distanz-Modell `inverse`). Jenseits der
Hörweite (`maxAudibleDistance` 500 m, für One-Shots je Sound per `audibleDistance` anders)
fallen One-Shots weg und Loops pausieren.

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

Facade-Klasse für 3D-Audio. Delegiert an fünf Helper:

- `AudioBufferCache` (`audio-buffer-cache.ts`): LRU-Cache, Buffer-Loading.
- `AudioPoolManager` (`audio-pool.manager.ts`): `PositionalAudio` erzeugen und
  aufräumen, Panner-Updates.
- `SpatialAudioPlayback` (`spatial-audio-playback.ts`): `playAt`, `playAtGeo`,
  `playGlobal`, One-Shot-Verwaltung, Anti-Flood-Fenster, Polyphony-Caps,
  Projektil-Budget, Voice-Stealing.
- `SpatialAudioLoops` (`spatial-audio-loops.ts`): Loops per Handle, Pausieren
  außerhalb der Hörweite, späterer Einstieg wartender Loops, Enemy-Budget pro Loop.
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

// Mit Lautstärke-Anteil und Abspielrate (0,95: etwas tiefer und länger)
const voice = await spatialAudio.playAt('skarnax_growl_1', position, 0.8, 0.95);
spatialAudio.stopOneShot(voice);  // diesen einen One-Shot sofort beenden

// Mit Geo-Koordinaten
spatialAudio.playAtGeo('arrow', lat, lon, height);

// Globaler Sound (keine Position)
spatialAudio.playGlobal('music');
```

**Loop Sounds (zentral verwaltet):**
```typescript
// Loop erstellen - gibt Handle zurück, auch außer Hörweite oder bei vollem Budget (wartet dann)
const handle = await spatialAudio.createLoop('zombie_walk', position, {
  volumeMultiplier: 1.0,
  randomStart: true,
});

// Position aktualisieren (inkl. Distance-Culling; ein wartender Loop steigt hier ein)
spatialAudio.updateLoopPosition(handle, newPosition);

// Manuell pausieren/fortsetzen
spatialAudio.pauseLoop(handle);
spatialAudio.resumeLoop(handle);  // false wenn Budget erschöpft oder das Spiel pausiert

// Spielpause (GameStateManager): alle Loops stehen, neue warten
spatialAudio.holdLoops(true);
spatialAudio.holdLoops(false);    // Loops in Hörweite laufen weiter

// Lautstärke als Anteil der Sound-Lautstärke (zum Ausblenden, vom Aufrufer gestuft)
spatialAudio.setLoopVolume(handle, 0.5);

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
  maxEnemySounds: 12,           // Loop-only Budget für Enemy-Ambient (walk/roar)
  maxProjectileSounds: 25,      // Per-Kategorie-Cap für Projektil-Class One-Shots
  maxConcurrentOneShots: 30,    // Cap über alle One-Shots. Bei Überschreitung stoppt
                                // Voice-Stealing den ältesten One-Shot ohne `priority`
                                // (weicher als Reject).
  maxAudibleDistance: 500,      // Loops pausieren jenseits dieser Distanz, One-Shots fallen weg
                                // (je Sound überschreibbar: `audibleDistance`)
} as const;

export const ENEMY_SOUND_PATTERNS = [
  'zombie', 'tank', 'enemy', 'wallsmasher', 'big_arm', 'herbert', 'mammouth',
] as const;
```

`PROJECTILE_SOUND_IDS` (ebenfalls `audio.config.ts`) enthält genau die Schlüssel von
`PROJECTILE_SOUNDS`. Die Liste der Projektil-Sounds mit ihren Werten steht nur in
[PROJECTILES.md](PROJECTILES.md#sound).

Per-Sound-Anti-Flood-Fenster und Polyphony-Cap werden zur Laufzeit aus der
Buffer-Dauer abgeleitet (kurze Combat-Samples → locker, lange Spawn-Samples
→ strikt). Override pro Sound via `SpatialSoundConfig.minIntervalMs` /
`maxInstances` beim `registerSound()`. Der `ProjectileManager` registriert alle
Projektil-Sounds mit `minIntervalMs: 10` und `maxInstances: 12`, weil Schuss-Samples bis
etwa 1 s lang sind und die Heuristik sie sonst auf 4 Instanzen begrenzt. Beide Grenzen
zählen pro `AudioBuffer`, nicht pro Sound-ID: eine Datei, die unter vielen IDs
registriert ist (eine pro Gegner oder Tower), teilt sich ein Limit.

Reihenfolge der Prüfungen in `SpatialAudioPlayback.playAt()`: Distanz (über der
`audibleDistance` des Sounds verworfen, Standard 500 m), Anti-Flood, Polyphony-Cap,
Projektil-Budget (voll: der neue Sound wird verworfen), globaler Cap (voll: der älteste
One-Shot ohne `priority` wird gestoppt; haben alle `priority`, der älteste).

**Vorrang und eigene Hörweite.** `priority` ist für die wenigen Sounds, an denen ein
Moment hängt, Stand heute die Stücke des Nuklearschlags. Er landet auf einer großen
Welle, deren Treffer und Tode im selben Sub-Step viele One-Shots starten; ohne Vorrang
wäre sein Knall als ältester One-Shot der erste, den das Voice-Stealing stoppt.
`audibleDistance` gilt nur für One-Shots: Der Nuklearschlag ist bis 1500 m zu hören, so
weit wie sein Shake reicht, der HQ-Schadenston ebenso weit (siehe unten). Loops pausieren
weiter ab `maxAudibleDistance`.

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
- Bei `createLoop()`: Liegt der Punkt in Hörweite, läuft das Spiel und ist ein Slot frei,
  nimmt der Loop ihn und startet. Sonst gibt `createLoop()` trotzdem ein Handle zurück: Der
  Loop wartet pausiert, ohne Slot und ohne `PositionalAudio`, und steigt beim ersten
  `updateLoopPosition()` ein, das ihn in Hörweite findet, während ein Slot frei ist, oder beim
  Fortsetzen (`holdLoops(false)`). `null` gibt es nur für einen unbekannten Sound oder einen
  ohne Buffer.
- Bei Distance-Culling Pause: Budget wird freigegeben
- Bei Resume: Budget wird erneut angefragt (kann fehlschlagen, dann beim nächsten
  Positions-Update wieder). Einen Vorrang für nahe Gegner gibt es nicht: Den freien Slot
  bekommt der Loop, dessen Positions-Update zuerst kommt, bei Gegnern also in der
  Reihenfolge des `EnemyManager`.
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
- Scheitert auch die letzte Wiederholung, bleibt kein Eintrag, und der Sound gilt als nicht
  spielbar. Dieselbe URL lädt frühestens nach `RETRY_COOLDOWN_MS` (30 s) wieder, höchstens
  `MAX_LOAD_ROUNDS` (3) Runden je URL. Gegner registrieren ihre Sounds bei jedem Spawn; die
  Sperre begrenzt, wie oft eine fehlende Datei neu geladen wird
- `accessTimestamps: Map<string, number>` trackt Zugriffs-Zeitpunkte (inkrementierender Counter)
- Bei jedem Zugriff: Timestamp wird aktualisiert
- Bei Überschreitung: Ältester Eintrag (niedrigster Timestamp) wird evicted
- Buffers die gerade laden werden nicht evicted

## Hintergrundmusik (BackgroundMusicService)

Hintergrundmusik läuft separat zu Spatial Audio und ist **nicht-positional**
(globale Lautstärke), siehe `game-engine/background-music.service.ts`. Details:

- **Two-Channel A/B Crossfade-System** (zwei `THREE.Audio` Kanäle) für
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
- **Track-Auswahl**: `pickRandom()` schließt den zuletzt gespielten Track aus,
  sodass beim Wechsel ein neuer Track gewählt wird.
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
  priority?: boolean;        // Default: false. Voice-Stealing nimmt ihn erst, wenn alle ihn haben
  audibleDistance?: number;  // Default: 500 m (AUDIO_LIMITS.maxAudibleDistance), nur One-Shots
}
```

Die Defaults stehen in `SPATIAL_AUDIO_DEFAULTS` (`audio.config.ts`). `AudioComponent`
setzt beim Registrieren eigene Werte, wenn nichts angegeben ist: `refDistance` 30,
`rolloffFactor` 1, `volume` 0.5.

## Integration

### Projektil-Sounds (One-Shot)
Der `ProjectileManager` registriert die Sounds aus `PROJECTILE_SOUNDS` und emittiert beim
Schuss ein `audio:play`-Event, beim Tower an seiner Position. Der `AudioService` empfängt es
und spielt den Sound über `SpatialAudioManager.playAtGeo()` ab. Liste, Werte und die Regel
zu `PROJECTILE_SOUND_IDS`: [PROJECTILES.md](PROJECTILES.md#sound).

```typescript
// ProjectileManager.playProjectileSound(), aufgerufen beim Schuss
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

`play('moving', true)` läuft einmal pro Gegner. Liegt der Gegner dann außer Hörweite oder ist das
Budget voll, wartet sein Loop; `AudioComponent.update()` führt ihn jeden Sub-Step nach, und er
setzt ein, sobald die Kamera in Hörweite ist und ein Slot frei ist. Vorher blieb so ein Gegner
sein ganzes Leben stumm.

### Ooze-Sounds (Loop am Körper, One-Shots in Spielzeit)
Die Ooze hat kein Modell und keinen `movingSound`. Ihre Sounds spielt `OozeSounds`
(`managers/ooze-sounds.ts`), angetrieben von `OozeBodies`; Werte in `OOZE_SOUNDS`
(`audio.config.ts`).

- **Synthese:** `utils/ooze-sound.ts` erzeugt Blubber-Loop (3 s, Ende läuft nahtlos in den
  Anfang), Splat (2,2 s: Aufprall und nasser Burst, dann das Zusammensacken über den
  zweisekündigen Kollaps des Bands mit dunklem Grollen, platzenden Blasen und tiefen
  Gloops; bis 2026-09-14 nur die ersten 0,9 s) und Schlürfen (1,1 s) mit festem Seed als WAV-Data-URL
  (`utils/pcm-wav.ts`, derselbe Schreiber wie die UI-Töne in `alert-tone.ts`). Erzeugt und
  registriert beim ersten Spawn einer Ooze, danach gecacht.
- **Loop:** `createLoop('ooze_bubble', …)` je Ooze. `presentFrame` setzt ihn einmal pro Frame
  auf den Punkt des Körpers, der dem Listener am nächsten ist (`RouteBody.nearest`), am
  Boden. `OozeSounds` fragt den Loop beim ersten Frame an; liegt der Punkt weiter als 500 m weg,
  wartet er in `SpatialAudioLoops` und setzt ein, wenn er in Hörweite kommt. Die ID passt auf kein `ENEMY_SOUND_PATTERNS`: Der Loop zählt nicht zum
  Enemy-Budget, zwölf Zombies können den Boss nicht stumm schalten.
- **Pause:** `GameStateManager` meldet Pause und Weiterspielen über
  `SpatialAudioManager.holdLoops()`. Das gilt für alle Loops, nicht nur die der Ooze: Laufgeräusche
  der Gegner, Flammen und Blubbern stehen. Fährt die Kamera in der Pause an eine Ooze heran, entsteht
  dort noch kein Loop: `presentFrame` und damit `OozeSounds.follow` laufen nur in Frames mit
  mindestens einem Sub-Step (`GameStateManager.update`), in der Pause also nicht. Der Loop entsteht
  mit dem ersten Frame nach dem Fortsetzen. Ein `createLoop`, das erst in der Pause fertig wird (etwa
  weil es beim Pausieren noch lud), wartet ohne Ton bis zum Fortsetzen. Beim Weiterspielen laufen die Loops in Hörweite
  weiter, Gegner-Loops soweit das Budget reicht; die übrigen beim nächsten Positions-Update wie gehabt.
  Boss-Intro und Replay pausieren über denselben Weg (`GameStore.paused`).
- **One-Shots:** Splat beim Kill am Körperpunkt nächst dem Listener (eine Stimme, 2,2 s lang), Schlürfen alle 3 m
  Körper, die in die HQ fließen (der erste Meter sofort). Beide gehen als `audio:play`
  (deferred) aus dem Sub-Step, also in Spielzeit: In der Pause kommt nichts, bei hoher
  Spielgeschwindigkeit begrenzt `minIntervalMs: 600` (Wandzeit) das Schlürfen.

### Skarnax (Stimme am Kopf)
Der Wurm hat keinen `movingSound`: Jedes Segment ist ein Gegner vom Typ `worm`, ein
Loop je Segment hätte das Gegner-Budget allein gefüllt. Seine Stimme spielt `WormSounds`
(`managers/worm/worm-sounds.ts`), angetrieben vom `EnemyManager.presentFrame`; Werte in
`WORM_SOUNDS.voice` (`audio.config.ts`). Seit 2026-09-15 (E18); bis Playtest 733/734 ein
durchgehender Loop von 6 s am Kopf, der zu gleichmäßig klang.

- **Samples:** drei One-Shots, geschnitten aus mit ElevenLabs erzeugten Sounds:
  `skarnax_growl_1` (`growl_1.mp3`, 1,35 s, Knurren), `skarnax_growl_2` (`growl_2.mp3`,
  2 s, tieferes Knurren, setzt aus der Stille ein), `skarnax_clack` (`clack.mp3`, 2 s,
  klackernde Chitinbeine; `gain` 1,5, weil die Datei leiser ist).
- **Takt in Spielzeit:** die erste Stimme 1,5 bis 4 s nach dem Erscheinen des Wurms, danach
  alle 6 bis 15 s. Je Stimme gezogen: das Sample, 75 bis 100 % der Lautstärke, die
  Abspielrate 0,9 bis 1,1 (Tonhöhe, `playAt(…, playbackRate)`) und der Abstand zur nächsten.
  Gezogen aus einem Seed je Wurm (`seeded`, plus `WormGroup.seq`): Derselbe Lauf klingt
  gleich.
- **Ort:** am Kopf, `liftM` (2 m) über dem Boden. Zerfällt der Wurm, läuft jeder Teil mit
  eigenem Kopf; die Stimme kommt vom Kopf, der dem Listener beim Einsatz am nächsten ist. Ein
  zerteilter Wurm bleibt eine Stimme. Der One-Shot bleibt, wo er einsetzte, bis er ausklingt
  (höchstens 2,3 s bei Rate 0,9). Führt gerade kein Kopf (einer starb, der nächste Ring
  führt ab dem nächsten Sub-Step), wartet eine fällige Stimme.
- **Budget:** normale One-Shots ohne `priority`: Anti-Flood, Polyphony-Cap, globaler Cap mit
  Voice-Stealing, Hörweite 500 m, SFX-Lautstärke.
- **Ende:** Ist ein Wurm geschlagen, durch oder entfernt, fehlt er in `WormChains.all`, und
  seine laufende Stimme stoppt im nächsten Frame (`stopOneShot`); `EnemyManager.clear()`
  (Wellenende, Reset) stoppt alle. Eine Stimme, die erst startet, wenn ihr Wurm weg ist,
  stoppt sofort.
- **Pause und Tempo:** Der Takt zählt Spielzeit und läuft aus `presentFrame`, das nur in
  Frames mit Sub-Step läuft: In der Pause kommt keine neue Stimme, eine laufende spielt aus
  (One-Shots kennen keine Pause). Bei 4x kommen die Stimmen in Wanduhrzeit viermal so oft.
  Headless (Training ohne Rendering) keine Stimme.

### HQ Damage Sound
`HQDamageService.initialize()` registriert `GAME_SOUNDS.hqDamage` (`audio.config.ts`)
und emittiert bei `health:changed` mit negativem `delta` ein `audio:play`-Event an der
Basis, höchstens alle 150 ms (`DAMAGE_SOUND_COOLDOWN`). Leck und Debug-Knopf ("+HP",
Rechtsklick) laufen beide über `BaseHealthLedger` und dasselbe `health:changed`.
```typescript
spatialAudio.registerSound('hq_damage', 'assets/sounds/effects/explosion.mp3', {
  refDistance: 40, rolloffFactor: 1, volume: 1.4, audibleDistance: 1500,
});
eventBus.emitDeferred({ type: 'audio:play', sound: 'hq_damage', lat, lon, height });
```
`height` ist der Boden unter der HQ, dieselbe Höhe wie das Feuer dort (gecachte
Terrainhöhe aus `onTilesLoaded()`, sonst Raycast), plus die Höhe des Origins. Bis
2026-09-15 stand dort 0: Die Basis hat keine Höhe, der Ton lag auf dem Ellipsoid, so
tief unter der HQ, wie der Boden dort hoch ist, und fiel an höher gelegenen Orten aus
der Hörweite von 500 m (Playtest 649). Seine Hörweite ist 1500 m wie beim
Nuklearschlag, damit der Treffer auch aus der weiten Übersicht zu hören ist; der Shake
kommt ohnehin überall. Die Abnahme bleibt (`inverse`, `refDistance` 40,
`rolloffFactor` 1): Aus 1000 m kommt er mit 4 % der Lautstärke von 40 m.
Vor dem ersten Tile an der HQ liefern Cache und Raycast nichts; dann bleibt die Höhe 0
(wie beim Feuer).

### Nuklearschlag (synthetisiert, Nachhall in Spielzeit)
`GAME_SOUNDS.nuclearStrike` (`audio.config.ts`), im Code synthetisiert in
`utils/nuke-sound.ts`, registriert und gespielt vom `AudioService` über
`ABILITY_IMPACT_SOUNDS`.

- **Knall** (`nuclear_strike`, 2,4 s) beim `ability:impact`: ein Crack aus einem N-förmigen
  Druckpuls (7 ms), einem Rauschstoß und Knacksern, die über 0,3 s ausdünnen; ein
  Sub-Bass-Boom, Sinus von 70 auf 28 Hz fallend, rund 2 s ausklingend; das Tosen des
  Feuerballs, Rauschen unter einem Tiefpass, der sich von 1,8 kHz auf 150 Hz schließt. Die
  Summe läuft durch ein `tanh`: lauter, und die ungeraden Obertöne tragen den Boom auch auf
  Lautsprecher ohne Bass.
- **Grollen** (`nuclear_strike_rumble_1` bis `_3`, je 3 s): tiefes Rauschen (zwei Tiefpässe
  bei 110 Hz) mit einem Band Tosen zwischen 250 und 700 Hz, in fünf Wellen anschwellend,
  dazu zwei tiefe Schläge wie Echos; 0,35 s ein- und 0,7 s ausgeblendet, sodass ein Stück
  ins nächste übergeht. Der `AudioService` startet sie nach 450, 2600 und 4800 ms
  Spielzeit mit 85, 65 und 45 % der Lautstärke (`tail`, jeder Eintrag mit eigenem
  `sample`), zusammen etwa 8 s.
- **Spielzeit:** Die Stücke starten in `AudioService.update()` je Sub-Step. Eine Pause hält
  das Grollen, das noch kommt, höheres Tempo verkürzt es, `game:reset` verwirft
  ausstehende. Ein Stück, das schon spielt, spielt zu Ende (One-Shots kennen keine Pause),
  höchstens 3 s. Deshalb Stücke statt eines langen Samples.
- **Budget:** normale One-Shots über `playAtGeo`, mit SFX-Lautstärke, Anti-Flood und
  globalem Cap. `priority` hält sie gegen das Voice-Stealing, `audibleDistance` 1500 m
  (so weit wie der Shake des Schlags), `maxInstances` 2 je Stück für zwei Schläge
  hintereinander.
- **Erzeugung:** fester Seed, beim ersten Registrieren gebaut und als WAV-Data-URL
  (24 kHz, 16 bit mono) für die Sitzung gecacht; im Test (`nuke-sound.spec.ts`) dauern
  Synthese, WAV und Base64 zusammen etwa 25 ms.
- **Warnsirene** (`nuclear_strike_siren`, `abilities/nuke_siren.mp3`, 2 s, eine
  steigende Luftschutzsirene, mit ElevenLabs erzeugt; seit 2026-09-15, E18): ein Loop
  (`AbilityImpactSound.warning`), den der `AudioService` beim `ability:used` am Ziel
  anlegt, wo der Zielmarker die Vorwarnung zeigt, auf dem Boden des Route-Grids
  (`AudioService.setGround`), und beim `ability:impact` desselben `strikeId` vor dem
  Knall stoppt. Die Vorwarnung dauert seit 2026-09-17 6,5 s Spielzeit (vorher 1,5 s): Bei 1x
  läuft der 2-s-Loop gut dreimal, bei 4x ein Viertel davon. Als Loop steht sie in der Pause (`holdLoops`) und ist nur bis
  `maxAudibleDistance` (500 m) zu hören, nicht bis 1500 m wie der Knall. Kommt der Loop
  erst nach dem Einschlag an, stoppt der Service ihn sofort. `game:reset`, ein Sprung im
  Replay (`clearAbilitySounds`) und `destroy()` beenden sie. Abnahme wie beim Knall
  (`refDistance` 150, `rolloffFactor` 0,6), `volume` 1.
- **Rakete aus dem Silo** (`GAME_SOUNDS.nuclearStrike.launch`, `AbilityLaunchSound`, seit
  2026-09-17): nur, wenn `ability:used` einen Startort trägt (`launch`). Drei Dateien, mit
  ElevenLabs erzeugt, je drei Varianten, gewählt nach Hüllkurve und Spektrum (nicht angehört),
  auf -14,5 LUFS gebracht (Abschnitt [Assets](#assets)); Abnahme wie beim Knall (`refDistance`
  150, `rolloffFactor` 0,6).

  | ID, Datei | Länge | Wo und wann | Klang |
  |---|---|---|---|
  | `nuclear_strike_launch`, `abilities/missile_launch.mp3` | 5 s | One-Shot am Silo beim `ability:used`, `volume` 1,3, `priority`, bis 1500 m | Zündknall und krachendes Tosen des Triebwerks, 0 bis 0,8 s hell, dann tiefes Tosen, ab etwa 3,5 s ausklingend |
  | `nuclear_strike_engine`, `abilities/missile_engine.mp3` | 3 s | Loop an der Rakete vom `ability:used` bis zum `ability:impact`, `volume` 0,8, blendet über 2 s Spielzeit ein (`fadeInMs`) | gleichmäßiges Dröhnen des Triebwerks, Pegel über die 3 s innerhalb von etwa 3 dB, Naht ohne Sprung |
  | `nuclear_strike_dive`, `abilities/missile_dive.mp3` | 2,55 s | One-Shot am Ziel, 2500 ms Spielzeit vor dem Einschlag (`leadMs`), `volume` 1, `priority`, bis 1500 m | fallendes Pfeifen (von etwa 2 kHz auf 600 Hz), das anschwillt, an der lautesten Stelle geschnitten |

  Der `AudioService` plant beim `ability:used` dieselbe Flugbahn wie der Renderer
  (`MissileFlight`, `utils/missile-flight.ts`, vom Start der Rakete im platzierten Silo,
  `missileStartAt`, zum Ziel in `warningMs`) und setzt den Triebwerks-Loop je Sub-Step (`update()`) dorthin, wo die
  Bahn die Rakete zu dieser Spielzeit hat. Der Loop startet stumm (`volumeMultiplier` 0) und
  kommt über `setLoopVolume` hoch, während die Zündung ausklingt. Beim `ability:impact`
  desselben `strikeId` endet der Loop, und ein noch spielendes Pfeifen stoppt
  (`stopOneShot`), bevor der Knall kommt: bei 4x dauert der Flug ein Viertel, das Pfeifen nicht.
  Ohne Einschlag endet der Loop am Ende der Flugzeit. Pause hält Loop und Weg, `game:reset`,
  ein Sprung im Replay (`clearAbilitySounds`) und `destroy()` beenden beides. Als Loop ist das
  Triebwerk nur bis 500 m zu hören: Steht die Rakete am Scheitel weiter weg, pausiert er dort
  und setzt wieder ein, wenn sie näher kommt. Im Wave-Replay reicht das Replay `ability:used`
  an seinen AudioService weiter: Zündung und Pfeifen sind bei 1x zu hören, der Loop wartet,
  weil das Spiel pausiert ist.

### Orbitallaser (Einschlag synthetisiert, Brennen als Loop am Strahlfuß)
`GAME_SOUNDS.orbitalLaser` (`audio.config.ts`).

- **Einschlag** (`orbital_laser`, 1,8 s, im Code synthetisiert in `utils/laser-sound.ts`,
  seit Playtest 636; vorher der Blitz des Lightning Towers) beim `ability:impact` am
  Aufsetzpunkt: ein Zap, der in wenigen Hundertstelsekunden von 3,2 kHz auf 200 Hz fällt,
  der Strahl kommt an; ein Crack und ein Schlag, Sinus von 90 auf 38 Hz; dann setzt das
  Brennen ein (Dröhnen aus zwei Sägezähnen bei 55 Hz, Zischen über 2,5 kHz), in den
  letzten 0,5 s ausgeblendet. `priority` gegen das Voice-Stealing (der Strahl tötet einen
  Abschnitt der Welle in wenigen Sekunden, deren Todesgeräusche nähmen ihm sonst die
  Stimme), `maxInstances` 2, Standard-Hörweite 500 m.
- **Brennen** (`orbital_laser_beam`, `abilities/orbital_laser_beam.mp3`, 4 s, mit
  ElevenLabs erzeugt; seit 2026-09-15, E18): ein Loop (`AbilityImpactSound.beam`), den der
  `AudioService` beim `ability:impact` am Anfang des Pfads anlegt (`path` im Event) und je
  Sub-Step (`update()`) mitführt: Er steht nach verbrannter Zeit mal 18 m/s auf dem Pfad,
  wie der Strahl in der Simulation, auf dem Boden des Route-Grids, bis
  `abilityBeamBurnMs` (4 s, weniger, wo die Route früher endet). Danach blendet er dort
  über 450 ms Spielzeit aus (`setLoopVolume`) und endet. Das Sample zündet in den ersten
  0,7 s und brennt dann gleichmäßig bis 4,0 s, so lang wie der Strahl; bei 1x fällt die
  Loop-Naht in das Ausblenden. Bis 2026-09-15 spielten zwei synthetisierte Stücke Brennen
  nach 1,3 und 2,5 s als One-Shots am Aufsetzpunkt: Der Ton blieb dort, während der
  Strahl bis 72 m weiterlief.
- **Spielzeit:** Die Pause hält den Loop (`holdLoops`) und seinen Weg, höheres Tempo führt
  ihn schneller mit und kürzt ihn; `game:reset`, ein Sprung im Replay
  (`clearAbilitySounds`) und `destroy()` beenden ihn. Im Wave-Replay ist das Spiel
  pausiert: Der Loop entsteht dort, wartet aber, bis er endet; zu hören ist nur der
  Einschlag. Vorher waren die Stücke Brennen One-Shots und auch im Replay zu hören.
- **Budget:** Der Loop hat keine Gegner-ID und zählt nicht zum Gegner-Budget; Loops kennen
  weder Voice-Stealing noch Polyphony-Cap. Hörweite 500 m wie alle Loops.

### Frostbombe und EMP (eigene Samples)
Frostbombe und EMP stehen wie der Nuklearschlag in `ABILITY_IMPACT_SOUNDS`
(`GAME_SOUNDS.frostBomb`, `.emp`). Der `AudioService` registriert sie beim
Start und spielt beim `ability:impact` das Sample am Einschlag, ohne Wiederholungen
(`tail` leer). Beide seit 2026-09-15 eigene Samples, mit ElevenLabs erzeugt (E18);
vorher der Cast des Ice Towers und der Kettenblitz des Lightning Towers, je zweimal
leiser wiederholt.

| Fähigkeit | ID, Datei | Länge | Klang |
|---|---|---|---|
| Frostbombe | `frost_bomb`, `abilities/frost_bomb.mp3` | 2,5 s | eisiger Knall und Aufbruch, dann knisterndes Gefrieren mit glasigem Schimmer, klingt über etwa 2 s aus |
| EMP | `emp`, `abilities/emp.mp3` | 2,5 s | elektrischer Schlag mit Hochspannungs-Zap, dann knisternde Entladung, klingt aus |

Ohne `priority` und mit der Standard-Hörweite (500 m), `maxInstances` 2. `refDistance`,
`rolloffFactor` und `volume` stehen in `audio.config.ts`. Die Dateien sind wie alle
Assets auf etwa -14 LUFS gebracht, lineare Verstärkung mit True Peak höchstens -1 dBFS
(Abschnitt [Assets](#assets)).

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
- Ein wartender Loop hat noch kein `PositionalAudio`, es entsteht erst beim Einstieg. Solange
  das Enemy-Budget voll ist, prüft ein wartender oder pausierter Gegner-Loop die Distanz nicht
- Die Distanz misst `SpatialAudioPlayback` zur Translation der Weltmatrix der Kamera (sie trägt
  den Listener), wie `ThreeTilesEngine.render()` sie im letzten gezeichneten Frame gesetzt hat;
  im selben Schritt setzt three den Web-Audio-Listener. Kein `getWorldPosition()` je Prüfung:
  Das aktualisiert die Matrizen von Kamera und Eltern und zerlegt und invertiert die Kameramatrix.
  Bei freiem Budget prüft jeder wartende Gegner-Loop jeden Sub-Step

### Memory Leak Prevention
- **setTimeout-Referenzen**: Alle Timer werden getrackt und bei Cleanup gecleaned
- **Container-Cleanup**: `stopAll()` entfernt alle Container aus der Scene
- **Audio-Disconnect**: Alle Audio-Nodes werden ordentlich disconnected
- **Audio-Cleanup**: PositionalAudio wird bei Rückgabe gestoppt, aus Parent entfernt und disconnected

### Race Condition Fix
- `createLoop()` nimmt den Enemy-Slot erst nach seinen awaits, im selben synchronen Schritt
  wie die Prüfung und den Start. Parallele Anfragen können das Budget so nicht überbuchen
- `createLoop()` kopiert die Position vor den awaits; der Aufrufer darf seinen Vektor
  weiterverwenden
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

5. **Loops aus mp3**: Lückenlos ist die Naht eines Loops nur, wenn der Browser die
   Encoder-Verzögerung der mp3 abschneidet; das hängt vom Browser ab. Mit ElevenLabs
   erzeugte Loops (`loop: true`) kamen nicht gleichmäßig heraus (Zündphase, Wechsel laut
   und leise); passend ist so ein Stück nur, wo es wie das Brennen des Orbitallasers etwa
   einmal durchläuft.

6. **Wartende Loops**: `getActiveSoundCount()`, `getSoundPoolStats().activeLoops` und
   `debugLogActiveSounds()` zählen Loops mit, die noch auf ihren Einstieg warten (als
   pausiert). Wirft `audio.play()` beim Einstieg, bleibt der Loop wartend und versucht es
   beim nächsten Update erneut, mit einer Warnung je Versuch. Einen Vorrang naher Gegner
   gibt es nicht (bräuchte Sortieren je Frame).

## Assets

Sound-Dateien befinden sich unter `public/assets/sounds/` (Auszug, nicht
vollständig). Hintergrundmusik liegt separat unter `public/assets/music/`:
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
├── abilities/                         # mit ElevenLabs erzeugt (E18, 2026-09-15)
│   ├── nuke_siren.mp3                 # Warnsirene des Nuklearschlags (Loop)
│   ├── missile_launch.mp3             # Zündung der Rakete am Silo (2026-09-17)
│   ├── missile_engine.mp3             # Triebwerk der Rakete (Loop an der Rakete)
│   ├── missile_dive.mp3               # Pfeifen im Anflug, am Ziel vor dem Einschlag
│   ├── frost_bomb.mp3                 # Einschlag der Frostbombe
│   ├── emp.mp3                        # Einschlag des EMP
│   └── orbital_laser_beam.mp3         # Brennen des Orbitallasers (Loop am Strahlfuß)
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
│   ├── dragon/dragon01.mp3            # Dragon-Random-Sound
│   └── skarnax/growl_1.mp3, growl_2.mp3, clack.mp3  # Skarnax-Stimme am Kopf (ElevenLabs, E18)
└── effects/
    ├── explosion.mp3                  # HQ-Schadens-Sound
    ├── building_placed.mp3            # Tower-Platziert-Sound
    └── building_selled.mp3            # Tower-Verkauft-Sound
```

Neue Datei-Sounds von ElevenLabs (Text-to-Sound-Effects) werden linear auf etwa
-14 LUFS verstärkt, begrenzt auf True Peak -1 dBFS, und als mp3 mit 44,1 kHz, Stereo,
128 kbit/s abgelegt wie die Tower-Sounds. Kein dynamisches `loudnorm`: Es glättet das
Abklingen eines One-Shots und die Naht eines Loops. Die Lautstärke im Spiel regelt
danach das `volume` in der Config.

Ohne Datei, im Code synthetisiert: die UI-Töne (`utils/alert-tone.ts`), die Ooze-Sounds
(`utils/ooze-sound.ts`) und der Nuklearschlag (`utils/nuke-sound.ts`), alle als WAV-Data-URL
über `utils/pcm-wav.ts`. Seed-Zufall,
Tiefpass-Koeffizient und Normalisieren teilen sich die Synthesen in `utils/synth.ts`.

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
