# Enemy Creation Guide

**Stand:** 2026-01-17

Anleitung zum Erstellen neuer Enemy-Typen mit Animationen, Sounds und visuellen Effekten.

---

## Übersicht

Enemies werden über die Konfigurationsdatei `models/enemy-types.ts` definiert. Das System unterstützt:

- Verschiedene 3D-Modelle (GLB, FBX) mit Skelett-Animationen
- Walk-, Run- und Death-Animationen mit Speed-Coupling
- Spatial Audio (Loop-Sounds, Random Sounds, Spawn Sounds)
- Status-Effekte (Slow, Freeze, Burn)
- Air und Ground Units
- Lateral Offset und Height Variation für Bewegungsvariation
- Boss-Enemies mit Custom Health Bar
- Bluteffekte und visuelle Anpassungen

---

## Schritt-für-Schritt: Neuen Enemy hinzufügen

### 1. EnemyTypeId erweitern

```typescript
// models/enemy-types.ts
export const ENEMY_TYPES: Record<string, EnemyTypeConfig> = {
  zombie: { ... },
  tank: { ... },
  bat: { ... },
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

  // Stats
  baseHp: 150,
  baseSpeed: 5,    // m/s
  damage: 15,      // Schaden an Basis
  reward: 2,       // Credits bei Kill

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

  // Movement Variation
  lateralOffset: 2.0,     // ±2m seitlicher Versatz
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

### Boss Health Bar

```typescript
healthBarColor: '#ef4444',   // Rote Healthbar
bossName: 'Boss',            // Name über Healthbar
immunityPercent: 100,        // "Immun 100%" Anzeige
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

**Stacking:** Slow-Effekte multiplizieren sich
- 1x Slow 50%: `speedMultiplier = 0.5`
- 2x Slow 50%: `speedMultiplier = 0.25` (75% langsamer)

### Freeze (Einfrieren)

```typescript
// Noch nicht implementiert
type: 'freeze',
value: 1.0,  // Komplett eingefroren
```

### Burn (Brennen - DoT)

```typescript
// Noch nicht implementiert
type: 'burn',
value: 10,   // Schaden pro Sekunde
```

Siehe [STATUS_EFFECTS.md](STATUS_EFFECTS.md) für Details.

---

## Beispiele

### Standard Ground Enemy (Zombie)

```typescript
zombie: {
  id: 'zombie',
  name: 'Zombie',
  modelUrl: '/assets/models/enemies/zombie_01.glb',
  scale: 2.0,
  minimumPixelSize: 0,
  baseHp: 100,
  baseSpeed: 5,
  damage: 10,
  reward: 1,
  hasAnimations: true,
  walkAnimation: 'Armature|Walk',
  deathAnimation: 'Armature|Die',
  animationSpeed: 2.0,
  movingSound: '/assets/sounds/zombie-sound-2-357976.mp3',
  movingSoundVolume: 0.4,
  movingSoundRefDistance: 25,
  heightOffset: 0,
  healthBarOffset: 8,
  canBleed: true,
  randomAnimationStart: true,
  randomSoundStart: true,
  lateralOffset: 3.0,
},
```

### Air Unit (Bat)

```typescript
bat: {
  id: 'bat',
  name: 'Fledermaus',
  modelUrl: '/assets/models/enemies/bat_new.glb',
  scale: 7,
  minimumPixelSize: 0,
  baseHp: 80,
  baseSpeed: 8,
  damage: 5,
  reward: 3,
  hasAnimations: true,
  walkAnimation: 'fly.001',
  animationSpeed: 1.5,
  heightOffset: 15,        // 15m Flughöhe
  healthBarOffset: 4,
  canBleed: false,
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
  modelUrl: '/assets/models/enemies/herbert_walking.glb',
  scale: 4.0,
  minimumPixelSize: 0,
  baseHp: 5000,            // Sehr hohe HP
  baseSpeed: 4,
  damage: 20,
  reward: 8,
  hasAnimations: true,
  walkAnimation: 'Armature|walking_man|baselayer',
  animationSpeed: 1.0,

  // Spawn Sound
  spawnSound: '/assets/sounds/herbert_01.mp3',
  spawnSoundVolume: 0.6,

  // Random Sounds Pool (13 Voice Lines)
  randomSounds: [
    '/assets/sounds/herbert_02.mp3',
    // ... 12 weitere
  ],
  randomSoundsMinInterval: 10000,
  randomSoundsMaxInterval: 25000,
  randomSoundsVolume: 0.6,

  heightOffset: 0,
  healthBarOffset: 12,
  healthBarColor: '#ef4444',  // Rote Boss-Bar
  bossName: 'Boss',
  immunityPercent: 100,       // "Immun 100%"
  canBleed: true,
  randomAnimationStart: true,
  lateralOffset: 2.0,
},
```

### Run-Animation Enemy (Wallsmasher)

```typescript
wallsmasher: {
  id: 'wallsmasher',
  name: 'Wallsmasher',
  modelUrl: '/assets/models/enemies/wallsmasher_01.fbx',
  scale: 0.05,
  minimumPixelSize: 0,
  baseHp: 500,
  baseSpeed: 7,
  damage: 30,
  reward: 20,
  hasAnimations: true,
  walkAnimation: 'CharacterArmature|Walk',
  runAnimation: 'CharacterArmature|Run',
  deathAnimation: 'CharacterArmature|Death',
  animationSpeed: 1.5,
  animationVariation: true,    // Wechselt zwischen Walk/Run
  runSpeedMultiplier: 2.5,     // 2.5x Speed bei Run

  spawnSound: '/assets/sounds/big_arm_spawn.mp3',
  randomSound: '/assets/sounds/big_arm_01.mp3',
  randomSoundMinInterval: 8000,
  randomSoundMaxInterval: 25000,

  heightOffset: 0,
  healthBarOffset: 12,
  canBleed: true,
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
- [ ] Bei Boss: `healthBarColor`, `bossName`, `immunityPercent` gesetzt

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
  useGathering: false,
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
