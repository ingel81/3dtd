# Enemy Creation Guide

**Stand:** 2026-09-13

Anleitung zum Erstellen neuer Enemy-Typen mit Animationen, Sounds und visuellen Effekten.

---

## Übersicht

Enemies werden über die Konfigurationsdatei `configs/enemy-types.config.ts` definiert (vorher `models/enemy-types.ts`, 2026-05-10 umgezogen — siehe DONE.md). Das System unterstützt:

- Verschiedene 3D-Modelle (GLB, FBX) mit Skinning- oder Node-Animationen, als VAT instanziert gerendert ([INSTANCED_ENEMY_RENDERING.md](INSTANCED_ENEMY_RENDERING.md))
- Walk-, Run- und Death-Animationen mit Speed-Coupling
- Spatial Audio (Loop-Sounds, Random Sounds, Spawn Sounds, Random-Sounds-Pool mit Shuffle)
- Status-Effekte (Slow, Poison, Burn; Freeze-Typ reserviert)
- Air und Ground Units
- **Damage/Armor-Matrix** (`armorType` Pflichtfeld, Phase 5.x)
- Lateral Spread und Height Variation für Bewegungsvariation
- Boss-Enemies mit Custom Health Bar
- Bluteffekte (`canBleed`), Emissive Glow, Color Multiplier, Unlit Rendering
- Konfigurierbare Sidebar-Preview (Camera Distance / Angle / Offset)

---

## Aktuelle Enemy-Typen (20)

| Enemy | armorType | baseHp | Speed | Air? | Besonderheit |
|-------|-----------|--------|-------|------|--------------|
| zombie | unarmored | 80 | 5 | – | Standard-Gegner |
| zombie-v2 | unarmored | 80 | 3 | – | Zweites Zombie-Modell, Todes-Clip-Pool `deathAnimations: ['Dead', 'dying_backwards']`, 10 % der `zombie_horde` |
| zombie-soldier | heavy | 160 | 6 | – | Stärkere Variante mit Emissive |
| rat | unarmored | 5 | 10 | – | Schwächster Swarm-Gegner |
| spider | light | 60 | 9 | – | Schneller, wenig HP |
| penguin | unarmored | 30 | 9 | – | Unlit Cartoon-Style |
| skeleton | unarmored | 20 | 6 | – | Swarm (2026-09-12), Kenney-Modell aus starren Teilen mit Node-Animation (`bakeObjectAnimVAT`), `canBleed: false`, `animationSpeed: 0.93` (Beine passend zu 6 m/s), Template `skeleton_swarm` (Curriculum W19), `splitOnDeath`: ein Kill teilt ihn in 2 `skeleton-minion` (2026-09-13) |
| skeleton-minion | unarmored | 6 | 7 | – | Nur aus dem Split eines Skeletons, kein Template. Gleiches Modell bei `scale: 2.4` in eigenem VAT-Pool, `animationSpeed: 1.82`, teilt sich nicht weiter |
| wallsmasher | light | 200 | 4 | – | Walk/Run-Variation, `runSpeedMultiplier: 2.5` (rennt 10 m/s, im Mittel 7 m/s), **silent-spawn** (kein `spawnSound`) |
| bat | light | 25 | 8 | ✓ | Air-Unit, `heightOffset: 15` |
| hornet | light | 80 | 9 | ✓ | Air-Unit, `heightOffset: 18` |
| dragon | heavy | 450 | 6 | ✓ | Air-Boss-Tier, `heightOffset: 20` |
| tank | heavy | 250 | 3 | – | Mechanisch, `canBleed: false` |
| bear | heavy | 300 | 8 | – | Random Growl Sound |
| mech | heavy | 500 | 3 | – | Mechanisch |
| mammoth | fortified | 400 | 3 | – | Random Mammoth Call |
| herbert | fortified | 500 | 4 | – | Boss, `immunityPercent: 100` (derzeit nicht ausgewertet) |
| **stone-golem** | fortified | 480 | 2.5 | – | Neuer Fortified-Gegner (2026-05-12), `canBleed: false`, `randomAnimationStart: true`, `lateralSpread: 0.65`, `spawnStartDelay: 1200` |
| ghost | ethereal | 120 | 5 | – | Nur magic/chaos wirkt voll |
| wraith | ethereal | 100 | 8 | – | Schneller Ethereal |

> **Wave-Director:** Stone Golem ist seit 2026-08-27 angebunden — Template
> `golem_squad` (`src/app/ai/core/templates.ts`, `minWave: 14`) steht auf Wave 15
> des Curriculums (`configs/wave-curriculum.config.ts`).

