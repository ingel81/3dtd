# Wave System

**Stand:** 2026-01-17

Dokumentation des Wave-Systems für automatisches Enemy-Spawning und Spielphasen.

---

## Übersicht

Das Wave-System (`WaveManager`) steuert:
- Spielphasen (Setup, Wave, Game Over)
- Automatisches Enemy-Spawning
- Wave-Konfiguration (Anzahl, Typ, Speed, Spawn-Modus)
- Gathering-Phase (Enemies spawnen pausiert, starten zusammen)
- Wave-Completion-Detection

---

## Architektur

### WaveManager

```typescript
// managers/wave.manager.ts

@Injectable()
export class WaveManager {
  readonly phase = signal<GamePhase>('setup');
  readonly waveNumber = signal(0);
  readonly gatheringPhase = signal(false);

  initialize(spawnPoints: SpawnPoint[], cachedPaths: Map<string, GeoPosition[]>): void;
  startWave(config: WaveConfig): void;
  checkWaveComplete(): boolean;
  endWave(): void;
  reset(): void;
}
```

### Game Phases

```typescript
export type GamePhase = 'setup' | 'wave' | 'gameover';
```

| Phase | Beschreibung |
|-------|--------------|
| `setup` | Initialer Zustand, User kann Tower platzieren |
| `wave` | Wave läuft, Enemies spawnen und bewegen sich |
| `gameover` | Basis zerstört, keine Interaktion mehr |

---

## Wave-Konfiguration

### WaveConfig Interface

```typescript
export interface WaveConfig {
  enemyCount: number;      // Anzahl Enemies
  enemyType: EnemyTypeId;  // Enemy-Typ (z.B. 'zombie', 'tank')
  enemySpeed: number;      // Geschwindigkeit override (m/s)
  spawnMode: 'each' | 'random';  // Spawn-Verteilung
  spawnDelay: number;      // Delay zwischen Spawns (ms)
  useGathering: boolean;   // Gathering-Phase aktivieren
}
```

### Spawn Mode

#### 'each' - Round Robin

Enemies spawnen abwechselnd an jedem Spawn-Point:

```
Spawn Point A: Enemy 1, 4, 7, 10, ...
Spawn Point B: Enemy 2, 5, 8, 11, ...
Spawn Point C: Enemy 3, 6, 9, 12, ...
```

**Verwendung:** Gleichmäßige Verteilung, vorhersehbar

#### 'random' - Zufällig

Jeder Enemy spawnt an einem zufälligen Spawn-Point:

```
Spawn Point A: Enemy 1, 3, 7, 9, ...
Spawn Point B: Enemy 4, 5, 10, ...
Spawn Point C: Enemy 2, 6, 8, 11, ...
```

**Verwendung:** Unvorhersehbar, schwieriger

---

## Wave-Start

### Normale Wave (ohne Gathering)

```typescript
this.waveManager.startWave({
  enemyCount: 10,
  enemyType: 'zombie',
  enemySpeed: 5,
  spawnMode: 'random',
  spawnDelay: 500,        // 500ms zwischen Spawns
  useGathering: false,    // Spawnen und sofort bewegen
});
```

**Verhalten:**
1. Wave-Nummer erhöht sich
2. Phase wechselt zu `'wave'`
3. Enemies spawnen im Abstand von 500ms
4. Jeder Enemy beginnt sofort zu laufen

### Gathering Wave

```typescript
this.waveManager.startWave({
  enemyCount: 20,
  enemyType: 'zombie',
  enemySpeed: 5,
  spawnMode: 'each',
  spawnDelay: 200,
  useGathering: true,     // Gathering aktiviert
});
```

**Verhalten:**
1. Wave-Nummer erhöht sich
2. Phase wechselt zu `'wave'`
3. `gatheringPhase` Signal = `true`
4. Enemies spawnen pausiert (stehen still)
5. Nach dem letzten Enemy: 500ms Delay
6. `gatheringPhase` Signal = `false`
7. Alle Enemies starten gleichzeitig

**Verwendung:**
- Große Wellen (20+ Enemies)
- Boss-Waves (dramatischer Effekt)
- Cinematic Moments

