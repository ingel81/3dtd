import { describe, it, expect, beforeEach } from 'vitest';
import { EngineStore } from './engine.store';
import { TileStats } from './tower-defense.store.types';

describe('EngineStore', () => {
  let store: EngineStore;

  beforeEach(() => {
    store = new EngineStore();
  });

  describe('initial values', () => {
    it('loading starts as true', () => {
      expect(store.loading()).toBe(true);
    });

    it('tilesLoading starts as true', () => {
      expect(store.tilesLoading()).toBe(true);
    });

    it('osmLoading starts as true', () => {
      expect(store.osmLoading()).toBe(true);
    });

    it('heightsLoading starts as false', () => {
      expect(store.heightsLoading()).toBe(false);
    });

    it('heightProgress starts at 0', () => {
      expect(store.heightProgress()).toBe(0);
    });

    it('error starts as null', () => {
      expect(store.error()).toBeNull();
    });

    it('loadingStatus starts as Initializing...', () => {
      expect(store.loadingStatus()).toBe('Initializing...');
    });

    it('loadingSteps starts as empty array', () => {
      expect(store.loadingSteps()).toEqual([]);
    });

    it('fps starts at 0', () => {
      expect(store.fps()).toBe(0);
    });

    it('tileStats starts with all zeros', () => {
      expect(store.tileStats()).toEqual({ parsing: 0, downloading: 0, total: 0, visible: 0 });
    });

    it('activeSounds starts at 0', () => {
      expect(store.activeSounds()).toBe(0);
    });

    it('mapAttribution has default value', () => {
      expect(store.mapAttribution()).toBe('Map data ©2024 Google');
    });

    it('cameraHeading starts at 0', () => {
      expect(store.cameraHeading()).toBe(0);
    });

    it('compassRotation starts at 0', () => {
      expect(store.compassRotation()).toBe(0);
    });

    it('cameraDebugEnabled starts as false', () => {
      expect(store.cameraDebugEnabled()).toBe(false);
    });

    it('cameraDebugInfo starts as null', () => {
      expect(store.cameraDebugInfo()).toBeNull();
    });

    it('cameraFramingDebug starts as false', () => {
      expect(store.cameraFramingDebug()).toBe(false);
    });
  });

  describe('updateEngineStats', () => {
    const baseTileStats: TileStats = { parsing: 2, downloading: 3, total: 10, visible: 8 };

    it('updates fps', () => {
      store.updateEngineStats({
        fps: 60,
        tileStats: baseTileStats,
        activeSoundCount: 0,
        cameraHeading: 0,
      });
      expect(store.fps()).toBe(60);
    });

    it('updates tileStats', () => {
      store.updateEngineStats({
        fps: 30,
        tileStats: baseTileStats,
        activeSoundCount: 0,
        cameraHeading: 0,
      });
      expect(store.tileStats()).toEqual(baseTileStats);
    });

    it('updates activeSounds', () => {
      store.updateEngineStats({
        fps: 60,
        tileStats: baseTileStats,
        activeSoundCount: 5,
        cameraHeading: 0,
      });
      expect(store.activeSounds()).toBe(5);
    });

    it('updates attribution when provided', () => {
      store.updateEngineStats({
        fps: 60,
        tileStats: baseTileStats,
        activeSoundCount: 0,
        attribution: 'OpenStreetMap',
        cameraHeading: 0,
      });
      expect(store.mapAttribution()).toBe('OpenStreetMap');
    });

    it('does not overwrite attribution when not provided', () => {
      const original = store.mapAttribution();
      store.updateEngineStats({
        fps: 60,
        tileStats: baseTileStats,
        activeSoundCount: 0,
        cameraHeading: 0,
      });
      expect(store.mapAttribution()).toBe(original);
    });

    it('updates cameraHeading', () => {
      store.updateEngineStats({
        fps: 60,
        tileStats: baseTileStats,
        activeSoundCount: 0,
        cameraHeading: 90,
      });
      expect(store.cameraHeading()).toBe(90);
    });

    it('accumulates compassRotation correctly', () => {
      store.updateEngineStats({
        fps: 60,
        tileStats: baseTileStats,
        activeSoundCount: 0,
        cameraHeading: 90,
      });
      expect(store.compassRotation()).toBe(90);

      store.updateEngineStats({
        fps: 60,
        tileStats: baseTileStats,
        activeSoundCount: 0,
        cameraHeading: 180,
      });
      expect(store.compassRotation()).toBe(180);
    });

    it('handles compass wrap-around (350 → 10 = +20 not -340)', () => {
      store.cameraHeading.set(350);
      store.compassRotation.set(350);

      store.updateEngineStats({
        fps: 60,
        tileStats: baseTileStats,
        activeSoundCount: 0,
        cameraHeading: 10,
      });
      // delta = 10 - 350 = -340, corrected to +20
      expect(store.compassRotation()).toBe(370);
    });

    it('does not update cameraDebugInfo when debug is disabled', () => {
      store.cameraDebugEnabled.set(false);
      const debugInfo = {
        posX: 1, posY: 2, posZ: 3,
        rotX: 0, rotY: 0, rotZ: 0,
        heading: 0, pitch: 0, altitude: 100,
        distanceToCenter: 500, fov: 60, terrainHeight: 0,
      };

      store.updateEngineStats({
        fps: 60,
        tileStats: baseTileStats,
        activeSoundCount: 0,
        cameraHeading: 0,
        cameraDebugInfo: debugInfo,
      });
      expect(store.cameraDebugInfo()).toBeNull();
    });

    it('updates cameraDebugInfo when debug is enabled', () => {
      store.cameraDebugEnabled.set(true);
      const debugInfo = {
        posX: 1, posY: 2, posZ: 3,
        rotX: 0, rotY: 0, rotZ: 0,
        heading: 45, pitch: -30, altitude: 200,
        distanceToCenter: 1000, fov: 75, terrainHeight: 50,
      };

      store.updateEngineStats({
        fps: 60,
        tileStats: baseTileStats,
        activeSoundCount: 0,
        cameraHeading: 45,
        cameraDebugInfo: debugInfo,
      });
      expect(store.cameraDebugInfo()).toEqual(debugInfo);
    });
  });

  describe('resetAll', () => {
    it('resets all engine state to initial values', () => {
      store.loading.set(false);
      store.tilesLoading.set(false);
      store.osmLoading.set(false);
      store.heightsLoading.set(true);
      store.heightProgress.set(0.75);
      store.error.set('Something broke');
      store.loadingStatus.set('Done');
      store.loadingSteps.set([{ id: 'test', label: 'Test', status: 'done' }]);
      store.fps.set(120);
      store.tileStats.set({ parsing: 5, downloading: 10, total: 50, visible: 40 });
      store.activeSounds.set(10);
      store.mapAttribution.set('Custom');
      store.cameraHeading.set(270);
      store.compassRotation.set(630);
      store.cameraDebugEnabled.set(true);
      store.cameraDebugInfo.set({
        posX: 1, posY: 2, posZ: 3,
        rotX: 0, rotY: 0, rotZ: 0,
        heading: 0, pitch: 0, altitude: 0,
        distanceToCenter: 0, fov: 0, terrainHeight: 0,
      });
      store.cameraFramingDebug.set(true);

      store.resetAll();

      expect(store.loading()).toBe(true);
      expect(store.tilesLoading()).toBe(true);
      expect(store.osmLoading()).toBe(true);
      expect(store.heightsLoading()).toBe(false);
      expect(store.heightProgress()).toBe(0);
      expect(store.error()).toBeNull();
      expect(store.loadingStatus()).toBe('Initializing...');
      expect(store.loadingSteps()).toEqual([]);
      expect(store.fps()).toBe(0);
      expect(store.tileStats()).toEqual({ parsing: 0, downloading: 0, total: 0, visible: 0 });
      expect(store.activeSounds()).toBe(0);
      expect(store.mapAttribution()).toBe('Map data ©2024 Google');
      expect(store.cameraHeading()).toBe(0);
      expect(store.compassRotation()).toBe(0);
      expect(store.cameraDebugEnabled()).toBe(false);
      expect(store.cameraDebugInfo()).toBeNull();
      expect(store.cameraFramingDebug()).toBe(false);
    });
  });
});
