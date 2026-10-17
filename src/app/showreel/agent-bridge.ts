/**
 * The desktop preload's agent bridge for the showreel's AI agent take
 * (tools/showreel/agent/relay.mjs): the web build has no MCP server, so with
 * `?showreel&agent=<port>` the hook puts the same `window.desktop.agent` on
 * the page as desktop/src/preload.js does, its IPC carried over a WebSocket
 * to the relay. The relay runs the app's own server and, when the scene asks,
 * the recorded agent's calls.
 */
import type { AgentAnswer, AgentCall, AgentStatus } from '../core/desktop-bridge';

type Message = { t: 'ipc'; channel: string; payload: unknown } | { t: 'result'; id: number; value: unknown; error?: string };

let replayOf: ((name: string, reset: boolean) => Promise<unknown>) | null = null;

/**
 * The recorded calls of a fixture, through the relay; resolves once the last answered. `reset`: then the
 * switch off and on, so the band forgets the agent (a warm-up before the take)
 */
export function agentReplay(name: string, reset = false): Promise<unknown> {
  if (!replayOf) return Promise.reject(new Error('showreel: no agent relay (the page needs agent=<port>)'));
  return replayOf(name, reset);
}

/** Before the app starts: `window.desktop` with the agent part, over the relay on `port` */
export function installAgentBridge(port: number): void {
  const socket = new WebSocket(`ws://127.0.0.1:${port}`);
  const open = new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve(), { once: true });
    socket.addEventListener('error', () => reject(new Error(`showreel: the agent relay on ${port} does not answer`)), { once: true });
  });
  let nextId = 1;
  const waiting = new Map<number, { resolve(v: unknown): void; reject(e: Error): void }>();
  const request = (message: Record<string, unknown>): Promise<unknown> =>
    open.then(
      () =>
        new Promise((resolve, reject) => {
          const id = nextId++;
          waiting.set(id, { resolve, reject });
          socket.send(JSON.stringify({ ...message, id }));
        }),
    );
  const invoke = (channel: string, arg?: unknown) => request({ t: 'invoke', channel, arg }) as Promise<AgentStatus>;
  const send = (channel: string, arg: unknown) => void open.then(() => socket.send(JSON.stringify({ t: 'send', channel, arg })));

  // As the preload: one handler answers the calls, the last status kept for the next listener
  let handler: ((call: AgentCall, reply: (answer: AgentAnswer) => void) => void) | null = null;
  let status: AgentStatus | null = null;
  const listeners = new Set<(s: AgentStatus) => void>();
  socket.addEventListener('message', (e) => {
    const m = JSON.parse(String(e.data)) as Message;
    if (m.t === 'result') {
      const w = waiting.get(m.id);
      waiting.delete(m.id);
      if (m.error) w?.reject(new Error(m.error));
      else w?.resolve(m.value);
      return;
    }
    if (m.channel === 'desktop:agent-status-changed') {
      status = m.payload as AgentStatus;
      for (const l of listeners) l(status);
    } else if (m.channel === 'desktop:agent-call') {
      const call = m.payload as { id: number; tool: string; args: Record<string, unknown> };
      let replied = false;
      const reply = (answer: AgentAnswer) => {
        if (replied) return;
        replied = true;
        send('desktop:agent-reply', { id: call.id, answer: { text: answer.text, isError: answer.isError === true, ...(answer.image ? { image: answer.image } : {}) } });
      };
      if (!handler) reply({ text: 'The map editor is not open.', isError: true });
      else handler({ tool: call.tool, args: call.args ?? {} }, reply);
    }
  });

  replayOf = (name, reset) => request({ t: 'replay', name, reset });
  (window as unknown as { desktop: unknown }).desktop = Object.freeze({
    version: '',
    onUpdateReady: () => () => undefined,
    installUpdateNow: () => undefined,
    saveRun: () => Promise.resolve(false),
    agent: Object.freeze({
      onCall(h: typeof handler) {
        handler = h;
        return () => {
          if (handler === h) handler = null;
        };
      },
      status: () => invoke('desktop:agent-status'),
      setEnabled: (on: boolean) => invoke('desktop:agent-set-enabled', on === true),
      onStatus(listener: (s: AgentStatus) => void) {
        listeners.add(listener);
        if (status) listener(status);
        else void invoke('desktop:agent-status').then((s) => s && listeners.has(listener) && listener(status ?? s));
        return () => listeners.delete(listener);
      },
      stop: () => invoke('desktop:agent-stop'),
      resume: () => invoke('desktop:agent-resume'),
    }),
  });
}
