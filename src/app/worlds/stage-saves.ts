import { computed, signal, type Signal } from '@angular/core';
import { BUILD_VERSION } from '../configs/build-info.config';
import { balanceConfigHash } from '../run-log/config-hash';
import { downloadBlob } from '../utils/download';
import { SaveGame } from '../services/save-game/save-game';
import { FILE_SLOT, type LoadResult, type SaveGamePort, type SaveResult, type SaveSlotInfo, type SlotWorld, type StartPlace } from '../services/save-game/save-game.port';
import type { SaveSlotStore } from '../services/save-game/save-slot.store';
import type { Messages } from '../i18n/messages/en';
import { en } from '../i18n/messages/en';

/**
 * The save slots as the globes see them (docs/WORLDS_NAVIGATION_PLAN.md, 3.1):
 * no game is loaded, so nothing saves, and loading a slot opens its world
 * with the save to load (`open`, the stage's Continue). Listing, export and
 * delete work on the stored slots alone. A save file is kept as a slot of
 * its own (FILE_SLOT, listed nowhere) and loads as a slot does.
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
    /** The world of a map's save: OpenStreetMap for one made there and unchanged, else the Built Worlds */
    private readonly worldOf: (mapId: string) => SlotWorld = () => 'maps',
    /** The player's words, read when they are said */
    private readonly t: () => Messages = () => en,
  ) {
    this.game = new SaveGame(
      {
        saveBlocked: computed(() => this.t().saves.noRun),
        loadBlocked: computed(() => null),
        collect: async () => null,
        apply: async () => this.t().saves.noWorld,
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
    return Promise.resolve({ ok: false, reason: this.t().saves.noRun });
  }

  /** Opens the slot's world, which loads it once it stands; the reason when that is not possible */
  async load(slotId: string): Promise<LoadResult> {
    const slot = this.slots().find((s) => s.id === slotId);
    if (!slot) return { ok: false, reason: this.t().saves.slotEmpty };
    const why = this.open(slot);
    return why ? { ok: false, reason: why } : { ok: true, note: null };
  }

  deleteSlot(slotId: string): Promise<void> {
    return this.game.deleteSlot(slotId);
  }

  exportFile(slotId: string): Promise<SaveResult> {
    return this.game.exportFile(slotId);
  }

  /** A save file: kept as the file slot, then its world opens with it as with a slot (the same question first) */
  async importFile(file: File): Promise<LoadResult> {
    const kept = await this.game.storeFile(file, FILE_SLOT, this.worldOf);
    if (!kept.ok) return kept;
    const why = this.open(kept.slot);
    return why ? { ok: false, reason: why } : { ok: true, note: null };
  }

  continueAutosave(): Promise<LoadResult> {
    return this.load('autosave');
  }

  /** No game stands on the globes: nothing to save */
  async autosaveNow(): Promise<boolean> {
    return false;
  }

  newRun(): void {
    // No run here
  }
}
