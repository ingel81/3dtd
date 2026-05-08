# Bot System - Dokumentation

## Überblick

Das Bot System ist ein professionelles, erweiterbares Framework für automatisierte Tower-Platzierung und -Management in 3DTD. Es basiert auf dem **Strategy Pattern** mit **Composition**, was maximale Flexibilität und Erweiterbarkeit ermöglicht.

**Key Features:**
- 🎯 Strategy Pattern Architecture - Pluggable Entscheidungsstrategien
- 🔧 Hochgradig erweiterbar - Neue Strategien ohne Core-Code-Änderungen
- 🎮 4 Skill Levels - Beginner, Casual, Strategist, Meta
- 🧪 Vollständig testbar - Jede Strategie isoliert testbar
- 🎨 Variabel - Verschiedene Verhaltensweisen durch Strategie-Komposition
- 📊 Performance-Tracking - Detaillierte Stats (Towers, Gold, Actions)

**Location:** `src/app/ai/training/`

---

## Architektur

### High-Level Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    TOWER DEFENSE COMPONENT                       │
│                                                                 │
│  ┌──────────────┐      ┌──────────────┐      ┌──────────────┐  │
│  │ Game Engine  │─────▶│  Bot System  │─────▶│   Actions    │  │
│  │  (update)    │      │   (update)   │      │(place/upgrade)│ │
│  └──────────────┘      └──────┬───────┘      └──────────────┘  │
│                               │                                 │
│                               ▼                                 │
│                        ┌──────────────┐                         │
│                        │ StrategyBot  │                         │
│                        │  (Composite) │                         │
│                        └──────┬───────┘                         │
│                               │                                 │
│                 ┌─────────────┼─────────────┐                   │
│                 ▼             ▼             ▼                   │
│          ┌───────────┐ ┌───────────┐ ┌───────────┐             │
│          │ Strategy1 │ │ Strategy2 │ │ Strategy3 │             │
│          │Priority:90│ │Priority:75│ │Priority:60│             │
│          └───────────┘ └───────────┘ └───────────┘             │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Strategy Pattern

**Core Konzept:** Jede Strategie repräsentiert eine einzelne Entscheidungs-Domain:

- **Placement Strategies** → Wo soll ein Tower / Research-Center gebaut werden?
- **Research Strategies** → Welche Research-Node soll als nächstes gepickt werden?
- **Upgrade Strategies** → Welcher Tower soll upgraden werden? Welcher gesellt werden?
- **Wave Strategies** → Wann nächste Welle starten?

**Execution Flow:**

1. Bot wird jedes Frame von `TowerDefenseComponent` aufgerufen via `update(state, deltaTime)`
2. `BaseTowerBot.update()` prüft Cooldown (`reactionTimeMs`) und delegiert an `decideAction()`
3. `StrategyBot.decideAction()` iteriert über Strategien (sortiert nach Priority)
4. Erste Strategie mit `canExecute() === true` und konkreter Action wird ausgeführt
5. `wait`-Actions werden als Fallback gespeichert, blockieren aber nicht niedrigere Strategien
6. `BaseTowerBot.update()` wendet optional Fehler an (`mistakeRate`)
7. `TowerDefenseComponent` führt Action aus

---

## Verzeichnisstruktur

```
src/app/ai/training/
├── index.ts                         # Module Exports
├── training-client.service.ts       # WebSocket Training Client
│
├── bots/
│   ├── index.ts                     # Bot Exports
│   ├── tower-bot.interface.ts       # ITowerBot, TowerAction, BotConfig, BOT_CONFIGS
│   ├── base-tower-bot.ts            # Abstract Base Bot
│   ├── strategy-bot.ts              # Strategy-Based Bot
│   └── strategy-bot.factory.ts      # Factory für Skill Levels
│
├── strategies/
│   ├── tower-strategy.interface.ts  # ITowerStrategy, BaseStrategy
│   │
│   ├── placement/                   # Placement Strategies
│   │   ├── anti-air-placement.strategy.ts
│   │   ├── splash-defense-placement.strategy.ts
│   │   ├── coverage-fill.strategy.ts
│   │   ├── distributed-placement.strategy.ts
│   │   └── research-center-placement.strategy.ts
│   │
│   ├── research/                    # Research Strategies (Phase 5.5+)
│   │   └── research-pick.strategy.ts
│   │
│   ├── upgrade/                     # Upgrade Strategies
│   │   ├── near-spawn-upgrade.strategy.ts
│   │   └── sell-underperformer.strategy.ts
│   │
│   └── wave/                        # Wave Control Strategies
│       └── auto-start-wave.strategy.ts
│
```

**Hinweis:** `TowerAction`, `BotConfig` und `BOT_CONFIGS` befinden sich alle in `bots/tower-bot.interface.ts`.
`GameStateSnapshot` befindet sich in `src/app/ai/core/models/game-state-snapshot.ts`.

---

## Core Interfaces

### ITowerBot

```typescript
export interface ITowerBot {
  /** Bot configuration */
  readonly config: BotConfig;

  /** Bot name for display */
  readonly name: string;

  /**
   * Get next action based on game state
   * Called every frame by TowerDefenseComponent
   *
   * @param state Current game state snapshot
   * @param deltaTime Time since last update (ms)
   */
  update(state: GameStateSnapshot, deltaTime: number): TowerAction | null;

  /** Reset bot state (new game) */
  reset(): void;

  /** Notify bot of wave completion (for learning bots) */
  onWaveCompleted?(survived: boolean, damagePercent: number): void;
}

export type BotSkillLevel = 'beginner' | 'casual' | 'strategist' | 'meta';
```

