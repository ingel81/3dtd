import { describe, expect, it } from 'vitest';
import { loadSlotRows, saveSlotRows, slotDetail, slotWhen } from './save-slots';
import { AUTOSAVE_SLOT, manualSlotId, type SaveSlotInfo } from '../../services/save-game/save-game.port';

const slot = (id: string, name: string, wave: number, savedAt = '2026-10-05T14:32:00'): SaveSlotInfo => ({
  id, name, wave, savedAt,
  autosave: id === AUTOSAVE_SLOT,
  location: 'Heilbronn',
  gameVersion: '0.6.0',
  note: null,
});

describe('save slots of the game menu', () => {
  it('words a slot as wave and place, the time apart so a long place cannot cut it', () => {
    expect(slotDetail(slot('slot-1', 'x', 7))).toBe('Wave 7 · Heilbronn');
    expect(slotWhen(slot('slot-1', 'x', 7))).toBe('5 Oct, 14:32');
    expect(slotWhen(slot('slot-1', 'x', 7, 'not a date'))).toBe('');
    expect(slotDetail({ ...slot('slot-1', 'x', 2), location: 'Hauptstraße 51, Bad Wimpfen, Deutschland' })).toBe('Wave 2 · Bad Wimpfen');
  });

  it('Save shows every manual slot, empty or filled', () => {
    const rows = saveSlotRows([slot(manualSlotId(3), 'Mine', 4), slot(AUTOSAVE_SLOT, 'auto', 6)], 4);
    expect(rows.map((r) => [r.id, r.title, r.filled])).toEqual([
      ['slot-1', 'Slot 1', false],
      ['slot-2', 'Slot 2', false],
      ['slot-3', 'Mine', true],
      ['slot-4', 'Slot 4', false],
    ]);
    expect(rows[0].detail).toBe('Empty');
  });

  it('Load shows the filled slots, the autosave first and named so', () => {
    const rows = loadSlotRows([slot(manualSlotId(1), 'Mine', 4), slot(AUTOSAVE_SLOT, 'auto', 6)]);
    expect(rows.map((r) => [r.id, r.title, r.autosave])).toEqual([
      ['autosave', 'Autosave', true],
      ['slot-1', 'Mine', false],
    ]);
  });
});
