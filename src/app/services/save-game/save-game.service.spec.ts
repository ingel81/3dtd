// The services are partially compiled and need the JIT compiler
import '@angular/compiler';
import { describe, it, expect, vi } from 'vitest';
import { Injector, signal } from '@angular/core';
import { LOAD_NO_ROUTE, SAVE_NO_ROUTE, SaveGameService } from './save-game.service';
import { SimClient } from '../../sim/client/sim-client.service';
import { SimMirror } from '../../sim/client/mirror/sim-mirror';
import { MainWorldService } from '../world/main-world.service';
import { WorldPackageLoader } from '../world/world-package-loader.service';
import { LocationManagementService } from '../location/location-management.service';
import { EngineInitializationService } from '../infrastructure/engine-initialization.service';
import { WaveDirector } from '../../director/wave-director';
import { RunLogFacade } from '../../run-log/run-log.facade';
import { GameStore } from '../../store/game.store';
import { UIStore } from '../../store/ui.store';
import { LocationStore } from '../../store/location.store';
import { CoopService } from '../coop.service';
import { createMainEventBus } from '../../sim/client/view-events';
import { buildWorldPackage } from '../../coop/world-package';
import { SIM_SNAPSHOT_VERSION, type SimSnapshot } from '../../simulator/sim-snapshot';
import { buildSaveFile, type SaveFile } from '../../simulator/save-file';
import { BUILD_VERSION } from '../../configs/build-info.config';
import { balanceConfigHash } from '../../run-log/config-hash';
import type { GamePhase } from '../../models/game.types';
import { WorldContext } from '../../world/world-context.service';
import { fakeWorldContext, TEST_WORLD_REF } from '../../../test/world-context-fake';
import { CameraSlotsService } from '../camera-slots.service';
import { PLAIN_START, WorldStartService } from '../../world/world-start';
import { SAVE_SLOT_STORE, type StoredSlotMeta } from './save-slot.store';
import { AUTOSAVE_SLOT } from './save-game.port';
import { MemorySlotStore } from '../../../test/memory-slot-store';

/**
 * The save game in the running game (TODO E110), on stand-ins: when saving
 * is possible, and that a load puts the main thread's part (director,
 * random source, run log) back only after the packet that says the
 * simulation took the snapshot, which comes after the reset of the fresh
 * run on the save's world.
 */

const HEAD = { gameVersion: BUILD_VERSION, configHash: balanceConfigHash() };

function saveFile(): SaveFile {
  const hq = { lat: 49.1, lon: 9.2 };
  const spawn = { id: 'spawn-1', name: 'Spawn 1', lat: 49.11, lon: 9.21 };
  return buildSaveFile({
    ...HEAD,
    commit: 'c0ffee',
    name: 'Heilbronn, wave 5',
    wave: 5,
    place: { name: 'Heilbronn', hq, spawns: [{ lat: spawn.lat, lon: spawn.lon }] },
    world: buildWorldPackage({
      origin: hq, hq, spawns: [spawn], paths: new Map([['spawn-1', [{ lat: spawn.lat, lon: spawn.lon }, hq]]]),
      heights: [[1, 2.5, 1]], worldKey: 'w1',
    }, { ...HEAD, world: TEST_WORLD_REF }),
    sim: { version: SIM_SNAPSHOT_VERSION, towers: [], rng: { seed: 9, streams: {} }, waveNumber: 4 } as unknown as SimSnapshot,
    director: { source: 'budget', sourceState: null, planned: null },
    mainRng: { seed: 9, streams: { director: 1234 } },
    runLog: null,
    waveSeries: [],
  });
}

interface Applying { apply(file: SaveFile): Promise<string | null> }

