import { describe, it, expect } from 'vitest';
import { RESEARCH_TREE } from '../../configs/research/research-tree.config';
import type { ActiveResearch, ResearchId } from '../../configs/research/research.types';
import {
  buildResearchEdges,
  buildResearchNodes,
  researchClickAction,
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
    expect(open.subtitle).toBe(`${RESEARCH_TREE['gatling-tech'].cost} · ${RESEARCH_TREE['gatling-tech'].duration}s`);

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
    expect(node.subtitle).toBe(`${Math.ceil(duration * 0.75)}s left`);
  });

  it('numbers a queued node by its place in the queue', () => {
    const nodes = buildResearchNodes(state({ queued: ['ice-magic', 'toxic-compounds'] }));
    expect(nodes.find((n) => n.id === 'ice-magic')!.badge).toBe('1');
    expect(nodes.find((n) => n.id === 'toxic-compounds')!.badge).toBe('2');
    expect(nodes.find((n) => n.id === 'toxic-compounds')!.subtitle).toBe(
      `${RESEARCH_TREE['toxic-compounds'].cost} at start`,
    );
  });

  it('says a click will queue when there is no slot or no credits', () => {
    const noSlot = nodeFor('gatling-tech', state({ availableSlots: 0 }));
    expect(noSlot.hint).toContain('Click to queue');
    const noCredits = nodeFor('gatling-tech', state({ credits: 0 }));
    expect(noCredits.hint).toContain('Click to queue');
    expect(nodeFor('gatling-tech').hint).toBe(RESEARCH_TREE['gatling-tech'].description);
  });

  it('lets the status icon win over the config icon', () => {
    expect(nodeFor('siege-engineering').icon).toBe('lock');
    expect(nodeFor('gatling-tech', state({ completed: new Set(['gatling-tech']) })).icon).toBe('check');
    expect(nodeFor('gatling-tech').icon).toBe(RESEARCH_TREE['gatling-tech'].icon);
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
