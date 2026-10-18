import { getResearch } from '../../../configs/research/research-tree.config';
import {
  ActiveResearch, ResearchConfig, ResearchId, researchWaitsForWave,
} from '../../../configs/research/research.types';
import type { Messages } from '../../../i18n/messages/en';
import { researchName } from '../../../i18n/lookups';

export type ResearchStatus = 'completed' | 'active' | 'queued' | 'available' | 'locked';

/**
 * Status eines Knotens im Forschungsbaum, abgeleitet aus dem Research-Store.
 * `wave` ist die Welle des Laufs für die Forschung (researchWave); vor seiner
 * `minWave` ist ein Knoten gesperrt wie ohne Voraussetzungen.
 */
export function researchStatus(
  id: ResearchId,
  completed: ReadonlySet<ResearchId>,
  active: readonly ActiveResearch[],
  queued: readonly ResearchId[],
  wave: number,
): ResearchStatus {
  if (completed.has(id)) return 'completed';
  if (active.some(a => a.researchId === id)) return 'active';
  if (queued.includes(id)) return 'queued';
  const config = getResearch(id);
  if (!config || researchWaitsForWave(config, wave) !== null) return 'locked';
  const allPrereqsMet = config.prerequisites.every(p => completed.has(p));
  return allPrereqsMet ? 'available' : 'locked';
}

/**
 * Resolve the td-icon name for a research node based on its current status.
 * Status icons override the per-research config; available nodes use config.
 */
export function researchNodeIcon(research: ResearchConfig, status: ResearchStatus): string {
  if (status === 'completed') return 'check';
  if (status === 'active') return 'refresh';
  if (status === 'queued') return 'layers';
  if (status === 'locked') return 'lock';
  return research.icon; // td-icon name set in research-tree.config
}

/** Fortschritt 0..1 einer laufenden Forschung. */
export function researchProgress(duration: number, elapsed: number): number {
  return Math.min(1, elapsed / duration);
}

/** Verbleibende Spielzeit (s) einer laufenden Forschung. */
export function researchRemaining(duration: number, elapsed: number): number {
  return Math.max(0, duration - elapsed);
}

/** Namen der noch fehlenden Voraussetzungen, kommagetrennt. */
export function missingPrereqNames(t: Messages, id: ResearchId, completed: ReadonlySet<ResearchId>): string {
  const config = getResearch(id);
  if (!config) return '';
  const missing = config.prerequisites
    .filter(p => !completed.has(p))
    .map(p => researchName(t, p));
  return missing.join(', ');
}