---

## Schritt-für-Schritt: Neuen Enemy hinzufügen

### 1. EnemyTypeId erweitern

```typescript
// configs/enemy-types.config.ts
export const ENEMY_TYPES: Record<string, EnemyTypeConfig> = {
  zombie: { ... },
  tank: { ... },
  // ... (siehe Tabelle oben für alle 20 aktuellen Typen)
  'new-enemy': { ... }, // Neuer Enemy
};

export type EnemyTypeId = keyof typeof ENEMY_TYPES;
```

### 2. Model-URL definieren

```typescript
const NEW_ENEMY_MODEL_URL = 'assets/models/enemies/new_enemy.glb';
```

**Model-Anforderungen:**
- Unterstützte Formate: GLB, FBX
- Animation per Skinning (SkinnedMesh) oder per Node-Transform starrer Teile (Skeleton, Mech, Hornet); ohne Animation wird das Modell statisch gebacken
- Benannte Animationen (z.B. `Armature|Walk`, `Armature|Die`). Gebacken werden nur die Clips aus `walkAnimation`, `runAnimation`, `deathAnimation` und `deathAnimations`

### 3. Enemy-Konfiguration hinzufügen

```typescript
'new-enemy': {
  id: 'new-enemy',
  name: 'New Enemy',
  modelUrl: 'assets/models/enemies/new_enemy.glb',
  scale: 2.0,
  minimumPixelSize: 0, // 0 = echte Größe, kein Clamping

  // Combat (Pflichtfeld seit Phase 5.x)
  armorType: 'light',  // 'unarmored' | 'light' | 'medium' | 'heavy' | 'fortified' | 'ethereal'

  // Stats
  baseHp: 150,
  baseSpeed: 5,    // m/s
  reward: 2,       // Credits bei Kill (nur ohne AI - AI nutzt dynamische Reward-Berechnung)

  // Animation
  hasAnimations: true,
  walkAnimation: 'Armature|Walk',
  deathAnimation: 'Armature|Die',
  animationSpeed: 1.5,
  randomAnimationStart: true, // Start bei zufälligem Frame

  // Audio (optional)
  movingSound: '/assets/sounds/enemy_move.mp3',
  movingSoundVolume: 0.4,
  movingSoundRefDistance: 30,
  randomSoundStart: true, // Sound-Position zufällig

  // Visual
  heightOffset: 0,        // Höhe über Terrain
  healthBarOffset: 8,     // Health-Bar über Model
  canBleed: true,         // Bluteffekte
  headingOffset: 0,       // Rotations-Offset in Radians

  // Visual-Tuning (optional)
  emissiveIntensity: 0.15,    // 0 = aus, 0.1-0.5 dezent, 1+ stark
  emissiveColor: '#ccddff',   // Default '#ffffff'
  colorMultiplier: 1.3,       // Gesamt-Helligkeit (Default 1.0)
  unlit: false,                // Cartoon-Style ohne Beleuchtung

  // Movement Variation
  lateralSpread: 0.65,    // Anteil der Korridorbreite für seitlichen Versatz

  // Preview (optional)
  previewScale: 1.5,            // Überschreibt Scale für Model-Preview (Sidebar)
  previewCameraDistance: 7,     // Default 7
  previewCameraAngle: Math.PI/12, // Default Math.PI/12 (~15°)
  previewOffsetY: 0,            // Vertikaler Offset des Preview-Kamera-Targets
},
```

---

## Animation-System

### Verfügbare Animationen

| Animation | Erforderlich | Beschreibung |
|-----------|--------------|--------------|
| `walkAnimation` | Empfohlen | Standard-Bewegung |
| `runAnimation` | Optional | Schnellere Bewegung (Alternative zu Walk) |
| `deathAnimation` | Optional | Spielt beim Tod, 2 s bis zum Entfernen. Gebacken wird nur dieser Teil (`animationSpeed` × 2 s Clip-Zeit), der Rest des Clips ist nie zu sehen |
| `deathAnimations` | Optional | Pool von Todes-Clips, einer zufällig pro Kill; gekürzt wie `deathAnimation` |

Idle-Clips werden nicht gebacken, das Spiel zeigt keine stehenden Gegner.

Ein Todes-Clip muss innerhalb von `animationSpeed` × 2 s Clip-Zeit am Boden sein, sonst
verschwindet der Gegner stehend. `zombie-v2` hatte deshalb `Electrocuted_Fall` im Pool, dessen
Fall erst nach etwa 3,25 s beginnt; der Clip ist raus (fd18a10). Ein kürzerer Clip hält seinen
letzten Frame bis zum Entfernen (Skeleton: `die` mit 0,33 s).

