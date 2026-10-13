import { MAX_MAP_BYTES } from '../../coop/protocol';

/**
 * What a map spends of its budget, for the Map panel: objects against what
 * keeps a map fluid (docs/SHOWCASE_LEVELS.md), the file against what a coop
 * room can send (MAX_MAP_BYTES).
 */

/** Objects a map holds at most and stays fluid (docs/SHOWCASE_LEVELS.md, Leistung) */
export const OBJECT_BUDGET = 15_000;

/** From this share on a line shows as a warning */
const WARN_SHARE = 0.8;

export interface BudgetLine {
  label: string;
  /** What is spent of what, as text */
  text: string;
  /** Share spent, 0 to 1 and above */
  share: number;
  state: 'ok' | 'warn' | 'over';
}

function line(label: string, used: number, limit: number, text: string): BudgetLine {
  const share = used / limit;
  return { label, text, share, state: share > 1 ? 'over' : share >= WARN_SHARE ? 'warn' : 'ok' };
}

function mb(bytes: number): string {
  return `${(bytes / 2 ** 20).toFixed(1)} MB`;
}

/** The budget lines; the file line only once its size is known (packed at a save) */
export function mapBudget(objects: number, fileBytes: number | null): BudgetLine[] {
  const lines = [line('Objects', objects, OBJECT_BUDGET, `${objects.toLocaleString('en-US')} of ${OBJECT_BUDGET.toLocaleString('en-US')}`)];
  if (fileBytes !== null) lines.push(line('File', fileBytes, MAX_MAP_BYTES, `${mb(fileBytes)} of ${mb(MAX_MAP_BYTES)}`));
  return lines;
}
