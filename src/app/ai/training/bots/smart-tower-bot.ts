/**
 * Smart Tower Bot
 *
 * Intelligent bot that uses StrategicPlacementService for targeted tower placement.
 * Places towers near spawns along enemy paths, avoiding trial & error.
 */

import { BaseTowerBot } from './base-tower-bot';
import { GameStateSnapshot } from '../../core/models/game-state-snapshot';
import { TowerAction, BotSkillLevel } from './tower-bot.interface';
import { TowerTypeId, TOWER_TYPES } from '../../../configs/tower-types.config';
import { StrategicPlacementService, PlacementCandidate } from '../../../services/strategic-placement.service';
import { GameStateManager } from '../../../managers/game-state.manager';
import { GeoPosition } from '../../../models/game.types';

export class SmartTowerBot extends BaseTowerBot {
  private placementCandidates: PlacementCandidate[] = [];
  private lastCandidateRefresh = 0;
  private placedPositions = new Set<string>(); // Track used positions
  private autoStartWaves = false;
  private lastPlacementTime = 0; // Track when last tower was placed (using Date.now())
  private lastWaveStartTime = 0; // Track when we started a wave
  private readonly WAVE_START_DELAY = 1000; // Wait 1 second (in ms) after last tower before starting wave
  private readonly MIN_WAVE_INTERVAL = 5000; // Don't start waves more often than every 5 seconds
  private hasLoggedWaiting = false; // Only log waiting message once

  constructor(
    skillLevel: BotSkillLevel,
    private strategicPlacement: StrategicPlacementService,
    private gameState: GameStateManager,
    name?: string,
    autoStartWaves = false
  ) {
    super(skillLevel, name || `Smart${skillLevel.charAt(0).toUpperCase()}${skillLevel.slice(1)}Bot`);
    this.autoStartWaves = autoStartWaves;
  }

  protected decideAction(state: GameStateSnapshot): TowerAction | null {
    // 1. Refresh placement candidates if needed
    if (this.shouldRefreshCandidates(state)) {
      this.refreshPlacementCandidates();
      this.lastCandidateRefresh = state.gameTimeSeconds;
    }

    // 2. Random choice: Upgrade vs Place (60% place, 40% upgrade if possible)
    const shouldTryUpgradeFirst = Math.random() < 0.4 && state.defense.towerCount >= 2;

    if (shouldTryUpgradeFirst) {
      const upgradeAction = this.considerUpgrade(state);
      if (upgradeAction) {
        this.lastPlacementTime = Date.now();
        return upgradeAction;
      }
    }

    // 3. AUTO-MODE: Try to spend money, then auto-start waves
    if (this.autoStartWaves) {
      // Strategy: Spend aggressively but with variety
      // Save up for more expensive towers sometimes

      const minTowersBeforeStart = state.waveNumber < 3 ? 2 : 1; // Minimal defense
      const hasMinimalDefense = state.defense.towerCount >= minTowersBeforeStart;

      // Determine spending threshold (sometimes save for expensive towers)
      const shouldSaveForExpensive = Math.random() < 0.3 && state.defense.towerCount >= 3;
      const savingTarget = shouldSaveForExpensive ? 100 : 0; // Save for 100+ credit towers

      // Try to spend money on towers (up to 20 towers max)
      if (state.player.credits >= 20 + savingTarget && state.defense.towerCount < 20) {
        const placeAction = this.considerPlacement(state);
        if (placeAction) {
          console.log(`[${this.name}] 🏗️ Placing tower ${state.defense.towerCount + 1} (${state.player.credits} credits)`);
          this.hasLoggedWaiting = false;
          return placeAction;
        }
      }

      // Try to spend money on upgrades (if we have at least 20 credits)
      if (state.player.credits >= 20 && !shouldSaveForExpensive) {
        const upgradeAction = this.considerUpgrade(state);
        if (upgradeAction) {
          this.lastPlacementTime = Date.now();
          return upgradeAction;
        }
      }

      // Can't spend any more money - ready to start wave!
      if (!hasMinimalDefense) {
        return { type: 'wait', reason: 'Need at least 1 tower' };
      }

      // We have towers and can't spend more - start wave after delay
      const now = Date.now();
      if (this.lastPlacementTime === 0) {
        // Never placed a tower yet - this shouldn't happen but start anyway
        console.log(`[${this.name}] 🚀 Starting Wave ${state.waveNumber + 1} (${state.defense.towerCount} towers)`);
        return { type: 'start-wave', reason: `Auto-starting wave` };
      }

      const timeSinceLastPlacement = now - this.lastPlacementTime;
      const hasWaitedEnough = timeSinceLastPlacement >= this.WAVE_START_DELAY;

      if (hasWaitedEnough) {
        console.log(`[${this.name}] 🚀 Starting Wave ${state.waveNumber + 1} (${state.defense.towerCount} towers)`);
        this.hasLoggedWaiting = false;
        return { type: 'start-wave', reason: `Auto-starting wave (${state.defense.towerCount} towers ready)` };
      }

      // Still waiting
      if (!this.hasLoggedWaiting) {
        this.hasLoggedWaiting = true;
        const remainingMs = this.WAVE_START_DELAY - timeSinceLastPlacement;
        console.log(`[${this.name}] ⏳ Ready, waiting ${(remainingMs / 1000).toFixed(1)}s...`);
      }

      return { type: 'wait', reason: 'Waiting to start wave' };
    }

    // 4. NOT AUTO-MODE: Keep building/upgrading aggressively (no wave starts)
    const canAffordTower = state.player.credits >= 20;
    if (canAffordTower && state.defense.towerCount < 20) {
      const placeAction = this.considerPlacement(state);
      if (placeAction) {
        console.log(`[${this.name}] 🏗️ Placing tower ${state.defense.towerCount + 1} (${state.player.credits} credits)`);
        return placeAction;
      }
    }

    // Try upgrades
    if (!shouldTryUpgradeFirst) {
      const upgradeAction = this.considerUpgrade(state);
      if (upgradeAction) {
        this.lastPlacementTime = Date.now();
        return upgradeAction;
      }
    }

    return { type: 'wait', reason: 'Waiting for better opportunity' };
  }

