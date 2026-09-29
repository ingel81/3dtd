import { describe, expect, it } from 'vitest';
import { ResyncDriver, RESYNC_PART_CHARS, type ResyncGame } from './resync';
import { MAX_RESYNC_PARTS } from './protocol';
import { TICK_SUB_STEPS } from './lockstep';
import type { WaveSnapshot } from '../simulator/wave-snapshot';

/** Characters gzip cannot shrink much: a state that needs several pieces */
function noise(chars: number): string {
  let x = 12345;
  let out = '';
  for (let i = 0; i < chars; i++) {
    x = (Math.imul(x, 1103515245) + 12345) >>> 0;
    out += String.fromCharCode(33 + (x >>> 16) % 90);
  }
  return out;
}

function game(snapshot: unknown, restored: unknown[]): ResyncGame {
  return {
    subStep: () => 7 * TICK_SUB_STEPS,
    refusal: () => null,
    capture: () => snapshot as WaveSnapshot,
    restore: (s) => { restored.push(s); },
  };
}

const noWait = () => Promise.resolve();

describe('ResyncDriver', () => {
  it('sends a large state in pieces and the guest loads it once all are there', async () => {
    const snapshot = { blob: noise(2 * RESYNC_PART_CHARS) };
    const restored: unknown[] = [];
    const sent: { part: number; parts: number; chars: number }[] = [];
    const loaded: boolean[] = [];
    const guest = new ResyncDriver(() => false, game(null, restored), { state: () => undefined, loaded: (_t, ok) => loaded.push(ok) });
    const host = new ResyncDriver(() => true, game(snapshot, []), {
      state: (tick, gz, part, parts) => {
        sent.push({ part, parts, chars: gz!.length });
        guest.state(tick, gz!, part, parts);
      },
      loaded: () => undefined,
    }, () => undefined, noWait);
    host.hold(7);
    guest.hold(7);
    await host.poll();
    expect(sent.length).toBeGreaterThan(1);
    expect(sent.every((s) => s.parts === sent.length && s.chars <= RESYNC_PART_CHARS && s.chars % 4 === 0 || s.part === s.parts - 1)).toBe(true);
    await guest.poll();
    expect(loaded).toEqual([true]);
    expect(restored).toEqual([snapshot]);
  });

  it('does not load before the last piece', async () => {
    const restored: unknown[] = [];
    const guest = new ResyncDriver(() => false, game(null, restored), { state: () => undefined, loaded: () => undefined });
    guest.hold(7);
    guest.state(7, 'QUJD', 0, 2);
    await guest.poll();
    expect(restored).toEqual([]);
  });

  it('refuses a state of more pieces than the relay passes on', async () => {
    const snapshot = { blob: noise((MAX_RESYNC_PARTS + 1) * RESYNC_PART_CHARS) };
    const sent: (string | null)[] = [];
    const host = new ResyncDriver(() => true, game(snapshot, []), { state: (_t, gz) => sent.push(gz), loaded: () => undefined }, () => undefined, noWait);
    host.hold(7);
    await host.poll();
    expect(sent).toEqual([null]);
  }, 60_000);
});
