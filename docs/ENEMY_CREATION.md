# Enemy Creation Guide

**Stand:** 2026-05-12

Anleitung zum Erstellen neuer Enemy-Typen mit Animationen, Sounds und visuellen Effekten.

---

## Übersicht

Enemies werden über die Konfigurationsdatei `configs/enemy-types.config.ts` definiert (vorher `models/enemy-types.ts`, 2026-05-10 umgezogen — siehe DONE.md). Das System unterstützt:

- Verschiedene 3D-Modelle (GLB, FBX) mit Skelett-Animationen (VAT-instanziert)
- Walk-, Run- und Death-Animationen mit Speed-Coupling
- Spatial Audio (Loop-Sounds, Random Sounds, Spawn Sounds, Random-Sounds-Pool mit Shuffle)
- Status-Effekte (Slow, Poison — Freeze/Burn Typen reserviert)
- Air und Ground Units
- **Damage/Armor-Matrix** (`armorType` Pflichtfeld, Phase 5.x)
- Lateral Offset und Height Variation für Bewegungsvariation
- Boss-Enemies mit Custom Health Bar
- Bluteffekte (`canBleed`), Emissive Glow, Color Multiplier, Unlit Rendering
- Konfigurierbare Sidebar-Preview (Camera Distance / Angle / Offset)
- `isElite`-Flag für visuelle Markierung stärkerer Varianten

---

## Aktuelle Enemy-Typen (17)

| Enemy | armorType | baseHp | Speed | Air? | Besonderheit |
|-------|-----------|--------|-------|------|--------------|
| zombie | unarmored | 80 | 5 | – | Standard-Gegner |
| zombie-soldier | heavy | 160 | 6 | – | Stärkere Variante mit Emissive |
| rat | unarmored | 5 | 10 | – | Schwächster Swarm-Gegner |
| spider | light | 60 | 9 | – | Schneller, wenig HP |
| penguin | unarmored | 30 | 9 | – | Unlit Cartoon-Style |
| wallsmasher | light | 200 | 7 | – | Walk/Run-Variation, `runSpeedMultiplier: 2.5`, **silent-spawn** (kein `spawnSound`) |
| bat | light | 25 | 8 | ✓ | Air-Unit, `heightOffset: 15` |
| hornet | light | 80 | 9 | ✓ | Air-Unit, `heightOffset: 18` |
| dragon | heavy | 450 | 6 | ✓ | Air-Boss-Tier, `heightOffset: 20` |
| tank | heavy | 250 | 3 | – | Mechanisch, `canBleed: false` |
| bear | heavy | 300 | 8 | – | Random Growl Sound |
| mech | heavy | 500 | 3 | – | Mechanisch, idle/walk |
| mammoth | fortified | 400 | 3 | – | Random Mammoth Call |
| herbert | fortified | 500 | 4 | – | Boss, `immunityPercent: 100` |
| **stone-golem** | fortified | 480 | 2.5 | – | Neuer Fortified-Gegner (2026-05-12), `canBleed: false`, `randomAnimationStart: true`, `lateralOffset: 2.0`, `spawnStartDelay: 1200` |
| ghost | ethereal | 120 | 5 | – | Nur magic/chaos wirkt voll |
| wraith | ethereal | 100 | 8 | – | Schneller Ethereal |

> **Wichtig (AI-Wave-Director):** Stone Golem ist in der Config registriert, aber im
> Wave-Curriculum (`configs/wave-curriculum.config.ts`) und in den Templates
> (`src/app/ai/core/templates.ts`) **noch nicht** eingebaut — siehe TODO 2.2.
> Im AI-Mode taucht er deshalb aktuell nicht auf.

---

## Schritt-für-Schritt: Neuen Enemy hinzufügen

### 1. EnemyTypeId erweitern

```typescript
// configs/enemy-types.config.ts
export const ENEMY_TYPES: Record<string, EnemyTypeConfig> = {
  zombie: { ... },
  tank: { ... },
  // ... (siehe Tabelle oben für alle 17 aktuellen Typen)
  'new-enemy': { ... }, // Neuer Enemy
};

export type EnemyTypeId = keyof typeof ENEMY_TYPES;
```

### 2. Model-URL definieren

```typescript
const NEW_ENEMY_MODEL_URL = '/assets/models/enemies/new_enemy.glb';
```