  override reset(): void {
    super.reset();
    this.placementCandidates = [];
    this.lastCandidateRefresh = 0;
    this.placedPositions.clear();
    this.lastPlacementTime = 0;
    this.hasLoggedWaiting = false;
  }

  private shouldRefreshCandidates(state: GameStateSnapshot): boolean {
    // Refresh more frequently as more towers are placed (to account for placement constraints)
    const towerCount = state.defense.towerCount;
    const refreshInterval = towerCount < 5 ? 10 : 5; // Refresh every 5s after 5 towers

    // Refresh when:
    // - Interval expired
    // - First wave (waveNumber === 0)
    // - No candidates available
    // - IMPORTANT: After each wave completion (lastCandidateRefresh will be old)
    const needsRefresh = state.gameTimeSeconds - this.lastCandidateRefresh > refreshInterval
        || state.waveNumber === 0
        || this.placementCandidates.length === 0;

    return needsRefresh;
  }

  private refreshPlacementCandidates(): void {
    const spawnPoints = this.gameState.getSpawnPoints();
    const paths = this.gameState.getCachedPaths();
    const existingTowers = this.gameState.towerManager.getAll();

    this.placementCandidates = this.strategicPlacement.findStrategicPositions(
      spawnPoints,
      paths,
      60,  // Archer range as default
      existingTowers  // Pass existing towers to avoid placing too close
    );

    // Note: lastCandidateRefresh is updated in decideAction() using state.gameTimeSeconds
  }

  private considerPlacement(state: GameStateSnapshot): TowerAction | null {
    // 1. Check credits
    const affordableTowers = this.getAffordableTowers(state.player.credits);
    if (affordableTowers.length === 0) return null;

    // 2. Determine best tower type for situation
    const towerType = this.getBestTowerForSituation(state, state.player.credits);
    if (!towerType) return null;

    // 2b. Double-check we can actually afford this tower
    const towerConfig = TOWER_TYPES[towerType];
    if (!towerConfig || towerConfig.cost > state.player.credits) {
      console.warn(`[${this.name}] ⚠️ Selected tower ${towerType} costs ${towerConfig?.cost} but only have ${state.player.credits} credits`);
      return null;
    }

    // 3. Find best unused placement position
    const candidate = this.findBestUnusedPosition(state);
    if (!candidate) {
      return { type: 'wait', reason: 'No good placement positions available' };
    }

    // 4. Mark position as used and record time
    const posKey = `${candidate.position.lat.toFixed(6)},${candidate.position.lon.toFixed(6)}`;
    this.placedPositions.add(posKey);
    this.lastPlacementTime = Date.now(); // Record when we placed a tower

    return {
      type: 'place',
      position: this.geoToGridPosition(candidate.position),
      towerType,
      confidence: candidate.score,
      reason: candidate.reason
    };
  }

