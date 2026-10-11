import { describe, expect, it } from 'vitest';
import {
  defaultOpenLanes, hasLaneChoice, laneChoiceOf, laneChoiceProblem, laneLoadHint, toggledLanes,
} from './lane-choice';
import type { MapSpawn } from './map-document';

const spawn = (id: string, optional = false): MapSpawn => ({ id, name: id.toUpperCase(), x: 0, y: 0, ...(optional ? { optional } : {}) });

describe('lane choice (TODO E130)', () => {
  it('has no choice on a map whose lanes are all always open', () => {
    const choice = laneChoiceOf([spawn('a'), spawn('b')], undefined);
    expect(hasLaneChoice(choice)).toBe(false);
    expect(defaultOpenLanes(choice)).toEqual(['a', 'b']);
    expect(choice).toMatchObject({ min: 2, max: 2, vacant: 'close' });
  });

  it('opens the always-open lanes, then optional ones in order up to the most', () => {
    const choice = laneChoiceOf([spawn('a', true), spawn('b'), spawn('c', true), spawn('d', true)], { lanes: { max: 3, vacant: 'split' } });
    expect(hasLaneChoice(choice)).toBe(true);
    expect(choice).toMatchObject({ min: 1, max: 3, vacant: 'split' });
    expect(defaultOpenLanes(choice)).toEqual(['a', 'b', 'c']);
    expect(choice.lanes.map((l) => l.slot)).toEqual([0, 1, 2, 3]);
  });

  it('holds the bounds in what the lanes allow', () => {
    // Fewer than the always-open lanes, more than there are: held
    const choice = laneChoiceOf([spawn('a'), spawn('b'), spawn('c', true)], { lanes: { min: 9, max: 1 } });
    expect(choice.max).toBe(2);
    expect(choice.min).toBe(2);
    // Only the first `limit` spawns count (?spawns=N)
    expect(laneChoiceOf([spawn('a'), spawn('b', true), spawn('c', true)], undefined, 2).lanes.map((l) => l.id)).toEqual(['a', 'b']);
    expect(laneChoiceOf([spawn('a')], { lanes: { vacant: 'nonsense' as never } }).vacant).toBe('close');
  });

  it('says why a set of open lanes is not allowed', () => {
    const choice = laneChoiceOf([spawn('a'), spawn('b', true), spawn('c', true)], { lanes: { min: 2, max: 2 } });
    expect(laneChoiceProblem(choice, ['a', 'b'])).toBeNull();
    expect(laneChoiceProblem(choice, ['b', 'c'])).toBe('A is always open');
    expect(laneChoiceProblem(choice, ['a'])).toBe('at least 2 lanes stay open');
    expect(laneChoiceProblem(choice, ['a', 'b', 'c'])).toBe('at most 2 lanes are open on this map');
    expect(laneChoiceProblem(choice, ['a', 'x'])).toBe('no lane x on this map');
  });

  it('switches a lane in the map order, or refuses', () => {
    const choice = laneChoiceOf([spawn('a', true), spawn('b'), spawn('c', true)], undefined);
    expect(toggledLanes(choice, ['b'], 'c')).toEqual(['b', 'c']);
    expect(toggledLanes(choice, ['b', 'c'], 'a')).toEqual(['a', 'b', 'c']);
    expect(toggledLanes(choice, ['a', 'b'], 'b')).toBeNull();
    const one = laneChoiceOf([spawn('a', true), spawn('b', true)], undefined);
    expect(toggledLanes(one, ['a'], 'a')).toBeNull();
  });

  it('says that every open lane brings a full wave', () => {
    expect(laneLoadHint(1)).toBe('1 lane open: one wave at a time');
    expect(laneLoadHint(3)).toBe('3 lanes open: each brings a full wave, 3 times the enemies');
  });
});
