import { afterEach, describe, expect, it, vi } from 'vitest';
import { CoopSession, type CoopSocket } from './coop-session';

/** A socket that opens at once and answers the hello; everything else goes unanswered */
function relay(): { session: CoopSession; sent: string[] } {
  const sent: string[] = [];
  const socket = {
    readyState: 1,
    send: (text: string) => {
      sent.push(text);
      if (JSON.parse(text).t === 'hello') queueMicrotask(() => socket.onmessage?.({ data: JSON.stringify({ t: 'welcome', playerId: 'p1' }) }));
    },
    close: () => undefined,
  } as unknown as CoopSocket & { onmessage?: (e: { data: string }) => void; onopen?: () => void };
  const session = new CoopSession('ws://relay', { name: 'Ann', gameVersion: '1', configHash: 'x' }, () => {
    queueMicrotask(() => socket.onopen?.());
    return socket;
  });
  return { session, sent };
}

describe('CoopSession requests to the relay', () => {
  afterEach(() => vi.useRealTimers());

  it('fail after 10 s without an answer, and the next request goes out', async () => {
    const { session, sent } = relay();
    await session.connect();
    vi.useFakeTimers();
    const list = session.listRooms();
    const failed = expect(list).rejects.toThrow('No answer from the relay');
    await vi.advanceTimersByTimeAsync(10_000);
    await failed;
    // Not "busy" any more
    void session.listRooms().catch(() => undefined);
    expect(sent.filter((text) => JSON.parse(text).t === 'rooms')).toHaveLength(2);
  });
});
