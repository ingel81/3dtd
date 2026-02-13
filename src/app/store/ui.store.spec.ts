import { describe, it, expect, beforeEach } from 'vitest';
import { UIStore } from './ui.store';

describe('UIStore', () => {
  let store: UIStore;

  beforeEach(() => {
    localStorage.removeItem('td-ui-state');
    store = new UIStore();
  });

  describe('initial values', () => {
    it('debugMode starts as false', () => {
      expect(store.debugMode()).toBe(false);
    });

    it('layerMenuExpanded starts as false', () => {
      expect(store.layerMenuExpanded()).toBe(false);
    });

    it('devMenuExpanded starts as false', () => {
      expect(store.devMenuExpanded()).toBe(false);
    });

    it('displayMenuExpanded starts as false', () => {
      expect(store.displayMenuExpanded()).toBe(false);
    });

    it('all debug visibility flags start as false', () => {
      expect(store.streetsVisible()).toBe(false);
      expect(store.routesVisible()).toBe(false);
      expect(store.heightDebugVisible()).toBe(false);
      expect(store.specialPointsDebugVisible()).toBe(false);
      expect(store.infoOverlayVisible()).toBe(false);
      expect(store.spatialGridDebugVisible()).toBe(false);
      expect(store.dpsBinsVisible()).toBe(false);
      expect(store.buildingsVisible()).toBe(false);
    });

    it('debugLog starts as empty string', () => {
      expect(store.debugLog()).toBe('');
    });

    it('buildMode starts as false', () => {
      expect(store.buildMode()).toBe(false);
    });

    it('selectedTowerType starts as null', () => {
      expect(store.selectedTowerType()).toBeNull();
    });

    it('buildValidationReason starts as null', () => {
      expect(store.buildValidationReason()).toBeNull();
    });

    it('debug enemy overrides have correct defaults', () => {
      expect(store.enemySpeed()).toBe(2.0);
      expect(store.enemyHealth()).toBe(100);
      expect(store.enemyCount()).toBe(5);
      expect(store.enemyType()).toBe('basic');
      expect(store.spawnMode()).toBe('sequential');
      expect(store.spawnDelay()).toBe(1000);
    });
  });

  describe('toggleBuildings', () => {
    it('toggles buildingsVisible', () => {
      expect(store.buildingsVisible()).toBe(false);
      store.toggleBuildings();
      expect(store.buildingsVisible()).toBe(true);
      store.toggleBuildings();
      expect(store.buildingsVisible()).toBe(false);
    });
  });

  describe('appendDebugLog', () => {
    it('appends a message to the debug log', () => {
      store.appendDebugLog('Hello');
      expect(store.debugLog()).toContain('Hello');
    });

    it('appends multiple messages with newlines', () => {
      store.appendDebugLog('Line 1');
      store.appendDebugLog('Line 2');
      const log = store.debugLog();
      expect(log).toContain('Line 1');
      expect(log).toContain('Line 2');
    });

    it('trims lines beyond 50', () => {
      for (let i = 0; i < 55; i++) {
        store.appendDebugLog(`Line ${i}`);
      }
      const lines = store.debugLog().split('\n').filter(l => l.length > 0);
      expect(lines.length).toBeLessThanOrEqual(51);
    });
  });

  describe('clearDebugLog', () => {
    it('clears the debug log', () => {
      store.appendDebugLog('Something');
      store.clearDebugLog();
      expect(store.debugLog()).toBe('');
    });
  });

  describe('resetBuildState', () => {
    it('resets build mode and selection', () => {
      store.buildMode.set(true);
      store.selectedTowerType.set('archer');
      store.buildValidationReason.set('Too close');

      store.resetBuildState();

      expect(store.buildMode()).toBe(false);
      expect(store.selectedTowerType()).toBeNull();
      expect(store.buildValidationReason()).toBeNull();
    });

    it('does NOT reset debug visibility flags', () => {
      store.debugMode.set(true);
      store.streetsVisible.set(true);

      store.resetBuildState();

      expect(store.debugMode()).toBe(true);
      expect(store.streetsVisible()).toBe(true);
    });
  });

  describe('resetAll', () => {
    it('resets all UI state to defaults', () => {
      store.debugMode.set(true);
      store.layerMenuExpanded.set(true);
      store.devMenuExpanded.set(true);
      store.displayMenuExpanded.set(true);
      store.streetsVisible.set(true);
      store.routesVisible.set(true);
      store.heightDebugVisible.set(true);
      store.specialPointsDebugVisible.set(true);
      store.infoOverlayVisible.set(true);
      store.spatialGridDebugVisible.set(true);
      store.dpsBinsVisible.set(true);
      store.buildingsVisible.set(true);
      store.appendDebugLog('test log');
      store.buildMode.set(true);
      store.selectedTowerType.set('cannon');
      store.buildValidationReason.set('blocked');
      store.enemySpeed.set(10);
      store.enemyHealth.set(500);
      store.enemyCount.set(50);
      store.enemyType.set('boss');
      store.spawnMode.set('random');
      store.spawnDelay.set(5000);

      store.resetAll();

      expect(store.debugMode()).toBe(false);
      expect(store.layerMenuExpanded()).toBe(false);
      expect(store.devMenuExpanded()).toBe(false);
      expect(store.displayMenuExpanded()).toBe(false);
      expect(store.streetsVisible()).toBe(false);
      expect(store.routesVisible()).toBe(false);
      expect(store.heightDebugVisible()).toBe(false);
      expect(store.specialPointsDebugVisible()).toBe(false);
      expect(store.infoOverlayVisible()).toBe(false);
      expect(store.spatialGridDebugVisible()).toBe(false);
      expect(store.dpsBinsVisible()).toBe(false);
      expect(store.buildingsVisible()).toBe(false);
      expect(store.debugLog()).toBe('');
      expect(store.buildMode()).toBe(false);
      expect(store.selectedTowerType()).toBeNull();
      expect(store.buildValidationReason()).toBeNull();
      expect(store.enemySpeed()).toBe(2.0);
      expect(store.enemyHealth()).toBe(100);
      expect(store.enemyCount()).toBe(5);
      expect(store.enemyType()).toBe('basic');
      expect(store.spawnMode()).toBe('sequential');
      expect(store.spawnDelay()).toBe(1000);
    });
  });
});
