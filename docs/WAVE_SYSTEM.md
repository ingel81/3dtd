# Wave System

**Stand:** 2026-05-12 (Wave-Erzeugung/Fairness-Gate + Game-Over-Pfad: 2026-09-07)

Dokumentation des Wave-Systems fuer automatisches Enemy-Spawning und Spielphasen.

---

## Uebersicht

Das Wave-System (`WaveManager`) steuert:
- Spielphasen (Setup, Wave, Game Over)
- Automatisches Enemy-Spawning via Sub-Step-Spawner in Game-Time (`tickSpawn(dtMs)`)
- Manuelles Wave-Management (via `beginWave()`)
- Wave-Konfiguration (Anzahl, Typ, Speed, Spawn-Modus, **Mixed-Wave-Schedule**)
- Wave-Completion-Detection (inkl. Spawn-Tracking)
- Damage-Tracking pro Wave (für Perfect/CloseCall-Detection)
- Event-Emission (`wave:started`, `wave:completed`)

> **Sub-Step Refactor (Phase 5.x):** Der Spawner läuft nicht mehr über `setTimeout` mit `timescaleProvider`,
> sondern über einen Sub-Step-Akkumulator. `GameStateManager` ruft `waveManager.tickSpawn(gameTimeDeltaMs)` einmal pro Sub-Step auf. Das ist deterministisch über alle Speed-Multiplier (inkl. Training x75).
> `setTimescaleProvider()` ist als deprecated No-Op erhalten geblieben, bis Tests migriert sind.

---

## Architektur

### WaveManager

```typescript
// managers/wave.manager.ts

export class WaveManager implements IGameManager {
  readonly phase = signal<GamePhase>('setup');
  readonly waveNumber = signal(0);

  spawnPoints: SpawnPoint[] = [];

  constructor(eventBus: GameEventBus, enemyManager: EnemyManager);

  initialize(spawnPoints: SpawnPoint[], cachedPaths: Map<string, GeoPosition[]>): void;
  setTimescaleProvider(_provider: () => number): void; // deprecated no-op
  setCurrentHealthProvider(provider: () => number): void; // für CloseCall-Detection
  getExpectedEnemyCount(): number; // genutzt vom EnemyManager (Swarm-Discount)
  beginWave(): void;
  startWave(config: WaveConfig): void;
  /** Sub-step-driven spawner — called per sub-step from GameStateManager */
  tickSpawn(gameTimeDeltaMs: number): void;
  checkWaveComplete(): boolean;
  endWave(): void;
  stopSpawning(): void;
  reset(): void;
  update(dt: number): void;
  destroy(): void;
}
```

**Hinweis:** `WaveManager` ist KEIN Angular `@Injectable()`. Es ist eine framework-agnostische Klasse, die `IGameManager` implementiert und per Constructor Injection `GameEventBus` und `EnemyManager` erhaelt.

### Game Phases

```typescript
export type GamePhase = 'setup' | 'wave' | 'gameover';
```

| Phase | Beschreibung |
|-------|--------------|
| `setup` | Initialer Zustand, User kann Tower platzieren |
| `wave` | Wave laeuft, Enemies spawnen und bewegen sich |
| `gameover` | Basis zerstoert, keine Interaktion mehr |

### Events

