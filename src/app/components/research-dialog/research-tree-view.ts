/**
 * Maps the research tree onto what the tech tree component draws, and onto
 * what the detail panel beside it shows: one node per research, one edge per
 * prerequisite, plus the state, the numbers and the prose.
 *
 * Pure, so the whole mapping can be tested without a DOM or a dialog. The base
 * state comes from `research-status.ts`, which the sidebar has used all along.
 * Added here is the pair the game logic has no word for: a node that is open
 * but too dear (`poor`), and one that is shut while everything it still waits
 * for is already running or queued (`pending`).
 */
import { RESEARCH_TREE, getResearch } from '../../configs/research/research-tree.config';
import {
  RESEARCH_BRANCH_LABEL,
  type ActiveResearch,
  type ResearchConfig,
  type ResearchId,
} from '../../configs/research/research.types';
import type { ResearchSnapshot } from '../../managers/research-snapshot';
import type { DagEdge } from '../../utils/dag-layout';
import type { TdIconName } from '../icon/icon.component';
import type { TechTreeNode, TechTreeNodeState } from '../tech-tree/tech-tree-view';
import { missingPrereqNames, researchStatus } from '../game-sidebar/research-panel/research-status';

export interface ResearchTreeState {
  completed: ReadonlySet<ResearchId>;
  active: readonly ActiveResearch[];
  queued: readonly ResearchId[];
  /** Game time each active research has run, to fill its bar. */
  elapsed: ReadonlyMap<ResearchId, number>;
  credits: number;
  availableSlots: number;
  /**
   * A coop partner's tree, looked at only (TODO E35): no click does anything,
   * and the hints say nothing about clicking.
   */
  readOnly?: boolean;
}

/** One tab of the coop research view: a player, this one as "You" */
export interface ResearchTab {
  id: string;
  label: string;
  me: boolean;
}

/**
 * The tabs of the coop research view (TODO E35): this player first as "You",
 * the partners after in the room's order under their names.
 */
export function researchTabs(
  roster: readonly { id: string; name: string }[],
  me: string | null,
): ResearchTab[] {
  const tabs = roster.map((p) => ({ id: p.id, label: p.id === me ? 'You' : p.name, me: p.id === me }));
  return [...tabs.filter((t) => t.me), ...tabs.filter((t) => !t.me)];
}

/**
 * The tree state for a partner's research, read only. Their credits are not
 * this view's business: every open node shows as open, none as too dear.
 */
export function viewOnlyTreeState(snapshot: ResearchSnapshot): ResearchTreeState {
  return {
    completed: snapshot.completed,
    active: snapshot.active,
    queued: snapshot.queued,
    elapsed: snapshot.elapsed,
    credits: Number.POSITIVE_INFINITY,
    availableSlots: Math.max(0, snapshot.maxSlots - snapshot.active.length),
    readOnly: true,
  };
}

/** What one research looks like to the detail panel. */
export interface ResearchDetail {
  id: ResearchId;
  name: string;
  icon: TdIconName;
  branch: string;
  branchLabel: string;
  /** Depth in the tree, 0-based. Comes from the layout, not from the config. */
  tier: number;
  state: TechTreeNodeState;
  stateLabel: string;
  /** What the research does, from the config. */
  effect: string;
  cost: number;
  duration: number;
  /** Set while it runs, in seconds. */
  remaining: number | null;
  /** Credits still missing, 0 when it can be paid. */
  missingCredits: number;
  /** Place in the queue, 1-based; 0 when it is not queued. */
  queuePosition: number;
  prerequisites: { id: ResearchId; name: string; done: boolean }[];
  /** How many researches this one opens up. */
  opens: number;
  action: ResearchAction;
}

export type ResearchAction = 'start' | 'queue' | 'unqueue' | 'none';

