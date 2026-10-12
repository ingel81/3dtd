import { describe, expect, it } from 'vitest';
import { loadingPlateView, tilesProgress } from './loading-plate';
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

describe('tilesProgress', () => {
  it('counts the tiles that stand against the ones still coming, and says nothing once none are coming', () => {
    expect(tilesProgress({ total: 300, downloading: 80, parsing: 20 })).toEqual({ loaded: 300, pending: 100, percent: 75 });
    expect(tilesProgress({ total: 0, downloading: 5, parsing: 0 })).toEqual({ loaded: 0, pending: 5, percent: 0 });
    expect(tilesProgress({ total: 420, downloading: 0, parsing: 0 })).toBeNull();
  });
});
