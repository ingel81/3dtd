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
│  │  (update)    │      │ (decideAction)│      │(place/upgrade)│ │
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

- **Placement Strategies** → Wo soll ein Tower gebaut werden?
- **Upgrade Strategies** → Welcher Tower soll upgraden werden?
- **Economy Strategies** → Wann sparen, wann ausgeben?
- **Wave Strategies** → Wann nächste Welle starten?

**Execution Flow:**

1. Bot wird jedes Frame von `TowerDefenseComponent` aufgerufen
2. `StrategyBot.decideAction()` iteriert über Strategien (sortiert nach Priority)
3. Erste Strategie mit `canExecute() === true` wird ausgeführt
4. `execute()` gibt `TowerAction` zurück
5. `TowerDefenseComponent` führt Action aus

---

## Verzeichnisstruktur

```
src/app/ai/training/
├── bots/
│   ├── tower-bot.interface.ts        # ITowerBot Interface
│   ├── base-tower-bot.ts             # Abstract Base Bot
│   ├── strategy-bot.ts               # Strategy-Based Bot
│   └── strategy-bot.factory.ts       # Factory für Skill Levels
│
├── strategies/
│   ├── tower-strategy.interface.ts   # ITowerStrategy Interface
│   │
│   ├── placement/                    # Placement Strategies
│   │   ├── anti-air-placement.strategy.ts
│   │   ├── splash-defense-placement.strategy.ts
│   │   ├── coverage-fill.strategy.ts
│   │   ├── distributed-placement.strategy.ts
│   │   └── economic-tower-placement.strategy.ts
│   │
│   ├── upgrade/                      # Upgrade Strategies
│   │   ├── near-spawn-upgrade.strategy.ts
│   │   └── cost-effective-upgrade.strategy.ts
│   │
│   ├── economy/                      # Economy Strategies
│   │   ├── save-for-expensive.strategy.ts
│   │   └── spend-aggressively.strategy.ts
│   │
│   └── wave/                         # Wave Control Strategies
│       └── auto-start-wave.strategy.ts
│
├── models/
│   ├── tower-action.ts               # TowerAction Type
│   └── bot-config.ts                 # Bot Configurations
│
└── core/
    ├── game-state-snapshot.ts        # Game State Capture
    └── ai-data-collector.service.ts  # State Collection
```

---

## Core Interfaces

### ITowerBot

```typescript
export interface ITowerBot {
  /** Bot name for logging */
  readonly name: string;

  /** Skill level */
  readonly skillLevel: BotSkillLevel;

  /**
   * Decide next action based on current game state
   * Called every frame by TowerDefenseComponent
   */
  decideAction(state: GameStateSnapshot): TowerAction | null;

  /** Reset bot state (new game) */
  reset(): void;
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
export type TowerAction =
  | PlaceTowerAction
  | UpgradeTowerAction
  | StartWaveAction
  | WaitAction;

interface PlaceTowerAction {
  type: 'place';
  position: { x: number; z: number };  // World coordinates
  towerType: TowerTypeId;
  confidence: number;                   // 0-1
  reason: string;
}

interface UpgradeTowerAction {
  type: 'upgrade';
  towerId: number;
  upgradeId: UpgradeId;
  confidence: number;
  reason: string;
}

interface StartWaveAction {
  type: 'start-wave';
  confidence: number;
  reason: string;
}

interface WaitAction {
  type: 'wait';
  reason: string;
}
```

### GameStateSnapshot

```typescript
export interface GameStateSnapshot {
  waveNumber: number;
  gameTimeSeconds: number;

  player: {
    credits: number;
    livesPercent: number;  // 0-1
  };

  defense: {
    towerCount: number;
    totalDPS: number;
    pathCoverage: number;           // 0-1
    avgTowerLevel: number;
    killZoneStrength: number;       // 0-1
    towerVariety: number;           // 0-1

    capabilities: {
      hasAntiAir: boolean;
      hasSplash: boolean;
      hasSlow: boolean;
      hasDoT: boolean;
      hasSniper: boolean;
    };

    towerDistribution: Record<TowerTypeId, {
      count: number;
      avgLevel: number;
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
    damagePerWave: number[];        // Last N waves
    lastWaveThreat: number;
    winStreak: number;
    closeCallStreak: number;
  };
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
    super(skillLevel, name || `Strategy${skillLevel}Bot`);

    // Sort strategies by priority (highest first)
    this.strategies = strategies.sort((a, b) => b.priority - a.priority);

    console.log(`[${this.name}] Initialized with ${strategies.length} strategies:`,
      strategies.map(s => `${s.name}(${s.priority})`).join(', ')
    );
  }

  protected decideAction(state: GameStateSnapshot): TowerAction | null {
    // Iterate through strategies in priority order
    for (const strategy of this.strategies) {
      if (!strategy.canExecute(state)) {
        continue;
      }

      const action = strategy.execute(state);

      if (action) {
        console.log(`[${this.name}] 📋 ${strategy.name} → ${action.type}`,
          action.reason || '');
        return action;
      }
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
- ✅ Early exit on first applicable strategy
- ✅ Runtime strategy modification
- ✅ Detailed logging

### BaseTowerBot

**Abstract base für alle Bots:**

```typescript
export abstract class BaseTowerBot implements ITowerBot {
  constructor(
    public readonly skillLevel: BotSkillLevel,
    public readonly name: string
  ) {}

