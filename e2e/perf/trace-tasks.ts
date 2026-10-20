// The long tasks of a Chrome trace (siege-probe.ts --chrome-trace, or any devtools.timeline trace) on the page's
// main thread: per task over the threshold its length, when it came, and the trace events inside it by total time
// (functions, GC, compile, layout, messages). What a CPU profile leaves out (native work, GC) shows here.
//
//   node e2e/perf/trace-tasks.ts <trace.json> [--long 30] [--lines 14]
import { readFileSync } from 'node:fs';

function argument(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
}

interface TraceEvent { name: string; ph: string; ts: number; dur?: number; pid: number; tid: number; args?: { data?: Record<string, unknown>; name?: string } }

const file = process.argv[2];
const LONG_MS = Number(argument('long', '30'));
const LINES = Number(argument('lines', '14'));
const raw = JSON.parse(readFileSync(file, 'utf8')) as { traceEvents: TraceEvent[] } | TraceEvent[];
const events = Array.isArray(raw) ? raw : raw.traceEvents;

// The renderer's main thread: the one with the most animation frames (thread names come only with __metadata)
const names = new Map<string, string>();
for (const e of events) if (e.name === 'thread_name' && e.args?.name) names.set(`${e.pid}:${e.tid}`, e.args.name);
const tasksOf = new Map<string, number>();
for (const e of events) {
  const key = `${e.pid}:${e.tid}`;
  if (e.name === 'FireAnimationFrame') tasksOf.set(key, (tasksOf.get(key) ?? 0) + 1);
}
const main = [...tasksOf.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
if (!main) throw new Error('no renderer main thread in the trace');
const onMain = events.filter((e) => `${e.pid}:${e.tid}` === main && e.ph === 'X' && e.dur !== undefined);
const start = Math.min(...onMain.map((e) => e.ts));
const long = onMain.filter((e) => (e.name === 'RunTask' || e.name === 'ThreadControllerImpl::RunTask') && e.dur! / 1000 > LONG_MS);

/** A short label: the event's name, a function call's script and line, a message's type */
function label(e: TraceEvent): string {
  const d = e.args?.data;
  if (e.name === 'FunctionCall' && d) return `FunctionCall ${String(d['functionName'] || '(anon)')} ${String(d['url'] ?? '').split('/').pop()}:${String(d['lineNumber'] ?? '')}`;
  if (e.name === 'EventDispatch' && d) return `EventDispatch ${String(d['type'])}`;
  if (e.name === 'TimerFire' || e.name === 'FireAnimationFrame') return e.name;
  return e.name;
}

for (const task of long) {
  const end = task.ts + task.dur!;
  const inside = onMain.filter((e) => e !== task && e.ts >= task.ts && e.ts + e.dur! <= end);
  const total = new Map<string, number>();
  for (const e of inside) total.set(label(e), (total.get(label(e)) ?? 0) + e.dur! / 1000);
  console.log(`TASK ${(task.dur! / 1000).toFixed(1)} ms at ${((task.ts - start) / 1e6).toFixed(2)} s`);
  for (const [name, ms] of [...total.entries()].sort((a, b) => b[1] - a[1]).slice(0, LINES)) console.log(`${ms.toFixed(1).padStart(8)} ms  ${name}`);
}

// --gpu: the GPU process's main thread too, its tasks over the threshold and what took their time
if (process.argv.includes('--gpu')) {
  const gpu = [...names.entries()].filter(([, n]) => n === 'CrGpuMain').map(([k]) => k);
  for (const key of gpu) {
    const on = events.filter((e) => `${e.pid}:${e.tid}` === key && e.ph === 'X' && e.dur !== undefined);
    const tasks = on.filter((e) => e.name === 'RunTask' || e.name === 'ThreadControllerImpl::RunTask');
    for (const task of tasks.filter((e) => e.dur! / 1000 > LONG_MS)) {
      const end = task.ts + task.dur!;
      const total = new Map<string, number>();
      for (const e of on) if (e !== task && e.ts >= task.ts && e.ts + e.dur! <= end) total.set(label(e), (total.get(label(e)) ?? 0) + e.dur! / 1000);
      console.log(`GPU TASK ${(task.dur! / 1000).toFixed(1)} ms at ${((task.ts - start) / 1e6).toFixed(2)} s`);
      for (const [name, ms] of [...total.entries()].sort((a, b) => b[1] - a[1]).slice(0, LINES)) console.log(`${ms.toFixed(1).padStart(8)} ms  ${name}`);
    }
  }
}