function setup(options: { inCoop?: boolean; editorTest?: boolean; slots?: StoredSlotMeta[] } = {}) {
  const store = new MemorySlotStore(options.slots);
  // The simulation's world has a lane (TODO E232)
  const locationStore = { hasLanes: signal(true) };
  const bus = createMainEventBus();
  const frames = new Set<() => void>();
  const order: string[] = [];
  const sim = {
    bus,
    onFrame: (listener: () => void) => {
      frames.add(listener);
      return () => frames.delete(listener);
    },
    rpc: vi.fn(async (method: string) => {
      order.push(method);
      if (method === 'restoreSnapshot') {
        // The packet after the restore: the reset's events, then sim:restored, then the frame is done
        queueMicrotask(() => {
          bus.emit({ type: 'game:reset' } as never);
          bus.emit({ type: 'sim:restored', reason: 'live' } as never);
          for (const frame of [...frames]) frame();
        });
      }
      return null;
    }),
  };
  const mirror = {
    rng: { setState: vi.fn(() => order.push('rng')), getState: () => ({ seed: 1, streams: {} }) },
    scalars: { snapshotRefusal: null },
    losAwaiting: signal(0),
  };
  const director = {
    restoreState: vi.fn(() => order.push('director')),
    saveState: vi.fn(() => {
      order.push('director save');
      return { source: 'budget', sourceState: null, planned: null };
    }),
    useSourceNextRun: vi.fn((id: string) => order.push(`source ${id}`)),
  };
  const runLog = {
    resumeRun: vi.fn(() => order.push('run-log')),
    saveState: vi.fn(() => {
      order.push('run-log save');
      return { runLog: null, waveSeries: [] };
    }),
  };
  const loader = {
    worldHere: vi.fn((): string | null => null),
    placeLoaded: vi.fn(async () => true),
    standsOn: vi.fn(() => true),
    sameHq: vi.fn(() => true),
    takeSpawns: vi.fn(async () => true),
    moveTo: vi.fn(async () => true),
    adopt: vi.fn((): string => {
      order.push('adopt');
      return 'w1';
    }),
  };
  const cameraSlots = {
    saveState: vi.fn(() => [{ position: { x: 1, y: 2, z: 3 }, target: { x: 0, y: 0, z: 0 } }]),
    restoreState: vi.fn(() => order.push('camera views')),
  };
  const phase = signal<GamePhase>('setup');
  const world = { source: () => ({}), spawnPoints: [], sendToSim: vi.fn(() => order.push('fresh run')) };
  // The editor's test plays a custom map
  const context = fakeWorldContext();
  if (options.editorTest) context.useCustomMap('m');
  const injector = Injector.create({
    providers: [
      SaveGameService,
      { provide: SimClient, useValue: sim },
      { provide: SimMirror, useValue: mirror },
      { provide: MainWorldService, useValue: world },
      { provide: WorldPackageLoader, useValue: loader },
      { provide: LocationManagementService, useValue: { hq: signal({ lat: 49.1, lon: 9.2 }), getLocationDisplayName: () => 'Heilbronn' } },
      { provide: EngineInitializationService, useValue: { getEngine: () => ({}), loading: signal(false) } },
      { provide: WaveDirector, useValue: director },
      { provide: RunLogFacade, useValue: runLog },
      { provide: WorldContext, useValue: context },
      { provide: GameStore, useValue: { phase, isGameOver: signal(false) } },
      { provide: UIStore, useValue: { replayMode: signal(false) } },
      { provide: LocationStore, useValue: locationStore },
      { provide: CoopService, useValue: { room: signal(options.inCoop ? {} : null), inGame: signal(false) } },
      { provide: CameraSlotsService, useValue: cameraSlots },
      { provide: SAVE_SLOT_STORE, useValue: store },
      { provide: WorldStartService, useValue: { current: () => ({ ...PLAIN_START, trial: options.editorTest ? { bot: null } : null }) } },
    ],
  });
  const service = injector.get(SaveGameService);
  return { service, apply: (file: SaveFile) => (service as unknown as Applying).apply(file), order, phase, director, mirror, runLog, loader, bus, sim, cameraSlots, store, locationStore };
}