| Event | Emitted von | Beschreibung |
|-------|-------------|--------------|
| `wave:started` | `beginWave()`, `startWave()` | Wave beginnt, enthaelt `wave` (Nummer) und `enemyCount` |
| `wave:completed` | `endWave()` | Wave abgeschlossen, emitted via `emitDeferred()`. **Nicht** emittiert, wenn die Basis faellt — siehe [Game Over Integration](#base-destroyed). |

---

## Wave-Konfiguration

### WaveConfig Interface (Schedule-only seit 2026-05-23)

`WaveConfig` ist schedule-only — der WaveManager hat genau einen
Spawn-Pfad. Single-Enemy-Wellen sind Schedules mit einer Gruppe → N
Entries desselben Typs; Mixed-Wellen interleaven mehrere Gruppen per
Spawn-Pattern (siehe unten).

```typescript
export interface WaveConfig {
  schedule: SpawnSchedule;
}

export interface SpawnSchedule {
  entries: SpawnEntry[];
  baseDelay: number;                    // ms zwischen Spawns
  getDelay?: () => number;              // dynamische Delay-Funktion (Live-Tune Debug)
  spawnMode?: 'each' | 'random';        // Spawn-Point-Wahl (default 'random')
}

export interface SpawnEntry {
  enemyType: EnemyTypeId;
  speed: number;                        // m/s
  health?: number;                      // Per-Enemy-HP-Override
  delay?: number;                       // ms — Gap VOR dem nächsten Spawn (überschreibt baseDelay)
  pauseAfter?: number;                  // ms — Extra-Pause NACH diesem Spawn (wave-in-wave)
}
```

**Producer:** Niemand baut `WaveConfig` direkt — alle gehen durch
`adaptAIWaveConfig(AIWaveConfig)` in
`src/app/ai/core/wave-config-adapter.ts`. Quellen für die `AIWaveConfig`:

| Quelle | Funktion |
|---|---|
| Wave Director (Default) | `WaveDirectorService.getNextWave()` — regelbasiert, siehe unten |
| Training-Backend | `trainingClient.requestWaveConfig()`, solange die WebSocket-Verbindung steht |
| Static Curriculum | `staticWaveResolvedFor(waveNum)` (siehe [STATIC_WAVE_FALLBACK.md](STATIC_WAVE_FALLBACK.md)) |
| Debug-Panel | `WaveDebugService.toAIWaveConfig()` |

### SpawnPoint Interface

```typescript
export interface SpawnPoint extends GeoPosition {
  id: string;    // Eindeutige ID
  name: string;  // Display name (z.B. "Nord")
}
```

**Hinweis:** `SpawnPoint` erweitert `GeoPosition` (mit `lat`, `lon`, `height?`), NICHT eigene `latitude`/`longitude` Felder.

### Spawn Mode

#### 'each' - Round Robin

Enemies spawnen abwechselnd an jedem Spawn-Point:

```
Spawn Point A: Enemy 1, 4, 7, 10, ...
Spawn Point B: Enemy 2, 5, 8, 11, ...
Spawn Point C: Enemy 3, 6, 9, 12, ...
```

**Verwendung:** Gleichmaessige Verteilung, vorhersehbar

#### 'random' - Zufaellig

Jeder Enemy spawnt an einem zufaelligen Spawn-Point:

```
Spawn Point A: Enemy 1, 3, 7, 9, ...
Spawn Point B: Enemy 4, 5, 10, ...
Spawn Point C: Enemy 2, 6, 8, 11, ...
```

**Verwendung:** Unvorhersehbar, schwieriger

---

## Wave-Erzeugung: Director → WaveConfig

> **Stand 2026-09-07:** Der Director ist **regelbasiert und laeuft im Client**.
> Das ONNX-Modell ist nicht mehr der Default; es bleibt als Opt-in erhalten
> (`WaveDirectorService.loadModel()`). Fuer den Betrieb braucht das Spiel weder
> Modell noch Python-Server.

`WaveDirectorService.getNextWave()` erzeugt fuenf Zahlen — einen Template-Index
und vier Formfaktoren in `[0,1]` (`count`, `spawn`, `hp`, `variation`) — und
schickt sie durch einen Decoder, der fuer Regeln und Modell **derselbe** ist.
Nur die Herkunft der fuenf Zahlen unterscheidet sich, was den A/B-Vergleich
zwischen beiden ueberhaupt erst aussagekraeftig macht.

```
getStateSnapshot()                     ai/core/ai-data-collector.service.ts
   │
   ▼
buildWaveContext(state, recent)        ai/core/wave-context.ts
   │   mask[32]  = Curriculum-Pin, sonst minWave/Capability/Boss/Cooldown
   │   ranges    = count / hpMult / spawnDelay des tatsaechlichen Templates
   ▼
RuleDirector.decide(mask, wave, recent)   ai/core/rule-director.ts
   │   templateIdx + countFactor / spawnFactor / hpFactor / variationFactor
   ▼
buildWaveConfig(decision, state, conf)    ai/core/wave-director.service.ts
   │   DPS-Ramp → endgameHpMultiplier → Fairness-Cap → Dauer-Cap → Gruppen
   ▼
AIWaveConfig ──adaptAIWaveConfig()──► WaveConfig (SpawnSchedule) ──► WaveManager
```

### Regel-Director: Abwechslung und Kurve

Der `RuleDirector` trifft genau zwei Entscheidungen, beide bewusst ohne Lernen:

- **Abwechslung wird erzwungen, nicht belohnt.** Gewaehlt wird das *aelteste
  erlaubte* Template (Gleichstand zufaellig). Reward-Term und Cooldown-Maske
  haben Wiederholung nur teuer gemacht — die Regel macht sie unmoeglich.
- **Schwierigkeit ist eine geschriebene Kurve, kein Pro-Wave-Urteil.** Der
  Spieler heilt nie, seine HP sind also ein Budget fuer den ganzen Run; das ist
  etwas, das man aufschreibt, nicht aus einem Skalar-Reward pro Welle ableitet.

| Faktor | Rampenstart | ab Wave 60 | Wirkung |
|---|---|---|---|
| `countFactor` | 0.45 | 0.85 | mehr Gegner |
| `spawnFactor` | 0.55 | 0.30 | kuerzeres Spawn-Delay |
| `hpFactor` | 0.40 | 0.75 | zaehere Gegner |
| `variationFactor` | 0.60 | 0.60 | konstante Streuung |

Rampe linear bis `RAMP_FULL_WAVE = 60`, danach gehalten; auf jeden Faktor kommt
`JITTER = ±0.12`, damit aufeinanderfolgende Wellen nicht identisch sind.

Die Maske selbst kommt aus `getAvailableTemplateMask()`: **innerhalb** des
Curriculums (bis `CURRICULUM_FORCED_THROUGH_WAVE`) kollabiert sie auf das eine
gepinnte Template — die Gates greifen dort gar nicht, weil der Designer die
Welle bereits gewaehlt hat. Erst danach gelten `minWave`,
Capability-Anforderungen (Anti-Air, Anti-Ethereal), die Boss-Kadenz
(`bossOnly` nur auf Vielfachen von 10) und der Cooldown
(`TEMPLATE_COOLDOWN_WAVES = 2`). Zwei Fallbacks garantieren, dass nie alle
Slots gesperrt sind; der Leerfall im `RuleDirector` (Slot 0 mit festen
Mittelwerten) ist deshalb rein defensiv.

### Decoder: von den Faktoren zur Welle

`buildWaveConfig()` ist der geteilte Teil und wendet in dieser Reihenfolge an:

1. **DPS-Ramp** — `count`- und `hpMult`-Range werden am Defense-DPS gedeckelt
   (`DPS_RAMP_COUNT = 500`, `DPS_RAMP_HP_MULT = 1000`, Untergrenze
   `DPS_RAMP_FLOOR = 0.10`). Schwache Defense → schmaler effektiver Bereich.
2. **`endgameHpMultiplier(wave)`** — multipliziert *nach* dem Faktor auf
   `hpMult` (ab W20 +5%/Wave, Cap 4×, siehe `wave-curriculum.config.ts`).
3. **Fairness-Cap** (`fairMaxCount`, siehe unten).
4. **Dauer-Cap** — `MAX_WAVE_DURATION_MS = 180_000`. Wird er gerissen, wird
   `spawnDelay` komprimiert **und der Count danach neu abgeleitet**: eine
   langsame Mega-Welle besteht den Fairness-Check gerade *weil* ihr langes
   Spawn-Fenster der Defense Zeit gibt, und die Kompression vervielfacht
   anschliessend die Spawn-Rate. Ohne den zweiten Durchlauf umgehen genau die
   Wellen das Gate, wegen derer es existiert.
5. **Gruppen-Aufteilung** — `template.enemies` liefert die Anteile; die letzte
   Gruppe bekommt den Rest, damit `totalCount` exakt aufgeht.

### Fairness-Cap (`fairMaxCount`)

Der Cap begrenzt, **wie gross eine Welle werden darf**. Er schaetzt aus
Defense-DPS, Kill-Throughput, Gegner-HP, -Ruestung und -Tempo, wie viele Gegner
die Verteidigung in der Spawn-Zeit plus Engagement-Fenster toeten kann, und
addiert eine in HP bepreiste Leck-Toleranz
(`FAIRNESS_WAVE_HP_BUDGET = 6%` der Rest-HP, mindestens `FAIRNESS_MIN_LEAK_HP`,
geteilt durch `enemyBaseDamageForWave(wave)`).

Zwei Eigenschaften sind wichtig:

- Der Cap **interpoliert, statt zu clampen**: er verengt die `count`-Range,
  bevor der Faktor angewandt wird. Nachtraegliches Clampen bildete jeden Faktor
  oberhalb des Caps auf dieselbe Welle ab — eine flache Zone, in der keine
  Praeferenz mehr ausdrueckbar ist.
- Der Cap **schlaegt das Template-Minimum**. Liegt er unter `countRange[0]`,
  kann die Defense nicht einmal die kleinste vorgesehene Welle halten; dann
  kollabiert die Range auf den Cap, statt trotzdem das Minimum zu schicken.

### Gate-Controller: Regelkreis auf der Leck-Quote

`fairMaxCount` diskontiert die Kill-Schaetzung mit `FAIRNESS_KILL_REALISM = 0.65`.
Dieser Wert wurde auf den Wellen 1–10 gemessen und ist ab Wave 11 zu
pessimistisch — der Cap hat also einen stehenden Bias und keine Moeglichkeit,
ihn zu bemerken. Der `GateController` (`ai/core/gate-controller.ts`) korrigiert
das aus der einzigen belastbaren Evidenz: **was tatsaechlich die Basis erreicht
hat**.

| Groesse | Wert | Bedeutung |
|---|---|---|
| `GATE_ADAPT_WINDOW` | 4 | Wellen Leck-Historie, bevor ueberhaupt geregelt wird |
| `GATE_LEAK_TARGET_LO/HI` | 0.08 / 0.16 | Zielband fuer den durchgelassenen Anteil |
| `GATE_GAIN` | 0.35 | Proportional-Verstaerkung auf den relativen Fehler |
| `GATE_MULT_DOWN` | 0.8 | Ruecknahme, wenn ein Run endet (bewusst haerter als der Gain) |
| `GATE_MULT_MIN/MAX` | 0.5 / 8 | Klammer des `budgetMultiplier` |

Innerhalb des Bandes wird gehalten. Zwei Fehlerformen sind bewusst vermieden:

- **Nicht auf die Kill-Quote regeln.** „Die Defense hat alles getoetet, also
  mehr erlauben" liest die eigene Vorsicht des Reglers als Spielraum — eine
  kleine Welle wird geraeumt, *weil* sie klein ist. Einseitiger Druck; im
  Python-Original lief der Multiplikator dabei an seine Obergrenze und schaltete
  das Gate praktisch ab. Die Leck-Quote ist zweiseitig und konvergiert.
- **Keine feste Schrittweite.** Der Multiplikator muss ~1.6 erreichen, nur um
  den veralteten Realism-Discount aufzuheben. Bei 5% pro Fenster sind das ~170
  Wellen bei Runs von ~60.

**Verdrahtung (der Teil, der beim ersten Anlauf gefehlt hat):** Der Controller
haengt an `AIDataCollectorService.onWaveResult()`, **nicht** am Event
`wave:completed`. Beim Fall der Basis wird `wave:completed` nicht emittiert
(siehe [EVENT_SYSTEM.md](EVENT_SYSTEM.md#event-typen)) — die Todes-Ruecknahme
waere ueber das Event nie erreichbar gewesen. `onWaveResult` haengt an
`addToHistory()`, dem einzigen Punkt, den beide Pfade passieren.

Der Zustand ist **pro Run**: `GameLoopFacadeService.restartGame()` ruft
`waveDirector.resetForNewGame()`. Lief der Multiplikator ueber Runs hinweg
weiter, wurde er zur Ratsche — neue Runs starteten gegen Wellen, die fuer eine
laengst abgebaute Verteidigung dimensioniert waren.

---

## Methoden

### beginWave()

Startet eine Wave OHNE Auto-Spawning (manueller Modus). Enemies muessen extern gespawnt werden.

```typescript
beginWave(): void {
  this.waveNumber.update((n) => n + 1);
  this.phase.set('wave');

  // Reset spawn tracking (manual mode - unlimited spawning)
  this.expectedEnemyCount = 0;
  this.spawnedEnemyCount = 0;

  // Emit wave:started event
  this.eventBus.emit({
    type: 'wave:started',
    wave: this.waveNumber(),
    enemyCount: 0, // Manual mode - count unknown
  });
}
```

**Verwendung:** Wird z.B. vom `GameStateManager` genutzt, wenn Enemies manuell (z.B. durch Bot/AI) gespawnt werden.

### startWave(config)

Startet eine Wave MIT automatischem Spawning gemäß `WaveConfig`.

```typescript
import { adaptAIWaveConfig } from './ai/core/wave-config-adapter';

const waveConfig = adaptAIWaveConfig({
  enemies: [{ type: 'zombie', count: 10 }],
  totalCount: 10,
  spawnDelay: 500,
});
this.waveManager.startWave(waveConfig);
```

**Verhalten:**
1. Empty-Schedule (`entries.length === 0`) → early-return, kein Event
2. Wave-Nummer erhöht sich
3. Phase wechselt zu `'wave'`
4. Emitted `wave:started` Event mit tatsaechlicher Enemy-Anzahl
5. Spawn-Loop startet, Enemies spawnen im konfigurierten Abstand
6. Jeder Enemy beginnt sofort zu laufen

### setTimescaleProvider(provider) — deprecated

Hat seit dem Sub-Step-Refactor keine Funktion mehr; bleibt als No-Op erhalten, bis Legacy-Tests migriert sind. Spawn-Delays werden inhärent korrekt skaliert, weil `tickSpawn(dtMs)` mit Game-Time arbeitet (Game-Clock läuft bei x2 doppelt so schnell, also wird auch das Delay-Limit doppelt so schnell erreicht).

### setCurrentHealthProvider(provider)

Verbindet den `WaveManager` mit dem aktuellen Base-Health-Wert aus `GameStateManager`. Wird am Wave-Ende für CloseCall-Detection ausgewertet.

### getExpectedEnemyCount()

Gibt die Anzahl Enemies zurück, die diese Wave tatsächlich enthält (post-Validation). Wird vom `EnemyManager` für den Swarm-Discount in der Kill-Reward-Formel benutzt.

### stopSpawning()

Beendet den aktiven Sub-Step-Spawner sofort und passt `expectedEnemyCount` an die tatsaechlich gespawnten Enemies an, sodass `checkWaveComplete()` greift sobald die bereits gespawnten Enemies tot sind.

```typescript
stopSpawning(): void {
  this.activeSpawner = null;                           // sub-step spawner deaktivieren
  this.expectedEnemyCount = this.spawnedEnemyCount;    // wave kann mit dem bereits gespawnten Pool enden
}
```

**Verwendung:** Wird intern vom `debug:kill-all` Event-Handler aufgerufen.

### checkWaveComplete()

Prueft ob die Wave abgeschlossen ist.

```typescript
checkWaveComplete(): boolean {
  if (this.phase() !== 'wave') return false;

  const allEnemiesSpawned = this.expectedEnemyCount === 0
    || this.spawnedEnemyCount >= this.expectedEnemyCount;
  const allEnemiesDead = this.enemyManager.getAliveCount() === 0;

  return allEnemiesSpawned && allEnemiesDead;
}
```

**Logik:**
- Wave ist komplett wenn ALLE Enemies gespawnt UND ALLE gespawnten Enemies tot sind
- Im manuellen Modus (`expectedEnemyCount === 0`): Nur `allEnemiesDead` relevant
- Verhindert vorzeitige Wave-Completion waehrend Enemies noch spawnen

**Aufruf:** Vom `GameStateManager` jedes Frame

### endWave()

Beendet die aktuelle Wave.

```typescript
endWave(): void {
  const waveNum = this.waveNumber();
  this.enemyManager.clear();
  this.phase.set('setup');

  // Emit wave:completed event (deferred)
  this.eventBus.emitDeferred({
    type: 'wave:completed',
    wave: waveNum,
    credits: 0, // Credits werden separat via GAME_BALANCE verwaltet
  });
}
```

**Effekt:**
- Alle restlichen Enemies entfernt
- Phase zurueck zu `'setup'`
- Wave-Nummer bleibt erhoet
- `wave:completed` Event wird deferred emitted
- User kann neue Tower platzieren

### reset()

Setzt den WaveManager komplett zurueck.

```typescript
reset(): void {
  // Sub-Step-Spawner deaktivieren
  this.activeSpawner = null;

  this.enemyManager.clear();
  this.phase.set('setup');
  this.waveNumber.set(0);

  // Spawn-Tracking zuruecksetzen
  this.expectedEnemyCount = 0;
  this.spawnedEnemyCount = 0;
}
```

### update(dt)

Per-Frame Update. Aktuell no-op — `tickSpawn(gameTimeDeltaMs)` wird stattdessen pro Sub-Step vom `GameStateManager` aufgerufen.

### destroy()

Raeumt alle Ressourcen auf: ruft `reset()` auf, leert `cachedPaths` und `spawnPoints`.

---

## Spawn-Logik (Intern)

### Sub-Step-Spawner (Phase 5.x)

`startWave()` baut einen `activeSpawner`-Controller und initialisiert seinen Akkumulator. Der eigentliche Tick erfolgt in `tickSpawn(gameTimeDeltaMs)`, das `GameStateManager` jeden Sub-Step aufruft:

```typescript
tickSpawn(gameTimeDeltaMs: number): void {
  const spawner = this.activeSpawner;
  if (!spawner) return;
  if (this.phase() !== 'wave' || this.waveNumber() !== spawner.waveId) {
    this.activeSpawner = null;
    return;
  }

  spawner.accumulatedMs += gameTimeDeltaMs;
  while (spawner.accumulatedMs >= spawner.nextDelayMs) {
    spawner.accumulatedMs -= spawner.nextDelayMs;
    const stillActive = spawner.spawnAndAdvance();
    if (!stillActive) {
      this.activeSpawner = null;
      return;
    }
    spawner.nextDelayMs = spawner.recomputeDelay();
  }
}
```

Vorteile:
- **Deterministisch** — jeder Sub-Step ist ~16 ms Game-Time, unabhängig vom Timescale-Multiplier
- **Korrektes Verhalten bei x75-Training** — keine setTimeout-Drift bei extremen Geschwindigkeiten
- **Saubere Pause-Semantik** — pausiertes Spiel = kein Tick = keine Spawns

Die `spawnAndAdvance`-Closure ist je nach Mode unterschiedlich:
- Single-Type: ruft `enemyManager.spawn(path, type, speed, false, health)` auf
- Mixed-Schedule: iteriert `schedule.entries[]` und spawnt mit Per-Entry Type/Speed/Health/`pauseAfter`

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

### Debug Event Handler

Der WaveManager reagiert auf `debug:kill-all` und kürzt dabei keine Credits zu (sonst Instant-Goldfarm beim Testen, Phase 5.16):

```typescript
private registerDebugHandlers(): void {
  this.eventBus.on('debug:kill-all', () => {
    this.stopSpawning();
    for (const enemy of this.enemyManager.getAlive()) {
      if (enemy.alive) {
        this.enemyManager.kill(enemy, /*awardCredits*/ false);
      }
    }
  });
}
```

---

## Wave-Completion

### Check-Logik

```typescript
// game-state.manager.ts update()
if (this.waveManager.checkWaveComplete()) {
  this.waveManager.endWave();
  // Optional: Rewards, UI Update, etc.
}
```

---

## UI Integration

### Reactive Signals

```typescript
// In Component
readonly waveNumber = this.waveManager.waveNumber;
readonly phase = this.waveManager.phase;
```

```html
<!-- In Template -->
<div class="wave-info">
  <h3>Welle {{ waveNumber() }}</h3>
  <p>Phase: {{ phase() }}</p>
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
  });
}
```

---

## Progressive Difficulty

### Konzept

Der `WaveManager` kennt **keine** Schwierigkeitskurve — er spielt einen fertigen
`SpawnSchedule` ab. Die Kurve entsteht an vier Stellen weiter oben und
multipliziert sich:

| Ebene | Wo | Wirkung |
|---|---|---|
| Content/Pacing | `WAVE_CURRICULUM` in `configs/wave-curriculum.config.ts` | pinnt Template + Gold-Budget pro Wave (W1–W30, danach Loop) |
| Formfaktoren | `RuleDirector` (`RAMP_FULL_WAVE = 60`) | Count/HP hoch, Spawn-Delay runter |
| Endgame-HP | `endgameHpMultiplier(wave)` | ab W20 +5%/Wave auf `hpMult`, Cap 4× |
| Leck-Schaden | `enemyBaseDamageForWave(wave)` | HP-Verlust pro Durchkommen: 1 (W1–10), 2 (W11–20), 3 (W21–30), … |

Nach oben gedeckelt wird die Kurve durch den Fairness-Cap und den
Gate-Controller (siehe [Wave-Erzeugung](#wave-erzeugung-director--waveconfig))
sowie durch `GAME_BALANCE.combat.maxLeakDamagePerWave` — eine einzelne Welle
kann den Spieler nie mehr als 18 HP kosten.

### Boss Waves

Boss-Wellen sind Templates mit `bossOnly: true`. Die Maske laesst sie nur auf
Wave-Nummern zu, die durch 10 teilbar sind; innerhalb des Curriculums stehen sie
ausserdem fest auf W10/W20/W30 (`boss_herbert` usw. in `WAVE_CURRICULUM`).

---

## Mixed Waves (Multi-Type)

Mixed Waves erlauben mehrere Enemy-Typen in einer Wave mit konfigurierbaren Spawn-Patterns.

### Architektur

Die Mixed-Wave-Logik basiert auf einem **SpawnSchedule** — einer vorab berechneten, flachen Liste von `SpawnEntry`-Objekten. Alle Pattern-Logik wird zur Build-Time aufgeloest, der WaveManager spielt den Schedule nur noch sequentiell ab.

```
┌─────────────────┐    ┌──────────────────────┐    ┌─────────────┐
│ Enemy Groups     │ -> │ SpawnScheduleBuilder  │ -> │ SpawnSchedule│
│ + Pattern        │    │ (Build-Time)          │    │ (flat list)  │
└─────────────────┘    └──────────────────────┘    └──────┬──────┘
                                                          │
                                                          v
                                                   ┌─────────────┐
                                                   │ WaveManager  │
                                                   │ (Runtime)    │
                                                   └─────────────┘
```

### Interfaces

```typescript
// managers/wave.manager.ts

export interface SpawnEntry {
  enemyType: EnemyTypeId;  // Typ dieses Spawns
  speed: number;           // Geschwindigkeit (m/s)
  health?: number;         // HP override (optional)
  pauseAfter?: number;     // Extra-Pause in ms nach diesem Spawn
}

export interface SpawnSchedule {
  entries: SpawnEntry[];   // Geordnete Spawn-Liste
  baseDelay: number;       // Standard-Delay zwischen Spawns (ms)
  getDelay?: () => number; // Optionale dynamische Delay-Funktion
}
```

Das bestehende `WaveConfig` Interface wurde um ein optionales `schedule` Feld erweitert:

```typescript
export interface WaveConfig {
  // Bestehende Felder (unveraendert)
  enemyCount: number;
  enemyType: EnemyTypeId;
  enemySpeed: number;
  enemyHealth?: number;
  spawnMode: 'each' | 'random';
  spawnDelay: number;
  getSpawnDelay?: () => number;

  schedule?: SpawnSchedule;  // Wenn vorhanden: Schedule-basiertes Spawning
}
```

**Backwards-kompatibel:** Ohne `schedule` Feld verhalt sich alles exakt wie bisher.

### Spawn-Patterns

7 Patterns stehen zur Verfuegung (`src/app/ai/core/spawn-schedule-builder.ts`):

| Pattern | Verhalten | Beispiel (8Z, 4B, 2T) |
|---------|-----------|------------------------|
| `interleaved` | Proportionaler Round-Robin | Z B Z T Z B Z Z B Z T Z B Z |
| `sequential` | Alle einer Gruppe, dann naechste | ZZZZZZZZ BBBB TT |
| `clustered` | Cluster von N, dann Wechsel | ZZZ BBB ZZZ TT BBB ZZ |
| `random` | Fisher-Yates Shuffle | Zufaellig durchmischt |
| `front-loaded` | Staerkste zuerst (HP desc) | TT ZZZZZZZZ BBBB |
| `back-loaded` | Schwaechste zuerst (HP asc) | BBBB ZZZZZZZZ TT |
| `wave-in-wave` | Sub-Waves mit Pausen | ZZZZZZZZ [Pause] BBBB [Pause] TT |

### SpawnScheduleBuilder

```typescript
import { buildSpawnSchedule, SpawnPattern } from '../ai/core/spawn-schedule-builder';

const schedule = buildSpawnSchedule({
  groups: [
    { type: 'zombie', count: 8 },
    { type: 'bat', count: 4, speedMultiplier: 1.2 },
    { type: 'wallsmasher', count: 2, healthMultiplier: 1.5 },
  ],
  pattern: 'interleaved',
  baseDelay: 800,
  delayVariation: 0.2,      // +/- 20% Zufallsvariation
  clusterSize: 3,            // Nur fuer 'clustered'
  subWavePause: 3000,        // Nur fuer 'wave-in-wave' (ms)
});
```

**Helper-Funktionen:**

```typescript
// Empfohlenes Pattern fuer einen Archetype
getRecommendedPattern('swarm');  // -> 'random'
getRecommendedPattern('boss');   // -> 'wave-in-wave'

// Gruppen aus Ratio-basierter Definition
fromRatio(20, { zombie: 0.6, bat: 0.3, tank: 0.1 });
// -> [{ type: 'zombie', count: 12 }, { type: 'bat', count: 6 }, { type: 'tank', count: 2 }]
```

### WaveManager Integration

Wenn `config.schedule` vorhanden ist, delegiert `startWave()` an `startScheduledWave()`:

```typescript
// Intern in wave.manager.ts
startWave(config: WaveConfig): void {
  if (config.schedule) {
    this.startScheduledWave(config);  // Mixed-Wave Pfad
    return;
  }
  // ... bestehender Single-Type Pfad
}
```

`startScheduledWave()` iteriert ueber `schedule.entries[]` und spawnt jeden Entry mit dem richtigen Typ, Speed und Health. `pauseAfter` wird als Extra-Delay zum Standard-Delay addiert. Die bestehenden Mechanismen (Timescale, `stopSpawning()`, `checkWaveComplete()`) funktionieren unveraendert.

### Director Integration

`adaptAIWaveConfig()` (`src/app/ai/core/wave-config-adapter.ts`) ist der einzige
Adapter — seit dem Schedule-only-Umbau (2026-05-23) gibt es keine
Single/Mixed-Weiche mehr. Er baut aus den Enemy-Gruppen ueber
`buildSpawnSchedule()` immer einen `SpawnSchedule`; eine Single-Type-Welle ist
dabei schlicht ein Schedule mit einer Gruppe.

```typescript
import { adaptAIWaveConfig } from '../ai/core/wave-config-adapter';

const waveConfig = adaptAIWaveConfig(aiConfig);
// -> WaveConfig { schedule }
```

### Debug Panel: Mixed Wave Designer

Das Wave-Debug-Panel (`wave-debugger.component.ts`) bietet einen **Mode-Toggle** (Single/Mixed):

- **Single Mode:** Bestehende Steuerung (Typ, Count, Speed, Health, Delay)
- **Mixed Mode:** Voller Wave-Designer:
  - Gruppen-Karten (Typ-Dropdown, Count, HP/Speed-Multiplier)
  - Add/Remove Groups
  - Pattern-Auswahl (7 Buttons mit Icons)
  - Konditionale Controls (Cluster Size, Sub-Wave Pause)
  - Delay + Variation Slider
  - Total-Counter

State wird im `WaveDebugService` verwaltet (`wave-debug.service.ts`):

```typescript
// Mixed-Mode Signals
readonly mixedMode = signal(false);
readonly mixedGroups = signal<MixedGroupConfig[]>([...]);
readonly spawnPattern = signal<SpawnPattern>('interleaved');
readonly clusterSize = signal(3);
readonly subWavePause = signal(3000);
readonly delayVariation = signal(0);

// Baut WaveConfig mit SpawnSchedule
buildMixedWaveConfig(): WaveConfig { ... }
```

### Dateien

| Datei | Rolle |
|-------|-------|
| `managers/wave.manager.ts` | `SpawnEntry`, `SpawnSchedule` Interfaces, `startScheduledWave()` |
| `ai/core/spawn-schedule-builder.ts` | 7 Pattern-Builder, `buildSpawnSchedule()`, Helpers |
| `ai/core/wave-config-adapter.ts` | `adaptAIWaveConfig()` — einziger Konverter AIWaveConfig → WaveManager-Config |
| `ai/core/models/wave-config.ts` | Optionales `pattern` Feld fuer AI Config |
| `services/debug/wave-debug.service.ts` | Mixed-Mode Signals (delegiert State an `DebugStore`), `buildMixedWaveConfig()` |
| `components/debug-window/wave-debugger.component.ts` | Mixed Wave Designer UI |
| `services/facade/game-loop-facade.service.ts` | Mixed-Mode Weiche in `startCustomWave()` |

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

Wave-Completion- und Game-Over-Check liegen beide **in der Sub-Step-Schleife**
von `GameStateManager.update()`, in dieser Reihenfolge:

```typescript
// managers/game-state.manager.ts (Sub-Step-Schleife)
if (isWavePhase && this.waveManager.checkWaveComplete()) {
  const result = this.waveManager.endWave();   // emittiert wave:completed (deferred)
  ...
  this.applyWaveCompletionBonus(result);
}
if (this.baseHealth() <= 0 && this.waveManager.phase() !== 'gameover') {
  this.triggerGameOver();                       // emittiert game:over (immediate)
  break;
}
```

`triggerGameOver()` setzt die Phase auf `gameover`, leert den EnemyManager,
loest die Tower-Selektion, startet die HQ-Effekte und emittiert `game:over`.

> **`wave:completed` wird beim Game Over NICHT emittiert.** `endWave()` laeuft
> nur, wenn die Welle regulaer fertig wird; faellt die Basis, wird die Phase
> direkt auf `gameover` gesetzt. Alles, was **jede** Welle sehen muss — der
> Gate-Controller ist der Anlassfall — darf deshalb nicht am Event haengen,
> sondern muss an `AIDataCollectorService.onWaveResult()` haengen. Details:
> [EVENT_SYSTEM.md](EVENT_SYSTEM.md#event-typen).
>
> Der Sonderfall, in dem beides fuer dieselbe Welle feuert: der letzte Leaker
> zerstoert die Basis. Dann laeuft der Wave-Complete-Check zuerst, aber
> `wave:completed` ist deferred und `game:over` immediate — der Game-Over-Pfad
> ist also **zuerst** zugestellt. Der Collector merkt sich die bereits
> finalisierte Wave-Nummer und verwirft das nachlaufende Event.

### Wave Reset bei Game Over

`WaveManager.reset()` verwirft den aktiven Spawner (`activeSpawner = null`),
leert den EnemyManager, setzt Phase auf `setup`, `waveNumber` auf 0 und die
Spawn-Tracking-Zaehler zurueck. Es gibt keine Timeouts mehr zu stoppen — der
Spawner laeuft seit dem Sub-Step-Refactor ueber `tickSpawn()`.

**WICHTIG:** `tickSpawn()` ist ein No-Op ohne `activeSpawner` und ausserhalb der
`wave`-Phase; Reset und Game Over stoppen das Spawning damit sofort.

---

## Spawn Points

### SpawnPoint Interface

```typescript
export interface SpawnPoint extends GeoPosition {
  id: string;    // Eindeutige ID
  name: string;  // Display name (z.B. "Nord")
}

// GeoPosition aus models/game.types.ts
export interface GeoPosition {
  lat: number;
  lon: number;
  height?: number;
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
    const bearing = (i * 90) + Math.random() * 45;  // Ungefaehr N, E, S, W
    const distance = minDistance + Math.random() * (maxDistance - minDistance);

    const spawnPos = this.calculatePointAtBearing(basePos, bearing, distance);

    // Validierung: Muss auf Strasse sein
    if (this.isOnStreet(spawnPos)) {
      spawnPoints.push({
        id: `spawn_${i}`,
        name: this.getCardinalDirection(bearing),
        lat: spawnPos.lat,
        lon: spawnPos.lon,
      });
    }
  }

  return spawnPoints;
}
```

### Cached Paths

Pfade von Spawn -> HQ werden vorberechnet:

```typescript
// In PathAndRouteService
private cachedPaths = new Map<string, GeoPosition[]>();

for (const spawn of spawnPoints) {
  const path = this.findPath(spawn, basePosition);
  if (path) {
    this.cachedPaths.set(spawn.id, path);
  }
}

// Uebergabe an WaveManager
this.waveManager.initialize(spawnPoints, this.cachedPaths);
```

---

## Best Practices

### 1. Spawn Delay

```typescript
// Zu schnell: Enemies spawnen als Block
spawnDelay: 50,  // Nicht empfohlen

// Gut: Sichtbare Luecken zwischen Enemies
spawnDelay: 300-500,  // Empfohlen

// Langsam: Fuer grosse Wellen
spawnDelay: 800-1000,  // Empfohlen (Tank, Boss)
```

### 2. Wave Difficulty Curve

```typescript
// Linear: Langweilig
enemyCount: 10 + waveNum * 2;  // Nicht empfohlen

// Exponentiell: Zu schwer
enemyCount: Math.pow(2, waveNum);  // Nicht empfohlen

// Progressiv mit Cap: Gut
enemyCount: Math.min(50, 10 + waveNum * 5);  // Empfohlen
```

### 3. Mixed Enemy Types

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
- Check `cachedPaths` enthaelt richtigen Pfad
- Check Pfad hat `length > 1` (Minimum fuer gueltige Route)

### Wave endet nicht
- Check `getAliveCount()` = 0
- Check Phase ist `'wave'` nicht `'setup'`
- Check `spawnedEnemyCount >= expectedEnemyCount` (alle Enemies gespawnt?)
- Manuell: `this.waveManager.endWave()`

### Spawning stoppt nicht nach Kill All
- `stopSpawning()` muss aufgerufen werden, um den Sub-Step-Spawner zu deaktivieren
- `debug:kill-all` Event macht dies automatisch

---

## Performance

### Spawn Delay Minimum

```typescript
// Zu viele gleichzeitige Spawns -> FPS-Drop
spawnDelay: 50,  // 20 enemies/sec - nicht empfohlen

// Gut fuer Performance
spawnDelay: 200,  // 5 enemies/sec - empfohlen
```

### Large Waves

```typescript
// 100+ Enemies: Ueberlege Staggering
if (enemyCount > 100) {
  // Option 1: Laengerer Spawn-Delay
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

- [STATIC_WAVE_FALLBACK.md](STATIC_WAVE_FALLBACK.md) - AI-off Debug-Pfad: feste Per-Wave-Profile + UI-Toggle
- [ENEMY_CREATION.md](ENEMY_CREATION.md) - Enemy-Typen erstellen
- [STATUS_EFFECTS.md](STATUS_EFFECTS.md) - Status-Effekte
- [ARCHITECTURE.md](ARCHITECTURE.md) - Manager-System Uebersicht
- [LOCATION_SYSTEM.md](LOCATION_SYSTEM.md) - Spawn-Point Generierung