### ITowerStrategy

```typescript
export interface ITowerStrategy {
  /** Strategy name (for debugging) */
  readonly name: string;

  /** Priority (0-100, higher = more important) */
  readonly priority: number;

  /**
   * Can this strategy execute now?
   * @returns true if strategy is applicable to current game state
   */
  canExecute(state: GameStateSnapshot): boolean;

  /**
   * Execute strategy and return action
   * @returns TowerAction to perform, or null if strategy cannot execute
   */
  execute(state: GameStateSnapshot): TowerAction | null;
}
```

### TowerAction

```typescript
export type TowerActionType = 'place' | 'upgrade' | 'sell' | 'wait' | 'start-wave';

export interface TowerAction {
  type: TowerActionType;

  /** For 'place': Where to place the tower */
  position?: { x: number; z: number };

  /** For 'place': What tower type to build */
  towerType?: TowerTypeId;

  /** For 'upgrade' and 'sell': Which tower to act on */
  towerId?: string;

  /** For 'upgrade': Which upgrade to apply */
  upgradeId?: string;

  /** Confidence in this action (0-1) */
  confidence?: number;

  /** Human-readable reason for this action */
  reason?: string;
}
```

### BotConfig

```typescript
export interface BotConfig {
  skillLevel: BotSkillLevel;
  reactionTimeMs: number;
  mistakeRate: number;              // 0-1, probability of suboptimal action
  knownTowerTypes: TowerTypeId[];
  adaptsToEnemies: boolean;
  plansAhead: boolean;
  maxTowers: number;                // 0 = unlimited
}
```

### GameStateSnapshot

```typescript
export interface GameStateSnapshot {
  timestamp: number;
  waveNumber: number;
  gameTimeSeconds: number;
  phase: GamePhase;

  player: {
    credits: number;
    lives: number;
    maxLives: number;
    livesPercent: number;  // 0-1
  };

  defense: {
    towerCount: number;
    totalDPS: number;
    antiAirDPS: number;
    avgTowerLevel: number;
    pathCoverage: number;           // 0-1
    defenseReachPercent: number;    // 0-1
    killZoneStrength: number;       // 0-1
    towerVariety: number;           // 0-1

    capabilities: {
      hasAntiAir: boolean;
      hasSplash: boolean;
      hasSlow: boolean;
      hasDoT: boolean;
    };

    towerDistribution: Record<string, {
      count: number;
      avgLevel: number;
      totalDamage: number;
      totalDPS: number;
    }>;
  };

  vulnerabilities: {
    airDefenseGap: boolean;
    splashGap: boolean;
    slowGap: boolean;
    uncoveredPathSegments: number[];
    overallVulnerability: number;   // 0-1
  };

  recentHistory: {
    damagePerWave: number[];
    progressPerWave: number[];
    enemyTypesUsed: string[][];
    lastWaveThreat: number;
    avgWaveDuration: number;
    winStreak: number;
    closeCallStreak: number;
  };

  dpsProfile: PathDPSProfile;
}
```

---

## Bot Implementation

### StrategyBot

**Hauptklasse für Composition-based Bots:**

```typescript
export class StrategyBot extends BaseTowerBot {
  private strategies: ITowerStrategy[] = [];

  constructor(
    skillLevel: BotSkillLevel,
    strategies: ITowerStrategy[],
    name?: string
  ) {
    super(skillLevel, name || `Strategy${skillLevel.charAt(0).toUpperCase()}${skillLevel.slice(1)}Bot`);

    // Sort strategies by priority (highest first)
    this.strategies = strategies.sort((a, b) => b.priority - a.priority);

    console.log(`[Bot] Initialized with ${strategies.length} strategies:`,
      strategies.map(s => `${s.name}(${s.priority})`).join(', ')
    );
  }

  protected decideAction(state: GameStateSnapshot): TowerAction | null {
    let pendingWait: TowerAction | null = null;

    // Iterate through strategies in priority order
    for (const strategy of this.strategies) {
      if (!strategy.canExecute(state)) {
        continue;
      }

      const action = strategy.execute(state);

      if (action) {
        if (action.type === 'wait') {
          // Store first wait as fallback, but don't block lower-priority strategies
          if (!pendingWait) pendingWait = action;
          continue;
        }

        this.notifyStrategies('onActionExecuted', action);
        console.log(`[Bot] ${strategy.name} → ${action.type}`, action.reason || '');
        return action;
      }
    }

    // Return best wait action if no concrete action was found
    if (pendingWait) {
      return pendingWait;
    }

    return { type: 'wait', reason: 'No applicable strategy' };
  }

  // Dynamic strategy management
  addStrategy(strategy: ITowerStrategy): void { ... }
  removeStrategy(name: string): boolean { ... }
  replaceStrategy(name: string, newStrategy: ITowerStrategy): boolean { ... }
}
```

**Features:**
- ✅ Priority-based execution
- ✅ `wait`-Actions als Fallback (blockieren niedrigere Strategien nicht)
- ✅ `notifyStrategies()` benachrichtigt alle Strategien bei konkreten Actions
- ✅ Runtime strategy modification
- ✅ Detailed logging
- ✅ `makeSuboptimalAction()` Override für Fehler-Simulation

### BaseTowerBot

**Abstract base für alle Bots:**

