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

    it('no quick-actions menu is open', () => {
      expect(store.openMenu()).toBeNull();
    });

    it('routes start visible', () => {
      expect(store.routesVisible()).toBe(true);
    });

    it('all debug visibility flags start as false', () => {
      expect(store.streetsVisible()).toBe(false);
      expect(store.heightDebugVisible()).toBe(false);
      expect(store.specialPointsDebugVisible()).toBe(false);
      expect(store.infoOverlayVisible()).toBe(false);
      expect(store.infoOverlayWide()).toBe(false);
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

  });

  describe('quick-actions menus: only one open', () => {
    const flags = () => ({
      layers: store.layerMenuExpanded(),
      dev: store.devMenuExpanded(),
    });

    it('toggleMenu opens the menu and only that one', () => {
      store.toggleMenu('layers');
      expect(store.openMenu()).toBe('layers');
      expect(flags()).toEqual({ layers: true, dev: false });
    });

    it('opening another menu closes the open one', () => {
      store.toggleMenu('layers');
      store.toggleMenu('dev');
      expect(flags()).toEqual({ layers: false, dev: true });
      store.toggleMenu('layers');
      expect(flags()).toEqual({ layers: true, dev: false });
    });

    it('toggling the open menu closes it', () => {
      store.toggleMenu('dev');
      store.toggleMenu('dev');
      expect(store.openMenu()).toBeNull();
      expect(store.devMenuExpanded()).toBe(false);
    });
  });

  describe('persisted open menu', () => {
    const load = (state: object) => {
      localStorage.setItem('td-ui-state', JSON.stringify(state));
      return new UIStore();
    };

    it('reopens the stored menu', () => {
      expect(load({ openMenu: 'layers' }).openMenu()).toBe('layers');
      expect(load({ openMenu: null }).openMenu()).toBeNull();
    });

    it('ignores an unknown stored menu, and the display and audio menus that moved to Settings', () => {
      expect(load({ openMenu: 'inventory' }).openMenu()).toBeNull();
      expect(load({ openMenu: 'display' }).openMenu()).toBeNull();
      expect(load({ openMenu: 'audio' }).openMenu()).toBeNull();
    });

    it('migrates the old per-menu flags to one menu, dev first', () => {
      const s = load({ devMenuExpanded: true, layerMenuExpanded: true, displayMenuExpanded: true });
      expect(s.openMenu()).toBe('dev');
      expect(s.layerMenuExpanded()).toBe(false);
      expect(load({ layerMenuExpanded: true, audioMenuExpanded: true }).openMenu()).toBe('layers');
      expect(load({ displayMenuExpanded: true }).openMenu()).toBeNull();
      expect(load({ devMenuExpanded: false, layerMenuExpanded: false }).openMenu()).toBeNull();
    });

    it('the new field wins over leftover old flags', () => {
      expect(load({ openMenu: 'layers', devMenuExpanded: true }).openMenu()).toBe('layers');
    });

    it('restores the auto-start of waves, off when never stored', () => {
      expect(load({ autoStartWaves: true }).autoStartWaves()).toBe(true);
      expect(load({}).autoStartWaves()).toBe(false);
    });

    it('keeps the defaults for values of the wrong type and clamps volumes to 0..1', () => {
      const fresh = new UIStore();
      const s = load({
        masterVolume: 'abc', musicVolume: 5, sfxVolume: -1, uiVolume: null,
        masterMuted: 'yes', streetsVisible: 1, perTowerLosFilter: 'sky', infoOverlayWide: true,
      });
      expect(s.masterVolume()).toBe(fresh.masterVolume());
      expect(s.musicVolume()).toBe(1);
      expect(s.sfxVolume()).toBe(0);
      expect(s.uiVolume()).toBe(fresh.uiVolume());
      expect(s.masterMuted()).toBe(fresh.masterMuted());
      expect(s.streetsVisible()).toBe(fresh.streetsVisible());
      expect(s.perTowerLosFilter()).toBe(fresh.perTowerLosFilter());
      expect(s.infoOverlayWide()).toBe(true);
    });
  });

  describe('toggleInfoOverlay', () => {
    it('steps through FPS only, expanded, wide and back', () => {
      const stage = () => [store.infoOverlayVisible(), store.infoOverlayWide()];
      expect(stage()).toEqual([false, false]);
      store.toggleInfoOverlay();
      expect(stage()).toEqual([true, false]);
      store.toggleInfoOverlay();
      expect(stage()).toEqual([true, true]);
      store.toggleInfoOverlay();
      expect(stage()).toEqual([false, false]);
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
      store.toggleMenu('dev');
      store.streetsVisible.set(true);
      store.routesVisible.set(false);
      store.heightDebugVisible.set(true);
      store.specialPointsDebugVisible.set(true);
      store.infoOverlayVisible.set(true);
      store.infoOverlayWide.set(true);
      store.spatialGridDebugVisible.set(true);
      store.dpsBinsVisible.set(true);
      store.buildingsVisible.set(true);
      store.appendDebugLog('test log');
      store.buildMode.set(true);
      store.selectedTowerType.set('cannon');
      store.buildValidationReason.set('blocked');

      store.resetAll();

      expect(store.debugMode()).toBe(false);
      expect(store.openMenu()).toBeNull();
      expect(store.devMenuExpanded()).toBe(false);
      expect(store.streetsVisible()).toBe(false);
      expect(store.routesVisible()).toBe(true);
      expect(store.heightDebugVisible()).toBe(false);
      expect(store.specialPointsDebugVisible()).toBe(false);
      expect(store.infoOverlayVisible()).toBe(false);
      expect(store.infoOverlayWide()).toBe(false);
      expect(store.spatialGridDebugVisible()).toBe(false);
      expect(store.dpsBinsVisible()).toBe(false);
      expect(store.buildingsVisible()).toBe(false);
      expect(store.debugLog()).toBe('');
      expect(store.buildMode()).toBe(false);
      expect(store.selectedTowerType()).toBeNull();
      expect(store.buildValidationReason()).toBeNull();
    });
  });

  describe('effective volumes', () => {
    it('scale music and sound effects by the master volume', () => {
      store.masterVolume.set(0.5);
      store.musicVolume.set(0.4);
      store.sfxVolume.set(0.8);
      expect(store.effectiveMusicVolume()).toBeCloseTo(0.2);
      expect(store.effectiveSfxVolume()).toBeCloseTo(0.4);
    });

    it('are 0 when the channel or everything is muted', () => {
      store.musicMuted.set(true);
      expect(store.effectiveMusicVolume()).toBe(0);
      expect(store.effectiveSfxVolume()).toBeGreaterThan(0);
      store.masterMuted.set(true);
      expect(store.effectiveSfxVolume()).toBe(0);
    });
  });
});
