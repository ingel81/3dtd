// The services are partially compiled and need the JIT compiler
import '@angular/compiler';
import { describe, it, expect, vi } from 'vitest';
import { Injector, signal } from '@angular/core';
import { SaveGameService } from './save-game.service';
import { SimClient } from '../../sim/client/sim-client.service';
import { SimMirror } from '../../sim/client/mirror/sim-mirror';
import { MainWorldService } from '../world/main-world.service';
import { WorldPackageLoader } from '../world/world-package-loader.service';
import { LocationManagementService } from '../location/location-management.service';
import { EngineInitializationService } from '../infrastructure/engine-initialization.service';
import { WaveDirector } from '../../director/wave-director';
import { RunLogFacade } from '../../run-log/run-log.facade';
import { DevWorldService } from '../../devworld/devworld.service';
import { GameStore } from '../../store/game.store';
import { UIStore } from '../../store/ui.store';
import { CoopService } from '../coop.service';
import { createMainEventBus } from '../../sim/client/view-events';
import { buildWorldPackage } from '../../coop/world-package';
import { SIM_SNAPSHOT_VERSION, type SimSnapshot } from '../../simulator/sim-snapshot';
import { buildSaveFile, type SaveFile } from '../../simulator/save-file';
import { BUILD_VERSION } from '../../configs/build-info.config';
import { balanceConfigHash } from '../../run-log/config-hash';
import type { GamePhase } from '../../models/game.types';

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
    }, HEAD),
    sim: { version: SIM_SNAPSHOT_VERSION, towers: [], rng: { seed: 9, streams: {} }, waveNumber: 4 } as unknown as SimSnapshot,
    director: { source: 'budget', sourceState: null, planned: null },
    mainRng: { seed: 9, streams: { director: 1234 } },
    runLog: null,
    waveSeries: [],
  });
}

interface Applying { apply(file: SaveFile): Promise<string | null> }

function setup(options: { inCoop?: boolean } = {}) {
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
  };
  const director = { restoreState: vi.fn(() => order.push('director')), saveState: vi.fn() };
  const runLog = { resumeRun: vi.fn(() => order.push('run-log')), saveState: vi.fn() };
  const loader = {
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
  const phase = signal<GamePhase>('setup');
  const injector = Injector.create({
    providers: [
      SaveGameService,
      { provide: SimClient, useValue: sim },
      { provide: SimMirror, useValue: mirror },
      { provide: MainWorldService, useValue: { source: () => ({}), spawnPoints: [] } },
      { provide: WorldPackageLoader, useValue: loader },
      { provide: LocationManagementService, useValue: { hq: signal({ lat: 49.1, lon: 9.2 }), getLocationDisplayName: () => 'Heilbronn' } },
      { provide: EngineInitializationService, useValue: { getEngine: () => ({}), loading: signal(false) } },
      { provide: WaveDirector, useValue: director },
      { provide: RunLogFacade, useValue: runLog },
      { provide: DevWorldService, useValue: { isActive: false } },
      { provide: GameStore, useValue: { phase, isGameOver: signal(false) } },
      { provide: UIStore, useValue: { replayMode: signal(false) } },
      { provide: CoopService, useValue: { room: signal(options.inCoop ? {} : null), inGame: signal(false) } },
    ],
  });
  const service = injector.get(SaveGameService);
  return { service, apply: (file: SaveFile) => (service as unknown as Applying).apply(file), order, phase, director, mirror, runLog, loader, bus };
}

describe('SaveGameService (TODO E110)', () => {
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
    expect(order).toEqual(['adopt', 'restoreSnapshot', 'director', 'rng', 'run-log']);
    expect(director.restoreState).toHaveBeenCalledWith(file.director);
    expect(mirror.rng.setState).toHaveBeenCalledWith(file.mainRng);
    expect(runLog.resumeRun).toHaveBeenCalledWith(null, [], 4);
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
      expect(order).toEqual(['captureSnapshot']);

      bus.emit({ type: 'wave:completed', wave: 4, credits: 0, perfect: true, closeCall: false, hpLost: 0 } as never);
      phase.set('wave');
      await vi.advanceTimersByTimeAsync(11_000);
      expect(order).toEqual(['captureSnapshot']);
    } finally {
      vi.useRealTimers();
    }
  });
});