```typescript
export abstract class BaseTowerBot implements ITowerBot {
  readonly config: BotConfig;
  readonly name: string;

  protected lastActionTime = 0;
  protected totalGoldSpent = 0;
  protected towersBuilt = 0;

  constructor(skillLevel: BotSkillLevel, name?: string) {
    this.config = { ...BOT_CONFIGS[skillLevel] };
    this.name = name ?? `${skillLevel.charAt(0).toUpperCase()}${skillLevel.slice(1)}Bot`;
  }

  /**
   * Main update method - handles timing, delegates to subclass, applies mistakes
   */
  update(state: GameStateSnapshot, _deltaTime: number): TowerAction | null {
    const now = Date.now();

    // Check cooldown (reactionTimeMs)
    if (now - this.lastActionTime < this.config.reactionTimeMs) {
      return null;
    }

    let action = this.decideAction(state);

    // Maybe make a mistake (mistakeRate)
    if (action && Math.random() < this.config.mistakeRate) {
      action = this.makeSuboptimalAction(state, action);
    }

    // Record action time
    if (action) {
      this.lastActionTime = now;
      // Track gold spent for place actions
    }

    return action;
  }

  protected abstract decideAction(state: GameStateSnapshot): TowerAction | null;

  reset(): void {
    this.lastActionTime = 0;
    this.totalGoldSpent = 0;
    this.towersBuilt = 0;
  }

  // Helper methods
  protected getCheapestAffordableTower(credits: number): TowerTypeId | null { ... }
  protected getBestTowerForSituation(state: GameStateSnapshot, credits: number): TowerTypeId | null { ... }
  protected getBestValueTower(typeIds: TowerTypeId[]): TowerTypeId { ... }
  protected getRandomPlacementPosition(): { x: number; z: number } { ... }
}
```

### StrategyBotFactory

**Factory für Skill-Level-basierte Bots:**

```typescript
export class StrategyBotFactory {
  constructor(
    private strategicPlacement: StrategicPlacementService,
    private gameState: GameStateManager,
    private osmService: OsmStreetService
  ) {}

  createBot(
    skillLevel: BotSkillLevel,
    autoStartWaves: boolean = false
  ): StrategyBot {
    const strategies = this.getStrategiesForSkillLevel(skillLevel, autoStartWaves);
    return new StrategyBot(skillLevel, strategies);
  }

  // Phase 5.16: alle Skill-Levels bekommen Research-Strategien
  // (Bootstrap + Tower-Lock-State respektieren).
  private getStrategiesForSkillLevel(
    skillLevel: BotSkillLevel,
    autoStartWaves: boolean
  ): ITowerStrategy[] {
    const strategies: ITowerStrategy[] = [];
    const config = BOT_CONFIGS[skillLevel];

    const researchCenterPlacement = new ResearchCenterPlacementStrategy(
      this.strategicPlacement, this.gameState
    );
    const researchPick = new ResearchPickStrategy(config);

    switch (skillLevel) {
      case 'beginner':
        // Research-Center + minimaler Pick (gatling-tech) + basic Placement
        strategies.push(
          researchCenterPlacement,
          researchPick,
          new CoverageFillStrategy(...)
        );
        break;

      case 'casual':
        // Research + AntiAir/Splash + occasional Upgrades + Coverage
        strategies.push(
          researchCenterPlacement,
          new AntiAirPlacementStrategy(...),       // Priority: 90
          new SplashDefensePlacementStrategy(...), // Priority: 85
          researchPick,                             // Priority: 80
          new NearSpawnUpgradeStrategy(...),        // Priority: 75
          new CoverageFillStrategy(...)             // Priority: 60
        );
        break;

      case 'strategist':
        // Volle Tree-Auswahl + Distributed-Placement + Sell-Underperformer
        strategies.push(
          researchCenterPlacement,
          new AntiAirPlacementStrategy(...),
          new SplashDefensePlacementStrategy(...),
          researchPick,
          new NearSpawnUpgradeStrategy(...),
          new SellUnderperformerStrategy(...),
          new DistributedPlacementStrategy(...)
        );
        break;

      case 'meta':
        // All-Round Setup ohne Sell, mit Coverage statt Distributed
        strategies.push(
          researchCenterPlacement,
          new AntiAirPlacementStrategy(...),
          new SplashDefensePlacementStrategy(...),
          researchPick,
          new NearSpawnUpgradeStrategy(...),
          new CoverageFillStrategy(...)
        );
        break;
    }

    if (autoStartWaves) {
      strategies.push(new AutoStartWaveStrategy(true));
    }

    return strategies;
  }
}
```

**Hinweise:**
- `NearSpawnUpgradeStrategy` erhält `(gameState, osmService)` als Parameter.
- `SellUnderperformerStrategy(gameState, config)` — nur Strategist-Bot.
- `ResearchPickStrategy(config)` ist skill-level-aware (siehe `researchOrderBySkill`).
- Die Factory wendet zusätzlich ±30 % Jitter auf `reactionTimeMs` und `maxTowers` an
  (`jitterConfig()`), damit parallele Training-Clients nicht alle identisch spielen.

---

## Strategies

### Placement Strategies

#### AntiAirPlacementStrategy

**Purpose:** Place anti-air towers when air defense gap exists.