### Animation Speed Coupling

Animationen werden automatisch an die Bewegungsgeschwindigkeit gekoppelt:

```typescript
// EnemyInstanceManager.updateEnemyState() / updateAnimations()
// currentSpeed = speedMps × speedMultiplier × Slow (EnemyManager.presentFrame)
state.speedMultiplier = currentSpeed / effectiveBaseSpeed; // Run-Clip: baseSpeed × runSpeedMultiplier
state.animTime += deltaTime * state.animSpeed * state.speedMultiplier; // animSpeed = animationSpeed
```

**Beispiel:** Enemy mit `baseSpeed: 5` bewegt sich mit `7 m/s`:
- Speed Ratio: `7 / 5 = 1.4`
- Animation läuft 1.4x schneller

### Run-Animation-System (Animation Variation)

Manche Enemies wechseln zwischen Walk- und Run-Animation:

```typescript
// Enemy-Konfiguration
animationVariation: true,      // Aktiviert Walk/Run Wechsel
runSpeedMultiplier: 2.5,       // 2.5x Speed bei Run
walkAnimation: 'Armature|Walk',
runAnimation: 'Armature|Run',
```

**Funktionsweise:**
1. Der Gegner startet gehend und wechselt nach jeweils 3-8 s **Spielzeit** zwischen Gehen und Rennen, beide Phasen gleich verteilt (im Mittel je 50 % der Zeit).
2. Der Zustand ist Simulation: `Enemy.rush` (`entities/enemy-rush.ts`), getickt im Enemy-Sub-Step **vor** `move()`. Der Multiplikator wirkt im selben Sub-Step, pausierte Gegner (Pending-Start, Debug, sterbend) ticken nicht.
3. Bei Run: `speedMultiplier = runSpeedMultiplier` (z.B. 2.5), Bewegung `baseSpeed × speedMultiplier` (Wallsmasher: 4 × 2.5 = 10 m/s, im Mittel über beide Phasen 7 m/s).
4. Deterministisch: Phasenlängen aus einem Mulberry32-Strom, geseedet aus der Enemy-ID. Kein `Math.random`, kein `setTimeout`.
5. Der Renderer zeigt nur den Clip: `EnemyManager.presentFrame()` ruft `startRunAnimation`/`startWalkAnimation`, sobald der Clip nicht zum Zustand passt.
6. Animation bleibt gleich schnell (die Animations-Kopplung rechnet beim Run-Clip mit `baseSpeed × runSpeedMultiplier`).

**WICHTIG:** `runSpeedMultiplier` beeinflusst NUR die Bewegung, NICHT die Animation-Speed. Der Renderer liefert keine Geschwindigkeit an die Simulation zurück; die Debug-Buttons Walk/Run setzen den Zustand über `Enemy.setRunning()`.

Nur Typen mit `animationVariation: true` **und** `runAnimation` bekommen `Enemy.rush`; alle anderen haben `null` und kosten im Sub-Step nur diese Feldprüfung.

---

## Audio-System

### 1. Loop-Sound (Moving Sound)

Spielt kontinuierlich während der Bewegung:

```typescript
movingSound: '/assets/sounds/zombie-sound.mp3',
movingSoundVolume: 0.4,         // 0.0 - 1.0
movingSoundRefDistance: 25,     // Distanz für volle Lautstärke
randomSoundStart: true,         // Start bei zufälliger Position
```

### 2. Random Sound (Single)

Spielt in zufälligen Intervallen:

```typescript
randomSound: '/assets/sounds/big_arm_01.mp3',
randomSoundMinInterval: 8000,   // Min. 8s zwischen Sounds
randomSoundMaxInterval: 25000,  // Max. 25s
randomSoundVolumeMin: 0.2,      // Min. Lautstärke
randomSoundVolumeMax: 0.6,      // Max. Lautstärke
randomSoundRefDistance: 35,
```

### 3. Random Sounds Pool (Shuffle)

Mehrere Sounds ohne Wiederholung (Fisher-Yates Shuffle):

```typescript
randomSounds: [
  '/assets/sounds/herbert_02.mp3',
  '/assets/sounds/herbert_03.mp3',
  '/assets/sounds/herbert_04.mp3',
],
randomSoundsMinInterval: 10000,
randomSoundsMaxInterval: 25000,
randomSoundsVolume: 0.6,
randomSoundsRefDistance: 40,
```

