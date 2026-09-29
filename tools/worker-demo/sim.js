// The stand-in simulation: N enemies walking loops, a fixed sub-step of 1/60 s, and an optional busy
// loop per sub-step that stands in for the real simulation's cost. Shared by the worker and the
// main-thread baseline. Each enemy writes 8 floats for the renderer: x, y, z, heading, anim time,
// hp share, type, flags (32 bytes, 160 kB at 5000).
export const FLOATS = 8;
export const STEP_MS = 1000 / 60;

export function createSim(n) {
  const pos = new Float64Array(n * 3);
  const phase = new Float64Array(n);
  const speed = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    phase[i] = (i * 2.399963) % (Math.PI * 2);
    speed[i] = 0.5 + ((i * 7919) % 100) / 100;
  }
  return { n, pos, phase, speed, step: 0, lastCommand: 0 };
}

/** One sub-step; `busyMs` burns that long to stand in for the real game's work */
export function stepSim(sim, busyMs) {
  const { n, pos, phase, speed } = sim;
  const dt = STEP_MS / 1000;
  for (let i = 0; i < n; i++) {
    phase[i] += speed[i] * dt * 0.2;
    const r = 20 + (i % 50);
    pos[i * 3] = Math.cos(phase[i]) * r;
    pos[i * 3 + 1] = 0;
    pos[i * 3 + 2] = Math.sin(phase[i]) * r;
  }
  sim.step++;
  if (busyMs > 0) {
    const end = performance.now() + busyMs;
    while (performance.now() < end) { /* the real simulation's cost */ }
  }
}

/** The renderer's view of the sim into `out` (Float32Array of n * FLOATS) */
export function writeView(sim, out) {
  const { n, pos, phase } = sim;
  for (let i = 0, o = 0; i < n; i++, o += FLOATS) {
    out[o] = pos[i * 3];
    out[o + 1] = pos[i * 3 + 1];
    out[o + 2] = pos[i * 3 + 2];
    out[o + 3] = phase[i];
    out[o + 4] = sim.step * STEP_MS;
    out[o + 5] = 1;
    out[o + 6] = i % 12;
    out[o + 7] = 0;
  }
}