---

## Spawn-Logik (Intern)

### Spawn Loop

```typescript
private startWave(config: WaveConfig): void {
  let spawnedCount = 0;

  const spawnNext = () => {
    // Stop bei Game Over
    if (this.phase() === 'gameover') return;

    // Alle gespawnt?
    if (spawnedCount >= config.enemyCount) {
      if (config.useGathering) {
        // Gathering: Start alle zusammen
        setTimeout(() => {
          if (this.phase() === 'gameover') return;
          this.gatheringPhase.set(false);
          this.enemyManager.startAll(300);
        }, 500);
      }
      return;
    }

    // Spawn-Point wählen
    const spawn = this.selectSpawnPoint(config.spawnMode, spawnedCount);
    const path = this.cachedPaths.get(spawn.id);

    // Enemy spawnen
    if (path) {
      this.enemyManager.spawn(
        path,
        config.enemyType,
        config.enemySpeed,
        config.useGathering  // paused = true wenn gathering
      );
      spawnedCount++;
    }

    // Nächster Spawn
    setTimeout(spawnNext, config.spawnDelay);
  };

  spawnNext();
}
```

### Spawn-Point-Auswahl

```typescript
private selectSpawnPoint(mode: 'each' | 'random', index: number): SpawnPoint {
  if (mode === 'each') {
    // Round robin
    return this.spawnPoints[index % this.spawnPoints.length];
  } else {
    // Random
    return this.spawnPoints[Math.floor(Math.random() * this.spawnPoints.length)];
  }
}
```

---

## Wave-Completion

### Check-Logik

```typescript
checkWaveComplete(): boolean {
  return this.enemyManager.getAliveCount() === 0 && this.phase() === 'wave';
}
```

**Aufruf:** Vom `GameStateManager` jedes Frame

```typescript
// game-state.manager.ts update()
if (this.waveManager.checkWaveComplete()) {
  this.waveManager.endWave();
  // Optional: Rewards, UI Update, etc.
}
```

### Wave End

```typescript
endWave(): void {
  this.enemyManager.clear();
  this.phase.set('setup');
}
```

**Effekt:**
- Alle restlichen Enemies entfernt (sollten 0 sein)
- Phase zurück zu `'setup'`
- Wave-Nummer bleibt erhöht
- User kann neue Tower platzieren

---

## UI Integration

### Reactive Signals

```typescript
// In Component
readonly waveNumber = this.waveManager.waveNumber;
readonly phase = this.waveManager.phase;
readonly gatheringPhase = this.waveManager.gatheringPhase;
```

```html
<!-- In Template -->
<div class="wave-info">
  <h3>Welle {{ waveNumber() }}</h3>
  <p>Phase: {{ phase() }}</p>

  @if (gatheringPhase()) {
    <p class="gathering">Gegner sammeln sich...</p>
  }
</div>
```

### Wave Start Button

```typescript
startNextWave(): void {
  if (this.waveManager.phase() !== 'setup') return;

  this.waveManager.startWave({
    enemyCount: 10 + this.waveManager.waveNumber() * 5,  // Progressive
    enemyType: this.getWaveEnemyType(),
    enemySpeed: 5,
    spawnMode: 'random',
    spawnDelay: 400,
    useGathering: false,
  });
}
```

---

## Progressive Difficulty

### Konzept

Jede Wave wird schwieriger:

```typescript
private getWaveConfig(): WaveConfig {
  const waveNum = this.waveManager.waveNumber();

  return {
    // Mehr Enemies pro Wave
    enemyCount: 10 + waveNum * 5,

    // Stärkere Enemy-Typen
    enemyType: this.getEnemyTypeForWave(waveNum),

    // Schnellere Enemies
    enemySpeed: 5 + waveNum * 0.5,

    // Schnellere Spawns
    spawnDelay: Math.max(200, 500 - waveNum * 20),

    spawnMode: 'random',
    useGathering: waveNum % 5 === 0,  // Gathering jede 5. Wave
  };
}

private getEnemyTypeForWave(waveNum: number): EnemyTypeId {
  if (waveNum >= 10) return 'tank';
  if (waveNum >= 5) return 'wallsmasher';
  return 'zombie';
}
```