**Verhalten:** Spielt alle Sounds in zufälliger Reihenfolge, dann neu shufflen.

### 4. Spawn Sound

Spielt einmalig beim Spawnen:

```typescript
spawnSound: '/assets/sounds/herbert_01.mp3',
spawnSoundVolume: 0.6,
spawnSoundRefDistance: 40,
```

### Audio-Typen Vergleich

| Typ | Use Case | Beispiel |
|-----|----------|----------|
| `movingSound` | Kontinuierlicher Sound | Panzer-Motor, Zombie-Stöhnen |
| `randomSound` | Gelegentliche Sounds | Wallsmasher Brüllen |
| `randomSounds` | Variierte Sounds (Pool) | Herbert Voice Lines |
| `spawnSound` | Einmaliger Spawn-Sound | Boss Spawn Roar |

---

## Visual Konfiguration

### Emissive Glow (Leuchteffekte)

```typescript
emissiveIntensity: 0.5,    // Leuchteffekt-Stärke (0 = aus, 1+ = stark)
emissiveColor: '#ff0000',  // Leuchtfarbe (Hex)
```

**Verwendung:** Für leuchtende Gegner (z.B. magische Kreaturen, Robots)

### Unlit Rendering (Cartoon-Style)

```typescript
unlit: true,  // Keine Beleuchtung - zeigt Originalfarben
```

**Verwendung:** Für Cartoon-artige Modelle die keine Schatten brauchen

### Color Multiplier (Helligkeit)

```typescript
colorMultiplier: 1.3,  // Gesamt-Helligkeit (Default 1.0; 1.3 = +30% heller)
```

**Verwendung:** Modelle die im VAT-Renderer dunkel wirken aufhellen (z.B. zombie-soldier, bear, dragon).

### Boss Health Bar

```typescript
immunityPercent: 100,        // derzeit von keinem Spielcode gelesen (keine Anzeige, keine Schadensreduktion)
healthBarColor: '#ff0000',   // Optional: feste Health-Bar-Farbe (z.B. Boss)
bossName: 'Boss',            // Optional: nur der Screen-Shake liest es (Preset bossDeath beim Tod), kein Name über der Health-Bar
```

### Blood Effects

```typescript
canBleed: true,  // Blutpartikel + Decals bei Treffer/Tod
```

**WICHTIG:** Nur für organische Gegner (Zombies, Menschen). `false` für Roboter, Panzer, etc.

---

## Unit-Typen

### Ground Units (Standard)

```typescript
// Keine spezielle Konfiguration nötig
isAirUnit: false,  // Optional, default = false
```

**Targeting:** Kann von allen Towern angegriffen werden (außer Air-Only Towern)

### Air Units (Fliegende Einheiten)

```typescript
isAirUnit: true,
heightOffset: 15,        // 15m über Terrain
heightVariation: 3,      // ±3m Variation zwischen Enemies
```

**Targeting:** Nur von Towern mit `canTargetAir: true`

**Höhen-System:**
- `heightOffset`: Basis-Flughöhe (konstant für alle Enemies dieses Typs)
- `heightVariation`: Zufällige Abweichung pro Enemy-Instanz

**Beispiel:** Fledermaus mit `heightOffset: 15`, `heightVariation: 3`
- Enemy A: 15 + 2.1 = 17.1m
- Enemy B: 15 - 1.5 = 13.5m
- Enemy C: 15 + 0.8 = 15.8m

---

## Movement Variation

### Lateral Spread (Seitlicher Versatz)

```typescript
lateralSpread: 1.0,  // Anteil des seitlichen Platzes im Routenkorridor (0-1)
```

**Effekt:** Jeder Enemy bekommt einen zufälligen Platz quer zur Route. Die
Meter folgen der lokalen Korridorbreite (`utils/route-corridor.ts`): Grenze ist
die Halbbreite des Korridors minus 1,5 m (`CORRIDOR_DEFAULTS.edgeMargin`), auf einer Hauptstraße also mehrere
Meter, in einer Gasse unter einem Meter. `lateralSpread` sagt, welchen Anteil
davon der Typ höchstens nutzt: `1.0` bis zum Rand, `0.5` nur die innere Hälfte
(Panzer, Bosse). Kein Gegner läuft dadurch außerhalb der Route-Cells, die Tower
sehen ihn also immer. Vorher war es `lateralOffset` in festen Metern (3,0 m
entspricht heute 1.0). Wie die Korridorbreite entsteht, steht in
[ROUTE_CORRIDOR.md](ROUTE_CORRIDOR.md).

