import { describe, it, expect, vi } from 'vitest';
import { signal } from '@angular/core';

// inject() hands out the fakes below by class name; effects are collected
// so a test can run them
const injections: Record<string, unknown> = {};
const effects: (() => void)[] = [];
vi.mock('@angular/core', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@angular/core');
  return {
    ...actual,
    Injectable: () => (target: unknown) => target,
    inject: (token: { name?: string }) => injections[token?.name ?? String(token)],
    effect: (fn: () => void) => { effects.push(fn); },
  };
});
vi.mock('../../sim/client/sim-client.service', () => ({ SimClient: class SimClient {} }));
vi.mock('../../presentation/presentation.service', () => ({ PresentationService: class PresentationService {} }));
vi.mock('../../store/ui.store', () => ({ UIStore: class UIStore {} }));

import { DestructionToolService } from './destruction-tool.service';

describe('DestructionToolService', () => {
  it('lets go of a blast on the way once build mode comes, so the click places the tower', () => {
    const buildMode = signal(false);
    injections['SimClient'] = { bus: { emit: vi.fn() } };
    injections['PresentationService'] = { host: null };
    injections['UIStore'] = { buildMode };
    effects.length = 0;
    const tool = new DestructionToolService();
    const runEffects = () => effects.forEach((fn) => fn());
    tool.setMode('blast');
    runEffects();
    expect(tool.active()).toBe(true);
    buildMode.set(true);
    runEffects();
    expect(tool.active()).toBe(false);
    // Out of build mode nothing lets go
    buildMode.set(false);
    tool.setMode('pick');
    runEffects();
    expect(tool.mode()).toBe('pick');
  });

  it('sends a blast that struck a wall or a roof with its height over the ground in whole dm, one at the ground without', () => {
    const emit = vi.fn();
    injections['SimClient'] = { bus: { emit } };
    injections['PresentationService'] = { host: null };
    injections['UIStore'] = { buildMode: signal(false) };
    const tool = new DestructionToolService();
    tool.setMode('blast');
    tool.blast.set('rocket');
    tool.click(0.001, 0.002, 17.4, 7.43);
    expect(emit).toHaveBeenLastCalledWith({ type: 'debug:blast', lat: 0.001, lon: 0.002, height: 17.4, blast: 'rocket', up: 74 });
    tool.click(0.001, 0.002, 10);
    expect(emit).toHaveBeenLastCalledWith({ type: 'debug:blast', lat: 0.001, lon: 0.002, height: 10, blast: 'rocket' });
  });
});
