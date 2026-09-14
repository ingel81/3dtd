import { describe, expect, it } from 'vitest';
import {
  DECK_APPROACH_M,
  DECK_APPROACH_RISE_M,
  continuesBridge,
  continuesDeck,
  deckApproachY,
  deckApproaches,
  nearestDeckApproach,
} from './deck-approach';

const p = (x: number, z: number) => ({ x, z });
const column = (groundY: number, topY: number) => ({ groundY, topY, tileDepth: 20, tileGeometricError: 2 });

describe('deckApproachY', () => {
  it('takes the top where it carries on the deck at the bridge end, else the lowest hit', () => {
    // The deck at 80 m over a quay at 70 m.
    expect(deckApproachY(column(70, 80), 80)).toBe(80);
    expect(deckApproachY(column(70, 80 + DECK_APPROACH_RISE_M), 80)).toBe(80 + DECK_APPROACH_RISE_M);
    // A crown 8 m over a street at deck level, a statue on it, a lamp: the ground.
    expect(deckApproachY(column(80, 88), 80)).toBe(80);
    expect(deckApproachY(column(80, 80 + DECK_APPROACH_RISE_M + 0.1), 80)).toBe(80);
    // A street far below the deck with nothing over it: its ground.
    expect(deckApproachY(column(70, 70), 80)).toBe(70);
    expect(continuesDeck(78.6, 80)).toBe(true);
    expect(continuesDeck(78.4, 80)).toBe(false);
  });
});

describe('continuesBridge', () => {
  it('goes on up to a turn of 45 degrees, and past a piece without length', () => {
    expect(continuesBridge(1, 0, 1, 0.99)).toBe(true);
    expect(continuesBridge(1, 0, 1, 1.01)).toBe(false);
    expect(continuesBridge(1, 0, 0, 1)).toBe(false);
    expect(continuesBridge(1, 0, -1, 0)).toBe(false);
    expect(continuesBridge(1, 0, 0, 0)).toBe(true);
  });
});

describe('deckApproaches', () => {
  it('runs along the route from both ends of a bridge and stops past DECK_APPROACH_M', () => {
    // Eastbound: road 0 to 10, ways of 20 and 8 m, the bridge 38 to 98, then 30 and 20 m.
    const points = [p(0, 0), p(10, 0), p(30, 0), p(38, 0), p(98, 0), p(128, 0), p(148, 0)];
    const onBridge = [false, false, false, true, false, false];
    const approaches = deckApproaches(points, onBridge, onBridge.map(() => false));

    // Back from the bridge start (point 3): 8 m, then 20 m, then the road from 28 m on.
    expect(approaches[2]).toEqual([{ end: 3, from: 8, to: 0 }]);
    expect(approaches[1]).toEqual([{ end: 3, from: 28, to: 8 }]);
    expect(approaches[0]).toEqual([{ end: 3, from: 38, to: 28 }]);
    expect(approaches[3]).toEqual([]);
    // On from the bridge end (point 4): 30 m, then 20 m more, which starts within the limit.
    expect(approaches[4]).toEqual([{ end: 4, from: 0, to: 30 }]);
    expect(approaches[5]).toEqual([{ end: 4, from: 30, to: 50 }]);
  });

  it('stops where the route turns off the bridge, at a tunnel and at the next bridge', () => {
    // A bridge east to (60, 0), then a way south: the route turns 90 degrees.
    const turn = deckApproaches([p(0, 0), p(60, 0), p(60, 30)], [true, false], [false, false]);
    expect(turn[1]).toEqual([]);
    // A gentle bend of 30 degrees goes on.
    const bend = deckApproaches([p(0, 0), p(60, 0), p(60 + 10 * Math.cos(Math.PI / 6), 10 * Math.sin(Math.PI / 6))], [true, false], [false, false]);
    expect(bend[1]).toHaveLength(1);

    const tunnel = deckApproaches([p(0, 0), p(60, 0), p(70, 0), p(90, 0)], [true, false, false], [false, true, false]);
    expect(tunnel[1]).toEqual([]);
    expect(tunnel[2]).toEqual([]);

    // A 20 m way between two bridges belongs to both ends.
    const between = deckApproaches([p(0, 0), p(60, 0), p(80, 0), p(140, 0)], [true, false, true], [false, false, false]);
    expect(between[1]).toEqual([{ end: 1, from: 0, to: 20 }, { end: 2, from: 20, to: 0 }]);
  });
});

describe('nearestDeckApproach', () => {
  it('picks the nearer bridge end at a point of the segment, none past DECK_APPROACH_M', () => {
    const a = { from: 0, to: 20 };
    const b = { from: 20, to: 0 };
    expect(nearestDeckApproach([a, b], 0.2)).toBe(a);
    expect(nearestDeckApproach([a, b], 0.8)).toBe(b);
    const far = { from: DECK_APPROACH_M - 5, to: DECK_APPROACH_M + 5 };
    expect(nearestDeckApproach([far], 0.4)).toBe(far);
    expect(nearestDeckApproach([far], 0.6)).toBeNull();
    expect(nearestDeckApproach([], 0.5)).toBeNull();
  });
});