**Verwendung:**
- Verhindert "Gänsemarsch"-Effekt
- Macht Bewegung natürlicher
- Erschwert präzises Zielen

### Spawning Delay

```typescript
spawnStartDelay: 800,  // 800ms zwischen Start von Enemies
```

**Standard:** 300ms
**Verwendung:** Größere Delays für große/langsame Enemies (Panzer, Bosse)

### Split on Death (`splitOnDeath`)

```typescript
splitOnDeath: { type: 'skeleton-minion', count: 2, spread: 0.3 },
```

Ein Kill durch Tower oder Damage-over-Time teilt den Gegner in `count` Gegner vom
Typ `type`. Ein Leck an der Basis teilt nicht, `debug:kill-all` auch nicht
(Ursache `'debug'` in `EnemyManager.kill()`). Umgesetzt für den Skeleton; der
Slime aus dem Game Design kann denselben Mechanismus nutzen.

- **Wo:** Die Kinder starten auf dem Pfad des getöteten Gegners, auf seinem
  Segment und Fortschritt (`MovementComponent.setPath(path, index, progress)`,
  keine Kopie des Pfads), auf der Bodenhöhe des Route-Grids unter ihm.
- **Seitlich:** Ihre Spuren liegen nach Index um seine Spur, `spread`
  auseinander (Anteil des Korridors), und bleiben im `lateralSpread` des
  Kind-Typs.
- **Werte:** HP und Tempo der Kinder skalieren mit seinen Multiplikatoren, das
  `hpMult` einer Welle erreicht also auch sie.
- **Deterministisch:** Der Split läuft in dem Sub-Step, der den tödlichen
  Schaden austeilt, ohne `Math.random`. Stirbt der Gegner durch DoT im
  Bewegungs-Pass, laufen die Kinder ab dem nächsten Sub-Step.
- **Welle:** Die Welle wartet auf die Kinder, sie leben ja. Das Kill-Gold
  verteilt sich auf alle Körper (`WaveManager.getExpectedBodyCount()`), ein Split
  erhöht es nicht. Ein durchgelaufenes Kind ist ein Leck. `enemy:split` erhöht
  Rest und Gesamtzahl im Wave-Panel und löst den Knochen-Burst aus.
- **Fairness-Gate:** `fairMaxCount` rechnet mit der HP der ganzen Linie
  (`lineageHp`), einem Kill pro Körper (`splitBodyCount`) und bis zu einem Leck
  pro Ende des Split-Baums (`splitLeafCount`; Skeleton: 2).
- **Kind-Typ:** ein eigener Eintrag in `ENEMY_TYPES` (eigener VAT-Pool, eigene
  Werte), in keinem Template. Nicht in `AI_ENEMY_ORDER` aufnehmen, solange ihn
  kein Template nennt: Sein Platz in der Typ-History bliebe 0, und der
  Schema-Bruch machte alle Checkpoints unbrauchbar.
- **Budget:** `npm run model-budget` zählt die Kinder in „max./Welle“ und in der
  Vertex-Last der Templates mit.

---

## Status-Effekte

Enemies können von Towern mit Status-Effekten belegt werden:

### Slow (Verlangsamung)

```typescript
// Ice-Tower-Treffer: StatusEffectService.applySlow(), Werte aus GAME_BALANCE.effects.ice
{
  type: 'slow',
  value: 0.5,        // 50% Verlangsamung
  duration: 3000,    // 3 Sekunden
}
```

**Kein Stacking:** Slow-Effekte ersetzen sich gegenseitig (nur einer aktiv)
- 1x Slow 50%: `slowMultiplier = 0.5`
- 2x Slow 50%: Ersetzt vorherigen (Timer reset), weiterhin 50% langsamer

### Poison (DoT — aktiv)

Vom Poison Tower angewendet. Kein Stacking — neuer Poison ersetzt vorherigen.

```typescript
// StatusEffectService.applyPoison(), Werte aus GAME_BALANCE.effects.poison
type: 'poison',
value: 8,         // Schaden pro Sekunde (× Upgrade-Multiplikator des Towers)
duration: 4000,   // Game-Time ms
```

### Burn (DoT — aktiv)

