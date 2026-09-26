// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest';
import { startRelay, type RelayServer } from './server.ts';
import { CoopRefusedError, CoopSession, type CoopStart } from '../../src/app/coop/coop-session.ts';

const HELLO = { gameVersion: 'v1', configHash: 'h' };

/** Wait until `check` holds, a few ms at a time. */
async function until(check: () => boolean, ms = 3000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe('CoopSession against the relay (COOP_PLAN C4b)', () => {
  let relay: RelayServer | null = null;
  const sessions: CoopSession[] = [];
  afterEach(async () => {
    for (const s of sessions.splice(0)) s.close();
    await relay?.close();
    relay = null;
  });
  const session = (name: string, hello = HELLO) => {
    const s = new CoopSession(`ws://localhost:${relay!.port}`, { name, ...hello });
    sessions.push(s);
    return s;
  };

  it('takes two players from the lobby into the game and carries their commands in one tick stream', async () => {
    relay = await startRelay({ port: 0 });
    const a = session('Ann');
    const b = session('Bob');
    await a.connect();
    await b.connect();

    const room = await a.create();
    expect(a.isHost).toBe(true);
    await b.join(room.code.toLowerCase());
    expect(b.isHost).toBe(false);

    a.sendWorld({ w: 1 }, ['s1', 's2']);
    await until(() => b.world !== null);
    expect(b.world).toEqual({ w: 1 });
    a.pick('s1');
    b.pick('s2');
    a.ready(true);
    b.ready(true);
    await until(() => a.room!.players.every((p) => p.ready));

    const starts: CoopStart[] = [];
    a.onStarted = (start) => starts.push(start);
    b.onStarted = (start) => starts.push(start);
    a.start(99);
    await until(() => starts.length === 2);
    expect(starts[0].seed).toBe(99);
    expect(starts[1].players).toEqual([a.playerId, b.playerId]);
    expect([...starts[1].lanes]).toEqual([[a.playerId, 's1'], [b.playerId, 's2']]);
    expect(starts.map((s) => s.localId)).toEqual([a.playerId, b.playerId]);

    b.link!.send({ type: 'command:upgrade-tower', towerId: 't1' });
    const tickOf = (s: CoopSession) => {
      for (let t = 0; t <= s.link!.confirmedTick(); t++) {
        if (s.link!.commandsAt(t).length > 0) return t;
      }
      return -1;
    };
    await until(() => tickOf(a) >= 0 && tickOf(b) >= 0);
    expect(tickOf(a)).toBe(tickOf(b));
    expect(a.link!.commandsAt(tickOf(a))).toEqual(b.link!.commandsAt(tickOf(b)));
    expect(a.link!.commandsAt(tickOf(a))[0]).toMatchObject({ playerId: b.playerId, command: { type: 'command:upgrade-tower' } });

    // The hashes go over the link; different ones come back as a desync (C5)
    const desyncs: number[] = [];
    a.onDesync = (tick) => desyncs.push(tick);
    b.onDesync = (tick) => desyncs.push(tick);
    a.link!.reportHash(0, 1);
    b.link!.reportHash(0, 1);
    // A hash only for a tick the relay has closed (relay review M3)
    await until(() => a.link!.confirmedTick() >= 30 && b.link!.confirmedTick() >= 30);
    a.link!.reportHash(30, 2);
    b.link!.reportHash(30, 3);
    await until(() => desyncs.length === 2);
    expect(desyncs).toEqual([30, 30]);
  });

  it('turns a refusal into an error and tells who is host after the host left', async () => {
    relay = await startRelay({ port: 0 });
    const a = session('Ann');
    const b = session('Bob', { gameVersion: 'v2', configHash: 'h' });
    const c = session('Cid');
    await a.connect();
    await b.connect();
    await c.connect();
    const room = await a.create();

    await expect(b.join(room.code)).rejects.toEqual(new CoopRefusedError('version', 'v1'));
    await expect(c.join('ZZZZZZ')).rejects.toBeInstanceOf(CoopRefusedError);
    await c.join(room.code);
    let host = '';
    c.onHost = (id) => { host = id; };
    a.close();
    await until(() => host !== '');
    expect(host).toBe(c.playerId);
    expect(c.isHost).toBe(true);
  });
});