```typescript
export class AntiAirPlacementStrategy extends BaseStrategy {
  constructor(
    private strategicPlacement: StrategicPlacementService,
    private gameState: GameStateManager,
    private config: BotConfig
  ) {
    super('AntiAirPlacement', 90);  // High priority
  }

  canExecute(state: GameStateSnapshot): boolean {
    // Only execute if:
    // 1. Tower count below maxTowers
    // 2. Air defense gap exists
    // 3. Wave number > 3 (air enemies appear later)
    // 4. Can afford anti-air tower
    if (this.config.maxTowers > 0 && state.defense.towerCount >= this.config.maxTowers) return false;
    if (!state.vulnerabilities.airDefenseGap) return false;
    if (state.waveNumber < 4) return false;

    const affordable = this.getAffordableTowers(
      state.player.credits,
      this.config.knownTowerTypes
    );
    return affordable.some(t => TOWER_TYPES[t].canTargetAir);
  }

  execute(state: GameStateSnapshot): TowerAction | null {
    // 1. Find best anti-air tower
    const affordable = this.getAffordableTowers(...);
    const antiAirTowers = affordable.filter(t => TOWER_TYPES[t].canTargetAir);

    if (antiAirTowers.length === 0) return null;

    const bestTower = antiAirTowers.reduce((best, current) => {
      return this.getTowerValue(current) > this.getTowerValue(best)
        ? current : best;
    });

    // 2. Get strategic placement candidates
    const spawnPoints = this.gameState.getSpawnPoints();
    const paths = this.gameState.getCachedPaths();
    const candidates = this.strategicPlacement.findStrategicPositions(
      spawnPoints, paths, TOWER_TYPES[bestTower].range,
      this.gameState.towerManager.getAll()
    );

    // 3. Find first valid position
    for (const candidate of candidates) {
      const validation = this.gameState.towerManager.validatePosition(
        candidate.position
      );

      if (validation.valid) {
        return {
          type: 'place',
          position: { x: candidate.position.lon, z: candidate.position.lat },
          towerType: bestTower,
          confidence: 0.95,
          reason: `Critical air defense gap - ${candidate.reason}`
        };
      }
    }

    return null;
  }
}
```

**Priority:** 90 (High)
**Triggers:** Air defense gap + Wave 4+ + Affordable anti-air tower + Below maxTowers
**Action:** Place rocket/sniper at strategic position

#### SplashDefensePlacementStrategy

**Purpose:** Place splash damage towers when splash gap exists.

**Priority:** 85 (High)
**Triggers:** Splash gap + Wave 3+ + Affordable splash tower + Below maxTowers
**Action:** Place cannon/rocket at strategic position

#### DistributedPlacementStrategy

**Purpose:** Distribute towers evenly across the entire path (for AI training).

```typescript
export class DistributedPlacementStrategy extends BaseStrategy {
  private savingForType: TowerTypeId | null = null;

  constructor(
    private strategicPlacement: StrategicPlacementService,
    private gameState: GameStateManager,
    private config: BotConfig
  ) {
    super('DistributedPlacement', 65);  // Higher than CoverageFill
  }

  canExecute(state: GameStateSnapshot): boolean {
    const notMaxed = this.config.maxTowers <= 0 || state.defense.towerCount < this.config.maxTowers;
    if (!notMaxed) return false;

    // Stay active while saving for a type
    if (this.savingForType) return true;

    return state.player.credits >= 20;
  }

  execute(state: GameStateSnapshot): TowerAction | null {
    // 1. Saving-Logik: wartet auf teure Tower-Typen
    // 2. First 2 towers: cheapest (bootstrap defense)
    // 3. New type available? Build it (variety first)
    // 4. Missing types too expensive? 30% save, 70% reinforce
    // 5. All types placed: reinforce least-represented
    // 6. Archer limit: max 4, then force alternatives

    // Uses findDistributedPositions() for zone-based placement
    const candidates = this.strategicPlacement.findDistributedPositions(
      spawnPoints, paths, towerRange, existingTowers
    );

    // Validate and place at best candidate
    for (const candidate of candidates) {
      if (validation.valid) {
        return { type: 'place', position, towerType, confidence: 0.8, reason };
      }
    }
    return null;
  }

  onReset(): void {
    this.savingForType = null;
  }
}
```

**Priority:** 65 (Medium-High)
**Triggers:** Credits >= 20 + Tower count below max (oder aktiv beim Sparen)
**Action:** Place tower in under-defended path zone
**Archer Limit:** Max 4 Archer-Tower, danach Alternativen erzwungen

**Zone Algorithm:**
1. `findDistributedPositions()` verteilt Kandidaten über die gesamte Pfadlänge
2. Under-defended zones get higher scores
3. Ensures towers spread across entire path (not just near spawn)

**Used by:** Strategist bot (AI training) - replaces CoverageFillStrategy

---

#### CoverageFillStrategy

**Purpose:** Fill gaps in path coverage, prioritize tower variety.

```typescript
export class CoverageFillStrategy extends BaseStrategy {
  private savingForType: TowerTypeId | null = null;

  constructor(
    private strategicPlacement: StrategicPlacementService,
    private gameState: GameStateManager,
    private config: BotConfig
  ) {
    super('CoverageFill', 60);  // Medium priority
  }

  canExecute(state: GameStateSnapshot): boolean {
    const notMaxed = this.config.maxTowers <= 0 || state.defense.towerCount < this.config.maxTowers;
    if (!notMaxed) return false;

    // Stay active while saving for a type
    if (this.savingForType) return true;

    return state.player.credits >= 20;
  }

  execute(state: GameStateSnapshot): TowerAction | null {
    // 1. Saving-Logik: wartet auf teure Tower-Typen
    // 2. First tower: cheapest to get started
    // 3. New type available? Build it (variety)
    // 4. Missing types too expensive? 50% save, 50% reinforce
    // 5. All types placed: reinforce least-represented

    // Uses findStrategicPositions() for placement
    ...
  }

  onReset(): void {
    this.savingForType = null;
  }
}
```

**Priority:** 60 (Medium)
**Triggers:** Credits >= 20 + Below maxTowers (oder aktiv beim Sparen)
**Action:** Place tower with variety/reinforce logic