Vom Fire Tower auf jeden Gegner im Flammenkegel angewendet: 20 % der Beam-DPS laufen als Burn, 3 s Nachbrennen. Pro Tower ein eigener Eintrag (zwei Fire Tower brennen nebeneinander). Details in [STATUS_EFFECTS.md](STATUS_EFFECTS.md#burn-effect-dot).

### Freeze (Reserviert)

`freeze` ist als `StatusEffectType` definiert, aktuell aber nicht aktiv im Spiel verwendet. Siehe [STATUS_EFFECTS.md](STATUS_EFFECTS.md) für Details.

---

## Beispiele

### Standard Ground Enemy (Zombie)

```typescript
zombie: {
  id: 'zombie',
  name: 'Zombie',
  modelUrl: 'assets/models/enemies/zombie.glb',
  scale: 0.984,
  minimumPixelSize: 0,
  armorType: 'unarmored',
  baseHp: 80,
  baseSpeed: 5,
  reward: 3,
  hasAnimations: true,
  walkAnimation: 'Armature|Walk',
  deathAnimation: 'Armature|Die',
  animationSpeed: 4.11,
  movingSound: 'assets/sounds/enemies/zombie/ambient.mp3',
  movingSoundVolume: 0.4,
  movingSoundRefDistance: 25,
  heightOffset: 0.5,
  healthBarOffset: 5.5,
  canBleed: true,
  headingOffset: -0.349,
  randomAnimationStart: true,
  randomSoundStart: true,
  lateralSpread: 1.0,
  previewScale: 1,
},
```

### Air Unit (Bat)

```typescript
bat: {
  id: 'bat',
  name: 'Bat',
  modelUrl: 'assets/models/enemies/bat.glb',
  scale: 3.958,
  minimumPixelSize: 0,
  armorType: 'light',
  baseHp: 25,
  baseSpeed: 8,
  reward: 2,
  hasAnimations: true,
  walkAnimation: 'fly.001',
  animationSpeed: 2.79,
  heightOffset: 15,        // 15m Flughöhe
  healthBarOffset: 3.5,
  canBleed: true,
  headingOffset: 0,
  isAirUnit: true,         // Nur Air-Tower können angreifen
  heightVariation: 3,      // ±3m Variation
  lateralSpread: 0.65,
  randomAnimationStart: true,
},
```

### Boss Enemy (Herbert)

```typescript
herbert: {
  id: 'herbert',
  name: 'Herbert',
  modelUrl: 'assets/models/enemies/herbert_optimized.glb', // optimiertes Mesh
  scale: 2.625,
  minimumPixelSize: 0,
  armorType: 'fortified',
  baseHp: 500,
  baseSpeed: 4,
  reward: 15,
  hasAnimations: true,
  walkAnimation: 'Armature|walking_man|baselayer',
  animationSpeed: 1.0,

  // Speech-Sounds aktuell auskommentiert (siehe Datei).
  // Random Sounds Pool (Shuffle ohne Wiederholung) wäre die Vorlage für künftige Voice Lines.

  heightOffset: 0.5,
  healthBarOffset: 7,
  immunityPercent: 100,       // "Immun 100%"
  canBleed: true,
  headingOffset: -0.192,
  randomAnimationStart: true,
  lateralSpread: 0.65,
  previewScale: 1.05,
  previewCameraDistance: 3,
  previewCameraAngle: 0,
  previewOffsetY: 0.8,
},
```

### Unlit Enemy (Penguin)

```typescript
penguin: {
  id: 'penguin',
  name: 'Penguin',
  modelUrl: 'assets/models/enemies/penguin.glb',
  scale: 0.005,
  minimumPixelSize: 0,
  armorType: 'unarmored',
  baseHp: 30,
  baseSpeed: 9,
  reward: 2,
  hasAnimations: true,
  walkAnimation: 'Walk',
  deathAnimation: 'Fall',
  animationSpeed: 5.6,
  heightOffset: 0.5,
  healthBarOffset: 4.5,
  canBleed: true,
  unlit: true,               // Cartoon-Style ohne Beleuchtung
  headingOffset: 0,
  randomAnimationStart: true,
  lateralSpread: 0.85,
  previewScale: 0.008,       // Eigener Scale für Sidebar-Preview
  previewCameraDistance: 7,
  previewCameraAngle: 0,
  previewOffsetY: 1.8,
},
```

### Run-Animation Enemy (Wallsmasher)

```typescript
wallsmasher: {
  id: 'wallsmasher',
  name: 'Wallsmasher',
  modelUrl: 'assets/models/enemies/wallsmasher.fbx',
  scale: 0.037,
  minimumPixelSize: 0,
  armorType: 'light',
  baseHp: 200,
  baseSpeed: 4,                // geht 4, rennt 10 m/s, Mittel 7 m/s
  reward: 5,
  hasAnimations: true,
  walkAnimation: 'CharacterArmature|Walk',
  runAnimation: 'CharacterArmature|Run',
  deathAnimation: 'CharacterArmature|Death',
  animationSpeed: 0.75,        // Schrittlänge passend zu 4 m/s (vorher 1.31 bei 7 m/s)
  animationVariation: true,    // Wechselt zwischen Walk/Run
  runSpeedMultiplier: 2.5,     // 2.5x Speed bei Run

  // Kein spawnSound — Wallsmasher-Rush ist als visuelle Überraschung gedacht.
  // `enemy.entity.ts` gateet beide Pfade (Register + Play) durch
  // `if (this.typeConfig.spawnSound)`, also bleibt der Spawn ohne Property lautlos.
  randomSound: 'assets/sounds/enemies/wallsmasher/attack.mp3',
  randomSoundMinInterval: 8000,
  randomSoundMaxInterval: 25000,
  randomSoundVolumeMin: 0.2,
  randomSoundVolumeMax: 0.6,
  randomSoundRefDistance: 35,

  heightOffset: 0,
  healthBarOffset: 9,
  canBleed: true,
  headingOffset: 0,
  randomAnimationStart: true,
  lateralSpread: 0.65,
  spawnStartDelay: 500,
},
```

---

## Checkliste: Neuer Enemy

- [ ] Model in `/public/assets/models/enemies/` abgelegt
- [ ] Enemy-Config in `ENEMY_TYPES` hinzugefügt
- [ ] Animationsnamen korrekt (z.B. `Armature|Walk`)
- [ ] `baseSpeed` sinnvoll gewählt (2-8 m/s typisch)
- [ ] `heightOffset` korrekt (0 für Ground, 10-20 für Air)
- [ ] `healthBarOffset` über Model-Höhe gesetzt
- [ ] Sound-Dateien in `/public/assets/sounds/` (optional)
- [ ] `canBleed` korrekt (true für organisch, false für mechanisch)
- [ ] Bei Air Unit: `isAirUnit: true` gesetzt
- [ ] Bei Run-Animation: `animationVariation: true` und `runSpeedMultiplier` gesetzt
- [ ] Todes-Clip liegt innerhalb von `animationSpeed` × 2 s Clip-Zeit am Boden
- [ ] Bei Boss: `healthBarColor` und `bossName` gesetzt (`immunityPercent` wird derzeit nicht ausgewertet)
- [ ] `previewScale` gesetzt falls Model im Sidebar-Preview zu gross/klein
- [ ] `npm run model-budget` gelaufen, Zeile in [ENEMY_MODEL_BUDGET.md](ENEMY_MODEL_BUDGET.md) liegt im Budget der Klasse
- [ ] Bei `splitOnDeath`: Kind-Typ in `ENEMY_TYPES`, kein Zyklus, `countRange` der Templates an die HP der ganzen Linie angepasst, `npm run ai-schema` gelaufen (`lineageHp`, `bodies`, `maxLeaks`)

---

## Integration in Waves

Siehe [WAVE_SYSTEM.md](WAVE_SYSTEM.md) für Wave-Konfiguration.

Gegner kommen über Wave-Templates in die Wellen: `ai/core/templates.ts`, Feld `enemies` mit
Anteilen, dazu `minWave` und die Bereiche für Anzahl, Spawn-Delay und HP. Das Curriculum
(`configs/wave-curriculum.config.ts`) legt fest, welches Template in welcher Welle läuft. Im
Debug-Pfad ohne Director erscheint ein Typ nur, wenn ein Eintrag in `STATIC_WAVE_PROFILES`
(gleiche Datei) ihn nennt. Nach Änderungen an den Templates `npm run ai-schema` laufen lassen, das spiegelt sie
nach `training-backend/generated/ai-schema.json`.

```typescript
// ai/core/templates.ts
{
  id: 'skeleton_swarm',
  name: 'Skeleton Swarm',
  description: 'A rattling swarm of skeletons.',
  enemies: [['skeleton', 1.0]],
  countRange: [25, 940], // mit den Minions des Splits bis 2.820 Körper
  spawnDelayRange: [15, 300],
  hpMultRange: [0.5, 5.0],
  variationRange: [0.05, 0.35],
  minWave: 6,
  spawnPattern: null,
  requiresCapability: null,
  bossOnly: false,
},
```

`WaveManager.startWave()` nimmt nur einen fertigen `SpawnSchedule` (`{ schedule }`), keine
Einzeltyp-Konfiguration mehr.

---

## Technische Details

### Enemy-Lifecycle

```
1. Spawn (EnemyManager)
   ↓
2. Initialize Components (Transform, Health, Movement, Audio)
   ↓
3. Instanz-Slot anlegen (InstancedEnemyRenderer.create, Pool aus dem VAT-Preload)
   ↓
4. Play Spawn Sound
   ↓
5. Start Moving (if not paused)
   ↓
6. Update Loop (movement, animation, audio)
   ↓
7. Death (Health = 0)
   ↓
8. Play Death Animation (2s delay)
   ↓
9. Remove from Scene
```

### Renderer-Integration

Enemies werden automatisch vom `InstancedEnemyRenderer` (`tilesEngine.enemies`) gerendert.
`ThreeTilesEngine` bäckt beim Laden per `preloadAllModels()` für jeden Typ in `ENEMY_TYPES`
eine VAT und legt den Pool an.

```typescript
// In EnemyManager
this.tilesEngine.enemies.create(enemy.id, typeId, lat, lon, height);              // Spawn
slot = engine.enemies.resolveSlot(enemy.id);                                      // presentFrame(), einmal pro Gegner
engine.enemies.updateSlot(slot, localPos, rotation, healthPercent, currentSpeed); // presentFrame(), pro Render-Frame
this.tilesEngine.enemies.startWalkAnimation(enemy.id);
this.tilesEngine.enemies.playDeathAnimation(enemy.id);
this.tilesEngine.enemies.remove(enemy.id);
```

Kein manueller Renderer-Code nötig.

### Animation-Namen finden

```bash
# GLB-Dateien inspizieren
npx gltf-transform inspect model.glb

# Suche nach "animations":
# animations:
#   - name: "Armature|Walk"
#   - name: "Armature|Run"
#   - name: "Armature|Die"
```

---

## Best Practices

1. **Animation Speed:** so wählen, dass die Füße bei `baseSpeed` nicht rutschen. Skeleton: 3,2 m Schrittlänge pro 0,5-s-Zyklus, bei 6 m/s also `0.93` (825e6d5). Die Kopplung an die aktuelle Geschwindigkeit hält das auch unter Slow
2. **Sound Volumes:** Loop-Sounds leiser (0.2-0.4), Spawn-Sounds lauter (0.5-0.7)
3. **Lateral Spread:** 0.65-1.0 für normale Gegner, 0.5 für große, die in der Mitte bleiben sollen
4. **Boss Health:** 10x normale Enemies (z.B. 500-5000 HP)
5. **Base Speed:** 3-5 m/s für langsame, 6-8 m/s für schnelle Gegner; die Air Units liegen bei 6-9 m/s, die Ratte bei 10 m/s
6. **Health Bar Offset:** `scale * 4` als Faustregel

---

## Troubleshooting

### Enemy spawnt unsichtbar
- Check `modelUrl` Pfad
- Check `scale` (zu klein? zu groß?)
- Check Browser Console für GLB-Ladefehlern
- Check Console auf `[InstancedRenderer] ... will not render`: Clone oder VAT-Bake ist gescheitert, der Typ hat keinen Pool

### Animation spielt nicht
- Check `hasAnimations: true` gesetzt
- Check Animation-Name exakt wie in GLB/FBX; nur Clips aus `walkAnimation`, `runAnimation` und `deathAnimation(s)` werden gebacken
- Check `animationSpeed` nicht 0

### Sound spielt nicht
- Check Sound-Datei existiert
- Check `movingSoundVolume` > 0
- Check `startMoving()` wurde aufgerufen

### Enemy läuft zu weit seitlich
- Reduziere `lateralSpread` (z.B. von 1.0 auf 0.5). Läuft er auf Fassaden, ist der Korridor zu breit: `__routes.describe()` zeigt Breite und Quelle je Abschnitt

### Enemy bewegt sich nicht
- Check `baseSpeed` > 0
- Check Path hat mindestens 2 Waypoints
- Check `paused` Flag (sollte false sein)

---

## Siehe auch

- [TOWER_CREATION.md](TOWER_CREATION.md) - Tower erstellen
- [STATUS_EFFECTS.md](STATUS_EFFECTS.md) - Status-Effekt-System
- [WAVE_SYSTEM.md](WAVE_SYSTEM.md) - Wave-Konfiguration
- [SPATIAL_AUDIO.md](SPATIAL_AUDIO.md) - 3D Audio Details
- [ARCHITECTURE.md](ARCHITECTURE.md) - System-Übersicht
