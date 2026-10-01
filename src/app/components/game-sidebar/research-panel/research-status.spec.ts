import { describe, it, expect } from 'vitest';
import {
  missingPrereqNames,
  researchNodeIcon,
  researchProgress,
  researchRemaining,
  researchStatus,
} from './research-status';
import { RESEARCH_TREE } from '../../../configs/research/research-tree.config';
import { ActiveResearch, ResearchId, researchWave } from '../../../configs/research/research.types';

const done = (...ids: ResearchId[]) => new Set<ResearchId>(ids);
/** A run far enough along that no research waits for its wave */
const LATE = Number.POSITIVE_INFINITY;
const running = (researchId: ResearchId): ActiveResearch =>
  ({ researchId, duration: 30, elapsed: 10, cost: 100 });

describe('researchStatus', () => {
  it('makes a research without prerequisites available', () => {
    expect(researchStatus('gatling-tech', done(), [], [], LATE)).toBe('available');
  });

  it('locks a research until its prerequisites are done', () => {
    expect(researchStatus('siege-engineering', done(), [], [], LATE)).toBe('locked');
    expect(researchStatus('siege-engineering', done('gatling-tech'), [], [], LATE)).toBe('available');
  });

  it('reports a running research as active, a finished one as completed', () => {
    expect(researchStatus('gatling-tech', done(), [running('gatling-tech')], [], LATE)).toBe('active');
    expect(researchStatus('gatling-tech', done('gatling-tech'), [running('gatling-tech')], [], LATE)).toBe('completed');
  });

  it('reports a queued research as queued until it runs', () => {
    expect(researchStatus('gatling-tech', done(), [], ['gatling-tech'], LATE)).toBe('queued');
    expect(researchStatus('gatling-tech', done(), [running('gatling-tech')], ['gatling-tech'], LATE)).toBe('active');
  });

  it('locks a research before its wave, whatever else is done', () => {
    const tier5 = RESEARCH_TREE['transcendent-tech'];
    const prerequisites = done(...tier5.prerequisites);
    expect(tier5.minWave).toBeGreaterThan(1);
    expect(researchStatus(tier5.id, prerequisites, [], [], tier5.minWave! - 1)).toBe('locked');
    expect(researchStatus(tier5.id, prerequisites, [], [], tier5.minWave!)).toBe('available');
  });

  it('locks an unknown research', () => {
    expect(researchStatus('nope' as ResearchId, done(), [], [], LATE)).toBe('locked');
  });
});

describe('researchWave', () => {
  it('is the next wave in the build phase and the running one during a wave', () => {
    expect(researchWave(0, 'setup')).toBe(1);
    expect(researchWave(9, 'setup')).toBe(10);
    expect(researchWave(10, 'wave')).toBe(10);
  });
});

describe('researchNodeIcon', () => {
  const gatling = RESEARCH_TREE['gatling-tech'];

  it('shows the status icon, and the research icon while available', () => {
    expect(researchNodeIcon(gatling, 'completed')).toBe('check');
    expect(researchNodeIcon(gatling, 'active')).toBe('refresh');
    expect(researchNodeIcon(gatling, 'queued')).toBe('layers');
    expect(researchNodeIcon(gatling, 'locked')).toBe('lock');
    // Whatever glyph the config carries: the status only overrides the others.
    expect(researchNodeIcon(gatling, 'available')).toBe(gatling.icon);
  });
});

describe('researchProgress / researchRemaining', () => {
  it('derive bar and countdown from the elapsed game time', () => {
    expect(researchProgress(20, 5)).toBe(0.25);
    expect(researchRemaining(20, 5)).toBe(15);
  });

  it('clamp once the time is up', () => {
    expect(researchProgress(20, 25)).toBe(1);
    expect(researchRemaining(20, 25)).toBe(0);
  });
});

describe('missingPrereqNames', () => {
  it('names the prerequisites still missing', () => {
    expect(missingPrereqNames('aa-retrofit', done())).toBe('Gatling Technology');
    expect(missingPrereqNames('aa-retrofit', done('gatling-tech'))).toBe('');
  });

  it('is empty for an unknown research', () => {
    expect(missingPrereqNames('nope' as ResearchId, done())).toBe('');
  });
});