### Boss Waves

```typescript
private isBossWave(waveNum: number): boolean {
  return waveNum % 10 === 0;  // Wave 10, 20, 30, ...
}

private getBossConfig(): WaveConfig {
  return {
    enemyCount: 1,
    enemyType: 'herbert',  // Boss
    enemySpeed: 4,
    spawnMode: 'random',
    spawnDelay: 0,
    useGathering: true,    // Dramatischer Spawn
  };
}
```

---

## Multi-Type Waves (Planned)

**Aktuell:** Nur ein Enemy-Typ pro Wave

**Geplant:** Mehrere Typen gemischt

```typescript
// Future: WaveConfig erweitern
export interface WaveConfig {
  waves: Array<{
    enemyType: EnemyTypeId;
    count: number;
    speed: number;
  }>;
  spawnMode: 'sequential' | 'mixed';
  // ...
}

// Beispiel: Mixed Wave
this.waveManager.startWave({
  waves: [
    { enemyType: 'zombie', count: 10, speed: 5 },
    { enemyType: 'tank', count: 2, speed: 3 },
    { enemyType: 'bat', count: 5, speed: 8 },
  ],
  spawnMode: 'mixed',  // Alle Typen durchmischen
  // ...
});
```

---

## Testing & Debugging

### Manual Wave Start

```typescript
// In Wave Debug Component
startTestWave(): void {
  this.waveManager.startWave({
    enemyCount: this.enemyCount(),  // Slider value
    enemyType: this.selectedEnemyType(),
    enemySpeed: this.enemySpeed(),  // Slider value
    spawnMode: this.spawnMode(),
    spawnDelay: this.spawnDelay(),
    useGathering: this.useGathering(),
  });
}
```

### Wave Skip

```typescript
// Debug: Wave sofort beenden
skipWave(): void {
  this.enemyManager.clear();
  this.waveManager.endWave();
}
```

### Enemy Count Debug

```typescript
// In Template
<p>Alive: {{ waveManager.enemyManager.aliveCount() }}</p>
<p>Total: {{ waveManager.enemyManager.getAll().length }}</p>
```

---

## Game Over Integration

### Base Destroyed

```typescript
// In GameStateManager
onEnemyReachedBase(enemy: Enemy): void {
  const damage = enemy.typeConfig.damage;
  const newHealth = Math.max(0, this.baseHealth() - damage);
  this.baseHealth.set(newHealth);

  if (newHealth === 0) {
    this.handleGameOver();
  }
}

private handleGameOver(): void {
  // Stop wave spawning
  this.waveManager.reset();
  this.waveManager.phase.set('gameover');

  // Visual effects
  this.spawnHQExplosion();

  // UI
  setTimeout(() => {
    this.showGameOverScreen();
  }, 3000);
}
```

### Wave Reset bei Game Over

```typescript
reset(): void {
  this.enemyManager.clear();
  this.phase.set('setup');
  this.waveNumber.set(0);
  this.gatheringPhase.set(false);
}
```

**WICHTIG:** Spawn-Loop prüft `phase() === 'gameover'` und bricht ab.

---

## Spawn Points

### SpawnPoint Interface

```typescript
export interface SpawnPoint {
  id: string;           // Eindeutige ID
  name: string;         // Display name (z.B. "Nord")
  latitude: number;
  longitude: number;
}
```

### Generierung

Spawn-Points werden beim Location-Setup generiert:

```typescript
// In LocationManagementService
private generateSpawnPoints(basePos: GeoPosition): SpawnPoint[] {
  const spawnPoints: SpawnPoint[] = [];
  const minDistance = 500;  // 500m von Base
  const maxDistance = 1000; // 1000m von Base

  // Versuche N Spawn-Points zu finden
  for (let i = 0; i < 4; i++) {
    const bearing = (i * 90) + Math.random() * 45;  // Ungefähr N, E, S, W
    const distance = minDistance + Math.random() * (maxDistance - minDistance);

    const spawnPos = this.calculatePointAtBearing(basePos, bearing, distance);

    // Validierung: Muss auf Straße sein
    if (this.isOnStreet(spawnPos)) {
      spawnPoints.push({
        id: `spawn_${i}`,
        name: this.getCardinalDirection(bearing),
        latitude: spawnPos.lat,
        longitude: spawnPos.lon,
      });
    }
  }

  return spawnPoints;
}
```

