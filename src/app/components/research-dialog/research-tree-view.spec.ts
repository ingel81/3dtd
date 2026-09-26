import { describe, it, expect } from 'vitest';
import { RESEARCH_TREE } from '../../configs/research/research-tree.config';
import type { ActiveResearch, ResearchId } from '../../configs/research/research.types';
import {
  buildResearchDetail,
  buildResearchEdges,
  buildResearchNodes,
  researchBranchCounts,
  researchClickAction,
  researchProgressCounts,
  researchTabs,
  viewOnlyTreeState,
  type ResearchTreeState,
} from './research-tree-view';

const state = (partial: Partial<ResearchTreeState> = {}): ResearchTreeState => ({
  completed: new Set<ResearchId>(),
  active: [],
  queued: [],
  elapsed: new Map<ResearchId, number>(),
  credits: 10_000,
  availableSlots: 1,
  ...partial,
});

const active = (researchId: ResearchId, duration: number): ActiveResearch =>
  ({ researchId, duration, startTime: 0, elapsed: 0, cost: 0 }) as ActiveResearch;

const nodeFor = (id: ResearchId, s = state()) => buildResearchNodes(s).find((n) => n.id === id)!;

describe('buildResearchEdges', () => {
  it('draws one edge per prerequisite, both of a node with two', () => {
    const edges = buildResearchEdges();
    const expected = Object.values(RESEARCH_TREE).reduce((sum, r) => sum + r.prerequisites.length, 0);
    expect(edges).toHaveLength(expected);
    // advanced-weaponry needs siege-engineering and arcane-studies
    expect(edges.filter((e) => e.to === 'advanced-weaponry').map((e) => e.from).sort()).toEqual([
      'arcane-studies',
      'siege-engineering',
    ]);
  });
});

describe('buildResearchNodes', () => {
  it('covers every research in the config', () => {
    expect(buildResearchNodes(state())).toHaveLength(Object.keys(RESEARCH_TREE).length);
  });

  it('shows cost and duration while a node is open, and the missing prerequisite while it is not', () => {
    const open = nodeFor('gatling-tech');
    expect(open.state).toBe('available');
    expect(open.subtitle).toBe(String(RESEARCH_TREE['gatling-tech'].cost));
    expect(open.subtitleAside).toBe(`${RESEARCH_TREE['gatling-tech'].duration}s`);

    const shut = nodeFor('siege-engineering');
    expect(shut.state).toBe('locked');
    expect(shut.hint).toBe('Requires: Gatling Technology');
  });

  it('fills the bar of a running node from the elapsed game time', () => {
    const duration = RESEARCH_TREE['gatling-tech'].duration;
    const node = nodeFor(
      'gatling-tech',
      state({
        active: [active('gatling-tech', duration)],
        elapsed: new Map([['gatling-tech', duration / 4]]),
      }),
    );
    expect(node.state).toBe('active');
    expect(node.progress).toBeCloseTo(0.25, 6);
    expect(node.subtitle).toBe(`${(duration * 0.75).toFixed(1)}s left`);
  });

  it('numbers a queued node by its place in the queue', () => {
    const nodes = buildResearchNodes(state({ queued: ['ice-magic', 'toxic-compounds'] }));
    expect(nodes.find((n) => n.id === 'ice-magic')!.badge).toBe('1');
    expect(nodes.find((n) => n.id === 'toxic-compounds')!.badge).toBe('2');
    expect(nodes.find((n) => n.id === 'toxic-compounds')!.subtitle).toBe(
      `${RESEARCH_TREE['toxic-compounds'].cost} at start`,
    );
  });

  it('says why a click will not start it right now', () => {
    expect(nodeFor('gatling-tech', state({ availableSlots: 0 })).hint).toContain('Every slot is busy');
    expect(nodeFor('gatling-tech', state({ credits: 0 })).hint).toContain('credits short');
    expect(nodeFor('gatling-tech').hint).toBe(RESEARCH_TREE['gatling-tech'].description);
  });

  it('is poor, not available, when the node is open but the purse is short', () => {
    const node = nodeFor('gatling-tech', state({ credits: RESEARCH_TREE['gatling-tech'].cost - 1 }));
    expect(node.state).toBe('poor');
    expect(node.hint).toContain('1 credits short');
  });

  it('is pending, not locked, while every missing prerequisite is already under way', () => {
    expect(nodeFor('siege-engineering', state({ queued: ['gatling-tech'] })).state).toBe('pending');
    expect(nodeFor('siege-engineering', state({ active: [active('gatling-tech', 15)] })).state).toBe('pending');
    // Nothing under way: shut is shut.
    expect(nodeFor('siege-engineering').state).toBe('locked');
  });

  it('carries the strand of the tree, for the tint and the tally', () => {
    expect(nodeFor('gatling-tech').branch).toBe('ballistics');
    expect(nodeFor('ice-magic').branch).toBe('arcane');
    expect(nodeFor('biology').branch).toBe('biology');
    expect(nodeFor('mercenary-contract').branch).toBe('engineering');
  });

  it('keeps its own icon in every state and carries the state beside it', () => {
    const locked = nodeFor('siege-engineering');
    expect(locked.icon).toBe(RESEARCH_TREE['siege-engineering'].icon);
    expect(locked.statusIcon).toBe('lock');

    const done = nodeFor('gatling-tech', state({ completed: new Set(['gatling-tech']) }));
    expect(done.icon).toBe(RESEARCH_TREE['gatling-tech'].icon);
    expect(done.statusIcon).toBe('check');

    expect(nodeFor('gatling-tech').icon).toBe(RESEARCH_TREE['gatling-tech'].icon);
  });

  it('gives every research an icon of its own, none used twice', () => {
    const icons = Object.values(RESEARCH_TREE).map((r) => r.icon);
    expect(new Set(icons).size).toBe(icons.length);
  });
});

