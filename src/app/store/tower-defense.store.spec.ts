import { describe, it, expect, beforeEach } from 'vitest';
import { Injector, runInInjectionContext } from '@angular/core';
import { TowerDefenseStore } from './tower-defense.store';
import { GameStore } from './game.store';
import { UIStore } from './ui.store';
import { EngineStore } from './engine.store';
import { LocationStore } from './location.store';
import { GAME_BALANCE } from '../configs/game-balance.config';

describe('TowerDefenseStore', () => {
  let store: TowerDefenseStore;
  let gameStore: GameStore;
  let uiStore: UIStore;
  let engineStore: EngineStore;
  let locationStore: LocationStore;

  beforeEach(() => {
    gameStore = new GameStore();
    uiStore = new UIStore();
    engineStore = new EngineStore();
    locationStore = new LocationStore();

    const injector = Injector.create({
      providers: [
        { provide: GameStore, useValue: gameStore },
        { provide: UIStore, useValue: uiStore },
        { provide: EngineStore, useValue: engineStore },
        { provide: LocationStore, useValue: locationStore },
        { provide: TowerDefenseStore, useFactory: () => {
          return runInInjectionContext(injector, () => new TowerDefenseStore());
        }},
      ],
    });

    store = injector.get(TowerDefenseStore);
  });

  describe('signal delegation', () => {
    it('credits delegates to GameStore', () => {
      gameStore.credits.set(999);
      expect(store.credits()).toBe(999);
    });

    it('debugMode delegates to UIStore', () => {
      uiStore.debugMode.set(true);
      expect(store.debugMode()).toBe(true);
    });

    it('fps delegates to EngineStore', () => {
      engineStore.fps.set(60);
      expect(store.fps()).toBe(60);
    });

    it('baseCoords delegates to LocationStore', () => {
      locationStore.baseCoords.set({ lat: 48.77, lon: 9.18 });
      expect(store.baseCoords()).toEqual({ lat: 48.77, lon: 9.18 });
    });
  });

  describe('computed: canStartWave', () => {
    beforeEach(() => {
      gameStore.phase.set('setup');
      engineStore.loading.set(false);
      locationStore.spawnPoints.set([
        { id: 'sp1', name: 'North', lat: 48.78, lon: 9.19, color: 0xff0000 },
      ]);
    });

    it('is true when not in wave, not game over, not loading, and has spawn points', () => {
      expect(store.canStartWave()).toBe(true);
    });

    it('is false when wave is active', () => {
      gameStore.phase.set('wave');
      expect(store.canStartWave()).toBe(false);
    });

    it('is false when game is over', () => {
      gameStore.phase.set('gameover');
      expect(store.canStartWave()).toBe(false);
    });

    it('is false when loading', () => {
      engineStore.loading.set(true);
      expect(store.canStartWave()).toBe(false);
    });

    it('is false when no spawn points exist', () => {
      locationStore.spawnPoints.set([]);
      expect(store.canStartWave()).toBe(false);
    });

    it('is false when wave is active and spawn points are empty', () => {
      gameStore.phase.set('wave');
      locationStore.spawnPoints.set([]);
      expect(store.canStartWave()).toBe(false);
    });

    it('is true when in setup phase', () => {
      gameStore.phase.set('setup');
      expect(store.canStartWave()).toBe(true);
    });
  });

  describe('computed: canPlaceTowers', () => {
    it('is true when not game over, not loading, and build mode active', () => {
      gameStore.phase.set('setup');
      engineStore.loading.set(false);
      uiStore.buildMode.set(true);
      expect(store.canPlaceTowers()).toBe(true);
    });

    it('is false when game is over', () => {
      gameStore.phase.set('gameover');
      engineStore.loading.set(false);
      uiStore.buildMode.set(true);
      expect(store.canPlaceTowers()).toBe(false);
    });

    it('is false when loading', () => {
      gameStore.phase.set('setup');
      engineStore.loading.set(true);
      uiStore.buildMode.set(true);
      expect(store.canPlaceTowers()).toBe(false);
    });

    it('is false when build mode is off', () => {
      gameStore.phase.set('setup');
      engineStore.loading.set(false);
      uiStore.buildMode.set(false);
      expect(store.canPlaceTowers()).toBe(false);
    });
  });

  describe('computed: waveActive', () => {
    it('is true when phase is wave', () => {
      gameStore.phase.set('wave');
      expect(store.waveActive()).toBe(true);
    });

    it('is false when phase is not wave', () => {
      gameStore.phase.set('setup');
      expect(store.waveActive()).toBe(false);
    });
  });

  describe('computed: isGameOver', () => {
    it('is true when phase is gameover', () => {
      gameStore.phase.set('gameover');
      expect(store.isGameOver()).toBe(true);
    });

    it('is false when phase is not gameover', () => {
      gameStore.phase.set('wave');
      expect(store.isGameOver()).toBe(false);
    });
  });

  describe('computed: gameStarted', () => {
    it('is false initially', () => {
      expect(store.gameStarted()).toBe(false);
    });

    it('is true when wave > 0', () => {
      gameStore.waveNumber.set(1);
      expect(store.gameStarted()).toBe(true);
    });

    it('is true when phase changed from setup', () => {
      gameStore.phase.set('wave');
      expect(store.gameStarted()).toBe(true);
    });
  });

  describe('computed: healthPercent', () => {
    it('is 100 at full health', () => {
      expect(store.healthPercent()).toBe(100);
    });

    it('is 50 at half health', () => {
      gameStore.baseHealth.set(GAME_BALANCE.player.startHealth / 2);
      expect(store.healthPercent()).toBe(50);
    });

    it('is 0 when dead', () => {
      gameStore.baseHealth.set(0);
      expect(store.healthPercent()).toBe(0);
    });
  });

  describe('computed: healthCritical', () => {
    it('is false at full health', () => {
      expect(store.healthCritical()).toBe(false);
    });

    it('is true at 25% health', () => {
      gameStore.baseHealth.set(GAME_BALANCE.player.startHealth * 0.25);
      expect(store.healthCritical()).toBe(true);
    });

    it('is true at 10% health', () => {
      gameStore.baseHealth.set(GAME_BALANCE.player.startHealth * 0.1);
      expect(store.healthCritical()).toBe(true);
    });
  });

  describe('computed: buildModeWarning', () => {
    it('is null when no validation reason set', () => {
      expect(store.buildModeWarning()).toBeNull();
    });

    it('returns the validation reason', () => {
      uiStore.buildValidationReason.set('Too close to existing tower');
      expect(store.buildModeWarning()).toBe('Too close to existing tower');
    });
  });

  describe('helper methods', () => {
    it('appendDebugLog delegates to UIStore', () => {
      store.appendDebugLog('Test message');
      expect(uiStore.debugLog()).toContain('Test message');
    });

    it('clearDebugLog delegates to UIStore', () => {
      store.appendDebugLog('Something');
      store.clearDebugLog();
      expect(uiStore.debugLog()).toBe('');
    });

    it('updateEngineStats delegates to EngineStore', () => {
      store.updateEngineStats({
        fps: 60,
        tileStats: { parsing: 1, downloading: 2, total: 10, visible: 8 },
        activeSoundCount: 3,
        cameraHeading: 45,
      });
      expect(engineStore.fps()).toBe(60);
      expect(engineStore.activeSounds()).toBe(3);
    });
  });

  describe('resetGameState', () => {
    it('resets game store state', () => {
      gameStore.credits.set(999);
      gameStore.phase.set('gameover');
      gameStore.waveNumber.set(10);
      gameStore.baseHealth.set(5);

      store.resetGameState();

      expect(store.credits()).toBe(GAME_BALANCE.player.startCredits);
      expect(store.phase()).toBe('setup');
      expect(store.waveNumber()).toBe(0);
      expect(store.baseHealth()).toBe(GAME_BALANCE.player.startHealth);
    });

    it('resets build state', () => {
      uiStore.buildMode.set(true);
      uiStore.selectedTowerType.set('archer');
      uiStore.buildValidationReason.set('blocked');

      store.resetGameState();

      expect(store.buildMode()).toBe(false);
      expect(store.selectedTowerType()).toBeNull();
      expect(store.buildValidationReason()).toBeNull();
    });

    it('does NOT reset UI preferences', () => {
      uiStore.debugMode.set(true);
      uiStore.streetsVisible.set(true);
      uiStore.infoOverlayVisible.set(true);

      store.resetGameState();

      expect(store.debugMode()).toBe(true);
      expect(store.streetsVisible()).toBe(true);
      expect(store.infoOverlayVisible()).toBe(true);
    });

    it('does NOT reset location state', () => {
      locationStore.baseCoords.set({ lat: 48.77, lon: 9.18 });
      locationStore.currentLocationName.set('Stuttgart');

      store.resetGameState();

      expect(store.baseCoords()).toEqual({ lat: 48.77, lon: 9.18 });
      expect(store.currentLocationName()).toBe('Stuttgart');
    });

    it('does NOT reset engine state', () => {
      engineStore.loading.set(false);
      engineStore.fps.set(60);

      store.resetGameState();

      expect(store.loading()).toBe(false);
      expect(store.fps()).toBe(60);
    });
  });

  describe('resetAll', () => {
    it('resets ALL sub-stores', () => {
      // Mutate game store
      gameStore.credits.set(999);
      gameStore.phase.set('gameover');
      gameStore.waveNumber.set(10);

      // Mutate UI store
      uiStore.debugMode.set(true);
      uiStore.buildMode.set(true);
      uiStore.streetsVisible.set(true);

      // Mutate engine store
      engineStore.loading.set(false);
      engineStore.fps.set(120);
      engineStore.error.set('broken');

      // Mutate location store
      locationStore.baseCoords.set({ lat: 48.77, lon: 9.18 });
      locationStore.currentLocationName.set('Berlin');
      locationStore.streetCount.set(50);

      store.resetAll();

      // Game state reset
      expect(store.credits()).toBe(GAME_BALANCE.player.startCredits);
      expect(store.phase()).toBe('setup');
      expect(store.waveNumber()).toBe(0);

      // UI state reset
      expect(store.debugMode()).toBe(false);
      expect(store.buildMode()).toBe(false);
      expect(store.streetsVisible()).toBe(false);

      // Engine state reset
      expect(store.loading()).toBe(true);
      expect(store.fps()).toBe(0);
      expect(store.error()).toBeNull();

      // Location state reset
      expect(store.baseCoords()).toEqual({ lat: 0, lon: 0 });
      expect(store.currentLocationName()).toBe('');
      expect(store.streetCount()).toBe(0);
    });

    it('computed values reflect reset state', () => {
      gameStore.phase.set('gameover');
      gameStore.waveNumber.set(5);

      store.resetAll();

      expect(store.waveActive()).toBe(false);
      expect(store.isGameOver()).toBe(false);
      expect(store.gameStarted()).toBe(false);
      expect(store.healthPercent()).toBe(100);
      expect(store.healthCritical()).toBe(false);
      expect(store.canPlaceTowers()).toBe(false);
    });
  });
});