/** Every research as a node, in config order; the layout decides the places. */
export function buildResearchNodes(state: ResearchTreeState): TechTreeNode[] {
  return Object.values(RESEARCH_TREE).map((research) => {
    const status = nodeState(research, state);
    return {
      id: research.id,
      title: research.name,
      subtitle: subtitleOf(research, status, state),
      subtitleAside: status === 'completed' || status === 'active' ? undefined : `${research.duration}s`,
      // Its own icon always, so the tree reads as a map of what is in it. The
      // state rides along as a small glyph, not as a replacement.
      icon: research.icon as TdIconName,
      statusIcon: STATUS_ICON[status],
      branch: research.branch,
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
 * Everything the detail panel shows about one research. `tier` comes from the
 * caller, since only the layout knows how deep a node sits.
 */
export function buildResearchDetail(
  id: ResearchId,
  state: ResearchTreeState,
  tier: number,
): ResearchDetail | null {
  const research = getResearch(id);
  if (!research) return null;
  const status = nodeState(research, state);
  return {
    id: research.id,
    name: research.name,
    icon: research.icon as TdIconName,
    branch: research.branch,
    branchLabel: RESEARCH_BRANCH_LABEL[research.branch],
    tier,
    state: status,
    stateLabel: STATE_LABEL[status],
    effect: research.description,
    cost: research.cost,
    duration: research.duration,
    remaining: status === 'active' ? remainingOf(research, state) : null,
    missingCredits: Math.max(0, research.cost - Math.floor(state.credits)),
    queuePosition: state.queued.indexOf(research.id) + 1,
    prerequisites: research.prerequisites.map((p) => ({
      id: p,
      name: getResearch(p)?.name ?? p,
      done: state.completed.has(p),
    })),
    opens: Object.values(RESEARCH_TREE).filter((r) => r.prerequisites.includes(research.id)).length,
    action: researchClickAction(research.id, state),
  };
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
export function researchClickAction(id: ResearchId, state: ResearchTreeState): ResearchAction {
  const research = getResearch(id);
  if (!research || state.readOnly) return 'none';
  switch (researchStatus(id, state.completed, state.active, state.queued)) {
    case 'available':
      return state.credits >= research.cost && state.availableSlots > 0 ? 'start' : 'queue';
    case 'queued':
      return 'unqueue';
    default:
      return 'none';
  }
}

/** How many researches are done, for the readout in the header. */
export function researchProgressCounts(state: ResearchTreeState): { done: number; total: number } {
  const all = Object.values(RESEARCH_TREE);
  return { done: all.filter((r) => state.completed.has(r.id)).length, total: all.length };
}

/** Done and total per strand, for the tally in the footer. */
export function researchBranchCounts(state: ResearchTreeState): {
  branch: string;
  label: string;
  done: number;
  total: number;
}[] {
  const order = Object.keys(RESEARCH_BRANCH_LABEL) as (keyof typeof RESEARCH_BRANCH_LABEL)[];
  return order.map((branch) => {
    const own = Object.values(RESEARCH_TREE).filter((r) => r.branch === branch);
    return {
      branch,
      label: RESEARCH_BRANCH_LABEL[branch],
      done: own.filter((r) => state.completed.has(r.id)).length,
      total: own.length,
    };
  });
}

const STATE_LABEL: Record<TechTreeNodeState, string> = {
  completed: 'Researched',
  active: 'In progress',
  queued: 'Queued',
  available: 'Ready to start',
  poor: 'Not enough credits',
  pending: 'Waiting on the queue',
  locked: 'Locked',
};

const STATUS_ICON: Record<TechTreeNodeState, TdIconName> = {
  completed: 'check',
  active: 'refresh',
  queued: 'layers',
  available: 'layers',
  poor: 'layers',
  pending: 'lock',
  locked: 'lock',
};

/**
 * The five states of the game logic plus the two the display needs. A locked
 * node whose missing prerequisites are all under way counts as `pending`, so
 * the tree can show a branch that is on its way rather than one that is shut.
 */
function nodeState(research: ResearchConfig, state: ResearchTreeState): TechTreeNodeState {
  const status = researchStatus(research.id, state.completed, state.active, state.queued);
  if (status === 'available') return state.credits >= research.cost ? 'available' : 'poor';
  if (status === 'locked') {
    const missing = research.prerequisites.filter((p) => !state.completed.has(p));
    const underway = missing.every(
      (p) => state.active.some((a) => a.researchId === p) || state.queued.includes(p),
    );
    return underway ? 'pending' : 'locked';
  }
  return status;
}

function subtitleOf(research: ResearchConfig, status: TechTreeNodeState, state: ResearchTreeState): string {
  switch (status) {
    case 'completed':
      return 'Researched';
    case 'active':
      return `${remainingOf(research, state).toFixed(1)}s left`;
    case 'queued':
      return `${research.cost} at start`;
    default:
      return String(research.cost);
  }
}

function hintOf(research: ResearchConfig, status: TechTreeNodeState, state: ResearchTreeState): string {
  switch (status) {
    case 'locked':
    case 'pending':
      return `Requires: ${missingPrereqNames(research.id, state.completed)}`;
    case 'queued':
      return state.readOnly ? research.description : `${research.description} Click to take it out of the queue.`;
    case 'poor':
      return `${research.description} ${research.cost - Math.floor(state.credits)} credits short.`;
    case 'available':
      return state.availableSlots > 0 || state.readOnly
        ? research.description
        : `${research.description} Every slot is busy, so a click queues it.`;
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
