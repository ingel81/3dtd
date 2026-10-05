import { computed, signal, type Signal } from '@angular/core';
import {
  AUTOSAVE_SLOT,
  MANUAL_SLOT_COUNT,
  manualSlotId,
  type LoadResult,
  type SaveGamePort,
  type SaveResult,
  type SaveSlotInfo,
} from './save-game.port';
import type { SaveSlotStore, StoredSlotMeta } from './save-slot.store';
import {
  MAX_SAVE_FILE_BYTES,
  buildSaveFile,
  readSaveFile,
  saveFileName,
  saveFileRefusalText,
  saveNote,
  type SaveFile,
  type SaveParts,
} from '../../simulator/save-file';
import { replayFileBlob, replayFileText } from '../../simulator/replay-file';

/** What the save game needs of the running game; SaveGameService fills it, specs stand in */
export interface SaveGameHost {
  /** Why saving is not possible now, null when it is; read in a computed, so from signals */
  readonly saveBlocked: Signal<string | null>;
  /** Why loading is not possible now (coop), null when it is */
  readonly loadBlocked: Signal<string | null>;
  /** The run between the waves; null when the simulation said no (a wave started meanwhile) */
  collect(): Promise<Omit<SaveParts, 'name'> | null>;
  /** Put the save in place: place, world, simulation, director, run log; the reason when it failed */
  apply(file: SaveFile): Promise<string | null>;
  download(blob: Blob, fileName: string): void;
}

const ORDER = [AUTOSAVE_SLOT, ...Array.from({ length: MANUAL_SLOT_COUNT }, (_, i) => manualSlotId(i + 1))];
const isManual = (id: string): boolean => ORDER.indexOf(id) > 0;

/**
 * Saving and loading a single-player run (docs/SAVE_LOAD_PLAN.md, TODO
 * E110): the slots in this browser, a file out and in, the autosave after
 * every wave. What a save holds and how it is put back is the host's; this
 * part is the slots, the names, the notes and one action at a time. The
 * port's startPlace is the game's (SaveGameService).
 */
export class SaveGame implements Omit<SaveGamePort, 'startPlace'> {
  private readonly stored = signal<readonly StoredSlotMeta[]>([]);
  /** A save or load in flight: a second one waits its turn */
  private busy: Promise<unknown> = Promise.resolve();

  readonly cannotSaveReason: Signal<string | null>;
  readonly canSave: Signal<boolean>;
  readonly slots: Signal<readonly SaveSlotInfo[]>;
  readonly hasAutosave: Signal<boolean>;

  constructor(
    private readonly host: SaveGameHost,
    private readonly store: SaveSlotStore,
    private readonly here: { gameVersion: string; configHash: string },
  ) {
    this.cannotSaveReason = computed(() => host.saveBlocked());
    this.canSave = computed(() => this.cannotSaveReason() === null);
    this.slots = computed(() => [...this.stored()]
      .filter((meta) => ORDER.includes(meta.id))
      .sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id))
      .map((meta) => this.info(meta)));
    this.hasAutosave = computed(() => this.stored().some((meta) => meta.id === AUTOSAVE_SLOT));
    void this.refresh();
  }

  async refresh(): Promise<void> {
    this.stored.set(await this.store.list());
  }

  save(slotId: string, name?: string): Promise<SaveResult> {
    if (!isManual(slotId)) return Promise.resolve({ ok: false, reason: 'There is no such slot.' });
    return this.queue(() => this.write(slotId, name));
  }

  /** After a wave: the autosave slot, quietly; false when nothing was written */
  async autosave(): Promise<boolean> {
    const result = await this.queue(() => this.write(AUTOSAVE_SLOT));
    return result.ok;
  }

  load(slotId: string): Promise<LoadResult> {
    return this.queue(async () => {
      const blocked = this.host.loadBlocked();
      if (blocked) return { ok: false, reason: blocked };
      const text = await this.store.read(slotId);
      if (text === null) return { ok: false, reason: 'That slot is empty.' };
      return this.loadText(text);
    });
  }

  continueAutosave(): Promise<LoadResult> {
    return this.load(AUTOSAVE_SLOT);
  }

  async deleteSlot(slotId: string): Promise<void> {
    await this.store.remove(slotId);
    await this.refresh();
  }

  async exportFile(slotId: string): Promise<SaveResult> {
    const text = await this.store.read(slotId);
    const meta = this.stored().find((m) => m.id === slotId);
    if (text === null || !meta) return { ok: false, reason: 'That slot is empty.' };
    const blob = await replayFileBlob(text);
    this.host.download(blob, saveFileName(meta.location, meta.wave));
    return { ok: true };
  }

  importFile(file: File): Promise<LoadResult> {
    return this.queue(async () => {
      const blocked = this.host.loadBlocked();
      if (blocked) return { ok: false, reason: blocked };
      if (file.size > MAX_SAVE_FILE_BYTES) return { ok: false, reason: saveFileRefusalText('too-big') };
      const text = await replayFileText(file, MAX_SAVE_FILE_BYTES);
      if (text === 'too-big') return { ok: false, reason: saveFileRefusalText('too-big') };
      if (text === 'not-a-replay') return { ok: false, reason: saveFileRefusalText('not-a-save') };
      return this.loadText(text);
    });
  }

  private async write(slotId: string, name?: string): Promise<SaveResult> {
    const blocked = this.host.saveBlocked();
    if (blocked) return { ok: false, reason: blocked };
    const parts = await this.host.collect();
    if (!parts) return { ok: false, reason: 'Saving works only between waves.' };
    const file = buildSaveFile({ ...parts, name: name?.trim() || `${parts.place.name}, wave ${parts.wave}` });
    const meta: StoredSlotMeta = {
      id: slotId,
      name: file.name,
      wave: file.wave,
      location: file.place.name,
      savedAt: file.createdAt,
      gameVersion: file.gameVersion,
      configHash: file.configHash,
    };
    const written = await this.store.write(meta, JSON.stringify(file));
    await this.refresh();
    return written ? { ok: true } : { ok: false, reason: 'This browser did not keep the save (storage full or blocked).' };
  }

  private async loadText(text: string): Promise<LoadResult> {
    const read = readSaveFile(text, this.here);
    if (read.refusal !== null) return { ok: false, reason: saveFileRefusalText(read.refusal) };
    const failed = await this.host.apply(read.file);
    return failed ? { ok: false, reason: failed } : { ok: true, note: read.note };
  }

  private info(meta: StoredSlotMeta): SaveSlotInfo {
    return {
      id: meta.id,
      name: meta.name,
      autosave: meta.id === AUTOSAVE_SLOT,
      wave: meta.wave,
      location: meta.location,
      savedAt: meta.savedAt,
      gameVersion: meta.gameVersion,
      note: saveNote(meta, this.here),
    };
  }

  /** One save or load after the other: a load must not see a save half written */
  private queue<T>(run: () => Promise<T>): Promise<T> {
    const next = this.busy.then(run, run);
    this.busy = next.catch(() => undefined);
    return next;
  }
}
