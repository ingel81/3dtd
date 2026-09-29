// CPU profiles of the page's main thread and of its simulation worker at once (Chromium only), for the load runner's
// --profile (e2e/perf/sim-load.ts). Playwright's own CDP sessions reach the page but not its dedicated workers, so this
// talks to the browser's DevTools endpoint directly: attach to the page, auto-attach its workers, profile both.
//   const stop = await startProfiles(9333); ...; const { main, worker } = await stop();
//   console.log(summarize(main, 25));

interface CallFrame { functionName: string; url: string; lineNumber: number; columnNumber: number }
interface ProfileNode { id: number; callFrame: CallFrame; hitCount?: number; children?: number[] }
export interface CpuProfile { nodes: ProfileNode[]; startTime: number; endTime: number; samples?: number[]; timeDeltas?: number[] }

type Message = { id?: number; method?: string; params?: Record<string, unknown>; result?: Record<string, unknown>; error?: unknown; sessionId?: string };

class Cdp {
  private nextId = 1;
  private readonly calls = new Map<number, (m: Message) => void>();
  private readonly listeners: ((m: Message) => void)[] = [];

  private constructor(private readonly ws: WebSocket) {
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(String(ev.data)) as Message;
      if (m.id !== undefined) {
        this.calls.get(m.id)?.(m);
        this.calls.delete(m.id);
      } else {
        for (const l of this.listeners) l(m);
      }
    });
  }

  static async connect(port: number): Promise<Cdp> {
    const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json() as { webSocketDebuggerUrl: string };
    const ws = new WebSocket(version.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', reject, { once: true });
    });
    return new Cdp(ws);
  }

  send(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<Record<string, unknown>> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.calls.set(id, (m) => (m.error ? reject(new Error(`${method}: ${JSON.stringify(m.error)}`)) : resolve(m.result ?? {})));
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }

  on(listener: (m: Message) => void): void {
    this.listeners.push(listener);
  }

  close(): void {
    this.ws.close();
  }
}

/** Starts profiling the page (the one tab) and its worker; the returned function stops and hands both profiles. */
export async function startProfiles(port: number, intervalUs = 200): Promise<() => Promise<{ main: CpuProfile; worker: CpuProfile | null }>> {
  const cdp = await Cdp.connect(port);
  const { targetInfos } = await cdp.send('Target.getTargets') as { targetInfos: { targetId: string; type: string; url: string }[] };
  const page = targetInfos.find((t) => t.type === 'page' && !t.url.startsWith('devtools'));
  if (!page) throw new Error('cdp-profile: no page target');
  const { sessionId: pageSession } = await cdp.send('Target.attachToTarget', { targetId: page.targetId, flatten: true }) as { sessionId: string };
  let workerSession: string | null = null;
  const attached = new Promise<void>((resolve) => {
    cdp.on((m) => {
      if (m.method === 'Target.attachedToTarget' && (m.params?.['targetInfo'] as { type: string }).type === 'worker') {
        workerSession = m.params?.['sessionId'] as string;
        resolve();
      }
    });
  });
  await cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, pageSession);
  await Promise.race([attached, new Promise((r) => setTimeout(r, 3000))]);
  const sessions = [pageSession, ...(workerSession ? [workerSession] : [])];
  for (const s of sessions) {
    await cdp.send('Profiler.enable', {}, s);
    await cdp.send('Profiler.setSamplingInterval', { interval: intervalUs }, s);
    await cdp.send('Profiler.start', {}, s);
  }
  return async () => {
    const main = (await cdp.send('Profiler.stop', {}, pageSession))['profile'] as CpuProfile;
    const worker = workerSession ? (await cdp.send('Profiler.stop', {}, workerSession))['profile'] as CpuProfile : null;
    cdp.close();
    return { main, worker };
  };
}

/** Self time per function, the top `limit` lines, as share of the profile's wall time and ms per second. */
export function summarize(profile: CpuProfile, limit = 25): string {
  const self = new Map<number, number>();
  const samples = profile.samples ?? [];
  const deltas = profile.timeDeltas ?? [];
  for (let i = 0; i < samples.length; i++) self.set(samples[i], (self.get(samples[i]) ?? 0) + (deltas[i + 1] ?? deltas[i] ?? 0));
  const byFunction = new Map<string, number>();
  for (const node of profile.nodes) {
    const us = self.get(node.id) ?? 0;
    if (us === 0) continue;
    const f = node.callFrame;
    const file = f.url.split('/').pop() ?? '';
    const key = `${f.functionName || '(anonymous)'} ${file}:${f.lineNumber + 1}:${f.columnNumber + 1}`;
    byFunction.set(key, (byFunction.get(key) ?? 0) + us);
  }
  const wallUs = profile.endTime - profile.startTime;
  return [...byFunction.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key, us]) => `${((us / wallUs) * 100).toFixed(1).padStart(5)} %  ${(us / 1000 / (wallUs / 1e6)).toFixed(1).padStart(6)} ms/s  ${key}`)
    .join('\n');
}
