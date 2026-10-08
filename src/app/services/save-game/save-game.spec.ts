import { describe, it, expect, vi } from 'vitest';
import { signal } from '@angular/core';
import { SaveGame, type SaveGameHost } from './save-game';
import { AUTOSAVE_SLOT, manualSlotId } from './save-game.port';
import { UNREADABLE, type SaveSlotStore, type StoredSlotMeta } from './save-slot.store';
import { buildWorldPackage } from '../../coop/world-package';
import { emptySimSnapshot } from '../../../test/sim-snapshot-fixture';
import { MAX_SAVE_FILE_BYTES, type SaveFile, type SaveParts } from '../../simulator/save-file';
import { replayFileBlob } from '../../simulator/replay-file';

/**
 * The slots, names, notes and order of the save game (TODO E110), on a
 * store in memory and a stand-in game. What goes into a save and how it is
 * put back is the acceptance spec's (integration/save-resume).
 */

const HERE = { gameVersion: '0.7.0', configHash: 'abc' };

class MemoryStore implements SaveSlotStore {
  readonly meta = new Map<string, StoredSlotMeta>();
  readonly text = new Map<string, string>();
  async list(): Promise<StoredSlotMeta[]> {
    return [...this.meta.values()];
  }
  /** Slots the browser would not hand out */
  readonly unreadable = new Set<string>();
  async read(id: string): Promise<string | null | typeof UNREADABLE> {
    return this.unreadable.has(id) ? UNREADABLE : this.text.get(id) ?? null;
  }
  async write(meta: StoredSlotMeta, text: string): Promise<boolean> {
    this.meta.set(meta.id, meta);
    this.text.set(meta.id, text);
    return true;
  }
  async remove(id: string): Promise<void> {
    this.meta.delete(id);
    this.text.delete(id);
  }
}

function parts(wave: number): Omit<SaveParts, 'name'> {
  const hq = { lat: 49.1, lon: 9.2 };
  const spawn = { id: 'spawn-1', name: 'Spawn 1', lat: 49.11, lon: 9.21 };
  return {
    ...HERE,
    commit: 'c0ffee',
    wave,
    place: { name: 'Heilbronn', hq, spawns: [{ lat: spawn.lat, lon: spawn.lon }] },
    world: buildWorldPackage({
      origin: hq, hq, spawns: [spawn], paths: new Map([['spawn-1', [{ lat: spawn.lat, lon: spawn.lon }, hq]]]),
      heights: [[1, 2.5, 1]], worldKey: 'w1',
    }, HERE),
    sim: emptySimSnapshot(wave - 1),
    director: { source: 'budget', sourceState: null, planned: null },
    mainRng: { seed: 1, streams: {} },
    runLog: null,
    waveSeries: [],
  };
}

function setup() {
  const store = new MemoryStore();
  const saveBlocked = signal<string | null>(null);
  const loadBlocked = signal<string | null>(null);
  let wave = 4;
  const applied: SaveFile[] = [];
  const host: SaveGameHost = {
    saveBlocked,
    loadBlocked,
    collect: vi.fn(async () => parts(wave)),
    apply: vi.fn(async (file: SaveFile) => {
      applied.push(file);
      return null;
    }),
    download: vi.fn(),
  };
  const game = new SaveGame(host, store, HERE);
  return { game, store, host, saveBlocked, loadBlocked, applied, setWave: (w: number) => { wave = w; } };
}

