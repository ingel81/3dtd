import { en } from '../../../i18n/messages/en';
import { say } from '../../../i18n/said';
import type { SaveNote, SaveRefusal } from '../save-game.port';

/** A save game's answer with its reason and note in English, as a spec compares them */
export function english<T extends object>(result: T): T {
  const r = result as { reason?: SaveRefusal; note?: SaveNote | null };
  return {
    ...result,
    ...(r.reason ? { reason: say(en.saves.refusal, r.reason) } : {}),
    ...(r.note ? { note: say(en.saves.note, r.note) } : {}),
  };
}