  abstract decideAction(state: GameStateSnapshot): TowerAction | null;

  reset(): void {
    // Override in subclass if needed
  }

  // Helper methods
  protected getAffordableTowers(
    credits: number,
    knownTypes: TowerTypeId[]
  ): TowerTypeId[] {
    return knownTypes.filter(typeId => {
      const config = TOWER_TYPES[typeId];
      return config && config.cost <= credits;
    });
  }

  protected getTowerValue(towerType: TowerTypeId): number {
    const config = TOWER_TYPES[towerType];
    const dps = config.damage * config.fireRate;
    return dps / config.cost;  // DPS per Credit
  }
}
```

### StrategyBotFactory

**Factory für Skill-Level-basierte Bots:**

```typescript
export class StrategyBotFactory {
  constructor(
    private strategicPlacement: StrategicPlacementService,
    private gameState: GameStateManager
  ) {}

  createBot(
    skillLevel: BotSkillLevel,
    autoStartWaves: boolean = false
  ): StrategyBot {
    const strategies = this.getStrategiesForSkillLevel(skillLevel, autoStartWaves);
    return new StrategyBot(skillLevel, strategies);
  }

  private getStrategiesForSkillLevel(
    skillLevel: BotSkillLevel,
    autoStartWaves: boolean
  ): ITowerStrategy[] {
    const strategies: ITowerStrategy[] = [];
    const config = BOT_CONFIGS[skillLevel];

    switch (skillLevel) {
      case 'beginner':
        // Only basic placement
        strategies.push(
          new CoverageFillStrategy(...)
        );
        break;

      case 'casual':
        // Basic placement + occasional upgrades
        strategies.push(
          new AntiAirPlacementStrategy(...),      // Priority: 90
          new SplashDefensePlacementStrategy(...), // Priority: 85
          new CoverageFillStrategy(...),           // Priority: 60
          new NearSpawnUpgradeStrategy(...)        // Priority: 75
        );
        break;

      case 'strategist':
        // Distributed placement for even path coverage (AI training)
        strategies.push(
          new AntiAirPlacementStrategy(...),
          new SplashDefensePlacementStrategy(...),
          new NearSpawnUpgradeStrategy(...),
          new DistributedPlacementStrategy(...)  // Zone-based distribution
        );
        break;

      case 'meta':
        // Advanced strategies + all basic ones
        strategies.push(
          new AntiAirPlacementStrategy(...),
          new SplashDefensePlacementStrategy(...),
          new NearSpawnUpgradeStrategy(...),
          new CoverageFillStrategy(...),
          // TODO: Advanced strategies
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
    // 1. Air defense gap exists
    // 2. Wave number > 3 (air enemies appear later)
    // 3. Can afford anti-air tower
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
    const bestTower = antiAirTowers.reduce((best, current) => {
      return this.getTowerValue(current) > this.getTowerValue(best)
        ? current : best;
    });

    // 2. Get strategic placement candidates
    const spawnPoints = this.gameState.getSpawnPoints();
    const paths = this.gameState.getCachedPaths();
    const candidates = this.strategicPlacement.findStrategicPositions(
      spawnPoints, paths, TOWER_TYPES[bestTower].range, ...
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
**Triggers:** Air defense gap + Wave 4+ + Affordable anti-air tower
**Action:** Place rocket/sniper at strategic position

#### SplashDefensePlacementStrategy

**Purpose:** Place splash damage towers when splash gap exists.

**Priority:** 85 (High)
**Triggers:** Splash gap + Affordable splash tower
**Action:** Place cannon at strategic position

#### DistributedPlacementStrategy

**Purpose:** Distribute towers evenly across the entire path (for AI training).

```typescript
export class DistributedPlacementStrategy extends BaseStrategy {
  constructor(
    private strategicPlacement: StrategicPlacementService,
    private gameState: GameStateManager,
    private config: BotConfig
  ) {
    super('DistributedPlacement', 65);  // Higher than CoverageFill
  }

  canExecute(state: GameStateSnapshot): boolean {
    return state.player.credits >= 20
      && (this.config.maxTowers <= 0 || state.defense.towerCount < this.config.maxTowers);
  }

  execute(state: GameStateSnapshot): TowerAction | null {
    // 1. Choose tower type (variety-first, then reinforce least-represented)
    const towerType = this.chooseTowerType(state);

    // 2. Use zone-based distributed positions
    const candidates = this.strategicPlacement.findDistributedPositions(
      spawnPoints, paths, towerRange, existingTowers, 5 /* zones */
    );

    // 3. Validate and place at best candidate
    for (const candidate of candidates) {
      if (validation.valid) {
        return { type: 'place', position, towerType, confidence: 0.8, reason };
      }
    }
    return null;
  }
}
```

**Priority:** 65 (Medium-High)
**Triggers:** Credits >= 20 + Tower count below max
**Action:** Place tower in under-defended path zone
**Scoring:** 50% zone-need + 30% path-coverage + 20% street-distance

**Zone Algorithm:**
1. Path divided into 5 equal-length zones
2. Each candidate scored by how many towers already exist in its zone
3. Under-defended zones get higher scores
4. Ensures towers spread across 60%+ of the path

**Used by:** Strategist bot (AI training) - replaces CoverageFillStrategy

---

#### CoverageFillStrategy

**Purpose:** Fill gaps in path coverage with cheap towers.

```typescript
export class CoverageFillStrategy extends BaseStrategy {
  constructor(...) {
    super('CoverageFill', 60);  // Medium priority
  }

  canExecute(state: GameStateSnapshot): boolean {
    return state.defense.pathCoverage < 0.7
      && state.defense.towerCount >= 2
      && state.player.credits >= 20;
  }

  execute(state: GameStateSnapshot): TowerAction | null {
    // Find cheapest affordable tower
    const affordable = this.getAffordableTowers(...);
    const cheapest = affordable.reduce((best, current) => {
      return TOWER_TYPES[current].cost < TOWER_TYPES[best].cost
        ? current : best;
    });

    // Get candidates and find gap
    const candidates = this.strategicPlacement.findStrategicPositions(...);

    for (const candidate of candidates) {
      const validation = this.gameState.towerManager.validatePosition(...);

      if (validation.valid) {
        return {
          type: 'place',
          position: { x: candidate.position.lon, z: candidate.position.lat },
          towerType: cheapest,
          confidence: 0.7,
          reason: `Filling coverage gap - ${candidate.reason}`
        };
      }
    }

    return null;
  }
}
```

**Priority:** 60 (Medium)
**Triggers:** Coverage < 70% + 2+ towers + 20+ credits
**Action:** Place cheapest tower in gap

### Upgrade Strategies

#### NearSpawnUpgradeStrategy

**Purpose:** Upgrade towers near spawn points (highest impact).

```typescript
export class NearSpawnUpgradeStrategy extends BaseStrategy {
  constructor(private gameState: GameStateManager) {
    super('NearSpawnUpgrade', 75);  // Medium-High priority
  }

  canExecute(state: GameStateSnapshot): boolean {
    return state.defense.towerCount >= 3
      && state.player.credits >= 50;
  }

  execute(state: GameStateSnapshot): TowerAction | null {
    const towers = this.gameState.towerManager.getAll();
    const spawnPoints = this.gameState.getSpawnPoints();

    // Find towers with available upgrades
    const upgradeableTowers = towers.filter(t =>
      t.getAvailableUpgrades().length > 0
    );

    if (upgradeableTowers.length === 0) {
      console.log(`[Bot] No upgradeable towers (all ${towers.length} at max)`);
      return null;
    }

    // Sort by distance to nearest spawn
    const towersWithDistance = upgradeableTowers.map(tower => {
      const minDist = Math.min(...spawnPoints.map(spawn => {
        return this.gameState.osmService.haversineDistance(
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
    const affordable = upgrades.filter(u => u.cost <= state.player.credits);

    if (affordable.length === 0) {
      const cheapest = upgrades.length > 0
        ? Math.min(...upgrades.map(u => u.cost))
        : 0;
      console.log(`[Bot] No affordable upgrades (${state.player.credits} credits, cheapest: ${cheapest})`);
      return null;
    }

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
**Triggers:** 3+ towers + 50+ credits
**Action:** Upgrade tower closest to spawn

### Wave Strategies

#### AutoStartWaveStrategy

**Purpose:** Automatically start next wave when ready.

```typescript
export class AutoStartWaveStrategy extends BaseStrategy {
  private lastActionTime = 0;
  private readonly WAVE_START_DELAY = 1000;  // 1 second

  constructor(private autoMode: boolean) {
    super('AutoStartWave', 30);  // Low priority
  }

  canExecute(state: GameStateSnapshot): boolean {
    if (!this.autoMode) return false;

    // Need minimal defense
    const minTowers = state.waveNumber < 3 ? 2 : 1;
    if (state.defense.towerCount < minTowers) return false;

    // Check cooldown
    const now = Date.now();
    if (now - this.lastActionTime < this.WAVE_START_DELAY) return false;

    return true;
  }

  execute(state: GameStateSnapshot): TowerAction | null {
    return {
      type: 'start-wave',
      confidence: 0.9,
      reason: `Auto-starting wave ${state.waveNumber + 1} (${state.defense.towerCount} towers ready)`
    };
  }

  onActionExecuted(): void {
    this.lastActionTime = Date.now();
  }
}
```

**Priority:** 30 (Low) - Only after other strategies can't execute
**Triggers:** Auto-mode + Minimal defense + Cooldown passed
**Action:** Start next wave

---

## Bot Configurations

### BOT_CONFIGS

```typescript
export const BOT_CONFIGS: Record<BotSkillLevel, BotConfig> = {
  beginner: {
    knownTowerTypes: ['archer', 'cannon'],           // Limited types
    reactionTimeMs: 2000,                            // Slow
    maxActionsPerSecond: 0.3,                        // ~1 action per 3 seconds
    confidenceThreshold: 0.5,                        // Low bar
    upgradeFrequency: 0.1,                           // Rarely upgrades
  },

  casual: {
    knownTowerTypes: ['archer', 'cannon', 'magic', 'sniper'],
    reactionTimeMs: 1500,
    maxActionsPerSecond: 0.5,                        // ~1 action per 2 seconds
    confidenceThreshold: 0.6,
    upgradeFrequency: 0.3,
  },

  strategist: {
    knownTowerTypes: ['archer', 'cannon', 'magic', 'sniper', 'dual-gatling', 'rocket'],
    reactionTimeMs: 1000,
    maxActionsPerSecond: 0.7,
    confidenceThreshold: 0.7,
    upgradeFrequency: 0.5,
  },

  meta: {
    knownTowerTypes: ALL_TOWER_TYPES,
    reactionTimeMs: 500,                             // Fast
    maxActionsPerSecond: 1.0,                        // 1 action per second
    confidenceThreshold: 0.8,                        // High standards
    upgradeFrequency: 0.7,                           // Frequent upgrades
  }
};
```

### Strategy Priority Ranges

**Best Practices:**

| Priority Range | Usage | Examples |
|----------------|-------|----------|
| 90-100 | **Critical** - Must execute ASAP | Air defense gaps, Game-losing scenarios |
| 75-89 | **High** - Important but not critical | Splash defense, Key upgrades |
| 50-74 | **Medium** - Standard operations | Coverage fill, Economic towers |
| 25-49 | **Low** - Nice to have | Economy optimization, Wave start |
| 0-24 | **Very Low** - Last resort | Fallback strategies, Default actions |

---

## Integration

### TowerDefenseComponent

**Bot Initialization:**

```typescript
export class TowerDefenseComponent implements OnInit {
  private strategicPlacement = inject(StrategicPlacementService);
  private currentBot: ITowerBot | null = null;
  private botFactory!: StrategyBotFactory;

  // Stats
  botEnabled = signal(false);
  botStats = signal<BotStats>({
    towersPlaced: 0,
    upgradesPerformed: 0,
    goldSpent: 0,
    actionsPerformed: 0
  });

  ngOnInit() {
    // Initialize factory
    this.botFactory = new StrategyBotFactory(
      this.strategicPlacement,
      this.gameState
    );

    // Enable bot if training mode active
    if (this.trainingClient.isConnected()) {
      this.enableBot('strategist', true);
    }
  }

  enableBot(skillLevel: BotSkillLevel, autoStartWaves: boolean): void {
    this.currentBot = this.botFactory.createBot(skillLevel, autoStartWaves);
    this.botEnabled.set(true);

    console.log('[Training] StrategyBot enabled:', skillLevel);
  }

  disableBot(): void {
    this.currentBot = null;
    this.botEnabled.set(false);
  }
}
```

**Bot Execution (Game Loop):**

```typescript
private updateBotBehavior(deltaTime: number): void {
  if (!this.currentBot || !this.botEnabled()) return;

  // Get current game state
  const state = this.captureGameState();

  // Bot decides action
  const action = this.currentBot.decideAction(state);

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
        console.warn(`[Bot] ⛔ Cannot afford tower: ${towerCost}`);
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

      console.log(`[Bot] ✅ Placed ${action.towerType} at (${action.position.x.toFixed(1)}, ${action.position.z.toFixed(1)})`);
      break;

    case 'upgrade':
      // Find tower
      const tower = this.gameState.towerManager.getTower(action.towerId);
      if (!tower) {
        console.warn(`[Bot] ⛔ Tower not found: ${action.towerId}`);
        break;
      }

      // Find upgrade
      const upgrade = tower.typeConfig.upgrades.find(u => u.id === action.upgradeId);
      if (!upgrade) {
        console.warn(`[Bot] ⛔ Upgrade not found: ${action.upgradeId}`);
        break;
      }

      // Validate can upgrade
      if (!tower.canUpgrade(action.upgradeId as UpgradeId)) {
        console.warn(`[Bot] ⛔ Upgrade at max level`);
        break;
      }

      // Validate affordable
      if (this.gameState.credits() < upgrade.cost) {
        console.warn(`[Bot] ⛔ Cannot afford upgrade: ${upgrade.cost}`);
        break;
      }

      // Execute upgrade
      const success = this.upgradeTower(tower, action.upgradeId as UpgradeId);

      if (success) {
        console.log(`[Bot] ✅ Upgraded ${tower.typeConfig.name} with ${upgrade.name}`);
        this.botStats.update(stats => ({
          ...stats,
          upgradesPerformed: stats.upgradesPerformed + 1,
          goldSpent: stats.goldSpent + upgrade.cost,
          actionsPerformed: stats.actionsPerformed + 1
        }));
      }
      break;

    case 'start-wave':
      // Engine prevents starting during active wave
      this.startNextWave();
      console.log(`[Bot] ✅ Starting Wave ${this.gameState.waveNumber() + 1}`);
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
    const action = bot.decideAction(state);

    expect(action).not.toBeNull();
    expect(action!.reason).toContain('High');  // High priority executed
  });

  it('should skip strategies that cannot execute', () => {
    strategies[0].canExecute = () => false;  // High disabled

    const action = bot.decideAction(state);

    expect(action!.reason).toContain('Low');  // Low priority executed
  });

  it('should return wait when no strategy can execute', () => {
    strategies.forEach(s => s.canExecute = () => false);

    const action = bot.decideAction(state);

    expect(action!.type).toBe('wait');
  });
});
```

---

## Best Practices

### Strategy Development

1. **Single Responsibility**
   - One strategy = one decision concern
   - Placement, Upgrade, Economy, Wave should be separate

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
2. Enough credits? → Check upgrade cost
3. Tower at max level? → `tower.canUpgrade()`

**Solution:**
- Added detailed logging in `NearSpawnUpgradeStrategy`
- Check console for "No upgradeable towers" or "No affordable upgrades"

### Bot Spam Starting Waves

**Check:**
1. AutoStartWaveStrategy has cooldown? → `WAVE_START_DELAY`
2. Engine prevents starts during active wave? → ✅ Already handled

**Fix:**
```typescript
// In AutoStartWaveStrategy
private lastActionTime = 0;

canExecute(state) {
  const now = Date.now();
  if (now - this.lastActionTime < 1000) return false;
  // ...
}

onActionExecuted() {
  this.lastActionTime = Date.now();
}
```

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
- ❌ Deprecated: Monolithic bot implementation
- ❌ Wave-start spam bug
- ❌ Complex state tracking
- ❌ Hard to extend

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
**Last Updated:** 2026-01-24
**Status:** Production Ready ✅