### Cached Paths

Pfade von Spawn → HQ werden vorberechnet:

```typescript
// In PathAndRouteService
private cachedPaths = new Map<string, GeoPosition[]>();

for (const spawn of spawnPoints) {
  const path = this.findPath(spawn, basePosition);
  if (path) {
    this.cachedPaths.set(spawn.id, path);
  }
}

// Übergabe an WaveManager
this.waveManager.initialize(spawnPoints, this.cachedPaths);
```

---

## Best Practices

### 1. Spawn Delay

```typescript
// Zu schnell: Enemies spawnen als Block
spawnDelay: 50,  // ❌

// Gut: Sichtbare Lücken zwischen Enemies
spawnDelay: 300-500,  // ✅

// Langsam: Für große Wellen
spawnDelay: 800-1000,  // ✅ (Tank, Boss)
```

### 2. Gathering Mode

```typescript
// Gathering JA: Große Wellen, Bosse
enemyCount >= 20 || isBossWave  // ✅

// Gathering NEIN: Kleine/mittlere Wellen
enemyCount < 20  // ✅
```

### 3. Wave Difficulty Curve

```typescript
// Linear: Langweilig
enemyCount: 10 + waveNum * 2;  // ❌

// Exponentiell: Zu schwer
enemyCount: Math.pow(2, waveNum);  // ❌

// Progressiv mit Cap: Gut
enemyCount: Math.min(50, 10 + waveNum * 5);  // ✅
```

### 4. Mixed Enemy Types

```typescript
// Nicht nur ein Typ pro Wave
// Mische einfache und schwere Enemies:

const zombieCount = 10 + waveNum * 3;
const tankCount = Math.floor(waveNum / 3);

// Spawne Zombies zuerst, dann Tanks
```

---

## Troubleshooting

### Wave startet nicht
- Check `phase() === 'setup'` vor `startWave()`
- Check `spawnPoints.length > 0`
- Check `cachedPaths` nicht leer

### Enemies spawnen an falscher Position
- Check `cachedPaths` enthält richtigen Pfad
- Check Spawn-Point `latitude`/`longitude` valide

### Gathering funktioniert nicht
- Check `useGathering: true` in Config
- Check `enemyManager.startAll()` wird aufgerufen
- Check Enemies sind `paused: true` beim Spawn

### Wave endet nicht
- Check `getAliveCount()` = 0
- Check Phase ist `'wave'` nicht `'setup'`
- Manuell: `this.waveManager.endWave()`

---

## Performance

### Spawn Delay Minimum

```typescript
// Zu viele gleichzeitige Spawns → FPS-Drop
spawnDelay: 50,  // ❌ 20 enemies/sec

// Gut für Performance
spawnDelay: 200,  // ✅ 5 enemies/sec
```

### Large Waves

```typescript
// 100+ Enemies: Überlege Staggering
if (enemyCount > 100) {
  // Option 1: Längerer Spawn-Delay
  spawnDelay: 800;

  // Option 2: Multiple Waves
  this.startWave({ enemyCount: 50, ... });
  setTimeout(() => {
    this.startWave({ enemyCount: 50, ... });
  }, 30000);  // 2. Wave nach 30s
}
```

---

## Siehe auch

- [ENEMY_CREATION.md](ENEMY_CREATION.md) - Enemy-Typen erstellen
- [STATUS_EFFECTS.md](STATUS_EFFECTS.md) - Status-Effekte
- [ARCHITECTURE.md](ARCHITECTURE.md) - Manager-System Übersicht
- [LOCATION_SYSTEM.md](LOCATION_SYSTEM.md) - Spawn-Point Generierung