#### ResearchCenterPlacementStrategy (Phase 5.5+)

**Purpose:** Baut das Research-Center, sobald genug Credits da sind und kein Center
existiert.

**Priority:** 95 (höchste — über AntiAir/Splash)
**Triggers:** `centerLevel === 0` + bezahlbar + valide Position via `findStrategicPositions`
**Action:** `place` mit `towerType: 'research-center'`

Code: `src/app/ai/training/strategies/placement/research-center-placement.strategy.ts`

### Research Strategies (Phase 5.5+)

#### ResearchPickStrategy

**Purpose:** Pickt die nächste Research-Node — skill-level-aware Reihenfolge,
wave-curriculum-aligned Prioritäten.

**Priority:** 80 (zwischen NearSpawnUpgrade=75 und SplashDefense=85)
**Triggers:** Research-Center vorhanden + freier Slot + bezahlbare Node + Prereqs erfüllt

**Skill-Level-Order (Phase 5.16, aligned an `wave-curriculum.ts`):**

| Skill       | Pick-Order |
|------------|--------------------------------------------------|
| beginner   | `gatling-tech` only |
| casual     | `gatling-tech, ice-magic, toxic-compounds, siege-engineering, fire-alchemy` |
| strategist | volle Tree (10+ Nodes), aligned an Wave-Curriculum: AA bis W6 (für `bat_swarm`@W7), Cannon bis W9 (für `boss_herbert`@W10), Magic bis W12 (für `ghost_surge`@W13) |
| meta       | wie strategist |

Code: `src/app/ai/training/strategies/research/research-pick.strategy.ts`

### Upgrade Strategies

#### NearSpawnUpgradeStrategy

**Purpose:** Upgrade towers near spawn points (highest impact).

```typescript
export class NearSpawnUpgradeStrategy extends BaseStrategy {
  constructor(
    private gameState: GameStateManager,
    private osmService: OsmStreetService
  ) {
    super('NearSpawnUpgrade', 75);  // Medium-High priority
  }

  canExecute(state: GameStateSnapshot): boolean {
    if (state.defense.towerCount < 3 || state.player.credits < 50) return false;

    // ~33% chance to fire (gives build/save strategies room)
    if (Math.random() > 0.33) return false;

    // Check if any tower actually has affordable upgrades (dynamic cost)
    const towers = this.gameState.towerManager.getAll();
    for (const tower of towers) {
      const upgrades = tower.getAvailableUpgrades();
      if (upgrades.some(u => tower.getNextUpgradeCost(u.id) <= state.player.credits)) {
        return true;
      }
    }
    return false;
  }

  execute(state: GameStateSnapshot): TowerAction | null {
    const towers = this.gameState.towerManager.getAll();
    const spawnPoints = this.gameState.getSpawnPoints();

    // Find towers with available upgrades
    const upgradeableTowers = towers.filter(t =>
      t.getAvailableUpgrades().length > 0
    );

    if (upgradeableTowers.length === 0) return null;

    // Sort by distance to nearest spawn (using osmService.haversineDistance)
    const towersWithDistance = upgradeableTowers.map(tower => {
      const minDist = Math.min(...spawnPoints.map(spawn => {
        return this.osmService.haversineDistance(
          tower.position.lat, tower.position.lon,
          spawn.lat, spawn.lon
        );
      }));
      return { tower, distance: minDist };
    });

    towersWithDistance.sort((a, b) => a.distance - b.distance);

    // Try to upgrade closest tower
    const closest = towersWithDistance[0].tower;
    const upgrades = closest.getAvailableUpgrades();
    const affordable = upgrades.filter(u =>
      closest.getNextUpgradeCost(u.id) <= state.player.credits
    );

    if (affordable.length === 0) return null;

    // Pick random affordable upgrade (variety for training)
    const upgrade = affordable[Math.floor(Math.random() * affordable.length)];

    return {
      type: 'upgrade',
      towerId: closest.id,
      upgradeId: upgrade.id,
      confidence: 0.8,
      reason: `Upgrading ${closest.typeConfig.name} near spawn with ${upgrade.name}`
    };
  }
}
```

**Priority:** 75 (Medium-High)
**Triggers:** 3+ towers + 50+ credits + ~33% Chance + bezahlbares Upgrade vorhanden
**Action:** Upgrade tower closest to spawn
**Upgrade-Kosten:** Dynamisch via `tower.getNextUpgradeCost(upgradeId)`

#### SellUnderperformerStrategy (Phase 5.16, nur Strategist)

**Purpose:** Verkauft Tower mit deutlich unterdurchschnittlicher Total-Damage-Bilanz,
damit Credits für stärkere/passendere Tower freikommen.

**Priority:** 55 (unter Upgrade-Strategien)
**Triggers:** Mindest-Tower-Anzahl + Tower mit Total-Damage signifikant unter Median

Code: `src/app/ai/training/strategies/upgrade/sell-underperformer.strategy.ts`

### Wave Strategies

#### AutoStartWaveStrategy

**Purpose:** Automatically start next wave when ready.

