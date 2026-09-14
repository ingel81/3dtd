# Wave System

**Stand:** 2026-09-14 (Blutmond-Wellen)

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

---

## Architektur

### WaveManager

```typescript
// managers/wave.manager.ts

export class WaveManager implements IGameManager {
  readonly phase = signal<GamePhase>('setup');
  readonly waveNumber = signal(0);

  spawnPoints: SpawnPoint[] = [];
  maxSpawnsPerFrame = 3; // max. Spawns pro tickSpawn()-Aufruf

  constructor(eventBus: GameEventBus, enemyManager: EnemyManager);

  initialize(spawnPoints: SpawnPoint[], cachedPaths: Map<string, GeoPosition[]>): void;
  setCurrentHealthProvider(provider: () => number): void; // für CloseCall-Detection
  getExpectedEnemyCount(): number; // Gegner laut Schedule, auf sie wartet die Wave-Completion
  getExpectedBodyCount(): number; // dazu die Split-Kinder: Kill-Gold-Slots des EnemyManager
  beginWave(): void;
  startWave(config: WaveConfig): void;
  /** Sub-step-driven spawner — called per sub-step from GameStateManager */
  tickSpawn(gameTimeDeltaMs: number): void;
  checkWaveComplete(): boolean;
  endWave(): { wave: number; perfect: boolean; closeCall: boolean; hpLost: number };
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
| `wave:completed` | `endWave()` | Wave abgeschlossen, emitted via `emitDeferred()`, mit `perfect`, `closeCall` und `hpLost`. **Nicht** emittiert, wenn die Basis fällt, siehe [Game Over Integration](#base-destroyed). |

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

Welche Quelle die nächste Welle liefert, entscheidet
`GameLoopFacadeService.startWave()` in dieser Reihenfolge: Ist der
Static-Curriculum-Schalter an, kommt die Welle aus `staticWaveResolvedFor()`.
Sonst, wenn der Director an ist (`useAIDirector`, Default an), fragt die Facade
das Training-Backend, falls eine Verbindung steht, und andernfalls
`WaveDirectorService.getNextWave()`. Ist der Director aus, gilt das
Debug-Panel. Wirft der Director, schaltet die Facade ihn ab, setzt `aiError`
und startet eine Debug-Panel-Welle. Alle Pfade senden `command:start-wave` mit
fertiger `WaveConfig`. Auf einer Boss-Welle der Rotation (siehe
[Boss Waves](#boss-waves)) ersetzt die Facade die Welle des lokalen Directors durch die
der Boss-Variante; Wellen aus dem Training-Backend bleiben unverändert.

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
buildWaveConfig(decision, state, maskReason, gate)   ai/core/wave-config-builder.ts
   │   DPS-Ramp → endgameHpMultiplier → Fairness-Cap → Dauer-Cap → Gruppen
   │   + explanation (explainWaveDecision, "Why this wave")
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

Die Maske selbst kommt aus `describeTemplateMask()` (`getAvailableTemplateMask()`
ist der Wrapper ohne Begründung): **innerhalb** des
Curriculums (bis `CURRICULUM_FORCED_THROUGH_WAVE`) kollabiert sie auf das eine
gepinnte Template — die Gates greifen dort gar nicht, weil der Designer die
Welle bereits gewaehlt hat. Erst danach gelten `minWave`,
Capability-Anforderungen (Anti-Air, Anti-Ethereal), die Boss-Kadenz und der
Cooldown (`TEMPLATE_COOLDOWN_WAVES = 2`). Boss-Kadenz: `isBossWave()` in
`wave-curriculum.config.ts`, bis W30 jede zehnte Welle (gepinnt), danach jede
fünfte. An Boss-Wellen kollabiert die Maske auf die `bossOnly`-Templates, die
die Gates bestehen (`boss_herbert`, `boss_golem`, `boss_dragon`; die
Älteste-zuerst-Regel rotiert sie), an allen anderen Wellen sind sie gesperrt.
Vorher waren Bosse an Vielfachen von 10 nur erlaubt, nicht erzwungen: simuliert
kamen zwischen W31 und W130 0,7 statt 10 Boss-Wellen. Boss-Wellen nach W30
zahlen das doppelte Gold-Budget. Fallbacks garantieren, dass nie alle Slots
gesperrt sind (Boss-Template trotz Cooldown, sonst normale Welle); der Leerfall
im `RuleDirector` (Slot 0 mit festen Mittelwerten) ist deshalb rein defensiv.

### Decoder: von den Faktoren zur Welle

`buildWaveConfig()` ist der geteilte Teil und wendet in dieser Reihenfolge an:

1. **DPS-Ramp** — `count`- und `hpMult`-Range werden am Defense-DPS gedeckelt
   (`DPS_RAMP_COUNT = 500`, `DPS_RAMP_HP_MULT = 1000`, Untergrenze
   `DPS_RAMP_FLOOR = 0.10`). Schwache Defense → schmaler effektiver Bereich.
2. **`endgameHpMultiplier(wave)`**: multipliziert *nach* dem Faktor auf
   `hpMult` (ab W21 +5 % pro Welle, W30 ×1,5, Cap 4× ab W80, siehe
   `wave-curriculum.config.ts`).
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

**Matchup-Floor (seit 2026-09).** Der Cap liest `gateDpsPerArmor` aus der
Defense-Analyse, nicht die rohe Matrix: gegen Boden-Gegner mit unarmored, light,
heavy und fortified zählt jeder Tower mindestens `FAIRNESS_MATCHUP_FLOOR = 0.6`
seiner DPS. Ohne Floor machte eine schlechte Paarung die Welle nur kleiner
(Gatlings gegen Panzer bekamen weniger Panzer), und die breitere Schadensmatrix
wäre im Gate verschwunden. Mit Floor spürt der Spieler ein falsches Roster als
Leck, begrenzt durch `maxLeakDamagePerWave`. Ethereal und Luft bleiben auf der
reinen Matrix, dort greifen die Capability-Gates.

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

Kills durch Spieler-Fähigkeiten (Nuklearschlag) zählen für den Regler als Leck
(`gateLeakRatio`, `WaveOutcome.abilityKills`): der Einsatz rettet HP und Gold,
vergrößert die folgenden Wellen aber nicht. Siehe [ABILITIES.md](ABILITIES.md).

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

**Verwendung:** `GameCommandsHandler` ruft `GameStateManager.beginWave()` für ein `command:start-wave` ohne `config`. Außerhalb der Tests sendet derzeit kein Aufrufer das Kommando ohne Config; Facade und Bot schicken immer eine.

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
4. Emitted `wave:started` Event mit tatsaechlicher Enemy-Anzahl (`entries.length`)
5. Legt den Sub-Step-Spawner an; der erste Enemy spawnt beim ersten `tickSpawn()`, die weiteren im konfigurierten Abstand
6. Jeder Enemy beginnt sofort zu laufen (`enemyManager.spawn(..., paused = false, ...)`)

### setCurrentHealthProvider(provider)

Verbindet den `WaveManager` mit dem aktuellen Base-Health-Wert aus `GameStateManager`. Wird am Wave-Ende für CloseCall-Detection ausgewertet.

### getExpectedEnemyCount() / getExpectedBodyCount()

`getExpectedEnemyCount()` gibt die Anzahl Enemies zurück, die der Schedule dieser Wave spawnt (post-Validation); auf sie wartet `checkWaveComplete()`.

`getExpectedBodyCount()` zählt dazu, was ein Kill abspaltet (`splitBodyCount`, ein Skeleton zählt 3). Damit teilt der `EnemyManager` das Kill-Gold der Welle in Slots: Jeder Körper zahlt einen Slot, ein durchgelaufener Gegner verliert seinen und die seiner nie entstandenen Kinder, und ein Split erhöht das Gold der Welle nicht.

Ein Wurm (`chain`, [ENEMY_CREATION.md](ENEMY_CREATION.md#kette-chain-der-wurm)) ist ein Eintrag im Schedule, bringt aber ein Enemy je Segment. Seine Länge hängt von der Route ab, die er bekommt; beim Spawn erhöht der `WaveManager` die Körper um `size - 1`. Der `EnemyManager` liest die Wellengröße deshalb bei jedem Kill neu und zählt die schon bezahlten Slots, statt die Slots beim ersten Kill der Welle festzulegen.

Split-Kinder leben, also wartet die Wave-Completion ohne eigenen Zähler auf sie.

### stopSpawning()

Beendet den aktiven Sub-Step-Spawner sofort und passt `expectedEnemyCount` an die tatsaechlich gespawnten Enemies an, sodass `checkWaveComplete()` greift sobald die bereits gespawnten Enemies tot sind.

```typescript
stopSpawning(): void {
  this.activeSpawner = null;                           // sub-step spawner deaktivieren
  this.expectedEnemyCount = this.spawnedEnemyCount;    // wave kann mit dem bereits gespawnten Pool enden
}
```

**Verwendung:** Intern vom `debug:kill-all`-Handler und von `GameLoopFacadeService.onGameOver()`.

### checkWaveComplete()

Prueft ob die Wave abgeschlossen ist.

```typescript
checkWaveComplete(): boolean {
  if (this.phase() !== 'wave') return false;
  if (!this._waveCheckDirty && this._cachedWaveComplete) return true;

  const allEnemiesSpawned = this.expectedEnemyCount === 0
    || this.spawnedEnemyCount >= this.expectedEnemyCount;
  const allEnemiesDead = this.enemyManager.getAliveCount() === 0
    && this.enemyManager.getKillingCount() === 0
    && this.enemyManager.getPendingSpawnCount() === 0;

  // (gekürzt: Stuck-Diagnose, loggt einmal pro Wave)
  const complete = allEnemiesSpawned && allEnemiesDead;
  this._cachedWaveComplete = complete;
  this._waveCheckDirty = false;
  return complete;
}
```

**Logik:**
- Wave ist komplett wenn ALLE Enemies gespawnt UND ALLE gespawnten Enemies tot sind; Enemies in der Todesanimation (`getKillingCount()`) zählen noch mit, ebenso Wurm-Segmente, die noch im Portal stecken (`getPendingSpawnCount()`)
- Im manuellen Modus (`expectedEnemyCount === 0`): Nur `allEnemiesDead` relevant
- Verhindert vorzeitige Wave-Completion waehrend Enemies noch spawnen
- Gecacht wird nur ein positives Ergebnis; `enemy:died`, `enemy:reached-base` und Spawn-Fortschritt setzen das Dirty-Flag

**Aufruf:** Vom `GameStateManager` in jedem Sub-Step der `wave`-Phase

### endWave()

Beendet die aktuelle Wave.

```typescript
endWave(): { wave: number; perfect: boolean; closeCall: boolean; hpLost: number } {
  const waveNum = this.waveNumber();
  this.enemyManager.clear();
  this.phase.set('setup');

  const hpLost = this.damageTakenThisWave;
  const perfect = hpLost === 0;
  const hpAtEnd = this.currentHealthProvider ? this.currentHealthProvider() : 100;
  const closeCall = !perfect && hpAtEnd <= GAME_BALANCE.economy.closeCallHpThreshold;

  this.eventBus.emitDeferred({
    type: 'wave:completed',
    wave: waveNum,
    credits: 0, // Credits vergibt der GameStateManager
    perfect, closeCall, hpLost,
  });

  return { wave: waveNum, perfect, closeCall, hpLost };
}
```

`hpLost` summiert den Schaden aus `enemy:reached-base` und `enemy:leaking` (die
Ooze fließt Meter für Meter in die HQ, ENEMY_CREATION.md) während der Welle,
`closeCallHpThreshold` steht in `GAME_BALANCE.economy` (25). Den Rückgabewert
reicht der `GameStateManager` an `applyWaveCompletionBonus()`.

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

Räumt alle Ressourcen auf: löst die EventBus-Subscriptions, ruft `reset()` auf, leert `cachedPaths` und `spawnPoints`.

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
  let spawnsThisCall = 0;
  while (spawnsThisCall < this.maxSpawnsPerFrame) {
    // Delay 0 überspringt die Wartebedingung (Burst)
    if (spawner.nextDelayMs > 0 && spawner.accumulatedMs < spawner.nextDelayMs) break;
    if (spawner.nextDelayMs > 0) spawner.accumulatedMs -= spawner.nextDelayMs;
    const stillActive = spawner.spawnAndAdvance();
    spawnsThisCall++;
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

Pro Tick spawnen höchstens `maxSpawnsPerFrame` (Default 3) Enemies; ein Delay
von 0 spawnt ohne Warten bis zu diesem Limit. Die `spawnAndAdvance`-Closure
nimmt den nächsten Entry, wählt den Spawn-Point nach `spawnMode`, holt den Pfad
aus `cachedPaths` und ruft `enemyManager.spawn(path, type, speed, false, health)`.
Fehlt ein gültiger Pfad (weniger als 2 Punkte), zählt sie Fehlversuche; nach
`spawnPoints.length * 2` in Folge bricht die Welle mit den bis dahin
gespawnten Enemies ab.

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

Der Check läuft in der Sub-Step-Schleife von `GameStateManager.update()`, nur in
der `wave`-Phase. Nach `endWave()` stoppt der Manager Beam- und Melee-Tower,
räumt Debug-Enemies und zahlt über `applyWaveCompletionBonus(result)` den
Abschlussbonus. Code siehe [Game Over Integration](#base-destroyed).

---

## UI Integration

### Reactive Signals

Die UI liest nicht den `WaveManager`, sondern den Store (`TowerDefenseStore`,
Quelle `GameStore`). `GameStateSyncService` füllt ihn aus den Events:

| Store-Signal | gesetzt bei |
|---|---|
| `phase`, `waveNumber` | `wave:started` (Phase `wave`), `wave:completed` (Phase `setup`), `game:over` (Phase `gameover`); `waveNumber` auch bei `wave:jumped` (Dev-Cheat, siehe [Jump to Wave](#jump-to-wave)) |
| `waveEnemyTotal` | `wave:started` (`enemyCount`), + Kinder je `enemy:split` in der Welle, 0 bei `wave:completed` |
| `waveEnemiesLeft` | `wave:started`, -1 je `enemy:died` und `enemy:reached-base`, + Kinder je `enemy:split` in der Welle, 0 bei `wave:completed` und `debug:kill-all` |

Manuelle Wellen (`beginWave()`) melden `enemyCount: 0`; Total und Rest bleiben
dann 0.

### Wave Start Button

Der Button im Wave-Panel der Sidebar (`components/game-sidebar/wave-panel/`)
sendet `startWave`; das landet über `TowerDefenseComponent` und
`TowerDefenseFacadeService` in `GameLoopFacadeService.startWave()` (Quellen
siehe [Wave-Konfiguration](#wave-konfiguration)). Text, Restzahl und Balken
berechnet `waveButtonView()` in `wave-button.ts`:

| Zustand | Label | rechts | Balken |
|---|---|---|---|
| keine Welle | `Wave N` (Name für Screenreader `Start wave N`) | Taste `Space`, mit Auto-Start `{n}s` | mit Auto-Start die Restzeit |
| Welle mit bekannter Größe | `Wave N` | `{n} left` | `waveEnemiesLeft / waveEnemyTotal` |
| manuelle Welle (Total 0) | `Wave N` | | |

### Auto-Start der nächsten Welle

Optional (Schalter "auto 10s" unter dem Wave-Button, Standard aus, `UIStore.autoStartWaves`). Nach `wave:completed` zählt `AutoWaveCountdown` (`utils/auto-wave-countdown.ts`) `AUTO_WAVE_DELAY_MS` = 10 s **Spielzeit** herunter, danach ruft `GameLoopFacadeService.tickAutoWave()` (pro Frame) `startWave()` auf, denselben Weg wie der Button. Spielzeit, weil die Pause zwischen den Wellen dann der gewählten Geschwindigkeit folgt wie die Forschung, und weil eine Pause (`GameStore.paused`, kein Sub-Step, die Game-Clock steht) den Countdown ohne Sonderfall anhält. Jedes `wave:started` (auch das eigene), `game:over` und `game:reset` beenden ihn; mit aktivem Bot startet er nicht, der Bot startet seine Wellen selbst.

---

## Progressive Difficulty

### Konzept

Der `WaveManager` kennt **keine** Schwierigkeitskurve — er spielt einen fertigen
`SpawnSchedule` ab. Die Kurve entsteht an vier Stellen weiter oben und
multipliziert sich:

| Ebene | Wo | Wirkung |
|---|---|---|
| Content/Pacing | `WAVE_CURRICULUM` in `configs/wave-curriculum.config.ts` | pinnt Template + Gold-Budget pro Wave (W1-W30). Danach wählt der Director das Template, das Gold halbiert sich pro Welle bis auf 5 % des W30-Budgets (Boss-Wellen doppelt, `goldBudgetForWave`) |
| Formfaktoren | `RuleDirector` (`RAMP_FULL_WAVE = 60`) | Count/HP hoch, Spawn-Delay runter |
| Endgame-HP | `endgameHpMultiplier(wave)` | ab W21 +5 % pro Welle auf `hpMult`, Cap 4× |
| Leck-Schaden | `enemyBaseDamageForWave(wave)` | HP-Verlust pro Durchkommen: 1 (W1–10), 2 (W11–20), 3 (W21–30), … |

Nach oben gedeckelt wird die Kurve durch den Fairness-Cap und den
Gate-Controller (siehe [Wave-Erzeugung](#wave-erzeugung-director--waveconfig))
sowie durch `GAME_BALANCE.combat.maxLeakDamagePerWave` — eine einzelne Welle
kann den Spieler nie mehr als 18 HP kosten.

### Boss Waves

Boss-Wellen sind Templates mit `bossOnly: true` (`boss_herbert`, `boss_golem`,
`boss_dragon`). Welche Welle eine Boss-Welle ist, sagt `isBossWave()`: im
Curriculum W10/W20/W30, dort fest auf `boss_herbert` gepinnt, danach jede
fünfte Welle (W35, W40, ...). An Boss-Wellen lässt die Maske nur Boss-Templates
zu, an allen anderen sperrt sie sie; Details unter
[Regel-Director](#regel-director-abwechslung-und-kurve). `boss_golem` und
`boss_dragon` haben `minWave: 31`, `boss_dragon` braucht Anti-Air.

**Boss-Varianten** (`configs/boss-variants.config.ts`): Bosse, die kein Template des
Directors sind, kommen über eine Rotation über die Boss-Wellen nach dem Curriculum.
`BOSS_VARIANT_ROTATION` läuft über W35, W40, W45, ... und nennt je Welle eine Variante oder
`null` für das Boss-Template des Directors; derzeit `['worm', null, 'ooze', null]`: W35,
W55, W75, ... bringen den Chitin-Wurm, W45, W65, W85, ... die Ooze (ENEMY_CREATION.md,
Körper entlang der Route), W40, W50, W60, ... die Director-Bosse. Der Director plant auch diese
Wellen wie bisher. `GameLoopFacadeService.startWaveWithAI()` ersetzt danach seine Welle durch
`bossVariantWave()`: ein Gegner des Varianten-Typs (ein Wurm, also ein Enemy je Segment) mit
dem HP-Multiplikator, den der Director für diese Welle gerechnet hat (Template-Range,
DPS-Ramp, Endgame-Multiplikator); der Wurm nimmt ihn je Segment. Das Fairness-Gate bestimmt
die Größe nicht, die Länge des Wurms folgt der Route. „Why this wave“ nennt das ersetzte
Template, der Collector speichert die Welle, die läuft. Templates, Curriculum, Encoder und
`ai-schema.json` kennen die Varianten nicht; Wellen aus dem Training-Backend werden nie
ersetzt. NEXT im Wave-Panel (Zeitleiste der kommenden Wellen, `wave-timeline.component`) zeigt
eine Varianten-Welle vorab mit Namen, Rüstung und „weak to“.

#### Boss-Intro

Tritt ein Boss einer Welle aus seinem Spawn-Portal (`EnemyTypeConfig.isBoss`,
`enemy:spawned` mit `viaPortal`), schneidet die Kamera hinter einem kurzen
dunklen Schleier aufs Portal, zeigt Namen (`EnemyTypeConfig.name`) und Welle
und kehrt danach in die Pose zurück, die sie vorher hatte. Ablauf in
`BossIntroService` (`services/boss-intro.service.ts`), Regeln, Zeitplan und
Einstellung in `utils/boss-intro.ts`, Schleier und Titelkarte in
`components/boss-intro/` (Gestaltung: [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md#boss-intro-canvas)).

- **Einmal pro Bosstyp und Welle** (`BossIntroGate`): mehrere Bosse eines Typs
  in einer Welle (fünf Herberts einer Custom Wave, die Segmente eines Wurms)
  bekommen eines, zwei Typen je eines, nacheinander. `game:reset` setzt das
  Tor zurück, der nächste Lauf zählt wieder ab Welle 1.
- **Wurm und Ooze**: den Wurm meldet `worm:spawned` mit `viaPortal` (Kopf als
  Boss); die `enemy:spawned` seiner Segmente tragen kein `viaPortal`, weil sie
  einzeln nachkommen, und lösen nichts aus. Ein zerstörtes Segment teilt den
  Wurm ohne neuen Spawn. Die Ooze kommt als ein Gegner aus dem Portal, ihre
  Spitze läuft die Route wie jeder Gegner; ihre Schleimklumpen beim Tod sind
  Split-Kinder ohne `viaPortal`.
- **Nur Wellen-Spawns**, Custom Wave eingeschlossen. Per Enemy Debug gesetzte
  Bosse stehen irgendwo auf der Route, ein Schnitt aufs Portal zeigte nichts.
- **Der Schnitt wartet, bis der Boss draußen ist**: Routendistanz
  `bossClearDistance` = halbe Portaltiefe (`PORTAL_DEPTH`, mit
  `portalDepthScale`) plus 3 m. Vorher steckt er im Portalvolumen und ist von
  keiner Seite zu sehen. Bei Herbert (4 m/s) knapp 2 s nach dem Spawn.
- **Keins** bei ausgeschaltetem Schalter "Boss Intro" im Display-Menü, im Photo
  Mode, mit Trainings-Bot oder verbundenem Trainings-Backend, über 4x (nur
  Trainingsläufe kommen darüber), ohne Rendering und während des Intro-Flugs
  (`bossIntroBlock`). Ein so übergangener Boss bekommt später keins mehr.
- **Pause**: das Intro setzt `GameStore.paused` wie der Pause-Knopf und gibt am
  Ende zurück, was der Spieler hatte; hatte er pausiert, bleibt es pausiert.
  An der Simulation ändert sich nichts, die Sub-Steps laufen nur nicht.
- **Zeitplan** in Wanduhr (`BOSS_INTRO_TIMING`): Schleier 220 ms, 60 ms dunkel,
  Schnitt aufs Portal, Einstellung 2,8 s (der Schleier weicht in 320 ms),
  Schleier, Schnitt zurück, Schleier weicht; zusammen rund 3,7 s. Ein Frame
  zählt höchstens 100 ms, ein Ruckler frisst die Einstellung nicht. Klick
  oder Esc springt sofort zur Rückkehr.
- **Einstellung** (`portalShot`): die Kamera steht über der Route jenseits
  des Bosses und folgt der Straße um Kurven, damit sie über der Fahrbahn und
  nicht in einer Fassade steht. Das Portal füllt 55 % der vertikalen Bildhöhe,
  14° Neigung auf einen Punkt zwischen Portal und Boss, über die Einstellung
  8 % Heranfahrt (keine bei `prefers-reduced-motion`). Ist die Route kürzer,
  steht die Kamera an ihrem Ende.
- Solange es läuft: Kamera-Controls aus, ein laufender Schnellsprung (Pos1, N)
  und gehaltene Pan-Tasten enden, die Spieltasten warten. Die obere HUD-Spalte
  blendet aus, die Boss-Leiste bleibt dabei bestehen.

---

## Blutmond-Wellen

Nur Optik. Stats, Spawns und Gold der Welle bleiben, wie sie sind, und keine
Spiel-Logik liest etwas davon.

- **Welche Wellen:** `isBloodMoonWave()` in `configs/blood-moon.config.ts`: ab
  W14 jede siebte (W14, W21, W28, W35, …), ohne Ende, also auch im Endlosspiel.
  Jede fünfte davon ist zugleich eine Boss-Welle: W35 die des Chitin-Wurms, W70 eine
  des Directors, W105 die der Ooze (Rotation siehe oben). Es zählt nur die Wellennummer, eine
  Custom-Welle aus dem Debug-Fenster auf W14 bekommt den Look ebenso.
- **An und aus:** `BloodMoonService` (`game-engine/`) hört auf den Event-Bus.
  `wave:started` einer Blutmond-Welle schaltet den Look an, `wave:completed` und
  `game:over` blenden ihn aus, `game:reset` nimmt ihn ohne Blende weg.
- **Blende:** `BloodMoonLook` (`engine.bloodMoon`, `three-engine/blood-moon/`)
  blendet in 3 s ein und in 4,5 s aus (Smoothstep). Sie läuft auf der Wanduhrzeit
  zwischen den Frames, solange das Spiel läuft (Timescale über 0), und steht in der
  Pause. Bei 4x dauert sie so lang wie bei 1x, ein pausiertes Bild bleibt stehen.
  Die Teile bekommen den Wert nur, wenn er sich ändert; außerhalb einer Blutmond-Welle
  bleibt es bei einem Vergleich pro Frame.

| Teil | Datei | Wirkung |
|---|---|---|
| Stimmung | `three-engine/blood-moon/blood-moon-mood.ts` | Ein Bildschirm-Quad am Ende des Opaque-Pass (`renderOrder` 900, Blend-Faktoren Null und Quellfarbe) multipliziert das Bild mit einem Rotton in Anzeigewerten, die Ecken dunkler. Der Himmel dimmt über `scene.backgroundIntensity`, der Distanznebel wird dunkelrot. Alles Transparente zeichnet danach und behält seine Farben: Feuer, Mündungsfeuer, Projektile, Suchscheinwerfer, Health-Bars, Reichweite, LOS-Zellen. Ausnahme sind die blendenden Gegnertypen und die Ooze, sie übernehmen die Tönung im Shader |
| Gegner | `renderers/instanced-enemy/vat-material.ts` | Randleuchten im VAT-Shader über einen Uniform, den alle Typen teilen, Kopf und Segmente des Wurms eingeschlossen ([INSTANCED_ENEMY_RENDERING.md](INSTANCED_ENEMY_RENDERING.md#blutmond)) |
| Ooze | `renderers/ooze/ooze-band-material.ts` | Dasselbe Randleuchten im eigenen Band-Shader, danach die Tönung der Stimmung (linear, das Band kodiert seine Ausgabe selbst). Zwei Uniform-Objekte, die `OozeBandRenderer` allen Bändern gibt |
| Suchscheinwerfer | `renderers/searchlight/searchlight.renderer.ts` | Ein additiver Lichtkegel je Tower, alle in einem Draw Call. Schwenkt ±60° um die Wachrichtung des Towers (folgt ihr, wenn Reichweite oder Routen sie ändern, `setHeading`), 18° unter der Waagerechten, Periode zufällig 10 bis 16 s. Die Lampe steht auf dem Fuß des Towers (`position.height`, also auf dem Sockel), 0,8 m über der Schusshöhe, mindestens 3,8 m über dem Fuß. Das Research Center bekommt keinen |
| Banner, NEXT | `components/blood-moon-banner/`, `game-sidebar/wave-panel/upcoming-waves.ts` | Siehe [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md#blutmond-banner-canvas) |

- **Warum kein Post-Processing-Pass:** Der Composer läuft nur mit Bloom oder Color
  Grading. Ihn zum Wellenstart einzuschalten, würde die Custom-Shader, die
  Anzeigewerte schreiben (darunter die Gegner), sichtbar springen lassen. Das Quad
  wirkt auf dem Canvas und im Composer-Target gleich; ins lineare Target geht seine
  Farbe hoch 2,2. Entsättigen kann eine Multiplikation nicht, der Look ist ein
  Rotstich mit dunkleren Ecken.
- **Display-Option:** "Blood Moon" im Display-Menü (`VfxSettings.bloodMoon`,
  Default an, von keinem Preset gesetzt). Aus nimmt den Look sofort weg, Mond auf
  NEXT und Banner entfallen. An während einer Blutmond-Welle blendet ihn ein.
- **Photo Mode:** Der Look gehört zur Szene und bleibt, auch im Screenshot. Das
  Banner geht mit dem HUD.
- **Werte:** `BLOOD_MOON_LOOK` in `configs/blood-moon.config.ts` (Blende, Tönung,
  Glühen, Suchscheinwerfer). Stand 2026-09-14 per Überlegung gesetzt, nicht am
  Bildschirm abgestimmt.
- **Kosten während einer Blutmond-Welle:** ein Vollbild-Quad mit Multiplikation, ein
  Draw Call für alle Kegel (24 Dreiecke je Tower), ein Uniform pro Frame für den
  Schwenk (während der Blende dazu Helligkeit, Tönung, Nebel und Himmel), ein Zweig im
  Fragment-Shader der Gegner. Kein Buffer-Upload und keine Allokation pro Frame.
  Gemessen ist das nicht.

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

`SpawnEntry` und `SpawnSchedule` stehen oben unter
[WaveConfig Interface](#waveconfig-interface-schedule-only-seit-2026-05-23);
`WaveConfig` besteht nur aus `schedule`. Der Builder setzt pro Entry `speed`
(Basis-Speed × `speedMultiplier`), `health` (Basis-HP × `healthMultiplier`,
nur wenn gesetzt), `delay` aus dem `spawnDelay` der Gruppe und bei
`wave-in-wave` `pauseAfter`.

### Spawn-Patterns

7 Patterns stehen zur Verfuegung (`src/app/ai/core/spawn-schedule-builder.ts`):

| Pattern | Verhalten | Beispiel (8Z, 4B, 2T) |
|---------|-----------|------------------------|
| `interleaved` | Round-Robin, pro Durchgang einer je Gruppe | Z B T Z B T Z B Z B Z Z Z Z |
| `sequential` | Alle einer Gruppe, dann naechste | ZZZZZZZZ BBBB TT |
| `clustered` | Cluster von N (Default 3), dann Wechsel | ZZZ BBB TT ZZZ B ZZ |
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

Ohne `pattern` nimmt der Adapter `DEFAULT_SPAWN_PATTERN` (`interleaved`).
Director-Wellen tragen das `spawnPattern` ihres Templates; Templates ohne
Pattern laufen damit `interleaved`. `delayVariation > 0` setzt `getDelay`, das
jeden Abstand zufällig in `baseDelay × (1 ± variation)` wählt.

### WaveManager Integration

Es gibt nur einen Pfad: `startWave()` spielt `schedule.entries[]` der Reihe
nach ab, jeder Entry mit eigenem Typ, Speed und Health. Der Abstand vor Entry
*i* ist das `delay` des vorigen Entries (sonst `getDelay()` bzw. `baseDelay`)
plus dessen `pauseAfter`. `stopSpawning()` und `checkWaveComplete()` gelten für
jede Welle gleich.

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

Oben im Wave-Debug-Panel (`wave-debugger.component.ts`) steht **Why this wave**:
die Begründung des Directors für die laufende Welle (`GameStore.aiExplanation`,
Herkunft der Gründe in [AI_WAVE_DIRECTOR_PLAN.md](AI_WAVE_DIRECTOR_PLAN.md)).
Custom-, Static-Curriculum- und Backend-Wellen haben keine Begründung.

Darunter bietet das Panel einen **Mode-Toggle** (Single/Mixed):

- **Single Mode:** Bestehende Steuerung (Typ, Count, Speed, Health, Delay)
- **Mixed Mode:** Voller Wave-Designer:
  - Gruppen-Karten (Typ-Dropdown, Count, HP/Speed-Multiplier)
  - Add/Remove Groups
  - Pattern-Auswahl (7 Buttons mit Icons)
  - Konditionale Controls (Cluster Size, Sub-Wave Pause)
  - Delay + Variation Slider
  - Total-Counter

State wird im `WaveDebugService` verwaltet (`wave-debug.service.ts`). Die
Mixed-Mode-Signale liegen im Service selbst, die Single-Mode-Werte (Typ, Count,
Speed, Health, Spawn-Mode, Delay) im `DebugStore`:

```typescript
// Mixed-Mode Signals
readonly mixedMode = signal(false);
readonly mixedGroups = signal<MixedGroupConfig[]>([...]);
readonly spawnPattern = signal<SpawnPattern>('interleaved');
readonly clusterSize = signal(3);
readonly subWavePause = signal(3000);
readonly delayVariation = signal(0);

