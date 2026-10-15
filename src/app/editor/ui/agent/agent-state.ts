/**
 * What the editor shows of an AI agent (docs/AGENT_MCP.md): the state in
 * the top bar's Agent button and the line of the agent band, from the
 * status the desktop app's MCP server pushes (AgentStatus).
 */
import type { AgentStatus } from '../../../core/desktop-bridge';

/** An agent counts as connected this long after its last request */
export const AGENT_CONNECTED_MS = 5 * 60_000;

export type AgentState = 'off' | 'error' | 'stopped' | 'working' | 'connected' | 'waiting';

export const AGENT_STATE_LABEL: Record<AgentState, string> = {
  off: 'Off',
  error: 'Not started',
  stopped: 'Stopped',
  working: 'Working',
  connected: 'Connected',
  waiting: 'On',
};

export function agentState(s: AgentStatus, now: number): AgentState {
  if (!s.enabled) return 'off';
  if (s.error) return 'error';
  if (s.held) return 'stopped';
  if (s.current) return 'working';
  if (s.client && now - s.client.lastSeen < AGENT_CONNECTED_MS) return 'connected';
  return 'waiting';
}

/** "12 s ago", "3 min ago", "just now" */
export function ago(at: number, now: number): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 3) return 'just now';
  if (s < 90) return `${s} s ago`;
  const m = Math.round(s / 60);
  if (m < 90) return `${m} min ago`;
  return `${Math.round(m / 60)} h ago`;
}

/** How long something runs: "4 s", "2 min" */
export function runningFor(since: number, now: number): string {
  const s = Math.max(0, Math.round((now - since) / 1000));
  return s < 90 ? `${s} s` : `${Math.round(s / 60)} min`;
}

/** The agent's name as its MCP client gives it, or a plain word */
export function agentName(s: AgentStatus): string {
  return s.client?.name?.trim() || 'AI agent';
}

/** Whether the band over the view shows: the agent works, was stopped, or came lately */
export function bandShown(s: AgentStatus | null, now: number): boolean {
  if (!s) return false;
  const state = agentState(s, now);
  return state === 'working' || state === 'stopped' || state === 'connected';
}

/** One line on what the agent does or did last, for the band and the button's panel */
export function agentLine(s: AgentStatus, now: number): string {
  switch (agentState(s, now)) {
    case 'off':
      return 'AI agents may not edit maps';
    case 'error':
      return s.error ?? 'The server could not start';
    case 'stopped':
      return 'Stopped: its calls are refused until you let it go on';
    case 'working':
      return `${s.current!.what} | ${runningFor(s.current!.at, now)}`;
    case 'connected':
      return s.last ? `Waiting | last: ${s.last.what}${s.last.ok === false ? ' (failed)' : ''}, ${ago(s.last.at, now)}` : `Connected ${ago(s.client!.lastSeen, now)}`;
    case 'waiting':
      return s.client ? `No call for a while | last seen ${ago(s.client.lastSeen, now)}` : 'No agent has connected yet';
  }
}