describe('researchClickAction', () => {
  const cost = RESEARCH_TREE['gatling-tech'].cost;

  it('starts an open node when a slot and the credits are there', () => {
    expect(researchClickAction('gatling-tech', state({ credits: cost, availableSlots: 1 }))).toBe('start');
  });

  it('queues it when a slot is busy or the credits are short', () => {
    expect(researchClickAction('gatling-tech', state({ availableSlots: 0 }))).toBe('queue');
    expect(researchClickAction('gatling-tech', state({ credits: cost - 1 }))).toBe('queue');
  });

  it('takes a queued node back out', () => {
    expect(researchClickAction('ice-magic', state({ queued: ['ice-magic'] }))).toBe('unqueue');
  });

  it('does nothing on a locked, running or finished node', () => {
    expect(researchClickAction('siege-engineering', state())).toBe('none');
    expect(
      researchClickAction('gatling-tech', state({ active: [active('gatling-tech', 15)] })),
    ).toBe('none');
    expect(researchClickAction('gatling-tech', state({ completed: new Set(['gatling-tech']) }))).toBe('none');
  });

  it('does nothing for an id the config does not know', () => {
    expect(researchClickAction('nope' as ResearchId, state())).toBe('none');
  });
});

describe('buildResearchDetail', () => {
  it('gathers what the panel shows, prerequisites with their state', () => {
    const detail = buildResearchDetail('siege-engineering', state(), 1)!;
    expect(detail).toMatchObject({
      id: 'siege-engineering',
      name: 'Siege Engineering',
      branchLabel: 'Ballistics',
      tier: 1,
      state: 'locked',
      stateLabel: 'Locked',
      cost: RESEARCH_TREE['siege-engineering'].cost,
      duration: RESEARCH_TREE['siege-engineering'].duration,
      remaining: null,
      action: 'none',
    });
    expect(detail.prerequisites).toEqual([
      { id: 'gatling-tech', name: 'Gatling Technology', done: false },
    ]);
  });

  it('counts what a node opens up', () => {
    // gatling-tech opens siege-engineering and aa-retrofit
    expect(buildResearchDetail('gatling-tech', state(), 0)!.opens).toBe(2);
  });

  it('names the credits still missing, and the place in the queue', () => {
    const poor = buildResearchDetail('gatling-tech', state({ credits: 100 }), 0)!;
    expect(poor.state).toBe('poor');
    expect(poor.missingCredits).toBe(RESEARCH_TREE['gatling-tech'].cost - 100);

    const queued = buildResearchDetail('ice-magic', state({ queued: ['biology', 'ice-magic'] }), 0)!;
    expect(queued.queuePosition).toBe(2);
    expect(queued.action).toBe('unqueue');
  });

  it('is null for an id the config does not know', () => {
    expect(buildResearchDetail('nope' as ResearchId, state(), 0)).toBeNull();
  });
});

describe('the readouts', () => {
  it('counts researched against the whole tree', () => {
    expect(researchProgressCounts(state())).toEqual({
      done: 0,
      total: Object.keys(RESEARCH_TREE).length,
    });
    expect(researchProgressCounts(state({ completed: new Set(['gatling-tech']) })).done).toBe(1);
  });

  it('tallies every strand, and they add up to the whole tree', () => {
    const counts = researchBranchCounts(state({ completed: new Set(['gatling-tech']) }));
    expect(counts.map((c) => c.branch)).toEqual(['ballistics', 'arcane', 'biology', 'engineering']);
    expect(counts.reduce((sum, c) => sum + c.total, 0)).toBe(Object.keys(RESEARCH_TREE).length);
    expect(counts.find((c) => c.branch === 'ballistics')!.done).toBe(1);
  });
});

describe('the read-only view of a coop partner (TODO E35)', () => {
  const partner = viewOnlyTreeState({
    completed: new Set<ResearchId>(['biology']),
    active: [active('gatling-tech', 15)],
    queued: ['ice-magic'],
    elapsed: new Map<ResearchId, number>([['gatling-tech', 5]]),
    centerLevel: 1,
    maxSlots: 1,
  });

  it('shows their done, running and queued research, and no click does anything', () => {
    expect(nodeFor('biology', partner).state).toBe('completed');
    expect(nodeFor('gatling-tech', partner).state).toBe('active');
    expect(nodeFor('gatling-tech', partner).progress).toBeCloseTo(5 / 15);
    expect(nodeFor('ice-magic', partner).state).toBe('queued');
    for (const id of Object.keys(RESEARCH_TREE) as ResearchId[]) {
      expect(researchClickAction(id, partner)).toBe('none');
    }
  });

  it('does not judge their credits and does not tell to click', () => {
    const nodes = buildResearchNodes(partner);
    expect(nodes.some((n) => n.state === 'poor')).toBe(false);
    expect(nodes.every((n) => !/click/i.test(n.hint ?? ''))).toBe(true);
    expect(partner.availableSlots).toBe(0);
  });

  it('gives one tab a player, this one first as "You"', () => {
    const roster = [
      { id: 'p1', name: 'Alpha' },
      { id: 'p2', name: 'Bravo' },
      { id: 'p3', name: 'Charlie' },
    ];
    expect(researchTabs(roster, 'p2')).toEqual([
      { id: 'p2', label: 'You', me: true },
      { id: 'p1', label: 'Alpha', me: false },
      { id: 'p3', label: 'Charlie', me: false },
    ]);
  });
});
