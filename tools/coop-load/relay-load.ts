/**
 * Load on the coop relay (docs/COOP_PLAN.md, C7): N rooms of four players on
 * real sockets, each aiming 15 times a second, building once a second and
 * reporting a hash every 30 ticks as a client does. Relay and clients run in
 * this one process, so the CPU share includes the clients.
 *
 *   node tools/coop-load/relay-load.ts 25
 */
import { WebSocket } from 'ws';
import { startRelay } from '../../coop-server/src/server.ts';
const ROOMS = Number(process.argv[2] ?? 10);
const SECONDS = 10;
/** What the relay sends, as far as this script reads it */
interface Heard { t: string; tick?: number; room?: { code: string; players: unknown[] } }

const relay = await startRelay({ port: 0 });
let received = 0;
async function client(name: string) {
  const s = new WebSocket(`ws://127.0.0.1:${relay.port}`);
  const heard: Heard[] = [];
  const waiters: (() => void)[] = [];
  s.on('message', (d) => {
    received++;
    const m = JSON.parse(String(d)) as Heard;
    // Like a client: a hash at every 30th tick, which paces the room; ticks are not kept
    if (m.t === 'tick') { if ((m.tick ?? 0) % 30 === 0) s.send(JSON.stringify({ t: 'hash', tick: m.tick, hash: 1 })); return; }
    heard.push(m);
    waiters.splice(0).forEach((w) => w());
  });
  await new Promise((r) => s.on('open', r));
  const send = (m: unknown) => s.send(JSON.stringify(m));
  const until = async (t: string, ok: (m: Heard) => boolean = () => true): Promise<Heard> => { for (;;) { const f = heard.find((m) => m.t === t && ok(m)); if (f) return f; await new Promise<void>((r) => waiters.push(r)); } };
  send({ t: 'hello', protocol: 1, name, gameVersion: 'v', configHash: 'h' });
  await until('welcome');
  return { s, send, until };
}
const all: Awaited<ReturnType<typeof client>>[] = [];
for (let r = 0; r < ROOMS; r++) {
  const host = await client('H' + r);
  host.send({ t: 'create' });
  const room = (await host.until('room')).room!;
  const guests = [];
  for (let g = 0; g < 3; g++) { const c = await client(`G${r}${g}`); c.send({ t: 'join', room: room.code }); guests.push(c); }
  await host.until('room', (m) => m.room?.players.length === 4);
  const lanes = ['s1', 's2', 's3', 's4'];
  host.send({ t: 'world', world: { big: 'x'.repeat(300_000) }, spawnIds: lanes });
  const players = [host, ...guests];
  players.forEach((p, i) => p.send({ t: 'pick', spawnId: lanes[i] }));
  guests.forEach((p) => p.send({ t: 'ready', ready: true }));
  await new Promise((r) => setTimeout(r, 200));
  host.send({ t: 'start', seed: 1 });
  await host.until('started');
  all.push(...players);
}
// Each player: an aim every tick (15/s) and a command every second, a hash every 2 s
const timers = all.map((p, i) => {
  let n = 0;
  return setInterval(() => {
    n++;
    p.send({ t: 'cmd', command: { type: 'command:tower-aim', towerId: 't' + i, yaw: n % 6, pitch: 0 } });
    if (n % 15 === 0) p.send({ t: 'cmd', command: { type: 'command:place-tower', typeId: 'archer' } });
  }, 1000 / 15);
});
received = 0;
const cpu0 = process.cpuUsage();
const t0 = performance.now();
await new Promise((r) => setTimeout(r, SECONDS * 1000));
const cpu = process.cpuUsage(cpu0);
const wall = performance.now() - t0;
timers.forEach(clearInterval);
const cpuMs = (cpu.user + cpu.system) / 1000;
console.log(`rooms ${ROOMS}, players ${all.length}: process CPU ${(cpuMs / wall * 100).toFixed(1)} % of one core (clients included), ${(received / SECONDS).toFixed(0)} messages/s to clients`);
all.forEach((p) => p.s.close());
await relay.close();
process.exit(0);
