import { InjectionToken, signal, type Signal } from '@angular/core';

/**
 * Saving and loading a single-player run (docs/SAVE_LOAD_PLAN.md, TODO E110):
 * what the game menu and the start screen see of it. Only between waves; in
 * coop saving is off. Slots live in this browser (IndexedDB), a slot goes out
 * and comes back in as a file.
 *
 * The port is what the UI binds to; the implementation behind SAVE_GAME
 * builds the save from the simulation and the world and loads it back.
 */

/** The slot written after every wave on its own */
export const AUTOSAVE_SLOT = 'autosave';
/** The slots the player saves to by hand: slot-1 to slot-N */
export const MANUAL_SLOT_COUNT = 5;
export const manualSlotId = (n: number): string => `slot-${n}`;

/** One filled slot, for the menu's list */
export interface SaveSlotInfo {
  /** AUTOSAVE_SLOT or manualSlotId(n) */
  id: string;
  /** The player's name for it, or the place and wave when they gave none */
  name: string;
  autosave: boolean;
  /** The wave the run stands before: the next start is this wave */
  wave: number;
  /** The place, as the location dialog names it */
  location: string;
  /** When it was saved, ISO 8601 */
  savedAt: string;
  /** The game version (BUILD_VERSION) it was saved with */
  gameVersion: string;
  /** Saved with another version: loads, but values may differ (null when it is this version) */
  note: string | null;
}

export type SaveResult = { ok: true } | { ok: false; reason: string };
/** A load that worked may carry a note (another game version) */
export type LoadResult = { ok: true; note: string | null } | { ok: false; reason: string };

export interface SaveGamePort {
  /** Saving is possible now: between waves, alone, with a place loaded */
  readonly canSave: Signal<boolean>;
  /** Why saving is not possible now, for a tooltip; null when it is */
  readonly cannotSaveReason: Signal<string | null>;
  /** The filled slots, the autosave first, then the manual ones in their order */
  readonly slots: Signal<readonly SaveSlotInfo[]>;
  /** An autosave exists: the start screen offers "Continue" */
  readonly hasAutosave: Signal<boolean>;
  /** Read the slots again from storage (the list fills on its own at start) */
  refresh(): Promise<void>;
  /** Save the run into a manual slot; `name` defaults to place and wave */
  save(slotId: string, name?: string): Promise<SaveResult>;
  /** Load a slot: the place loads from the save, the run stands before its next wave */
  load(slotId: string): Promise<LoadResult>;
  deleteSlot(slotId: string): Promise<void>;
  /** Download a slot as a file */
  exportFile(slotId: string): Promise<SaveResult>;
  /** Load a run from a file the player picked */
  importFile(file: File): Promise<LoadResult>;
  /** Load the autosave */
  continueAutosave(): Promise<LoadResult>;
}

const NOT_BUILT = 'Saving is not built yet.';

/** Until the real one is in place: nothing saved, nothing to load (the menu can be built against it) */
export class SaveGameStub implements SaveGamePort {
  readonly canSave = signal(false).asReadonly();
  readonly cannotSaveReason = signal<string | null>(NOT_BUILT).asReadonly();
  readonly slots = signal<readonly SaveSlotInfo[]>([]).asReadonly();
  readonly hasAutosave = signal(false).asReadonly();

  async refresh(): Promise<void> {
    // Nothing stored
  }
  async save(): Promise<SaveResult> {
    return { ok: false, reason: NOT_BUILT };
  }
  async load(): Promise<LoadResult> {
    return { ok: false, reason: NOT_BUILT };
  }
  async deleteSlot(): Promise<void> {
    // Nothing stored
  }
  async exportFile(): Promise<SaveResult> {
    return { ok: false, reason: NOT_BUILT };
  }
  async importFile(): Promise<LoadResult> {
    return { ok: false, reason: NOT_BUILT };
  }
  async continueAutosave(): Promise<LoadResult> {
    return { ok: false, reason: NOT_BUILT };
  }
}

/** The save game the UI injects */
export const SAVE_GAME = new InjectionToken<SaveGamePort>('SaveGame', {
  providedIn: 'root',
  factory: () => new SaveGameStub(),
});
