import { MANUAL_SLOT_COUNT, manualSlotId, type SaveSlotInfo } from '../../../../services/save-game/save-game.port';
import { shortPlaceName } from '../../../../services/save-game/slot-name';
import type { Messages } from '../../../../i18n/messages/en';
import { say } from '../../../../i18n/said';

/**
 * The slot lists of the menu's Save and Load pages (docs/SAVE_LOAD_PLAN.md): Save shows every
 * manual slot, empty or not; Load shows the filled ones, the autosave first.
 * Pure, so the spec reads the lines the pages show.
 */

/** One line of a slot list */
export interface SlotRow {
  id: string;
  /** "Slot 2" for an empty one, the save's name otherwise; "Autosave | Real places" for a world's autosave */
  title: string;
  /** "Wave 7 | Heilbronn"; "Empty" for an empty slot */
  detail: string;
  /** "5 Oct, 14:32", beside the title so a long place cannot cut it; "" for an empty slot or a broken date */
  when: string;
  filled: boolean;
  autosave: boolean;
  /** Saved with another game version (SaveSlotInfo.note) */
  note: string | null;
}

/** "Wave 7 | Heilbronn", the town of the saved place */
export function slotDetail(t: Messages, info: SaveSlotInfo): string {
  return [t.saves.wave(info.wave), shortPlaceName(info.location)].filter((part) => part !== '').join(' | ');
}

/** "5 Oct, 14:32"; "" for a broken date */
export function slotWhen(t: Messages, info: SaveSlotInfo): string {
  const saved = new Date(info.savedAt);
  return Number.isNaN(saved.getTime()) ? '' : t.saves.when(saved);
}

function rowOf(t: Messages, info: SaveSlotInfo): SlotRow {
  return {
    id: info.id,
    title: info.autosave ? (info.world ? t.saves.autosaveOf(t.worlds.names[info.world]) : t.saves.autosave) : info.name,
    detail: slotDetail(t, info),
    when: slotWhen(t, info),
    filled: true,
    autosave: info.autosave,
    note: info.note ? say(t.saves.note, info.note) : null,
  };
}

/** Save: the manual slots in order, each filled or empty */
export function saveSlotRows(t: Messages, slots: readonly SaveSlotInfo[], count = MANUAL_SLOT_COUNT): SlotRow[] {
  return Array.from({ length: count }, (_, i) => {
    const id = manualSlotId(i + 1);
    const info = slots.find((slot) => slot.id === id);
    return info
      ? rowOf(t, info)
      : { id, title: t.saves.slot(i + 1), detail: t.saves.empty, when: '', filled: false, autosave: false, note: null };
  });
}

/** Load: the filled slots, the autosaves first (one per world, each a Continue), as the port lists them */
export function loadSlotRows(t: Messages, slots: readonly SaveSlotInfo[]): SlotRow[] {
  return [...slots].sort((a, b) => Number(b.autosave) - Number(a.autosave)).map((info) => rowOf(t, info));
}
