import { MANUAL_SLOT_COUNT, manualSlotId, type SaveSlotInfo } from '../../services/save-game/save-game.port';
import { shortPlaceName } from '../../services/save-game/slot-name';

/**
 * The slot lists of the game menu (docs/SAVE_LOAD_PLAN.md): Save shows every
 * manual slot, empty or not; Load shows the filled ones, the autosave first.
 * Pure, so the spec reads the lines the menu shows.
 */

/** One line of a slot list */
export interface SlotRow {
  id: string;
  /** "Slot 2" for an empty one, the save's name otherwise; "Autosave" for the autosave */
  title: string;
  /** "Wave 7 · Heilbronn"; "Empty" for an empty slot */
  detail: string;
  /** "5 Oct, 14:32", beside the title so a long place cannot cut it; "" for an empty slot or a broken date */
  when: string;
  filled: boolean;
  autosave: boolean;
  /** Saved with another game version (SaveSlotInfo.note) */
  note: string | null;
}

const WHEN = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** "Wave 7 · Heilbronn", the town of the saved place */
export function slotDetail(info: SaveSlotInfo): string {
  return [`Wave ${info.wave}`, shortPlaceName(info.location)].filter((part) => part !== '').join(' · ');
}

/** "5 Oct, 14:32"; "" for a broken date */
export function slotWhen(info: SaveSlotInfo): string {
  const saved = new Date(info.savedAt);
  return Number.isNaN(saved.getTime()) ? '' : WHEN.format(saved);
}

function rowOf(info: SaveSlotInfo): SlotRow {
  return {
    id: info.id,
    title: info.autosave ? 'Autosave' : info.name,
    detail: slotDetail(info),
    when: slotWhen(info),
    filled: true,
    autosave: info.autosave,
    note: info.note,
  };
}

/** Save: the manual slots in order, each filled or empty */
export function saveSlotRows(slots: readonly SaveSlotInfo[], count = MANUAL_SLOT_COUNT): SlotRow[] {
  return Array.from({ length: count }, (_, i) => {
    const id = manualSlotId(i + 1);
    const info = slots.find((slot) => slot.id === id);
    return info
      ? rowOf(info)
      : { id, title: `Slot ${i + 1}`, detail: 'Empty', when: '', filled: false, autosave: false, note: null };
  });
}

/** Load: the filled slots, the autosave first, as the port lists them */
export function loadSlotRows(slots: readonly SaveSlotInfo[]): SlotRow[] {
  return [...slots].sort((a, b) => Number(b.autosave) - Number(a.autosave)).map(rowOf);
}
