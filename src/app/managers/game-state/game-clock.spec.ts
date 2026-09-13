import { describe, it, expect } from 'vitest';
import { GameClock } from './game-clock';

const STEP = GameClock.FIXED_STEP_MS;

/** Runs one frame and returns the sub-steps it took. */
function frame(clock: GameClock, currentTime: number, timescale = 1): number {
  clock.beginFrame(currentTime, timescale);
  while (clock.nextSubStep()) { /* sub-step */ }
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

  it('multiplies the clamped wall-clock delta by the timescale', () => {
    const clock = new GameClock();
    expect(frame(clock, 1000, 10)).toBe(9);    // 160 ms
    expect(frame(clock, 1020, 10)).toBe(12);   // 200 ms + ~10 ms carried
  });

  it('clamps a long wall-clock gap to MAX_CATCHUP_MS', () => {
    const clock = new GameClock();
    frame(clock, 1);
    frame(clock, 17);
    expect(frame(clock, 60_017)).toBe(3);      // 50 ms + carried, not 60 s
  });

  it('stops at MAX_SUBSTEPS_PER_FRAME and caps the carried debt', () => {
    const clock = new GameClock();
    frame(clock, 1);
    // 50 ms × 300 = 15 s of game-time for one frame
    expect(frame(clock, 51, 300)).toBe(GameClock.MAX_SUBSTEPS_PER_FRAME);
    // What was left is capped at MAX_REMAINDER_MS: the next frame at 1x
    // works that off plus its own 16 ms and no more.
    const next = frame(clock, 67);
    expect(next).toBe(Math.floor((GameClock.MAX_REMAINDER_MS + 16) / STEP));
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
    expect(frame(clock, 5000)).toBe(0);        // a first frame again
  });
});
