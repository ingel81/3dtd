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

/**
 * The slots written after every wave on their own, one per world: each world
 * keeps its own run to continue (docs/WORLDS_STATE_PLAN.md, 3.2). The real
 * places', OpenStreetMap's and the Built Worlds'.
 */
export const AUTOSAVE_SLOT = 'autosave';
export const AUTOSAVE_OSM_SLOT = 'autosave-osm';
export const AUTOSAVE_BUILT_SLOT = 'autosave-built';
export const AUTOSAVE_SLOTS: readonly string[] = [AUTOSAVE_SLOT, AUTOSAVE_OSM_SLOT, AUTOSAVE_BUILT_SLOT];
/** Before each world had its own: OpenStreetMap and the maps shared it; moved to AUTOSAVE_BUILT_SLOT once (WatchedSlotStore) */
export const LEGACY_AUTOSAVE_MAP_SLOT = 'autosave-map';

/** The worlds of the globes, as a slot names its own (worlds/world-rules.ts WorldId) */
export type SlotWorld = 'real' | 'osm' | 'maps';
/** The slots the player saves to by hand: slot-1 to slot-N */
export const MANUAL_SLOT_COUNT = 5;
export const manualSlotId = (n: number): string => `slot-${n}`;

/** One filled slot, for the menu's list */
export interface SaveSlotInfo {
  /** One of AUTOSAVE_SLOTS or manualSlotId(n) */
  id: string;
  /** The world the run plays in: the autosave's own, else as kept with the save; null for DevWorld */
  world: SlotWorld | null;
  /** The player's name for it, or the place and wave when they gave none */
  name: string;
  autosave: boolean;
  /** The wave the run stands before: the next start is this wave */
  wave: number;
  /** The place, as the location picker names it */
  location: string;
  /** The place's HQ; null for a slot saved before it was kept */
  hq: { lat: number; lon: number } | null;
  /** The custom map the run plays on; null on a real place (and for slots saved before it was kept) */
  map: { id: string; name: string } | null;
  /** When it was saved, ISO 8601 */
  savedAt: string;
  /** The game version (BUILD_VERSION) it was saved with */
  gameVersion: string;
  /** Saved with another version: loads, but values may differ (null when it is this version) */
  note: string | null;
}

/**
 * The place a load waits for at a start without one: the menu hands it to
 * the start (LocationChangeCoordinatorService.choosePlace, as the place of a
 * coop host), the boot loads it, and the load goes on there.
 */
export interface StartPlace {
  hq: { lat: number; lon: number };
  spawns: { lat: number; lon: number }[];
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
  /** A load at a start without a place waits for the menu to hand this one to the start; null otherwise */
  readonly startPlace: Signal<StartPlace | null>;
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
  /** A new run starts here (Restart): its autosave goes to its world's slot again, not to the one it was loaded from */
  newRun(): void;
  /**
   * Write this world's autosave now, between waves (the map editor opens and the run waits as it,
   * docs/WORLDS_NAVIGATION_PLAN.md decision 2); false when nothing was written (in a wave, no such world)
   */
  autosaveNow(): Promise<boolean>;
}

const NOT_BUILT = 'Saving is not built yet.';

/** Until the real one is in place: nothing saved, nothing to load (the menu can be built against it) */
export class SaveGameStub implements SaveGamePort {
  readonly canSave = signal(false).asReadonly();
  readonly cannotSaveReason = signal<string | null>(NOT_BUILT).asReadonly();
  readonly slots = signal<readonly SaveSlotInfo[]>([]).asReadonly();
  readonly hasAutosave = signal(false).asReadonly();
  readonly startPlace = signal<StartPlace | null>(null).asReadonly();

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
  async autosaveNow(): Promise<boolean> {
    return false;
  }
  async importFile(): Promise<LoadResult> {
    return { ok: false, reason: NOT_BUILT };
  }
  async continueAutosave(): Promise<LoadResult> {
    return { ok: false, reason: NOT_BUILT };
  }
  newRun(): void {
    // Nothing kept
  }
}

/** The save game the UI injects */
export const SAVE_GAME = new InjectionToken<SaveGamePort>('SaveGame', {
  providedIn: 'root',
  factory: () => new SaveGameStub(),
});