describe('SaveGameService (TODO E110)', () => {
  it("keeps no save of the editor's test of its map (E195 phase 5)", async () => {
    const { service } = setup({ editorTest: true });
    expect(service.cannotSaveReason()).toBe('A test of the map is not saved.');
    expect(await service.autosaveNow()).toBe(false);
  });

  it('saves between waves only, alone, not in co-op', () => {
    const { service, phase } = setup();
    expect(service.canSave()).toBe(true);
    phase.set('wave');
    expect(service.cannotSaveReason()).toBe('Saving works only between waves.');
    phase.set('gameover');
    expect(service.canSave()).toBe(false);
    expect(setup({ inCoop: true }).service.cannotSaveReason()).toBe('Saving is off in co-op.');
  });

  it('puts director, random source and run log back after the packet of the restore, the reset before it', async () => {
    const { apply, order, director, mirror, runLog } = setup();
    const file = saveFile();
    expect(await apply(file)).toBeNull();
    // The save's source before adopt: the reset of the fresh run puts it into service in the worker too
    expect(order).toEqual(['source budget', 'adopt', 'restoreSnapshot', 'director', 'rng', 'run-log', 'camera views']);
    expect(director.restoreState).toHaveBeenCalledWith(file.director);
    expect(mirror.rng.setState).toHaveBeenCalledWith(file.mainRng);
    expect(runLog.resumeRun).toHaveBeenCalledWith(null, [], 4);
  });

  it('starts a clean fresh run and says so when the simulation could not take the snapshot', async () => {
    const { apply, order, sim, director } = setup();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    sim.rpc.mockImplementationOnce(async (method: string) => {
      order.push(method);
      throw new Error('restore stopped');
    });
    expect(await apply(saveFile())).toBe('That save is damaged: a fresh run starts on its place.');
    expect(order).toEqual(['source budget', 'adopt', 'restoreSnapshot', 'fresh run']);
    expect(director.restoreState).not.toHaveBeenCalled();
  });

  it("takes the main thread's part before the simulation answers, so a wave started meanwhile changes none of it", async () => {
    const { service, order } = setup();
    // The simulation refuses: a wave began meanwhile
    expect(await service.save('slot-1')).toEqual({ ok: false, reason: 'Saving works only between waves.' });
    expect(order).toEqual(['director save', 'run-log save', 'captureSnapshot']);
  });

  it('does not save while a tower measures its line of sight, says so in the menu, and the autosave waits for it', async () => {
    vi.useFakeTimers();
    try {
      const { service, order, mirror, bus } = setup();
      mirror.losAwaiting.set(1);
      expect(service.cannotSaveReason()).toBe('A tower is still measuring its line of sight.');
      expect(await service.save('slot-1')).toEqual({ ok: false, reason: 'A tower is still measuring its line of sight.' });
      bus.emit({ type: 'wave:completed', wave: 3, credits: 0, perfect: true, closeCall: false, hpLost: 0 } as never);
      await vi.advanceTimersByTimeAsync(1000);
      expect(order).toEqual([]);
      mirror.losAwaiting.set(0);
      expect(service.canSave()).toBe(true);
      await vi.advanceTimersByTimeAsync(300);
      expect(order).toContain('captureSnapshot');
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps no save of a run without a route, so no Continue brings one back (TODO E232)', async () => {
    const { service, locationStore } = setup();
    locationStore.hasLanes.set(false);
    expect(service.cannotSaveReason()).toBe(SAVE_NO_ROUTE);
    expect(await service.autosaveNow()).toBe(false);
  });

  it('refuses a save whose world has no route before it moves anywhere (a 0.7.x autosave, TODO E232)', async () => {
    const { apply, order, loader } = setup();
    const file = saveFile();
    file.world.paths = [];
    expect(await apply(file)).toBe(LOAD_NO_ROUTE);
    expect(loader.placeLoaded).not.toHaveBeenCalled();
    expect(order).toEqual([]);
  });

  it('refuses a save of another world before it moves anywhere', async () => {
    const { apply, order, loader } = setup();
    loader.worldHere.mockReturnValue('It plays on another world (devworld flat/42), this page on tiles cesium. Open the same one first.');
    expect(await apply(saveFile())).toContain('That save cannot load here.');
    expect(loader.placeLoaded).not.toHaveBeenCalled();
    expect(order).toEqual([]);
  });

  it('waits for the place loaded here to stand, its corridor built, before it takes the save', async () => {
    const { apply, order, loader } = setup();
    let stand!: (ok: boolean) => void;
    loader.placeLoaded.mockReturnValueOnce(new Promise<boolean>((resolve) => { stand = resolve; }));
    const applied = apply(saveFile());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(order).toEqual([]);
    stand(true);
    expect(await applied).toBeNull();
    expect(order).toContain('adopt');
  });

  it('moves to the place of the save when it does not stand here, and stops when the world comes out another', async () => {
    const { apply, loader } = setup();
    loader.standsOn.mockReturnValueOnce(false).mockReturnValue(true);
    loader.sameHq.mockReturnValue(false);
    expect(await apply(saveFile())).toBeNull();
    expect(loader.moveTo).toHaveBeenCalledWith(saveFile().world, 'Heilbronn');
    loader.adopt.mockReturnValue('other');
    expect(await apply(saveFile())).toBe('The world of the save did not come out the same here.');
  });

  it('saves on its own after a wave, once the other listeners had their turn, and not when the next wave began', async () => {
    vi.useFakeTimers();
    try {
      const { bus, order, phase } = setup();
      bus.emit({ type: 'wave:completed', wave: 3, credits: 0, perfect: true, closeCall: false, hpLost: 0 } as never);
      expect(order).toEqual([]);
      await vi.advanceTimersByTimeAsync(300);
      const saved = ['director save', 'run-log save', 'captureSnapshot'];
      expect(order).toEqual(saved);

      bus.emit({ type: 'wave:completed', wave: 4, credits: 0, perfect: true, closeCall: false, hpLost: 0 } as never);
      phase.set('wave');
      await vi.advanceTimersByTimeAsync(11_000);
      expect(order).toEqual(saved);
    } finally {
      vi.useRealTimers();
    }
  });

  it('game over drops the Continue of this run: the autosave of this place goes, one of another place or a test stays (decision 1)', async () => {
    const meta = (lat: number): StoredSlotMeta => ({
      id: AUTOSAVE_SLOT, name: 'Heilbronn, wave 5', wave: 5, location: 'Heilbronn', savedAt: '2026-10-16T08:00:00Z',
      gameVersion: BUILD_VERSION, configHash: 'x', hq: { lat, lon: 9.2 },
    });
    const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
    const here = setup({ slots: [meta(49.1)] });
    await here.service.refresh();
    here.bus.emit({ type: 'game:over', reason: 'base-destroyed' } as never);
    await settle();
    await settle();
    expect(here.store.ids()).toEqual([]);

    const elsewhere = setup({ slots: [meta(48.5)] });
    await elsewhere.service.refresh();
    elsewhere.bus.emit({ type: 'game:over', reason: 'base-destroyed' } as never);
    await settle();
    expect(elsewhere.store.ids()).toEqual([AUTOSAVE_SLOT]);
  });
});