describe('SaveGame (TODO E110)', () => {
  it('saves into a slot, names it after place and wave, lists the autosave first', async () => {
    const { game, setWave } = setup();
    await game.save(manualSlotId(2), '  Before the boss  ');
    setWave(7);
    await game.save(manualSlotId(1));
    expect(await game.autosave()).toBe(true);
    expect(game.slots().map((s) => [s.id, s.name, s.wave, s.autosave, s.note])).toEqual([
      [AUTOSAVE_SLOT, 'Heilbronn, wave 7', 7, true, null],
      [manualSlotId(1), 'Heilbronn, wave 7', 7, false, null],
      [manualSlotId(2), 'Before the boss', 4, false, null],
    ]);
    expect(game.hasAutosave()).toBe(true);
    expect(game.slots()[0].location).toBe('Heilbronn');
  });

  it('keeps the HQ of the place with the slot; a slot from before it was kept has none and still lists (E120)', async () => {
    const { game, store } = setup();
    await game.save(manualSlotId(1));
    expect(store.meta.get(manualSlotId(1))!.hq).toEqual({ lat: 49.1, lon: 9.2 });
    expect(game.slots()[0].hq).toEqual({ lat: 49.1, lon: 9.2 });

    const { hq: _hq, ...older } = store.meta.get(manualSlotId(1))!;
    await store.write(older, store.text.get(manualSlotId(1))!);
    await game.refresh();
    expect(game.slots()[0].hq).toBeNull();
    expect(await game.load(manualSlotId(1))).toEqual({ ok: true, note: null });
  });

  it('saves nothing while the game says no, and only into its own slots', async () => {
    const { game, saveBlocked, host } = setup();
    saveBlocked.set('Saving works only between waves.');
    expect(game.canSave()).toBe(false);
    expect(game.cannotSaveReason()).toBe('Saving works only between waves.');
    expect(await game.save(manualSlotId(1))).toEqual({ ok: false, reason: 'Saving works only between waves.' });
    expect(await game.autosave()).toBe(false);
    expect(host.collect).not.toHaveBeenCalled();
    saveBlocked.set(null);
    expect(game.canSave()).toBe(true);
    expect((await game.save(AUTOSAVE_SLOT)).ok).toBe(false);
    expect((await game.save('slot-99')).ok).toBe(false);
    expect(game.slots()).toEqual([]);
  });

  it('says so when the simulation would not give its state', async () => {
    const { game, host } = setup();
    vi.mocked(host.collect).mockResolvedValueOnce(null);
    expect(await game.save(manualSlotId(1))).toEqual({ ok: false, reason: 'Saving works only between waves.' });
  });

  it('loads a slot through the game, with a note for another version; an empty slot and coop say why not', async () => {
    const { game, store, applied, loadBlocked } = setup();
    await game.save(manualSlotId(1));
    expect(await game.load(manualSlotId(1))).toEqual({ ok: true, note: null });
    expect(applied[0].wave).toBe(4);
    expect(await game.continueAutosave()).toEqual({ ok: false, reason: 'That slot is empty.' });

    const older = JSON.parse(store.text.get(manualSlotId(1))!) as SaveFile;
    await store.write({ ...store.meta.get(manualSlotId(1))!, gameVersion: '0.6.0' }, JSON.stringify({ ...older, gameVersion: '0.6.0' }));
    await game.refresh();
    expect(game.slots()[0].note).toBe('Saved with version 0.6.0, this is 0.7.0: values may differ.');
    expect(await game.load(manualSlotId(1))).toEqual({ ok: true, note: 'Saved with version 0.6.0, this is 0.7.0: values may differ.' });

    loadBlocked.set('Loading is off in co-op.');
    expect(await game.load(manualSlotId(1))).toEqual({ ok: false, reason: 'Loading is off in co-op.' });
  });

  it('passes on why the game could not load it', async () => {
    const { game, host } = setup();
    await game.save(manualSlotId(1));
    vi.mocked(host.apply).mockResolvedValueOnce('The place of the save did not load.');
    expect(await game.load(manualSlotId(1))).toEqual({ ok: false, reason: 'The place of the save did not load.' });
    // A load that throws on its way says so as well, and the next one still runs
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(host.apply).mockRejectedValueOnce(new Error('worker gone'));
    expect(await game.load(manualSlotId(1))).toEqual({ ok: false, reason: 'The save could not be loaded.' });
    expect(await game.load(manualSlotId(1))).toMatchObject({ ok: true });
  });

  it('says when the browser would not hand out a slot, apart from an empty one', async () => {
    const { game, store } = setup();
    await game.save(manualSlotId(2));
    store.unreadable.add(manualSlotId(2));
    expect(await game.load(manualSlotId(2))).toEqual({
      ok: false, reason: 'This browser could not read the save (storage blocked or unavailable).',
    });
    expect(await game.load(manualSlotId(4))).toEqual({ ok: false, reason: 'That slot is empty.' });
  });

  it('refuses a small gzip that unpacks past the cap, before it parses anything', async () => {
    const { game, applied } = setup();
    const bomb = await replayFileBlob(' '.repeat(MAX_SAVE_FILE_BYTES + 1024));
    expect(bomb.size).toBeLessThan(1024 * 1024);
    expect(await game.importFile(new File([await bomb.arrayBuffer()], 'save.json.gz'))).toEqual({ ok: false, reason: 'That file is far too big for a 3DTD save.' });
    expect(applied).toHaveLength(0);
  });

  it('exports a slot as a gzipped file that imports again, and refuses what is no save', async () => {
    const { game, host, applied } = setup();
    await game.save(manualSlotId(3));
    expect(await game.exportFile(manualSlotId(3))).toEqual({ ok: true });
    const [blob, name] = vi.mocked(host.download).mock.calls[0];
    expect(name).toBe('3dtd-save-heilbronn-w4.json.gz');
    const file = new File([await blob.arrayBuffer()], name);
    expect(await game.importFile(file)).toEqual({ ok: true, note: null });
    expect(applied.at(-1)?.place.name).toBe('Heilbronn');
    expect(await game.importFile(new File(['{"format":"x"}'], 'x.json'))).toEqual({ ok: false, reason: 'That file is no 3DTD save.' });
    expect(await game.exportFile(manualSlotId(4))).toEqual({ ok: false, reason: 'That slot is empty.' });
  });

  it('deletes a slot', async () => {
    const { game } = setup();
    await game.save(manualSlotId(1));
    await game.deleteSlot(manualSlotId(1));
    expect(game.slots()).toEqual([]);
  });
});
