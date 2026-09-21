import { describe, it, expect } from 'vitest';
import {
  missingPrereqNames,
  researchNodeIcon,
  researchProgress,
  researchRemaining,
  researchStatus,
} from './research-status';
import { RESEARCH_TREE } from '../../../configs/research/research-tree.config';
import { ActiveResearch, ResearchId } from '../../../configs/research/research.types';

const done = (...ids: ResearchId[]) => new Set<ResearchId>(ids);
const running = (researchId: ResearchId): ActiveResearch =>
  ({ researchId, startTime: 0, duration: 30, elapsed: 10, cost: 100 });

describe('researchStatus', () => {
  it('makes a research without prerequisites available', () => {
    expect(researchStatus('gatling-tech', done(), [])).toBe('available');
  });

  it('locks a research until its prerequisites are done', () => {
    expect(researchStatus('siege-engineering', done(), [])).toBe('locked');
    expect(researchStatus('siege-engineering', done('gatling-tech'), [])).toBe('available');
  });

  it('reports a running research as active, a finished one as completed', () => {
    expect(researchStatus('gatling-tech', done(), [running('gatling-tech')])).toBe('active');
    expect(researchStatus('gatling-tech', done('gatling-tech'), [running('gatling-tech')])).toBe('completed');
  });

  it('reports a queued research as queued until it runs', () => {
    expect(researchStatus('gatling-tech', done(), [], ['gatling-tech'])).toBe('queued');
    expect(researchStatus('gatling-tech', done(), [running('gatling-tech')], ['gatling-tech'])).toBe('active');
  });

  it('locks an unknown research', () => {
    expect(researchStatus('nope' as ResearchId, done(), [])).toBe('locked');
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