// Baut die AIWaveConfig: Mixed-Mode mit allen Gruppen und Pattern,
// Single-Mode als eine Gruppe mit Pattern 'sequential' und Spawn-Mode
toAIWaveConfig(): AIWaveConfig { ... }
```

`GameLoopFacadeService.startCustomWave()` reicht das Ergebnis durch
`adaptAIWaveConfig()` und sendet `command:start-wave`.

### Dateien

| Datei | Rolle |
|-------|-------|
| `managers/wave.manager.ts` | `SpawnEntry`, `SpawnSchedule`, `WaveConfig`, `startWave()`, `tickSpawn()` |
| `ai/core/spawn-schedule-builder.ts` | 7 Pattern-Builder, `buildSpawnSchedule()`, `ALL_SPAWN_PATTERNS`, `DEFAULT_SPAWN_PATTERN` |
| `ai/core/wave-config-adapter.ts` | `adaptAIWaveConfig()` — einziger Konverter AIWaveConfig → WaveManager-Config |
| `ai/core/models/wave-config.ts` | `AIWaveConfig` (dort `WaveConfig`): Gruppen, `spawnDelay`, optional `pattern`, `spawnMode`, `explanation` |
| `services/debug/wave-debug.service.ts` | Mixed-Mode-Signale, Single-Mode-Werte aus dem `DebugStore`, `toAIWaveConfig()` |
| `components/debug-window/wave-debugger.component.ts` | „Why this wave", Mixed Wave Designer UI |
| `services/facade/game-loop-facade.service.ts` | Quellen-Reihenfolge in `startWave()`, `startCustomWave()` |

---

## Testing & Debugging

### Manual Wave Start

Im Wave-Debug-Fenster (`wave-debugger.component.ts`) Single- oder Mixed-Mode
einstellen und starten. `onStartCustomWave()` sendet `debug:start-custom-wave`,
die Welle kommt aus `WaveDebugService.toAIWaveConfig()` (siehe
[Debug Panel](#debug-panel-mixed-wave-designer)). Das geht nur in Phase
`setup` und mit mindestens einem Spawn-Point.

### Kill All

`debug:kill-all` stoppt den Spawner (`stopSpawning()`) und tötet alle lebenden
Enemies ohne Credits. Die Welle endet danach regulär über `checkWaveComplete()`.

### Jump to Wave

Dev-Cheat, um späte Wellen ohne 30 gespielte Wellen davor zu testen
(Boss-Rotation W35 Wurm, W45 Ooze, Nachladen der Fähigkeiten). Im
Wave-Debug-Fenster (Dev-Menü, Gruppe "Waves & Inspect", Kachel "Waves"),
Abschnitt "Jump to wave": Wellennummer N (Standard 35), daneben was Welle N
ist (Boss-Variante, Curriculum-Template, Boss-Welle oder Director-Welle),
Schalter "Gold of the skipped waves" (Standard an), Knopf.

Weg: `debug:jump-to-wave` (`wave`, `grantGold`) → `GameCommandsHandler` →
`GameStateManager.jumpToWave()`. Sofort, nicht deferred, wie
`debug:add-credits`: der Sprung gilt nur in Phase `setup`, und ein
Wellenstart direkt danach muss den neuen Zähler schon sehen.

| Was | Verhalten |
|---|---|
| Zähler | `WaveManager.jumpTo(N - 1)`: Welle N - 1 gilt als gespielt, der nächste Start ist Welle N. Nichts spawnt, kein `wave:started` und kein `wave:completed` |
| Erlaubt | nur in Phase `setup` (nicht während einer Welle, nicht nach Game Over), nur vorwärts und nur, wenn mindestens eine Welle übersprungen wird (N ab aktueller Welle + 2). Sonst `false`, kein Event |
| Gold | mit Schalter `skippedWavesGold(from + 1, N - 1)` (`services/economy.service.ts`): Kill-Budget, Basis-Abschlussbonus und Meilenstein-Boni jeder übersprungenen Welle, also was ein Spieler bekommt, der jede Welle ganz abräumt. Keine Skill-Boni (Perfect, Close Call, Combo, Comeback); der Perfect-Streak bleibt, wie er war |
| Fähigkeiten | laden nach, als wären die übersprungenen Wellen abgeschlossen (`AbilityManager.advanceWaves`, derselbe Pfad wie bei `wave:completed`), höchstens bis voll |
| Forschung, Auto-Start-Countdown | bleiben, wie sie sind: sie laufen auf Spielzeit, und der Sprung verbraucht keine |
| Wave-Director | behält Gate-Fenster, Multiplikator und Template-Historie. Übersprungene Wellen liefern keine Leck-Evidenz, und die Verteidigung ist dieselbe. Er plant aus dem Zähler (`waveNumber + 1` im Snapshot), Curriculum-Pin, Boss-Takt, DPS-Rampe, Endgame-HP und Boss-Rotation folgen also Welle N |
| `game:started` | geht weiter genau einmal vor der ersten Welle eines Laufs raus. Der GameStateManager merkt sich das in einem Flag (`runStarted`, in `reset()` zurückgesetzt) statt an Welle 0, damit ein Sprung vor Welle 1 es nicht verschluckt |
| Ankündigung | `wave:jumped` (`from`, `wave`, `skipped`, `credits`): der Store setzt `waveNumber` auf N - 1, die Game-Over-Bilanz bucht `credits` als Cheat-Gold (nicht unter Earned), `BestWaveService` schreibt für diesen Lauf keinen Rekord mehr und meldet keinen neuen ([LOCATION_SYSTEM.md](LOCATION_SYSTEM.md)) |

Balance-Configs (Curriculum W1 bis W30, Gold-Budget, Boss-Rotation) ändert der
Cheat nicht.

---

## Game Over Integration

### Base Destroyed

Wave-Completion- und Game-Over-Check liegen beide **in der Sub-Step-Schleife**
von `GameStateManager.update()`, in dieser Reihenfolge:

```typescript
// managers/game-state.manager.ts (Sub-Step-Schleife)
// Ein Nuklearschlag in der Vorwarnung hält die Welle offen (ABILITIES.md)
if (isWavePhase && !this.abilityManager.hasPendingStrikes() && this.waveManager.checkWaveComplete()) {
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

`WaveManager.reset()` läuft beim Neustart (`command:restart-game` →
`GameStateManager.reset()`) und beim Location-Wechsel. Es verwirft den aktiven
Spawner (`activeSpawner = null`),
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

### Herkunft

Spawn-Points werden nicht zufällig erzeugt. `LocationFacadeService` übernimmt
die Spawn-Orte der Location aus `LocationManagementService.editableSpawnLocations()`
(aus URL oder Location-Service) und legt jeden über `addSpawnPoint()` in den
Store (`LocationStore.spawnPoints`). DevWorld erzeugt seine Spawns an
Straßenenden (`StreetGenerator.generateSpawnsAtEnds()`).

### Cached Paths

`addSpawnPoint()` ruft `PathAndRouteService.showPathFromSpawn(spawn)`, das die
Route berechnet; `buildRouteFromPath()` cached sie pro Spawn-ID mit Höhen
(`cachedPaths.set(spawn.id, ...)`). `GameStateManager.initialize()` übergibt
Spawn-Points und Pfade an `waveManager.initialize(spawnPoints, cachedPaths)`.
Nach einer DevWorld-Neugenerierung setzt `reseatWavePipeline()` beide neu, weil
`WaveManager.reset()` die Spawn-Points absichtlich behält.

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

Keine eigene Count-Formel schreiben: Count, HP und Delay kommen aus
Template-Ranges, Rule-Director-Rampe, Fairness-Cap und Gate-Controller (siehe
[Progressive Difficulty](#progressive-difficulty)). Feste Wellen stehen in
`STATIC_WAVE_PROFILES`.

### 3. Mixed Enemy Types

Mischungen gehören in ein Template (`enemies: [[typ, anteil], ...]`) bzw. in
die Gruppen einer `AIWaveConfig`; die Reihenfolge bestimmt das Spawn-Pattern.

---

## Troubleshooting

### Wave startet nicht
- Phase muss `setup` sein (die Facade ignoriert Starts in `wave` und `gameover`)
- Engine bereit und `store.spawnPoints().length > 0`
- Director-Anfrage noch offen (`pendingAIWaveRequest`)? Dann wird ein weiterer Start ignoriert
- Leerer Schedule (`entries.length === 0`): `WaveManager.startWave()` kehrt ohne Event zurück
- Kein Pfad in `cachedPaths` für die Spawn-Points: die Welle bricht nach `spawnPoints.length * 2` Fehlversuchen ab

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

Zwei Grenzen im Code: Der Director komprimiert das Delay, wenn
`count × spawnDelay` über `MAX_WAVE_DURATION_MS` (180 s) liegt, mit
`MIN_SPAWN_DELAY_MS = 5` als Untergrenze. Der `WaveManager` spawnt pro Sub-Step
höchstens `maxSpawnsPerFrame` (3) Enemies, auch bei Delay 0. Zwei Wellen
parallel gibt es nicht: `GameLoopFacadeService.startWave()` startet nur aus
`setup`.

---

## Siehe auch

- [STATIC_WAVE_FALLBACK.md](STATIC_WAVE_FALLBACK.md) - AI-off Debug-Pfad: feste Per-Wave-Profile + UI-Toggle
- [ENEMY_CREATION.md](ENEMY_CREATION.md) - Enemy-Typen erstellen
- [STATUS_EFFECTS.md](STATUS_EFFECTS.md) - Status-Effekte
- [ARCHITECTURE.md](ARCHITECTURE.md) - Manager-System Uebersicht
- [LOCATION_SYSTEM.md](LOCATION_SYSTEM.md) - Spawn-Point Generierung
