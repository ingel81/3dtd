import { describe, expect, it } from 'vitest';
import { loadingPlateView } from './loading-plate';
import type { BootStep } from './boot-step.model';

const step = (id: string, status: BootStep['status']): BootStep => ({ id, title: id, status });

describe('loadingPlateView', () => {
  it('counts the steps done and names the one under way', () => {
    const view = loadingPlateView([step('a', 'done'), step('b', 'current'), step('c', 'pending'), step('d', 'pending')]);
    expect(view).toMatchObject({ percent: 25, done: 1, total: 4, position: 2 });
    expect(view.current?.id).toBe('b');
  });

  it('names the next step due between two steps', () => {
    const view = loadingPlateView([step('a', 'done'), step('b', 'pending')]);
    expect(view.current?.id).toBe('b');
    expect(view.position).toBe(2);
  });

  it('is full with none left, and empty without steps', () => {
    expect(loadingPlateView([step('a', 'done')])).toMatchObject({ percent: 100, current: null, position: 2 });
    expect(loadingPlateView([])).toMatchObject({ percent: 0, current: null });
  });
});