**Model-Anforderungen:**
- Unterstützte Formate: GLB, FBX
- Skelett-Animationen optional aber empfohlen
- Benannte Animationen (z.B. `Armature|Walk`, `Armature|Die`)

### 3. Enemy-Konfiguration hinzufügen

```typescript
'new-enemy': {
  id: 'new-enemy',
  name: 'New Enemy',
  modelUrl: '/assets/models/enemies/new_enemy.glb',
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
  isElite: false,              // Visueller Marker für stärkere Variante

  // Movement Variation
  lateralOffset: 2.0,     // ±2m seitlicher Versatz

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
| `deathAnimation` | Optional | Spielt beim Tod (2s Delay vor Remove) |
| `idleAnimation` | Optional | Aktuell nicht verwendet |

### Animation Speed Coupling

Animationen werden automatisch an die Bewegungsgeschwindigkeit gekoppelt:

```typescript
// Berechnung in ThreeEnemyRenderer
const speedRatio = currentSpeed / effectiveBaseSpeed;
animationAction.timeScale = baseAnimSpeed * speedRatio;
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
1. Renderer wählt zufällig Walk (70%) oder Run (30%)
2. Bei Run: `speedMultiplier = runSpeedMultiplier` (z.B. 2.5)
3. Bewegungsgeschwindigkeit: `baseSpeed × speedMultiplier` (z.B. 7 × 2.5 = 17.5 m/s)
4. Animation bleibt gleich schnell (Run-Animation ist bereits schneller im Model)

**WICHTIG:** `runSpeedMultiplier` beeinflusst NUR die Bewegung, NICHT die Animation-Speed.

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

### Elite-Flag

```typescript
isElite: true,  // Visueller Marker für stärkere Variante eines Base-Enemy
```

**Verwendung:** Z.B. von Wave-Director-Templates gesetzt; UI/Renderer können daran z.B. Glow-Aura zeigen.

### Boss Health Bar