```typescript
export class AutoStartWaveStrategy extends BaseStrategy {
  private lastActionTime = 0;
  private setupPhaseStartTime = 0;
  private readonly WAVE_START_DELAY = 1000;   // 1 second
  private readonly MAX_SETUP_WAIT = 5000;     // Max 5 seconds in setup phase

  constructor(private autoMode: boolean) {
    super('AutoStartWave', 30);  // Low priority
  }

  canExecute(state: GameStateSnapshot): boolean {
    if (!this.autoMode) return false;
    if (state.phase !== 'setup') return false;

    // Need at least 1 tower
    if (state.defense.towerCount === 0) return false;

    const now = Date.now();

    // Track setup phase start time
    if (this.setupPhaseStartTime === 0) {
      this.setupPhaseStartTime = now;
    }

    // Force start wave if setup takes too long
    if (now - this.setupPhaseStartTime > this.MAX_SETUP_WAIT) return true;

    // Prefer 2+ towers for early waves if credits available
    if (state.waveNumber < 3 && state.defense.towerCount < 2
        && state.player.credits >= 20) return false;

    // Check cooldown
    if (now - this.lastActionTime < this.WAVE_START_DELAY) return false;

    return true;
  }

  execute(state: GameStateSnapshot): TowerAction | null {
    this.setupPhaseStartTime = 0; // Reset setup timer
    return {
      type: 'start-wave',
      confidence: 0.9,
      reason: `Auto-starting wave ${state.waveNumber + 1} (${state.defense.towerCount} towers ready)`
    };
  }

  /** Called by bot when ANY action is executed */
  onActionExecuted(): void {
    this.lastActionTime = Date.now();
  }

  /** Called on game reset */
  onReset(): void {
    this.lastActionTime = 0;
    this.setupPhaseStartTime = 0;
  }
}
```

**Priority:** 30 (Low) - Only after other strategies can't execute
**Triggers:** Auto-mode + Setup-Phase + Minimal defense + Cooldown passed
**Force-Start:** Nach 5 Sekunden in Setup-Phase wird Wave erzwungen
**Action:** Start next wave

---

## Bot Configurations

### BOT_CONFIGS

```typescript
export const BOT_CONFIGS: Record<BotSkillLevel, BotConfig> = {
  beginner: {
    skillLevel: 'beginner',
    reactionTimeMs: 3000,                            // Slow
    mistakeRate: 0.4,                                // Viele Fehler
    knownTowerTypes: ['archer', 'cannon'],            // Limited types
    adaptsToEnemies: false,
    plansAhead: false,
    maxTowers: 10,
  },

  casual: {
    skillLevel: 'casual',
    reactionTimeMs: 1500,
    mistakeRate: 0.2,
    knownTowerTypes: ['archer', 'cannon', 'rocket', 'ice', 'dual-gatling'],
    adaptsToEnemies: true,
    plansAhead: false,
    maxTowers: 15,
  },

  strategist: {
    skillLevel: 'strategist',
    reactionTimeMs: 800,
    mistakeRate: 0.05,
    knownTowerTypes: ['archer', 'cannon', 'rocket', 'ice', 'dual-gatling', 'magic'],
    adaptsToEnemies: true,
    plansAhead: true,
    maxTowers: 50,
  },

  meta: {
    skillLevel: 'meta',
    reactionTimeMs: 400,                             // Fast
    mistakeRate: 0.01,                               // Fast keine Fehler
    knownTowerTypes: ['archer', 'cannon', 'ice', 'dual-gatling', 'magic', 'rocket'],
    adaptsToEnemies: true,
    plansAhead: true,
    maxTowers: 0,                                    // Unlimited
  }
};
```

### Strategy Priority Ranges

**Best Practices:**

| Priority Range | Usage | Examples |
|----------------|-------|----------|
| 90-100 | **Critical** - Must execute ASAP | Air defense gaps, Game-losing scenarios |
| 75-89 | **High** - Important but not critical | Splash defense, Key upgrades |
| 50-74 | **Medium** - Standard operations | Coverage fill, Distributed placement |
| 25-49 | **Low** - Nice to have | Wave start |
| 0-24 | **Very Low** - Last resort | Fallback strategies, Default actions |

---

## Integration

### TrainingClientService

Die Bot-Logik (Factory, Steuerung, Stats) lebt im `TrainingClientService`, nicht in der Component:

```typescript
// In TrainingClientService (ai/training/training-client.service.ts)
export class TrainingClientService {
  private botFactory!: StrategyBotFactory;
  private currentBot: ITowerBot | null = null;

  // Stats
  readonly botEnabled = signal(false);
  readonly botStats = signal({ towersPlaced: 0, goldSpent: 0 });

  enableBot(skillLevel: BotSkillLevel): void {
    this.currentBot = this.botFactory.createBot(skillLevel);
    this.botEnabled.set(true);
  }

  disableBot(): void {
    this.currentBot = null;
    this.botEnabled.set(false);
  }
}
```

**TowerDefenseComponent** delegiert via `this.trainingClient.enableBot(skillLevel)` im `ngAfterViewInit()`.

**Bot Execution (Game Loop):**

```typescript
private updateBotBehavior(deltaTime: number): void {
  if (!this.currentBot || !this.botEnabled()) return;

  // Get current game state
  const state = this.captureGameState();

  // Bot decides action (update handles cooldown + mistakes internally)
  const action = this.currentBot.update(state, deltaTime);

  if (action) {
    this.executeBotAction(action);
  }
}

private executeBotAction(action: TowerAction): void {
  switch (action.type) {
    case 'place':
      // Validate affordable
      const towerCost = TOWER_TYPES[action.towerType]?.cost;
      if (!towerCost || this.gameState.credits() < towerCost) {
        console.warn(`[Bot] Cannot afford tower: ${towerCost}`);
        break;
      }

      // Place tower
      this.placeTower(action.position, action.towerType);

      // Update stats
      this.botStats.update(stats => ({
        ...stats,
        towersPlaced: stats.towersPlaced + 1,
        goldSpent: stats.goldSpent + towerCost,
        actionsPerformed: stats.actionsPerformed + 1
      }));
      break;

    case 'upgrade':
      // Find tower and upgrade, validate, execute
      ...
      break;

    case 'start-wave':
      // Engine prevents starting during active wave
      this.startNextWave();
      break;

    case 'wait':
      // Do nothing
      break;
  }
}
```

