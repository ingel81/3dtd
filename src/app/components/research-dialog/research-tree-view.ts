/**
 * Maps the research tree onto what the tech tree component draws: one node per
 * research, one edge per prerequisite, plus the state and the line under the
 * title.
 *
 * Pure, so the whole mapping can be tested without a DOM or a dialog. The
 * state itself comes from `research-status.ts`, which the sidebar has used all
 * along; nothing about it is new here.
 */
import { RESEARCH_TREE, getResearch } from '../../configs/research/research-tree.config';
import type { ResearchConfig, ResearchId } from '../../configs/research/research.types';
import type { ActiveResearch } from '../../configs/research/research.types';
import type { DagEdge } from '../../utils/dag-layout';
import type { TdIconName } from '../icon/icon.component';
import type { TechTreeNode } from '../tech-tree/tech-tree-view';
import {
  missingPrereqNames,
  researchNodeIcon,
  researchStatus,
  type ResearchStatus,
} from '../game-sidebar/research-panel/research-status';

export interface ResearchTreeState {
  completed: ReadonlySet<ResearchId>;
  active: readonly ActiveResearch[];
  queued: readonly ResearchId[];
  /** Game time each active research has run, to fill its bar. */
  elapsed: ReadonlyMap<ResearchId, number>;
  credits: number;
  availableSlots: number;
}

/** Every research as a node, in config order; the layout decides the places. */
export function buildResearchNodes(state: ResearchTreeState): TechTreeNode[] {
  return Object.values(RESEARCH_TREE).map((research) => {
    const status = researchStatus(research.id, state.completed, state.active, state.queued);
    return {
      id: research.id,
      title: research.name,
      subtitle: subtitleOf(research, status, state),
      // The status icon wins over the config icon, as in the sidebar: a check
      // for completed, a lock for locked and so on.
      icon: researchNodeIcon(research, status) as TdIconName,
      state: status,
      progress: status === 'active' ? progressOf(research, state) : undefined,
      badge: status === 'queued' ? String(state.queued.indexOf(research.id) + 1) : undefined,
      hint: hintOf(research, status, state),
    };
  });
}

/** One edge per prerequisite. A research with two of them gets two. */
export function buildResearchEdges(): DagEdge[] {
  return Object.values(RESEARCH_TREE).flatMap((research) =>
    research.prerequisites.map((prerequisite) => ({ from: prerequisite, to: research.id })),
  );
}

/**
 * What a click on a node should do. The dialog turns this into a command; it
 * lives here so the rule is testable and stays in one place.
 *
 * `start` only when a slot is free and the credits are there, since that is
 * what the manager accepts. Otherwise the node goes into the queue, which is
 * exactly what waiting for a slot is for. A queued node is taken out again,
 * and a locked or running one does nothing: its tooltip already says why.
 */
export function researchClickAction(
  id: ResearchId,
  state: ResearchTreeState,
): 'start' | 'queue' | 'unqueue' | 'none' {
  const research = getResearch(id);
  if (!research) return 'none';
  switch (researchStatus(id, state.completed, state.active, state.queued)) {
    case 'available':
      return state.credits >= research.cost && state.availableSlots > 0 ? 'start' : 'queue';
    case 'queued':
      return 'unqueue';
    default:
      return 'none';
  }
}

function subtitleOf(research: ResearchConfig, status: ResearchStatus, state: ResearchTreeState): string {
  switch (status) {
    case 'completed':
      return 'Completed';
    case 'active':
      return `${Math.ceil(remainingOf(research, state))}s left`;
    case 'queued':
      return `${research.cost} at start`;
    default:
      return `${research.cost} · ${research.duration}s`;
  }
}

function hintOf(research: ResearchConfig, status: ResearchStatus, state: ResearchTreeState): string {
  switch (status) {
    case 'locked':
      return `Requires: ${missingPrereqNames(research.id, state.completed)}`;
    case 'queued':
      return `${research.description} Queued: starts once a slot is free and you can pay. Click to take it out.`;
    case 'available':
      return state.credits >= research.cost && state.availableSlots > 0
        ? research.description
        : `${research.description} Click to queue: the credits are charged when it starts.`;
    default:
      return research.description;
  }
}

function elapsedOf(research: ResearchConfig, state: ResearchTreeState): number {
  return state.elapsed.get(research.id) ?? 0;
}

function progressOf(research: ResearchConfig, state: ResearchTreeState): number {
  if (research.duration <= 0) return 1;
  return Math.max(0, Math.min(1, elapsedOf(research, state) / research.duration));
}

function remainingOf(research: ResearchConfig, state: ResearchTreeState): number {
  return Math.max(0, research.duration - elapsedOf(research, state));
}
