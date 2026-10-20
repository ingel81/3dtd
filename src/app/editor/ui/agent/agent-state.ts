/**
 * What the editor shows of an AI agent (docs/AGENT_MCP.md): the state in
 * the top bar's Agent button and the line of the agent band, from the
 * status the desktop app's MCP server pushes (AgentStatus).
 */
import type { AgentStatus } from '../../../core/desktop-bridge';
import type { Messages } from '../../../i18n/messages/en';

/** An agent counts as connected this long after its last request */
export const AGENT_CONNECTED_MS = 5 * 60_000;

export type AgentState = 'off' | 'error' | 'stopped' | 'working' | 'connected' | 'waiting';

export function agentState(s: AgentStatus, now: number): AgentState {
  if (!s.enabled) return 'off';
  if (s.error) return 'error';
  if (s.held) return 'stopped';
  if (s.current) return 'working';
  if (s.client && now - s.client.lastSeen < AGENT_CONNECTED_MS) return 'connected';
  return 'waiting';
}

/** "12 s ago", "3 min ago", "just now" */
export function ago(t: Messages, at: number, now: number): string {
  const w = t.editor.agent;
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 3) return w.justNow;
  if (s < 90) return w.secondsAgo(s);
  const m = Math.round(s / 60);
  if (m < 90) return w.minutesAgo(m);
  return w.hoursAgo(Math.round(m / 60));
}

/** How long something runs: "4 s", "2 min" */
export function runningFor(t: Messages, since: number, now: number): string {
  const s = Math.max(0, Math.round((now - since) / 1000));
  return s < 90 ? t.editor.agent.seconds(s) : t.editor.agent.minutes(Math.round(s / 60));
}

/** The agent's name as its MCP client gives it, or a plain word */
export function agentName(t: Messages, s: AgentStatus): string {
  return s.client?.name?.trim() || t.editor.agent.anAgent;
}

/** Whether the band over the view shows: the agent works, was stopped, or came lately */
export function bandShown(s: AgentStatus | null, now: number): boolean {
  if (!s) return false;
  const state = agentState(s, now);
  return state === 'working' || state === 'stopped' || state === 'connected';
}

/** One line on what the agent does or did last, for the band and the button's panel */
/** `what` of a call is the agent's own words (the MCP server's), the rest the player's language */
export function agentLine(t: Messages, s: AgentStatus, now: number): string {
  const w = t.editor.agent;
  switch (agentState(s, now)) {
    case 'off':
      return w.notAllowed;
    case 'error':
      return s.error ?? w.notStarted;
    case 'stopped':
      return w.stopped;
    case 'working':
      return w.working(s.current!.what, runningFor(t, s.current!.at, now));
    case 'connected':
      return s.last ? w.waitingLast(s.last.what, s.last.ok === false, ago(t, s.last.at, now)) : w.connected(ago(t, s.client!.lastSeen, now));
    case 'waiting':
      return s.client ? w.quiet(ago(t, s.client.lastSeen, now)) : w.noneYet;
  }
}