---

## Testing

### Unit Testing Strategies

**Strategy Isolation:**

```typescript
describe('AntiAirPlacementStrategy', () => {
  let strategy: AntiAirPlacementStrategy;
  let mockPlacement: jasmine.SpyObj<StrategicPlacementService>;
  let mockGameState: jasmine.SpyObj<GameStateManager>;

  beforeEach(() => {
    mockPlacement = jasmine.createSpyObj('StrategicPlacementService', [
      'findStrategicPositions'
    ]);
    mockGameState = jasmine.createSpyObj('GameStateManager', [
      'getSpawnPoints', 'getCachedPaths', 'towerManager'
    ]);

    strategy = new AntiAirPlacementStrategy(
      mockPlacement,
      mockGameState,
      BOT_CONFIGS.casual
    );
  });

  it('should not trigger when no air defense gap', () => {
    const state = createMockState({ airDefenseGap: false });

    expect(strategy.canExecute(state)).toBe(false);
  });

  it('should not trigger before wave 4', () => {
    const state = createMockState({ airDefenseGap: true, waveNumber: 3 });

    expect(strategy.canExecute(state)).toBe(false);
  });

  it('should trigger when air gap exists after wave 4', () => {
    const state = createMockState({
      airDefenseGap: true,
      waveNumber: 5,
      credits: 100
    });

    expect(strategy.canExecute(state)).toBe(true);
  });

  it('should place anti-air tower at strategic position', () => {
    const state = createMockState({
      airDefenseGap: true,
      waveNumber: 5,
      credits: 100
    });

    mockPlacement.findStrategicPositions.and.returnValue([
      { position: { lat: 50, lon: 8 }, reason: 'Near Spawn A' }
    ]);

    const action = strategy.execute(state);

    expect(action).not.toBeNull();
    expect(action!.type).toBe('place');
    expect(TOWER_TYPES[action!.towerType].canTargetAir).toBe(true);
    expect(action!.confidence).toBeGreaterThan(0.9);
  });
});
```

### Integration Testing

**StrategyBot Execution:**

```typescript
describe('StrategyBot', () => {
  let bot: StrategyBot;
  let strategies: ITowerStrategy[];

  beforeEach(() => {
    strategies = [
      new MockStrategy('High', 90, true),   // Can execute
      new MockStrategy('Medium', 60, false), // Cannot execute
      new MockStrategy('Low', 30, true)     // Can execute
    ];

    bot = new StrategyBot('casual', strategies);
  });

  it('should execute highest priority applicable strategy', () => {
    const state = createMockState({});
    const action = bot.update(state, 16);

    expect(action).not.toBeNull();
    expect(action!.reason).toContain('High');  // High priority executed
  });

  it('should skip strategies that cannot execute', () => {
    strategies[0].canExecute = () => false;  // High disabled

    const action = bot.update(state, 16);

    expect(action!.reason).toContain('Low');  // Low priority executed
  });

  it('should return wait when no strategy can execute', () => {
    strategies.forEach(s => s.canExecute = () => false);

    const action = bot.update(state, 16);

    expect(action!.type).toBe('wait');
  });
});
```

---

## Best Practices

### Strategy Development

1. **Single Responsibility**
   - One strategy = one decision concern
   - Placement, Upgrade, Wave should be separate

2. **Clear canExecute()**
   - Fast checks only (no heavy computation)
   - Return false early if not applicable
   - Log why strategy can't execute (if needed)

3. **Detailed Logging**
   - Explain why strategy returned null
   - Show what was considered
   - Help debugging with reason strings

4. **Confidence Values**
   - 0.9-1.0: Very confident (critical actions)
   - 0.7-0.9: Confident (normal operations)
   - 0.5-0.7: Moderate (experimental actions)
   - <0.5: Low (fallback strategies)

5. **Priority Assignment**
   - Critical > High > Medium > Low
   - Air defense gaps: 90+
   - Important upgrades: 75-89
   - Coverage fill: 50-74
   - Wave start: <50

### Performance

1. **Minimal Allocations**
   - Reuse arrays where possible
   - Avoid creating objects in hot paths
   - Cache expensive computations

2. **Early Exit**
   - Check cheapest conditions first
   - Return null as soon as impossible
   - Don't iterate unnecessarily

3. **State Snapshot**
   - GameStateSnapshot is already computed
   - No need to query managers in strategies
   - Use provided data

### Testing

1. **Test Each Strategy Independently**
   - Mock dependencies
   - Test canExecute() logic
   - Test execute() returns valid actions

2. **Test Bot Composition**
   - Priority ordering
   - Strategy selection
   - Fallback behavior

3. **Integration Tests**
   - Full game loop with bot
   - Multi-wave scenarios
   - Edge cases (no credits, no positions, etc.)

---

## Troubleshooting

### Bot Not Placing Towers

**Check:**
1. Bot enabled? → `botEnabled()`
2. Enough credits? → Check console for "Cannot afford"
3. Valid positions? → Check TowerPlacementService validation
4. Strategy canExecute()? → Add logging
5. Cooldown abgelaufen? → `reactionTimeMs` im BotConfig

**Debug:**
```typescript
// In strategy.execute()
console.log('[Strategy]', this.name, 'checking positions...');
for (const candidate of candidates) {
  const validation = this.gameState.towerManager.validatePosition(...);
  console.log('[Strategy] Candidate:', candidate.position, 'valid:', validation.valid, validation.reason);
}
```