  private findBestUnusedPosition(_state: GameStateSnapshot): PlacementCandidate | null {
    let skippedCount = 0;
    let invalidCount = 0;

    for (const candidate of this.placementCandidates) {
      const posKey = `${candidate.position.lat.toFixed(6)},${candidate.position.lon.toFixed(6)}`;

      // Skip if already placed here
      if (this.placedPositions.has(posKey)) {
        skippedCount++;
        continue;
      }

      // Validate position (includes LOS check)
      const validation = this.gameState.towerManager.validatePosition(candidate.position);
      if (!validation.valid) {
        // Mark as used so we don't retry (LOS won't change)
        this.placedPositions.add(posKey);
        invalidCount++;
        continue;
      }

      // This candidate is good
      return candidate;
    }

    // Debug: Log when we run out of positions
    if (this.placementCandidates.length > 0) {
      console.warn(`[${this.name}] ⚠️ Out of valid positions: ${this.placementCandidates.length} total, ${skippedCount} already used, ${invalidCount} invalid`);
    }

    return null;
  }

  private considerUpgrade(state: GameStateSnapshot): TowerAction | null {
    // Strategy: Aggressive upgrades with randomness
    // Need at least 1 tower before upgrading
    if (state.defense.towerCount < 1) return null;

    // Need at least 20 credits (some upgrades are 20-25)
    if (state.player.credits < 20) return null;

    // Get all towers with available upgrades
    const towers = this.gameState.towerManager.getAll();
    const upgradeableTowers = towers.filter(tower => tower.getAvailableUpgrades().length > 0);

    if (upgradeableTowers.length === 0) return null;

    // Random selection: Pick a random tower
    const randomTower = upgradeableTowers[Math.floor(Math.random() * upgradeableTowers.length)];
    const availableUpgrades = randomTower.getAvailableUpgrades();

    // Filter upgrades we can afford (dynamic cost based on level)
    const affordableUpgrades = availableUpgrades.filter(u => randomTower.getNextUpgradeCost(u.id) <= state.player.credits);
    if (affordableUpgrades.length === 0) return null;

    // Random upgrade selection (adds variety to training data)
    const randomUpgrade = affordableUpgrades[Math.floor(Math.random() * affordableUpgrades.length)];
    const cost = randomTower.getNextUpgradeCost(randomUpgrade.id);

    return {
      type: 'upgrade',
      towerId: randomTower.id,
      upgradeId: randomUpgrade.id,
      confidence: 0.8,
      reason: `Upgrading ${randomTower.typeConfig.name} with ${randomUpgrade.name} (${cost} credits)`
    };
  }

  private getAffordableTowers(credits: number): TowerTypeId[] {
    return this.config.knownTowerTypes.filter((typeId) => {
      const config = TOWER_TYPES[typeId];
      return config && config.cost <= credits;
    });
  }

  /**
   * Override: Random tower selection with diversity bonus
   */
  protected override getBestTowerForSituation(state: GameStateSnapshot, credits: number): TowerTypeId | null {
    const affordable = this.getAffordableTowers(credits);
    if (affordable.length === 0) return null;

    // Get current tower distribution
    const distribution = state.defense.towerDistribution || {};
    const totalTowers = state.defense.towerCount;

    // Calculate diversity scores (prefer types we don't have many of)
    const diversityScores = {} as Record<TowerTypeId, number>;

    for (const typeId of affordable) {
      const count = distribution[typeId]?.count || 0;
      const ratio = totalTowers > 0 ? count / totalTowers : 0;

      // Diversity bonus: Higher score for types we have less of
      // Score 1.0 = don't have this type yet
      // Score 0.5 = 25% of towers are this type
      // Score 0.2 = 50% of towers are this type
      diversityScores[typeId] = Math.max(0.2, 1.0 - ratio * 1.5);
    }

    // 30% chance: Smart selection based on vulnerabilities (ignores diversity)
    if (Math.random() < 0.3) {
      if (state.vulnerabilities.airDefenseGap) {
        const antiAir = affordable.find((t) => TOWER_TYPES[t].canTargetAir);
        if (antiAir) return antiAir;
      }

      if (state.vulnerabilities.splashGap) {
        const splash = affordable.find((t) => t === 'cannon' || t === 'rocket');
        if (splash) return splash;
      }
    }

    // 70% chance: Weighted random selection (diversity bonus)
    // Build array of tower types weighted by diversity score
    const weightedTowers: TowerTypeId[] = [];
    for (const typeId of affordable) {
      const weight = diversityScores[typeId];
      const copies = Math.ceil(weight * 10); // 2-10 copies based on score
      for (let i = 0; i < copies; i++) {
        weightedTowers.push(typeId);
      }
    }

    return weightedTowers[Math.floor(Math.random() * weightedTowers.length)];
  }

  /**
   * Convert GeoPosition to grid position for TowerAction
   */
  private geoToGridPosition(geo: GeoPosition): { x: number; z: number } {
    // Note: GameStateManager.placeTower expects GeoPosition anyway,
    // but TowerAction uses grid coordinates
    // The component will convert back to GeoPosition
    return {
      x: geo.lon,
      z: geo.lat
    };
  }
}
