// The simulation in a worker, publishing the renderer's view either by postMessage with a transferred
// buffer (pooled, the main thread hands each back) or into a SharedArrayBuffer with three slots.
import { createSim, stepSim, writeView, FLOATS, STEP_MS } from './sim.js';

const now = () => performance.timeOrigin + performance.now();
let sim, mode, speed, busyMs;
let pool = [];
let shared = null; // { header: Int32Array, times: Float64Array, slots: Float32Array[] }
let pendingCommand = 0;
let appliedCommand = 0;
let last = 0;
let carry = 0;

self.onmessage = (e) => {
  const m = e.data;
  if (m.t === 'init') {
    ({ mode, speed, busyMs } = m);
    sim = createSim(m.n);
    if (mode === 'sab') {
      const size = m.n * FLOATS;
      shared = {
        header: new Int32Array(m.sab, 0, 8),
        times: new Float64Array(m.sab, 32, 8),
        slots: [0, 1, 2].map((i) => new Float32Array(m.sab, 96 + i * size * 4, size)),
      };
    } else {
      pool = [0, 1, 2].map(() => new Float32Array(m.n * FLOATS));
    }
    last = now();
    setInterval(tick, 2);
  } else if (m.t === 'buffer') {
    pool.push(m.buf);
  } else if (m.t === 'cmd') {
    pendingCommand = m.t0;
  } else if (m.t === 'speed') {
    speed = m.speed;
  }
};

function tick() {
  const t = now();
  carry += (t - last) * speed;
  last = t;
  let steps = 0;
  while (carry >= STEP_MS && steps < 8 * Math.max(1, speed)) {
    // A command lands at a sub-step's start, as in the lockstep
    if (pendingCommand) { appliedCommand = pendingCommand; pendingCommand = 0; }
    stepSim(sim, busyMs);
    carry -= STEP_MS;
    steps++;
  }
  if (steps === 0) return;
  publish();
}

function publish() {
  const stamp = now();
  if (mode === 'sab') {
    const { header, times, slots } = shared;
    const latest = Atomics.load(header, 0);
    const reading = Atomics.load(header, 2);
    let slot = 0;
    while (slot === latest || slot === reading) slot++;
    writeView(sim, slots[slot]);
    times[slot * 2] = stamp;
    times[slot * 2 + 1] = appliedCommand;
    Atomics.store(header, 3, sim.step);
    Atomics.store(header, 0, slot);
    Atomics.add(header, 1, 1);
  } else {
    const buf = pool.pop();
    if (!buf) return; // the main thread holds all three: skip this publish
    writeView(sim, buf);
    self.postMessage({ t: 'state', buf, stamp, command: appliedCommand, step: sim.step }, [buf.buffer]);
  }
}