```typescript
immunityPercent: 100,        // "Immun 100%" Anzeige
healthBarColor: '#ff0000',   // Optional: feste Health-Bar-Farbe (z.B. Boss)
bossName: 'Boss',            // Optional: Name über Health-Bar (UI-seitig noch nicht überall ausgewertet)
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

### Lateral Offset (Seitlicher Versatz)

```typescript
lateralOffset: 3.0,  // Max. ±3m seitlich zur Route
```

**Effekt:** Jeder Enemy bekommt einen zufälligen seitlichen Versatz zur Pfad-Mitte.

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

---

## Status-Effekte

Enemies können von Towern mit Status-Effekten belegt werden:

### Slow (Verlangsamung)

```typescript
// Automatisch wenn von Ice Tower getroffen
statusEffect: {
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
type: 'poison',
value: 5,         // Schaden pro Sekunde
duration: 4000,   // Game-Time ms
```

### Freeze / Burn (Reserviert)

`freeze` und `burn` sind als `StatusEffectType` definiert, aktuell aber nicht aktiv im Spiel verwendet. Siehe [STATUS_EFFECTS.md](STATUS_EFFECTS.md) für Details.

---

## Beispiele

### Standard Ground Enemy (Zombie)

```typescript
zombie: {
  id: 'zombie',
  name: 'Zombie',
  modelUrl: '/assets/models/enemies/zombie.glb',
  scale: 0.984,
  minimumPixelSize: 0,
  armorType: 'unarmored',
  baseHp: 80,
  baseSpeed: 5,
  reward: 3,
  hasAnimations: true,
  idleAnimation: 'Armature|Idle',
  walkAnimation: 'Armature|Walk',
  deathAnimation: 'Armature|Die',
  animationSpeed: 4.11,
  movingSound: '/assets/sounds/enemies/zombie/ambient.mp3',
  movingSoundVolume: 0.4,
  movingSoundRefDistance: 25,
  heightOffset: 0.5,
  healthBarOffset: 5.5,
  canBleed: true,
  headingOffset: -0.349,
  randomAnimationStart: true,
  randomSoundStart: true,
  lateralOffset: 3.0,
  previewScale: 1,
},
```

### Air Unit (Bat)

```typescript
bat: {
  id: 'bat',
  name: 'Bat',
  modelUrl: '/assets/models/enemies/bat.glb',
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
  canBleed: false,
  headingOffset: 0,
  isAirUnit: true,         // Nur Air-Tower können angreifen
  heightVariation: 3,      // ±3m Variation
  lateralOffset: 2.0,
  randomAnimationStart: true,
},
```

### Boss Enemy (Herbert)

```typescript
herbert: {
  id: 'herbert',
  name: 'Herbert',
  modelUrl: '/assets/models/enemies/herbert_optimized.glb', // optimiertes Mesh
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
  lateralOffset: 2.0,
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
  modelUrl: '/assets/models/enemies/penguin.glb',
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
  canBleed: false,
  unlit: true,               // Cartoon-Style ohne Beleuchtung
  headingOffset: 0,
  randomAnimationStart: true,
  lateralOffset: 2.5,
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
  modelUrl: '/assets/models/enemies/wallsmasher.fbx',
  scale: 0.037,
  minimumPixelSize: 0,
  armorType: 'light',
  baseHp: 200,
  baseSpeed: 7,
  reward: 5,
  hasAnimations: true,
  walkAnimation: 'CharacterArmature|Walk',
  runAnimation: 'CharacterArmature|Run',
  deathAnimation: 'CharacterArmature|Death',
  animationSpeed: 1.31,
  animationVariation: true,    // Wechselt zwischen Walk/Run
  runSpeedMultiplier: 2.5,     // 2.5x Speed bei Run

  // Kein spawnSound — Wallsmasher-Rush ist als visuelle Überraschung gedacht.
  // `enemy.entity.ts` gateet beide Pfade (Register + Play) durch
  // `if (this.typeConfig.spawnSound)`, also bleibt der Spawn ohne Property lautlos.
  randomSound: '/assets/sounds/enemies/wallsmasher/attack.mp3',
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
  lateralOffset: 2.0,
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
- [ ] Bei Run-Animation: `runSpeedMultiplier` gesetzt
- [ ] Bei Boss: `immunityPercent` gesetzt
- [ ] `previewScale` gesetzt falls Model im Sidebar-Preview zu gross/klein

---

## Integration in Waves

Siehe [WAVE_SYSTEM.md](WAVE_SYSTEM.md) für Wave-Konfiguration.

**Quick Example:**

```typescript
// In WaveDebugComponent oder Tower Defense
this.waveManager.startWave({
  enemyCount: 10,
  enemyType: 'new-enemy',  // Your new enemy type
  enemySpeed: 5,
  spawnMode: 'random',
  spawnDelay: 500,
});
```

---

## Technische Details

### Enemy-Lifecycle

```
1. Spawn (EnemyManager)
   ↓
2. Initialize Components (Transform, Health, Movement, Audio)
   ↓
3. Create 3D Model (ThreeEnemyRenderer)
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

Enemies werden automatisch vom `ThreeEnemyRenderer` gerendert:

```typescript
// In EnemyManager
this.tilesEngine.enemies.create(enemy.id, typeId, lat, lon, height);
this.tilesEngine.enemies.update(enemy.id, lat, lon, height, rotation, healthPercent);
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

1. **Animation Speed:** `animationSpeed: 1.0` als Basis, anpassen bis Bewegung natürlich wirkt
2. **Sound Volumes:** Loop-Sounds leiser (0.2-0.4), Spawn-Sounds lauter (0.5-0.7)
3. **Lateral Offset:** 2-3m für natürliche Bewegung, nicht zu viel (sonst laufen sie von der Route)
4. **Boss Health:** 10x normale Enemies (z.B. 500-5000 HP)
5. **Base Speed:** 3-5 m/s für langsame, 6-8 m/s für schnelle, 10+ m/s für Air Units
6. **Health Bar Offset:** `scale * 4` als Faustregel

---

## Troubleshooting

### Enemy spawnt unsichtbar
- Check `modelUrl` Pfad
- Check `scale` (zu klein? zu groß?)
- Check Browser Console für GLB-Ladefehlern

### Animation spielt nicht
- Check `hasAnimations: true` gesetzt
- Check Animation-Name exakt wie in GLB/FBX
- Check `animationSpeed` nicht 0

### Sound spielt nicht
- Check Sound-Datei existiert
- Check `movingSoundVolume` > 0
- Check `startMoving()` wurde aufgerufen

### Enemy läuft zu weit seitlich
- Reduziere `lateralOffset` (z.B. von 5.0 auf 2.0)

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
