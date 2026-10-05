import { DestroyRef, Injectable, computed, inject, signal, type Signal } from '@angular/core';
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
import { BUILD_VERSION } from '../../configs/build-info.config';
import { balanceConfigHash } from '../../run-log/config-hash';
import { buildCommit } from '../../run-log/build-commit';
import { buildWorldPackage } from '../../coop/world-package';
import type { SaveFile } from '../../simulator/save-file';
import type { SimSnapshot } from '../../simulator/sim-snapshot';
import { downloadBlob } from '../../utils/download';
import { SaveGame, type SaveGameHost } from './save-game';
import { IdbSaveSlotStore } from './save-slot.store';
import type { LoadResult, SaveGamePort, SaveResult, SaveSlotInfo, StartPlace } from './save-game.port';

/** How long the autosave waits after a wave for the last shots and events to settle, ms */
const AUTOSAVE_WAIT_MS = 10_000;
const AUTOSAVE_POLL_MS = 250;
/** Longest wait for the restored state's first packet after a load, ms */
const RESTORE_WAIT_MS = 10_000;

/**
 * Saving and loading in the running game (docs/SAVE_LOAD_PLAN.md, TODO
 * E110): what goes into a save and how one is put back, behind the port the
 * menu binds to (SAVE_GAME, provided with the game component).
 *
 * A save is taken between waves: the simulation's snapshot from the worker,
 * the world package of the place, the director and the main thread's
 * random source, the run log so far. A load stands on the place first (the
 * tiles to look at, WorldPackageLoader), takes the save's routes, cells and
 * heights, puts the snapshot into the simulation and, once its first packet
 * is here, the director, the random source and the run log back.
 */
@Injectable()
export class SaveGameService implements SaveGamePort {
  private readonly sim = inject(SimClient);
  private readonly mirror = inject(SimMirror);
  private readonly world = inject(MainWorldService);
  private readonly loader = inject(WorldPackageLoader);
  private readonly locationMgmt = inject(LocationManagementService);
  private readonly engineInit = inject(EngineInitializationService);
  private readonly director = inject(WaveDirector);
  private readonly runLog = inject(RunLogFacade);
  private readonly devWorld = inject(DevWorldService);
  private readonly gameStore = inject(GameStore);
  private readonly uiStore = inject(UIStore);
  private readonly coop = inject(CoopService, { optional: true });

  /** A load at a start without a place: the start dialog closes with this place (see StartPlace) */
  private readonly pendingPlace = signal<StartPlace | null>(null);
  readonly startPlace: Signal<StartPlace | null> = this.pendingPlace.asReadonly();

  private readonly inCoop = computed(() => !!this.coop && (this.coop.room() !== null || this.coop.inGame()));

  private readonly host: SaveGameHost = {
    saveBlocked: computed(() => {
      if (this.inCoop()) return 'Saving is off in co-op.';
      if (this.uiStore.replayMode()) return 'Saving is off while a replay plays.';
      if (this.devWorld.isActive) return 'Saving is off in DevWorld.';
      if (this.gameStore.isGameOver()) return 'The run is over.';
      if (this.gameStore.phase() !== 'setup') return 'Saving works only between waves.';
      if (!this.locationMgmt.hq() || this.engineInit.loading()) return 'No place is loaded yet.';
      return null;
    }),
    loadBlocked: computed(() => {
      if (this.inCoop()) return 'Loading is off in co-op.';
      if (this.uiStore.replayMode()) return 'Leave the replay first.';
      if (this.devWorld.isActive) return 'Loading is off in DevWorld.';
      return null;
    }),
    collect: () => this.collect(),
    apply: (file) => this.apply(file),
    download: (blob, fileName) => downloadBlob(blob, fileName),
  };

  private readonly game = new SaveGame(this.host, new IdbSaveSlotStore(), {
    gameVersion: BUILD_VERSION,
    configHash: balanceConfigHash(),
  });

  readonly canSave = this.game.canSave;
  readonly cannotSaveReason = this.game.cannotSaveReason;
  readonly slots: Signal<readonly SaveSlotInfo[]> = this.game.slots;
  readonly hasAutosave = this.game.hasAutosave;

  constructor() {
    // The autosave after every wave, once the last shots and events have settled
    let attempt = 0;
    const off = this.sim.bus.onLive('wave:completed', () => {
      const mine = ++attempt;
      void this.autosaveWhenQuiet(() => mine === attempt);
    });
    inject(DestroyRef).onDestroy(() => {
      attempt++;
      off.dispose();
    });
  }

  refresh(): Promise<void> {
    return this.game.refresh();
  }

  save(slotId: string, name?: string): Promise<SaveResult> {
    return this.game.save(slotId, name);
  }

