import { describe, it, expect } from 'vitest';
import { GameClock } from './game-clock';

const STEP = GameClock.FIXED_STEP_MS;

/** Runs one pass, at most `maxSteps` sub-steps of it (a deadline), and returns the sub-steps it took. */
function frame(clock: GameClock, currentTime: number, timescale = 1, maxSteps = Infinity): number {
  clock.beginFrame(currentTime, timescale);
  while (clock.stepsThisFrame < maxSteps && clock.nextSubStep()) { /* sub-step */ }
  clock.endFrame();
  return clock.stepsThisFrame;
}

describe('GameClock', () => {
  it('assumes 16 ms for the first frame, below one sub-step', () => {
    const clock = new GameClock();
    expect(frame(clock, 1000)).toBe(0);
    expect(clock.gameTimeMs).toBe(0);
  });

  it('carries the remainder into the next frame', () => {
    const clock = new GameClock();
    frame(clock, 1000);                   // 16 ms carried
    expect(frame(clock, 1050)).toBe(3);   // 66 ms: three steps, ~16 ms left
    expect(frame(clock, 1066)).toBe(1);   // ~32 ms: one step
    expect(clock.gameTimeMs).toBe(STEP + STEP + STEP + STEP);
  });

  it('multiplies the wall-clock delta by the timescale', () => {
    const clock = new GameClock();
    expect(frame(clock, 1000, 10)).toBe(9);    // 160 ms
    expect(frame(clock, 1020, 10)).toBe(12);   // 200 ms + ~10 ms carried
  });

  it('takes a slow pass in full: 100 ms are six sub-steps, not slow motion', () => {
    const clock = new GameClock();
    frame(clock, 1000);
    expect(frame(clock, 1100)).toBe(6);        // 100 ms + 16 ms carried
  });

  it('caps a long wall-clock gap at MAX_BACKLOG_MS times the timescale', () => {
    const clock = new GameClock();
    frame(clock, 1);
    frame(clock, 17);
    expect(frame(clock, 60_017)).toBe(Math.floor(GameClock.MAX_BACKLOG_MS / STEP));   // 250 ms, not 60 s
    expect(frame(clock, 120_017, 4)).toBe(Math.floor((GameClock.MAX_BACKLOG_MS * 4) / STEP));
  });

  it('carries what a pass did not get to, up to the backlog, and says when the next sub-step is due', () => {
    const clock = new GameClock();
    frame(clock, 1000);
    expect(clock.dueInMs(1)).toBeCloseTo(STEP - 16, 6);
    expect(clock.dueInMs(4)).toBeCloseTo((STEP - 16) / 4, 6);
    // 100 ms due, the pass gets to two sub-steps: four are left for the next
    expect(frame(clock, 1100, 1, 2)).toBe(2);
    expect(clock.dueInMs(1)).toBe(0);
    expect(frame(clock, 1100)).toBe(4);
    // A simulation that never keeps up stays MAX_BACKLOG_MS behind, no more
    for (let t = 1200; t <= 3000; t += 100) frame(clock, t, 1, 1);
    expect(frame(clock, 3000)).toBe(Math.floor(GameClock.MAX_BACKLOG_MS / STEP) - 1);
  });

  it('holds the game clock and the remainder while paused', () => {
    const clock = new GameClock();
    frame(clock, 1000);
    frame(clock, 1050);
    const time = clock.gameTimeMs;
    clock.holdFrame(1066);
    clock.holdFrame(9000);
    expect(clock.gameTimeMs).toBe(time);
    expect(frame(clock, 9016)).toBe(1);        // 16 ms since the pause, ~16 ms carried
  });

  it('reset() returns to game-time 0 and forgets the last frame', () => {
    const clock = new GameClock();
    frame(clock, 1000);
    frame(clock, 1050);
    clock.reset();
    expect(clock.gameTimeMs).toBe(0);
    expect(clock.subStep).toBe(0);
    expect(frame(clock, 5000)).toBe(0);        // a first frame again
  });

  it('counts sub-steps across frames, so a command can name the step it ran in', () => {
    // The game time is a sum of 16.667 ms steps and drifts in floating point;
    // the step index does not, which is what the run log stamps with.
    const clock = new GameClock();
    frame(clock, 1000);
    const first = frame(clock, 1050);
    expect(clock.subStep).toBe(first);
    const second = frame(clock, 1100);
    expect(clock.subStep).toBe(first + second);
    clock.holdFrame(1200);
    expect(clock.subStep).toBe(first + second);   // a pause takes no step
  });
});
