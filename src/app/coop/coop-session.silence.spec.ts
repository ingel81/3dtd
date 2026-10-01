import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CoopSession, SILENCE_MS, type CoopCloseReason, type CoopSocket } from './coop-session';

type TestSocket = CoopSocket & { closed: number; push(message: unknown): void };

/** A socket that opens when asked and answers hello and create; the rest the test pushes */
function relay(): { session: CoopSession; socket: TestSocket; closes: CoopCloseReason[] } {
  const socket = {
    readyState: 1,
    closed: 0,
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
    send(text: string) {
      const t = JSON.parse(text).t;
      if (t === 'hello') queueMicrotask(() => socket.push({ t: 'welcome', playerId: 'p1' }));
      if (t === 'create') {
        queueMicrotask(() => socket.push({
          t: 'room',
          room: { code: 'ABCD', hostId: 'p1', players: [], spawnIds: [], started: false, cheats: false, locked: false, options: {}, listing: { public: false, title: '', city: '' } },
        }));
      }
    },
    close() {
      socket.closed++;
    },
    push(message: unknown) {
      socket.onmessage?.({ data: JSON.stringify(message) });
    },
  } as unknown as TestSocket;
  const session = new CoopSession('ws://relay', { name: 'Ann', gameVersion: '1', configHash: 'x' }, () => {
    queueMicrotask(() => socket.onopen?.(null));
    return socket;
  });
  const closes: CoopCloseReason[] = [];
  session.onClosed = (reason) => closes.push(reason);
  return { session, socket, closes };
}

async function inRoom() {
  const r = relay();
  await r.session.connect();
  await r.session.create();
  return r;
}

describe('CoopSession watchdog over the relay heartbeat', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('closes as silent after SILENCE_MS without a word in a room', async () => {
    const { socket, closes } = await inRoom();
    await vi.advanceTimersByTimeAsync(SILENCE_MS - 2000);
    expect(closes).toEqual([]);
    await vi.advanceTimersByTimeAsync(3000);
    expect(closes).toEqual(['silent']);
    expect(socket.closed).toBe(1);
    // A close event the half-open socket sends late changes nothing
    socket.onclose?.({ code: 1006 });
    expect(closes).toEqual(['silent']);
  });

  it('stays open while the relay sends its round trips', async () => {
    const { socket, closes } = await inRoom();
    for (let i = 0; i < 10; i++) {
      await vi.advanceTimersByTimeAsync(5000);
      socket.push({ t: 'rtt', rtt: [['p1', 30]] });
    }
    expect(closes).toEqual([]);
  });

  it('counts no silence outside a room, where the relay sends nothing unasked', async () => {
    const { session, closes } = relay();
    await session.connect();
    await vi.advanceTimersByTimeAsync(SILENCE_MS * 3);
    expect(closes).toEqual([]);
  });

  it('starts the silence again after this page stood still', async () => {
    const { closes } = await inRoom();
    await vi.advanceTimersByTimeAsync(SILENCE_MS - 5000);
    // The page blocked for longer than half the silence: no check ran in between
    const now = performance.now();
    vi.spyOn(performance, 'now').mockReturnValue(now + SILENCE_MS);
    await vi.advanceTimersByTimeAsync(1000);
    expect(closes).toEqual([]);
    vi.mocked(performance.now).mockRestore();
  });

  it('stops watching once the session closes', async () => {
    const { session, closes } = await inRoom();
    session.close();
    await vi.advanceTimersByTimeAsync(SILENCE_MS * 2);
    expect(closes).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
