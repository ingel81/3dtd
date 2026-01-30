import { describe, it, expect, beforeEach } from 'vitest';
import { GameStore } from './game.store';
import { GAME_BALANCE } from '../configs/game-balance.config';

describe('GameStore', () => {
  let store: GameStore;

  beforeEach(() => {
    store = new GameStore();
  });

  describe('initial values', () => {
    it('credits start at configured startCredits', () => {
      expect(store.credits()).toBe(GAME_BALANCE.player.startCredits);
    });

    it('baseHealth starts at configured startHealth', () => {
      expect(store.baseHealth()).toBe(GAME_BALANCE.player.startHealth);
    });

    it('phase starts as setup', () => {
      expect(store.phase()).toBe('setup');
    });

    it('waveNumber starts at 0', () => {
      expect(store.waveNumber()).toBe(0);
    });

    it('enemiesAlive starts at 0', () => {
      expect(store.enemiesAlive()).toBe(0);
    });

    it('selectedTower starts as null', () => {
      expect(store.selectedTower()).toBeNull();
    });

    it('towerCount starts at 0', () => {
      expect(store.towerCount()).toBe(0);
    });

    it('showGameOverScreen starts as false', () => {
      expect(store.showGameOverScreen()).toBe(false);
    });

    it('trainingTimescale starts at 1.0', () => {
      expect(store.trainingTimescale()).toBe(1.0);
    });

    it('botEnabled starts as false', () => {
      expect(store.botEnabled()).toBe(false);
    });

    it('botSkillLevel starts as beginner', () => {
      expect(store.botSkillLevel()).toBe('beginner');
    });

    it('botAutoMode starts as false', () => {
      expect(store.botAutoMode()).toBe(false);
    });

    it('useAIDirector starts as false', () => {
      expect(store.useAIDirector()).toBe(false);
    });

    it('aiExplanation starts as null', () => {
      expect(store.aiExplanation()).toBeNull();
    });

    it('isDevWorldRegenerating starts as false', () => {
      expect(store.isDevWorldRegenerating()).toBe(false);
    });
  });

  describe('signal set/update', () => {
    it('credits can be set and updated', () => {
      store.credits.set(200);
      expect(store.credits()).toBe(200);

      store.credits.update(c => c + 50);
      expect(store.credits()).toBe(250);
    });

    it('phase can be changed', () => {
      store.phase.set('wave');
      expect(store.phase()).toBe('wave');

      store.phase.set('gameover');
      expect(store.phase()).toBe('gameover');
    });

    it('baseHealth can be decremented', () => {
      store.baseHealth.update(h => h - 10);
      expect(store.baseHealth()).toBe(GAME_BALANCE.player.startHealth - 10);
    });

    it('waveNumber can be incremented', () => {
      store.waveNumber.update(w => w + 1);
      expect(store.waveNumber()).toBe(1);

      store.waveNumber.update(w => w + 1);
      expect(store.waveNumber()).toBe(2);
    });

    it('enemiesAlive tracks count', () => {
      store.enemiesAlive.set(15);
      expect(store.enemiesAlive()).toBe(15);

      store.enemiesAlive.update(e => e - 1);
      expect(store.enemiesAlive()).toBe(14);
    });
  });

  describe('computed values', () => {
    it('selectedTowerId returns null when no tower selected', () => {
      expect(store.selectedTowerId()).toBeNull();
    });

    it('waveActive is true when phase is wave', () => {
      expect(store.waveActive()).toBe(false);
      store.phase.set('wave');
      expect(store.waveActive()).toBe(true);
    });

    it('waveActive is false for other phases', () => {
      store.phase.set('setup');
      expect(store.waveActive()).toBe(false);
      store.phase.set('paused');
      expect(store.waveActive()).toBe(false);
      store.phase.set('gameover');
      expect(store.waveActive()).toBe(false);
    });

    it('isGameOver is true only when phase is gameover', () => {
      expect(store.isGameOver()).toBe(false);
      store.phase.set('gameover');
      expect(store.isGameOver()).toBe(true);
    });

    it('gameStarted is false initially (setup, wave 0)', () => {
      expect(store.gameStarted()).toBe(false);
    });

    it('gameStarted is true when waveNumber > 0', () => {
      store.waveNumber.set(1);
      expect(store.gameStarted()).toBe(true);
    });

    it('gameStarted is true when phase is not setup', () => {
      store.phase.set('wave');
      expect(store.gameStarted()).toBe(true);
    });

    it('healthPercent is 100 at full health', () => {
      expect(store.healthPercent()).toBe(100);
    });

    it('healthPercent is 50 at half health', () => {
      store.baseHealth.set(GAME_BALANCE.player.startHealth / 2);
      expect(store.healthPercent()).toBe(50);
    });

    it('healthPercent is 0 when health is 0', () => {
      store.baseHealth.set(0);
      expect(store.healthPercent()).toBe(0);
    });

    it('healthCritical is false at full health', () => {
      expect(store.healthCritical()).toBe(false);
    });

    it('healthCritical is true at 25% health', () => {
      store.baseHealth.set(GAME_BALANCE.player.startHealth * 0.25);
      expect(store.healthCritical()).toBe(true);
    });

    it('healthCritical is true below 25% health', () => {
      store.baseHealth.set(GAME_BALANCE.player.startHealth * 0.1);
      expect(store.healthCritical()).toBe(true);
    });

    it('healthCritical is false at 26% health', () => {
      store.baseHealth.set(GAME_BALANCE.player.startHealth * 0.26);
      expect(store.healthCritical()).toBe(false);
    });
  });

  describe('resetGameState', () => {
    it('resets all game signals to initial values', () => {
      store.credits.set(999);
      store.baseHealth.set(10);
      store.phase.set('gameover');
      store.waveNumber.set(5);
      store.enemiesAlive.set(20);
      store.towerCount.set(8);
      store.showGameOverScreen.set(true);
      store.aiExplanation.set('test explanation');

      store.resetGameState();

      expect(store.credits()).toBe(GAME_BALANCE.player.startCredits);
      expect(store.baseHealth()).toBe(GAME_BALANCE.player.startHealth);
      expect(store.phase()).toBe('setup');
      expect(store.waveNumber()).toBe(0);
      expect(store.enemiesAlive()).toBe(0);
      expect(store.selectedTower()).toBeNull();
      expect(store.towerCount()).toBe(0);
      expect(store.showGameOverScreen()).toBe(false);
      expect(store.aiExplanation()).toBeNull();
    });

    it('does NOT reset bot/training settings', () => {
      store.botEnabled.set(true);
      store.trainingTimescale.set(10);
      store.botAutoMode.set(true);

      store.resetGameState();

      expect(store.botEnabled()).toBe(true);
      expect(store.trainingTimescale()).toBe(10);
      expect(store.botAutoMode()).toBe(true);
    });
  });

  describe('resetAll', () => {
    it('resets everything including bot/training settings', () => {
      store.credits.set(999);
      store.phase.set('gameover');
      store.botEnabled.set(true);
      store.trainingTimescale.set(50);
      store.botSkillLevel.set('expert');
      store.botAutoMode.set(true);
      store.useAIDirector.set(true);
      store.isDevWorldRegenerating.set(true);

      store.resetAll();

      expect(store.credits()).toBe(GAME_BALANCE.player.startCredits);
      expect(store.phase()).toBe('setup');
      expect(store.botEnabled()).toBe(false);
      expect(store.trainingTimescale()).toBe(1.0);
      expect(store.botSkillLevel()).toBe('beginner');
      expect(store.botAutoMode()).toBe(false);
      expect(store.useAIDirector()).toBe(false);
      expect(store.isDevWorldRegenerating()).toBe(false);
    });
  });
});