### Bot Not Upgrading

**Check:**
1. Towers have available upgrades? → `tower.getAvailableUpgrades()`
2. Enough credits? → `tower.getNextUpgradeCost(upgradeId)` (dynamische Kosten)
3. ~33% Chance getroffen? → `NearSpawnUpgradeStrategy` feuert nur mit ~33% Wahrscheinlichkeit
4. 3+ Towers vorhanden? → Minimum Requirement

**Solution:**
- Added detailed logging in `NearSpawnUpgradeStrategy`
- Check console for "No upgradeable towers" or "No affordable upgrades"

### Bot Spam Starting Waves

**Check:**
1. AutoStartWaveStrategy has cooldown? → `WAVE_START_DELAY` (1s)
2. Phase check? → Nur in `'setup'` Phase aktiv
3. Max setup wait? → Nach 5s wird Wave erzwungen (`MAX_SETUP_WAIT`)
4. Engine prevents starts during active wave? → Ja, bereits behandelt

### Bot Placing Towers on Buildings

**Issue:** Height validation too restrictive

**Solution:**
- Removed 10m height check in `TowerPlacementService`
- Building ON rooftops now allowed
- Only blocks placements IN streets (3D distance check)

---

## Future Enhancements

### Planned Strategies

1. **EconomicTowerPlacementStrategy**
   - Build cost-effective towers
   - Maximize DPS per credit
   - Priority: 65

2. **ChokepointPlacementStrategy**
   - Place at narrow path sections
   - Maximize enemies in range
   - Priority: 80

3. **ROIUpgradeStrategy**
   - Upgrade towers with best ROI
   - Calculate DPS gain per credit
   - Priority: 70

4. **SynergyUpgradeStrategy**
   - Upgrade for tower combos
   - Slow + DPS synergy
   - Priority: 60

5. **ThreatResponseStrategy**
   - Adapt to last wave results
   - Counter enemy types
   - Priority: 85

### Advanced Features

1. **Machine Learning Integration**
   - Train strategy weights via RL
   - Dynamic priority adjustment
   - Personalized to player style

2. **Curriculum Learning**
   - Start with simple strategies
   - Gradually add complex ones
   - Scale with player skill

3. **Multi-Agent Coordination**
   - Multiple bots with different roles
   - Economic bot + Defense bot
   - Coordinator strategy

4. **Adaptive Difficulty**
   - Bot skill scales with player performance
   - Mercy system for struggling players
   - Challenge mode for experts

---

## Changelog

### Version 2.3 (Phase 5.16, 2026-04 ff.) — Research-aware Bots
- **ResearchCenterPlacementStrategy** (Priority 95): baut Center sobald bezahlbar.
- **ResearchPickStrategy** (Priority 80): skill-level-aware Pick-Order, aligned an
  Wave-Curriculum (`bat_swarm` W7 → AA bis W6, `boss_herbert` W10 → Cannon bis W9,
  `ghost_surge` W13 → Magic bis W12).
- **SellUnderperformerStrategy** (Priority 55, nur Strategist): verkauft schwache Tower
  damit Credits für bessere frei werden.
- Factory hängt jetzt allen Skill-Levels die Research-Strategien an + jittert
  `reactionTimeMs` / `maxTowers` für parallele Training-Clients.

### Version 2.2 (Phase 5.10, 2026-03 ff.) — Template-aware Bots
- Bots koexistieren mit dem Template-basierten Wave-Director (siehe
  [PHASE_5.11_RANGES.md](PHASE_5.11_RANGES.md)).
- Curriculum-aware Research-Reihenfolge sobald Phase 5.16 stable ist.

### Version 2.1 (2026-01-24) - Distributed Placement
- DistributedPlacementStrategy: Zone-based tower distribution for AI training
- Strategist bot uses distributed placement instead of CoverageFillStrategy
- `StrategicPlacementService.findDistributedPositions()`: Zone-scored candidates
- Ensures towers spread across entire path (not just near spawn)
- Solves binary progress problem for AI reward learning

### Version 2.0 (2026-01-23) - Strategy Pattern
- ✅ Complete rewrite from monolithic SmartBot
- ✅ Strategy Pattern + Composition architecture
- ✅ 5+ concrete strategies (AntiAir, Splash, Coverage, Upgrade, Wave)
- ✅ StrategyBot with priority-based execution
- ✅ StrategyBotFactory for skill levels
- ✅ Runtime strategy management (add/remove/replace)
- ✅ Detailed logging and debugging
- ✅ Fixed wave-start spam bug
- ✅ Fixed credits deduction bug
- ✅ Comprehensive validation

### Version 1.0 (2026-01-20) - SmartTowerBot
- Deprecated: Monolithic bot implementation

---

## Referenzen

### Patterns & Architecture

- **Strategy Pattern**: Gang of Four Design Patterns
- **Composition over Inheritance**: Effective Java (Joshua Bloch)
- **Game AI**: Programming Game AI by Example (Mat Buckland)

### Related Documentation

- `training-backend/docs/AI_TRAINING_BACKEND.md` - Python Training Backend
- [AI_WAVE_DIRECTOR_PLAN.md](../../../docs/AI_WAVE_DIRECTOR_PLAN.md) - AI Wave Director Übersicht
- `docs/ARCHITECTURE.md` - Overall System Architecture
- `docs/TOWER_CREATION.md` - Tower System Details

---

**Maintainer:** 3DTD Team
**Last Updated:** 2026-05-08 (Phase 5.16 — Research-Strategien + Curriculum-Alignment)
**Status:** Production Ready ✅
