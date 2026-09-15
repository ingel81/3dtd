# Enemy Creation Guide

**Stand:** 2026-09-15

Anleitung zum Erstellen neuer Enemy-Typen mit Animationen, Sounds und visuellen Effekten.

---

## Übersicht

Enemies werden über die Konfigurationsdatei `configs/enemy-types.config.ts` definiert (vorher `models/enemy-types.ts`, 2026-05-10 umgezogen, siehe DONE.md). Das System unterstützt:

- 3D-Modelle als GLB mit Skinning- oder Node-Animationen, als VAT instanziert gerendert ([INSTANCED_ENEMY_RENDERING.md](INSTANCED_ENEMY_RENDERING.md))
- Walk-, Run- und Death-Animationen mit Speed-Coupling
- Spatial Audio (Loop-Sounds, Random Sounds, Spawn Sounds, Random-Sounds-Pool mit Shuffle)
- Status-Effekte (Slow, Poison, Burn, Freeze, Stun; [STATUS_EFFECTS.md](STATUS_EFFECTS.md))
- Air und Ground Units
- **Damage/Armor-Matrix** (`armorType` Pflichtfeld, Phase 5.x)
- Lateral Spread und Height Variation für Bewegungsvariation
- Boss-Enemies mit Custom Health Bar
- Ein Körper entlang der Route statt eines Modells (`ooze`, siehe [Körper entlang der Route](#körper-entlang-der-route-ooze))
- Bluteffekte (`canBleed`, Farbe `bloodColor`), Emissive Glow, Color Multiplier, Unlit Rendering
- Konfigurierbare Sidebar-Preview (Camera Distance / Angle / Offset)

---

## Aktuelle Enemy-Typen

Alle Einträge aus `ENEMY_TYPES`. Modellkosten je Typ (Vertices, VAT, Bake-Pfad) stehen in den
generierten Tabellen von [ENEMY_MODEL_BUDGET.md](ENEMY_MODEL_BUDGET.md#messwerte).

| Enemy | armorType | baseHp | Speed | Air? | Besonderheit |
|-------|-----------|--------|-------|------|--------------|
| zombie | unarmored | 80 | 5 | – | Standard-Gegner |
| zombie-v2 | unarmored | 80 | 3 | – | Zweites Zombie-Modell, Todes-Clip-Pool `deathAnimations: ['Dead', 'dying_backwards', 'Electrocuted_Fall']` (der letzte auf den Sturz geschnitten), 10 % der `zombie_horde` |
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
| **worm** | heavy | 35 je Segment | 4.5 | – | Boss, Kette aus Segmenten (`chain`, siehe [Kette](#kette-chain-der-wurm)), jedes Segment ein eigener Gegner; Endlos-Rotation ab W35, kein Template |
| worm-segment | heavy | 35 | 4.5 | – | Modell der Wurm-Segmente (eigener VAT-Pool, statisch). Einzeln gespawnt ein einzelner Ring mit den Werten des Wurms |
| **ooze** | unarmored | 3000 | 3 | – | Boss (2026-09-14), `isBoss`, ein Körper entlang der Route statt eines Modells ([Körper entlang der Route](#körper-entlang-der-route-ooze)), fließt an der HQ Meter für Meter hinein, zerfällt beim Kill in Slime Clumps. Boss-Variante der Endlos-Rotation, kein Template |
| slime-clump | unarmored | 15 | 4.5 | – | Nur aus dem Split der Ooze, kein Template. `slime.glb` bei `scale: 0.9` (Hüpfer `Wobble`, Tod `Splat`), grünes Blut (`bloodColor`) |

> **Wave-Director:** Stone Golem ist seit 2026-08-27 angebunden: Template
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
  // ... (siehe Tabelle oben für alle Typen)
  'new-enemy': { ... }, // Neuer Enemy
};

export type EnemyTypeId = keyof typeof ENEMY_TYPES;
```

### 2. Model-URL definieren

```typescript
const NEW_ENEMY_MODEL_URL = 'assets/models/enemies/new_enemy.glb';
```

**Model-Anforderungen:**
- Format: GLB (glTF). Einen FBX-Ladepfad gibt es nicht mehr, der Wallsmasher kam 2026-09-13 als letztes FBX-Modell auf GLB
- Animation per Skinning (SkinnedMesh) oder per Node-Transform starrer Teile (Skeleton, Hornet); ohne Animation wird das Modell statisch gebacken. Welcher Typ welchen Pfad nimmt, zeigt die Spalte „Bake-Pfad“ in [ENEMY_MODEL_BUDGET.md](ENEMY_MODEL_BUDGET.md#messwerte)
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
| `deathAnimation` | Optional | Spielt beim Tod, bis der Gegner nach `deathDuration` (Standard 2 s) entfernt wird. Gebacken wird nur dieser Teil (`animationSpeed` × `deathDuration` Clip-Zeit), der Rest des Clips ist nie zu sehen |
| `deathAnimations` | Optional | Pool von Todes-Clips, einer zufällig pro Kill; gekürzt wie `deathAnimation` |

Idle-Clips werden nicht gebacken, das Spiel zeigt keine stehenden Gegner.

Ein Todes-Clip muss am Boden liegen, wenn der Gegner entfernt wird, sonst verschwindet er im
Fallen. Das geschieht `deathDuration` ms nach dem Kill (`EnemyTypeConfig`, Standard
`TIMING.deathAnimationDuration` = 2000), in Clip-Zeit also nach `animationSpeed` ×
`deathDuration`. `tools/model-budget/death-rest.spec.ts` prüft das an den Modelldateien: Nach
dem Entfernen bewegt sich kein Vertex eines Todes-Clips mehr als 5 % der Modellhöhe. Zombie v2
(`Dead`), Stone Golem und Zombie Soldier fielen nach 2 s noch; seit dem Playtest vom
2026-09-15 haben sie eine `deathDuration`, in der ihr längster Todes-Clip ganz läuft (3000,
3000 und 3300 ms). Eine längere `deathDuration` verschiebt auch das Wellenende, denn Gegner in
der Todesanimation zählen dort mit (`getKillingCount()`).

`zombie-v2` hatte `Electrocuted_Fall` im Pool, dessen Fall erst nach etwa 3,25 s beginnt; der
Clip flog raus (fd18a10). Seit `05b25233` ist er in Blender auf den Sturz (3,0 bis 5,0 s)
geschnitten und wieder im Pool. Ein kürzerer Clip hält seinen letzten Frame bis zum Entfernen
(Skeleton: `die` mit 0,33 s).

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

Die Ooze nutzt keines dieser Felder: Ihr Körper liegt entlang der Route, ihre
Sounds (Blubber-Loop am nächsten Körperpunkt, Splat, Schlürfen) spielt
`OozeSounds`, siehe [Körper entlang der Route](#körper-entlang-der-route-ooze).

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
isBoss: true,                // Boss-Leiste oben mittig (Label: name), Screen-Shake beim Tod (Preset bossDeath), kleinerer Anteil bei Abilities
```

### Blood Effects

```typescript
canBleed: true,         // Blutpartikel + Decals bei Treffer/Tod
bloodColor: '#6fe021',  // Optional: Farbe von Partikeln und Decals, sonst Dunkelrot
```

### Maschinen

```typescript
mechanical: true,  // Eine Maschine, kein Lebewesen: Tank und Mech (Stand 2026-09-14)
```

Elektrische Wirkungen, die Maschinen lahmlegen, treffen sie härter (EMP, siehe [ABILITIES.md](ABILITIES.md)). Gilt pro Typ wie `isBoss`. Nicht dasselbe wie `canBleed: false`: Skelett, Geist und Golem bluten nicht und sind trotzdem keine Maschinen.

**WICHTIG:** Nur für organische Gegner (Zombies, Menschen). `false` für Roboter, Panzer, etc.
`bloodColor` läuft über `vfx:blood` (`color`) bis in Splatter und Decal; Ooze und Slime Clump
bluten Schleimgrün. Ein blutender Gegner, der sich teilt, spritzt zusätzlich an jedem Kind in
seiner Farbe (VFXService, `enemy:split`).

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

**Aus dem Spawn-Portal:** Lufteinheiten einer Welle sind am Spawn noch nicht auf dieser Höhe.
Sie kommen durch die Mitte der Portalöffnung, fliegen bis 8 m hinter die vordere Fläche
waagrecht und steigen dann über 30 m Route auf `heightOffset` plus Variation (`AIR_PORTAL_EXIT`
in `configs/marker-geometry.config.ts`). Die aktuelle Höhe über `terrainHeight` steht je Gegner
in `Enemy.heightOffset`: Wer etwas am Modell platziert oder darauf zielt, liest diesen Wert,
nicht `typeConfig.heightOffset`. Debug-Spawns und Split-Kinder starten auf Flughöhe.

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
(Ursache `'debug'` in `EnemyManager.kill()`). Umgesetzt für den Skeleton und die
Ooze; die Ooze teilt sich entlang ihres Körpers statt an einer Stelle (siehe
[Körper entlang der Route](#körper-entlang-der-route-ooze)).

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

### Kette (`chain`, der Wurm)

```typescript
chain: {
  segmentModel: 'worm-segment', // VAT-Pool der Körpersegmente
  spacing: 2.5,                 // Abstand der Segmente auf der Routenmitte (m)
  minSegments: 16,
  maxSegments: WORM_MAX_SEGMENTS, // 240
  sway: 0.35,                   // Schlängeln, Anteil des Korridors
  swayWavelength: 40,           // Länge einer Schlängelwelle (m)
},
```

Ein Spawn eines Typs mit `chain` setzt einen ganzen Wurm auf die Route (`managers/worm/`).
Umgesetzt für Skarnax, the Thousand-Legged Calamity (`worm`).

- **Länge:** so viele Segmente, dass der Kopf das HQ erreicht, wenn das letzte Segment den
  Start verlässt (`floor(Routenlänge / spacing) + 1`), mindestens `minSegments`, höchstens
  `maxSegments`. Die Obergrenze `WORM_MAX_SEGMENTS` = 240 (600 m) ist eine Leistungsgrenze:
  Jedes Segment ist ein ganzer Gegner (Targeting, Health-Bar, Kill-Gold-Slot, VAT-Instanz),
  und 240 × 2,5 m brauchen bei 4,5 m/s 133 s, bis sie aus dem Portal sind. Längere Routen
  bekommen einen Wurm dieser Länge.
- **Segmente:** Jedes Segment ist ein `Enemy` des Typs `worm` mit eigener HP; `healthOverride`
  gilt je Segment (Custom Wave: „Health“ ist die HP eines Segments). Der Kopf nutzt das Modell
  des Typs, der Körper das von `segmentModel`. `Enemy.worm` (`WormLink`) hält Gruppe, Slot,
  Kopf-Flag und das Ziel des Segments in diesem Sub-Step.
- **Bewegung:** `WormChains.tick()` läuft pro Sub-Step vor der Enemy-Schleife. Eine Kette
  schiebt eine Front-Distanz vor, im Mittel der Slows ihrer Segmente auf der Route (ein
  verlangsamtes Segment bremst den ganzen Wurm), und gibt jedem Segment Distanz und Platz quer
  zur Route vor. `stepWormSegment()` setzt es mit `MovementComponent.seekDistance()` auf diese
  Distanz, `WormPath.place()` stellt es hin. Pro Segment wird nichts aufintegriert, der Abstand
  bleibt bei jeder Timescale exakt. Das Schlängeln (`wormSway`) hängt nur von der Routendistanz
  ab: Der Körper läuft durch die S-Kurve des Kopfes, gerade aus dem Portal und erst nach dessen
  vorderer Fläche geschlängelt.
- **Ecken (`managers/worm/worm-path.ts`):** Der Körper läuft nicht über den spitzen Knick eines
  Wegpunkts, sondern über einen Bogen mit bis zu `WORM_BEND_RADIUS_M` = 20 m. Die Distanzen
  bleiben die der Routenmitte (Targeting-Reihenfolge, Leck, Abstand, Schlängeln), nur Ort und
  Blickrichtung kommen vom Bogen. Er wird gleichmäßig durchlaufen und ist kürzer als die beiden
  Schenkel, die Ringe rücken in der Ecke also etwas zusammen (bei 90° auf 0,79). Die
  Blickrichtung ist die Sehne von 1,25 m hinter bis 1,25 m vor dem Segment, in Metern gerechnet,
  direkt gesetzt (`TransformComponent.setHeading()`, ohne Nachlauf). Im Korridor hält den Bogen
  sein Radius: Die tiefste Stelle, `Radius · (1 − cos(Knick/2))` innen, bleibt über den ganzen
  Bogen im Lateral-Limit der Innenseite, und zwei Bögen teilen sich das Segment zwischen ihren
  Wegpunkten. Schlängeln zur Innenseite wird auf den Rest gekürzt. Gemessen
  (`worm-corner.spec.ts`, Standardkorridor 3 m Limit): Außenspalt bei 90° 0,15 m (Radius dort
  10,2 m, vom Korridor begrenzt), höchstens 0,36 m zwischen 10° und 90°; vorher 5,2 m bei 90°.
  Auf einer schmalen Straße (1,25 m Limit) bekommt 90° nur 4,3 m Radius, Spalt 0,8 m. Ohne
  Innenraum (Halbbreite bis 1,5 m) bleibt die Ecke spitz.
- **Aus dem Portal:** Ein Segment erscheint, wenn sein Slot am Routenstart Distanz 0
  erreicht, also eins nach dem anderen. Wer noch nicht draußen ist, ist kein Gegner (kein
  Ziel). Ein zweiter Wurm auf demselben Pfad wartet mit dem Kopf im Portal hinter dem ersten.
- **Zerstörtes Segment:** Der Wurm zerfällt in zwei unabhängige Würmer
  (`WormGroup.lose()`). Das erste Segment hinter der Lücke wird Kopf und wechselt in den Pool
  des Kopfmodells (`InstancedEnemyRenderer.setRenderType()`). Jeder Teil läuft in seinem
  eigenen Tempo, rückt dem Teil davor aber nicht näher als zwei Abstände (die Lücke eines
  Segments). Ein Leck am HQ und ein entferntes Segment trennen genauso.
- **Welle:** Die Welle endet erst, wenn auch die Segmente im Portal draußen und besiegt sind
  (`EnemyManager.getPendingSpawnCount()`). Ein Wurm-Eintrag zählt als ein Gegner im Schedule
  und als `size` Körper für das Kill-Gold; `worm:spawned` erhöht Gesamtzahl und Rest im
  Wave-Panel. `debug:kill-all` nimmt die Segmente im Portal mit.
- **Boss:** `isBoss` steht auf beiden Typen, also bekommt jedes Segment den Boss-Anteil der
  Fähigkeiten. Die Boss-Leiste zeigt einen Balken für den ganzen Wurm (HP aller Teile,
  „Skarnax ×3“ nach zwei Splits), der Screen-Shake kommt einmal, mit dem letzten Segment.
- **Enemy Debug:** Ein platzierter Wurm sitzt auf der Route selbst (`SpawnStart` der
  Platzierung) und kommt dort heraus statt aus dem Portal: Seine Segmente erscheinen an dieser
  Stelle (`WormGroup.origin`), er ist so lang wie die Route ab dort, das Schlängeln setzt ab
  dort ein. Die Liste zeigt den Kopf. Entfernen nimmt den ganzen Wurm samt Segmenten, die noch
  nicht draußen sind, mit. Ein platzierter (pausierter) Wurm steht, bis sein Kopf gestartet
  wird; ist kein Segment mehr draußen, kommt der Rest von selbst heraus.
- **Reihenfolge auf einer Route:** Die Ketten eines Pfads laufen pro Sub-Step von vorn nach
  hinten (Front, bei gleicher Stelle der ältere Wurm zuerst). Eine Kette, die noch Segmente
  herausbringen muss, endet für die dahinter an ihrem Ursprung: Ein Wurm aus dem Portal wartet
  hinter einem platzierten, bis der ganz draußen ist.
- **Director:** kein Template, kein Curriculum-Slot, nicht in `AI_ENEMY_ORDER`;
  `ai-schema.json` und Encoder bleiben gleich. In Wellen kommt der Wurm über die
  Boss-Rotation ab W35 (`configs/boss-variants.config.ts`, siehe
  [WAVE_SYSTEM.md](WAVE_SYSTEM.md#boss-waves)).
- **Modelle:** `worm_head.glb` und `worm_segment.glb` (`tools/blender/worm_boss.py`),
  statisch, je eine 512²-Basisfarbe, Blick nach +z, Pivot am Boden unter der Ringmitte.
  `WORM_MODELS` in `enemy-types.config.ts` fasst alles Modellabhängige zusammen (URL, Skala,
  Offsets, Abstand). Skala 2,5: 7,2 m breit mit Beinen, 4,5 m hoch, ein Ring alle 2,5 m (der
  `PITCH` des Skripts, 1,0 Einheiten, mit 0,10 Überlappung). Der Kopf sitzt wie ein Ring auf
  dem vordersten Knoten der Kette, sein Kragen deckt den Ring dahinter. Das Schlängeln ist so
  flach, dass die Ringe am Körper geschlossen bleiben; Routenecken rundet `WormPath` (siehe
  Ecken).
- **Kein Sound:** Alle Segmente sind vom Typ `worm`, ein Loop-Sound liefe auf jedem Segment
  und belegte das Budget von 12 Gegner-Sounds.

---

## Körper entlang der Route (`ooze`)

Die Ooze (Gallert-Boss, 2026-09-14) steht nicht als Modell auf der Route, ihr
Körper ist ein Stück der Route selbst: von der Spitze, die wie jeder Gegner den
Pfad entlangläuft, zurück bis zum Schwanz. Ein Gegner, ein HP-Pool. Ein Typ
bekommt das über `ooze: OozeConfig`:

```typescript
ooze: {
  // ...
  isBoss: true,
  lateralSpread: 0,   // die Spitze bleibt auf der Mittellinie, der Körper füllt den Korridor
  ooze: { maxLengthM: 80, leakDamageFactor: 10 },
  splitOnDeath: { type: 'slime-clump', count: 20, spread: 0.8 },
  bloodColor: '#6fe021',
}
```

| Punkt | Regel | Code |
|---|---|---|
| Wachstum | Der Schwanz bleibt, wo die Ooze den Pfad betritt (bei einer Wellen-Ooze am Portal), bis der Körper `maxLengthM` lang ist (80 m); danach folgt er der Spitze im selben Abstand. Bei 3 m/s ist der Körper nach knapp 27 s voll | `OozeBody.grow` (`entities/ooze-body.ts`), im Enemy-Sub-Step über `OozeBodies.update` (`managers/ooze-bodies.ts`) |
| Stationen | Je Pfad einmal: alle 2 m ein Punkt der Mittellinie mit lokaler und Geo-Position, Richtung quer, Korridor-Halbbreiten, Segment und Fortschritt | `RouteBodyStations` (`utils/route-body.ts`) |
| Zielen | Jeder Tower zielt auf den nächsten Punkt des Körpers in Reichweite und Sicht. Je Tower und Pfad sind die Punkte einmal sortiert (Station, quer zum Tower verschoben bis zur seitlichen Grenze, damit der Punkt in einer Route-Zelle liegt); je Tower-Zug gilt der nächste Punkt zwischen Schwanz und Spitze, dessen Zelle der Tower am Boden sieht, ohne Antwort der Zelle ein Raycast (höchstens 4 je Auflösung). Die Raycast-Antworten bleiben in der Punktliste, bis sich die Tiles ändern (`TerrainQueries.lodVersion`) oder die Liste neu gebaut wird (Reichweite, Grid-Generation) | `BodyAim` (`services/combat/body-aim.ts`), `Tower.findTarget(…, bodyDistSq)` |
| Bekannte Lücke | BodyAim trifft die Ooze auch an Punkten, deren Zelle keinen LOS-Eintrag des Towers hat (Raycast-Rückfall), etwa wo die Zellmitte knapp außerhalb der Reichweite liegt: ein Ring bis etwa 1,4 m bei 2-m-Zellen. Ein Gegner in so einer Zelle, auch ein Klumpen der getöteten Ooze, ist für diesen Tower kein Kandidat, denn die Zelle steht nicht in `visibleCells`. Bewusst so gelassen: Der Befund aus Playtest 363 (alte Tower lassen Klumpen teils aus) ließ sich damit nicht erklären und nicht nachstellen | `BodyAim.resolve`, `TowerCombatService.collectCandidates` |
| Diagnose | `__towerTargets()` in DevTools: je Tower mit einem Gegner in der Nähe eine Zeile, warum er ein Ziel hat oder keins (kein Kandidat in `visibleCells` samt den Antworten der Zellen, Kandidaten nur außerhalb der Reichweite, noch nicht genommen, schläft, LOS noch offen; mit Ziel Cooldown und Turm-Ausrichtung). `__towerTargets.watch()` loggt nach dem Zerfall einer Ooze 6 s lang (oder bis alle Klumpen weg sind) jede Sekunde eine Zeile je Tower nahe den Klumpen; zerfällt in der Zeit eine zweite Ooze, folgt die Sonde nur noch deren Klumpen. `__towerTargets.watch(false)` beendet das | `TowerTargetConsole` (`services/debug/tower-target-console.ts`) |
| Treffpunkt | Projektile fliegen zum Zielpunkt (`Projectile.aimPoint`), auch wenn die Ooze unterwegs stirbt; Flammenkegel, Tentakel und Blitz treffen dort. Zeigt der Flammenkegel auf ein anderes Ziel und liegt der Zielpunkt daneben, prüft er noch die Körperpunkte nächst seinem Ende und seiner Mitte (`bodyPointInCone`, `utils/body-cone.ts`), ohne eigene Sichtprüfung für diesen Punkt. Blut, Schadenszahlen, Eis und DoT-Zahlen erscheinen am Punkt des letzten Treffers; ein DoT-Tick zieht ihn vorher auf den nächsten Punkt des Körpers nach, falls der Schwanz schon daran vorbei ist | `RouteBody.hit`, `enemyHitSpot` (`utils/enemy-hit-spot.ts`), `CombatEffectService.keepHitOnBody` |
| Umkreis | Splash und Nuklearschlag nehmen den Körper einmal auf, sobald ihr Kreis einen Punkt des Bands erreicht (0,9 der Halbbreite je Seite); die Splash-Abnahme rechnet mit dem Abstand zu diesem Punkt | `GlobalRouteGrid.getEnemiesInRadius` |
| Grid | Die Ooze steht in keiner Zelle und nicht im Spatial-Grid, sondern in der Körperliste des Route-Grids. Tower bekommen sie als Kandidat dazu, der Weckcheck schlafender Tower fragt `hasBodyWithin` | `getBodyEnemies`, `tower-combat.service.ts` |
| Status-Effekte | Wirken auf das Ganze: Slow verlangsamt die Spitze, der Schwanz folgt; Poison und Burn ticken auf den einen Pool. Das Band tönt sich (Slow blau, Poison dunkler, Burn glüht) | wie jeder Gegner, `OozeBandRenderer.setFrame` |
| Leck | An der HQ bleibt die Spitze stehen, der Körper fließt mit dem Tempo der Spitze hinein (Slow wirkt, pausiert fließt nichts). Jeder Meter kostet `leakDamageFactor × enemyBaseDamageForWave(welle) / maxLengthM`, bei 10 und 80 m 0,125 Lecks, abgerechnet in ganzen Punkten als `enemy:leaking` und gedeckelt durch `maxLeakDamagePerWave` wie jedes Leck. Die HP sinken mit der verbleibenden Länge, die Ooze bleibt tötbar. Ist alles drin, kommt einmal `enemy:reached-base` mit dem Rest | `OozeBodies.update`, `OozeBody.flowIn`, `owe`, `settle` |
| Tod | Ein Kill teilt sie über `splitOnDeath` in `slime-clump`s entlang des Körpers, je Kind die Mitte seines Anteils, einer je 4 m verbleibender Körper (`maxLengthM / count`, bis 20), mindestens einer. Bis 2026-09-14 waren es bis zu 10 Clumps zu 30 HP; ein voll gewachsener Körper hält mit 20 zu 15 HP dieselben 300 HP (× HP-Multiplikator). Die Welle reserviert immer 21 statt 11 Gold-Slots (`splitBodyCount`, aus der Config), die Zahl der Clumps folgt aber der Länge. Die Gold-Slots fehlender Clumps bleiben unbezahlt wie bei einem Leck; eine jung getötete Ooze zahlt deshalb weniger aus als vorher. Beim Kill kollabiert das Band (siehe Darstellung) und lässt dabei aus dem ganzen Körper los: platzende Blasen mit Schleimspritzern, grüne Pfützen am Boden und Trümmer (Knochen, Rippen, Schädel, Kiefer mit Zähnen, Brustkörbe, Wirbelsäulen, Helme, Blech, Stiefel, Stoppschilder, Dosen, Leitkegel, Reifen, Ölfässer, Flaschen), `OOZE_DEATH_LOOK`, [PARTICLE_SYSTEM.md](PARTICLE_SYSTEM.md#tod-der-ooze). Der Knochen-Burst an der Spitze entfällt für die Ooze | `EnemyManager.splitOnDeath`, `OozeBodies.splitCount`, `placeSplitChild`, `OozeBodies.died`, `OozeBandRenderer.collapse` |
| Klang | Im Code synthetisiert, kein Asset (`utils/ooze-sound.ts`). Ein Blubber-Loop je Ooze sitzt am Punkt des Körpers, der dem Hörer am nächsten ist, und rückt einmal pro Frame nach; er zählt nicht zum Enemy-Sound-Budget. Beim Kill endet er in einem Splat an diesem Punkt. Fließt die Ooze in die HQ, schlürft es alle 3 m, in Spielzeit. In der Pause steht der Loop | `OozeSounds` (`managers/ooze-sounds.ts`), `OOZE_SOUNDS` (`configs/audio.config.ts`), SPATIAL_AUDIO.md |
| Darstellung | `OozeBandRenderer` (`tilesEngine.oozes`): ein Band pro Ooze. Die Geometrie deckt die ganze Route, wird einmal pro Pfad gebaut und geteilt; pro Frame setzt `presentFrame` nur Uniforms. Den Boden unter dem Körper liest der Renderer einmal je Spielsekunde neu. Aussehen in `OOZE_LOOK`. Nach einem Kill kollabiert das Band über `OOZE_LOOK.collapse` (2 s, `collapse()`): Es kocht und schwillt kurz an, sackt zur Pfütze zusammen, die über die Ränder läuft, und reißt auf, bis nichts bleibt. Ein Leck oder Entfernen sinkt wie bisher über `OOZE_LOOK.dissolve` (0,6 s) | `three-engine/renderers/ooze/` |
| Vorschau | `slime.glb` (Generator `tools/slime-model/build-slime-glb.mjs`) zeigt die Sidebar; für die Ooze bäckt der Instanz-Renderer keinen Pool | `InstancedEnemyRenderer.preloadAllModels` |

Wave-Director: Ooze und Slime Clump stehen in keinem Template und nicht in
`AI_ENEMY_ORDER`; Schema, Encoder (208 Werte) und Templates bleiben gleich. In
die Wellen kommt die Ooze als Boss-Variante der Endlos-Rotation, zuerst an W45
(`configs/boss-variants.config.ts`, WAVE_SYSTEM.md, Boss Waves),
außerdem über Custom Wave und das Enemy-Debug-Fenster.

Grenzen:

- Zielpunkte liegen auf den 2-m-Stationen, die Spitze wird auf die nächste Station gerundet.
- Der Fairness-Gate dimensioniert eine Boss-Welle ohne den Gast.
- Die Länge entlang der Route rechnen die Stationen wie die Bewegung mit Haversine, quer im
  lokalen Rahmen; Unterschiede im Zentimeterbereich.
- Die Balance (3000 HP, Leck-Faktor 10, 80 m) ist nicht im Spiel getestet.
- Die Sounds sind nur per Test geprüft (Länge, Pegel, nahtloser Loop), nicht im Browser angehört.

---

## Status-Effekte

Welche Effekte es gibt (Slow, Poison, Burn, Freeze, Stun), wie sie sich stapeln, wie sie
aussehen und wie sie auf Wurm und Ooze wirken, steht in [STATUS_EFFECTS.md](STATUS_EFFECTS.md).
Ein neuer Gegner braucht dafür keine eigenen Felder. Zwei Typ-Flags ändern die Dauer der
Fähigkeiten: `isBoss` hält Freeze und Stun kürzer, `mechanical` den Stun des EMP länger
([ABILITIES.md](ABILITIES.md)).

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
  modelUrl: 'assets/models/enemies/wallsmasher.glb', // in Metern (das FBX bis 2026-09-13 in cm, scale 0.037)
  scale: 3.7,
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

  // Kein spawnSound: Wallsmasher-Rush ist als visuelle Überraschung gedacht.
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
- [ ] Todes-Clip liegt beim Entfernen am Boden (`death-rest.spec.ts` grün, sonst `deathDuration` setzen)
- [ ] Bei Boss: `isBoss: true`, nur wenn der Typ in keiner normalen Welle vorkommt (das Flag gilt pro Typ); optional `healthBarColor` (`immunityPercent` wird derzeit nicht ausgewertet)
- [ ] `previewScale` gesetzt falls Model im Sidebar-Preview zu groß/klein
- [ ] `npm run model-budget` gelaufen, Zeile in [ENEMY_MODEL_BUDGET.md](ENEMY_MODEL_BUDGET.md) liegt im Budget der Klasse
- [ ] Bei `splitOnDeath`: Kind-Typ in `ENEMY_TYPES`, kein Zyklus, `countRange` der Templates an die HP der ganzen Linie angepasst, `npm run ai-schema` gelaufen (`lineageHp`, `bodies`, `maxLeaks`)
- [ ] Bei `chain`: `segmentModel` als eigener Typ in `ENEMY_TYPES` (gleiche Werte, nur das Modell), `spacing` passend zur Segmentlänge, `maxSegments` im Blick auf Gegnerzahl und Wellendauer
- [ ] Bei `ooze`: `lateralSpread: 0`, `modelUrl` nur für die Sidebar-Vorschau, `isBoss` nur ohne Template

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
außer der Ooze (ihr Körper ist ein Band, siehe oben) eine VAT und legt den Pool an.

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
- Check Animation-Name exakt wie im GLB; nur Clips aus `walkAnimation`, `runAnimation` und `deathAnimation(s)` werden gebacken
- Check `animationSpeed` nicht 0

### Sound spielt nicht
- Check Sound-Datei existiert
- Check `movingSoundVolume` > 0
- Check `startMoving()` wurde aufgerufen
- Der Lauf-Loop ist nur bis 500 m um die Kamera zu hören und solange das Budget von 12
  Gegner-Loops reicht (`AUDIO_LIMITS`); ein Gegner außerhalb setzt ein, sobald beides erfüllt ist

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
