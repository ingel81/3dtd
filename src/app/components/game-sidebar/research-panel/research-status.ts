import { getResearch } from '../../../configs/research/research-tree.config';
import { ActiveResearch, ResearchConfig, ResearchId } from '../../../configs/research/research.types';

export type ResearchStatus = 'completed' | 'active' | 'available' | 'locked';

/** Status eines Knotens im Forschungsbaum, abgeleitet aus dem Research-Store. */
export function researchStatus(
  id: ResearchId,
  completed: ReadonlySet<ResearchId>,
  active: readonly ActiveResearch[],
): ResearchStatus {
  if (completed.has(id)) return 'completed';
  if (active.some(a => a.researchId === id)) return 'active';
  const config = getResearch(id);
  if (!config) return 'locked';
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
  if (status === 'locked') return 'lock';
  return research.icon; // td-icon name set in research-tree.config
}

/** Namen der noch fehlenden Voraussetzungen, kommagetrennt. */
export function missingPrereqNames(id: ResearchId, completed: ReadonlySet<ResearchId>): string {
  const config = getResearch(id);
  if (!config) return '';
  const missing = config.prerequisites
    .filter(p => !completed.has(p))
    .map(p => getResearch(p)?.name ?? p);
  return missing.join(', ');
}