  load(slotId: string): Promise<LoadResult> {
    return this.game.load(slotId);
  }

  deleteSlot(slotId: string): Promise<void> {
    return this.game.deleteSlot(slotId);
  }

  exportFile(slotId: string): Promise<SaveResult> {
    return this.game.exportFile(slotId);
  }

  importFile(file: File): Promise<LoadResult> {
    return this.game.importFile(file);
  }

  continueAutosave(): Promise<LoadResult> {
    return this.game.continueAutosave();
  }

  /** After a wave: the autosave as soon as the simulation stands still between the waves */
  private async autosaveWhenQuiet(current: () => boolean): Promise<void> {
    const end = performance.now() + AUTOSAVE_WAIT_MS;
    while (current() && performance.now() < end) {
      // First a pause: the other listeners of wave:completed (the director's loop, the run log) go first
      await new Promise((resolve) => setTimeout(resolve, AUTOSAVE_POLL_MS));
      // The next wave started, or the run ended: nothing to save for this one
      if (!current() || this.gameStore.phase() !== 'setup') return;
      if (this.mirror.scalars.snapshotRefusal === null && this.host.saveBlocked() === null) {
        await this.game.autosave();
        return;
      }
    }
  }

  /** The run between the waves; null when the simulation refused (not between waves) */
  private async collect(): Promise<Awaited<ReturnType<SaveGameHost['collect']>>> {
    const source = this.world.source();
    const hq = this.locationMgmt.hq();
    if (!source || !hq) return null;
    const sim = (await this.sim.rpc('captureSnapshot')) as SimSnapshot | null;
    if (!sim) return null;
    const director = this.director.saveState();
    const head = { gameVersion: BUILD_VERSION, configHash: balanceConfigHash() };
    const { runLog, waveSeries } = this.runLog.saveState();
    return {
      ...head,
      commit: buildCommit(),
      wave: sim.waveNumber + 1,
      place: {
        name: this.locationMgmt.getLocationDisplayName(),
        hq: { lat: hq.lat, lon: hq.lon },
        spawns: this.world.spawnPoints.map(({ lat, lon }) => ({ lat, lon })),
      },
      world: buildWorldPackage(source, { ...head, waveSource: director.source }),
      sim,
      director,
      mainRng: this.mirror.rng.getState(),
      runLog,
      waveSeries,
    };
  }

  /**
   * Put a save in place. The place first: at a start without one the start
   * dialog closes with the save's (startPlace), otherwise the game goes
   * there as a coop guest follows the host; then the save's world, the
   * snapshot, and with its first packet the main thread's part.
   */
  private async apply(file: SaveFile): Promise<string | null> {
    const world = file.world;
    if (!this.engineInit.getEngine() || !this.locationMgmt.hq()) {
      this.pendingPlace.set({ hq: file.place.hq, spawns: file.place.spawns });
      const loaded = await this.loader.placeLoaded();
      this.pendingPlace.set(null);
      if (!loaded) return 'The place of the save did not load.';
    }
    if (!this.loader.standsOn(world)) {
      const there = this.loader.sameHq(world)
        ? await this.loader.takeSpawns(world)
        : await this.loader.moveTo(world, file.place.name);
      if (!there || !this.loader.standsOn(world)) return 'The place of the save did not load.';
    }
    if (this.loader.adopt(world) !== world.worldKey) return 'The world of the save did not come out the same here.';

    // The fresh run on the save's world (adopt sent it) and then the snapshot; the main thread's part
    // waits for the packet that says the simulation was restored, after the reset's
    const restored = this.nextRestore();
    await this.sim.rpc('restoreSnapshot', file.sim);
    if (!(await restored)) return 'The game did not take the save.';
    this.director.restoreState(file.director);
    this.mirror.rng.setState(file.mainRng);
    this.runLog.resumeRun(file.runLog, file.waveSeries, file.sim.waveNumber);
    return null;
  }

  /** Resolves true once a packet with `sim:restored` has been applied here, false after RESTORE_WAIT_MS */
  private nextRestore(): Promise<boolean> {
    return new Promise((resolve) => {
      let heard = false;
      const offEvent = this.sim.bus.onLive('sim:restored', () => { heard = true; });
      // The rest of the packet applied too (game:reset before it, the scalars of the restored state)
      const offFrame = this.sim.onFrame(() => {
        if (!heard) return;
        finish(true);
      });
      const timer = setTimeout(() => finish(false), RESTORE_WAIT_MS);
      const finish = (ok: boolean) => {
        clearTimeout(timer);
        offEvent.dispose();
        void offFrame();
        resolve(ok);
      };
    });
  }
}
