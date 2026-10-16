import { InjectionToken, computed, signal, type Signal } from '@angular/core';
import { BUILD_VERSION } from '../configs/build-info.config';
import { balanceConfigHash } from '../run-log/config-hash';
import { downloadBlob } from '../utils/download';
import { SaveGame } from '../services/save-game/save-game';
import type { LoadResult, SaveGamePort, SaveResult, SaveSlotInfo, StartPlace } from '../services/save-game/save-game.port';
import { IdbSaveSlotStore, type SaveSlotStore } from '../services/save-game/save-slot.store';

/** Where the globes read the slots from: this browser's IndexedDB; a spec hands in its own */
export const STAGE_SLOT_STORE = new InjectionToken<SaveSlotStore>('STAGE_SLOT_STORE', {
  providedIn: 'root',
  factory: () => new IdbSaveSlotStore(),
});

/**
 * The save slots as the globes see them (docs/WORLDS_NAVIGATION_PLAN.md, 3.1):
 * no game is loaded, so nothing saves, and loading a slot opens its world
 * with the save to load (`open`, the stage's Continue). Listing, export and
 * delete work on the stored slots alone. A file to load needs a game: the
 * Load page of a world's menu takes it.
 */
export class StageSaves implements SaveGamePort {
  private readonly game: SaveGame;
  readonly canSave: Signal<boolean>;
  readonly cannotSaveReason: Signal<string | null>;
  readonly slots: Signal<readonly SaveSlotInfo[]>;
  readonly hasAutosave: Signal<boolean>;
  readonly startPlace: Signal<StartPlace | null> = signal(null);

  constructor(
    store: SaveSlotStore,
    private readonly open: (slot: SaveSlotInfo) => string | null,
  ) {
    this.game = new SaveGame(
      {
        saveBlocked: computed(() => 'No run is loaded.'),
        loadBlocked: computed(() => null),
        collect: async () => null,
        apply: async () => 'No world is open.',
        download: (blob, fileName) => downloadBlob(blob, fileName),
      },
      store,
      { gameVersion: BUILD_VERSION, configHash: balanceConfigHash() },
    );
    this.canSave = this.game.canSave;
    this.cannotSaveReason = this.game.cannotSaveReason;
    this.slots = this.game.slots;
    this.hasAutosave = this.game.hasAutosave;
  }

  refresh(): Promise<void> {
    return this.game.refresh();
  }

  save(): Promise<SaveResult> {
    return Promise.resolve({ ok: false, reason: 'No run is loaded.' });
  }

  /** Opens the slot's world, which loads it once it stands; the reason when that is not possible */
  async load(slotId: string): Promise<LoadResult> {
    const slot = this.slots().find((s) => s.id === slotId);
    if (!slot) return { ok: false, reason: 'That slot is empty.' };
    const why = this.open(slot);
    return why ? { ok: false, reason: why } : { ok: true, note: null };
  }

  deleteSlot(slotId: string): Promise<void> {
    return this.game.deleteSlot(slotId);
  }

  exportFile(slotId: string): Promise<SaveResult> {
    return this.game.exportFile(slotId);
  }

  importFile(): Promise<LoadResult> {
    return Promise.resolve({ ok: false, reason: "A save file loads into a world's game: start one, then Load game in its menu (Esc)." });
  }

  continueAutosave(): Promise<LoadResult> {
    return this.load('autosave');
  }

  /** No game stands on the globes: nothing to save */
  async autosaveNow(): Promise<boolean> {
    return false;
  }
}
