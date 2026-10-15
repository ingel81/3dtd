/**
 * What the editor shows of an AI agent: the Agent button's state and the
 * band over the view with Stop (docs/AGENT_MCP.md), from the status the
 * desktop app pushes.
 */
import '@angular/compiler';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { signal, type Type } from '@angular/core';
import { getTestBed, TestBed } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import type { AgentStatus } from '../../../core/desktop-bridge';
import { EditorSession } from '../editor-session.service';
import { AgentBandComponent } from './agent-band.component';
import { AgentControlComponent } from './agent-control.component';
import { AGENT_CONNECTED_MS, agentLine, agentState, ago, bandShown } from './agent-state';

const NOW = 1_000_000_000;
const on = (patch: Partial<AgentStatus> = {}): AgentStatus => ({ enabled: true, url: 'http://127.0.0.1:47171/mcp', held: false, client: null, current: null, last: null, ...patch });

describe('agent state', () => {
  it('reads off, waiting, connected, working and stopped from the status', () => {
    expect(agentState({ enabled: false, url: null }, NOW)).toBe('off');
    expect(agentState(on(), NOW)).toBe('waiting');
    expect(agentState(on({ client: { name: 'claude-code', lastSeen: NOW - 1000 } }), NOW)).toBe('connected');
    expect(agentState(on({ client: { name: 'claude-code', lastSeen: NOW - AGENT_CONNECTED_MS - 1 } }), NOW)).toBe('waiting');
    expect(agentState(on({ current: { tool: 'run_script', what: 'runs the script', at: NOW } }), NOW)).toBe('working');
    expect(agentState(on({ held: true, current: { tool: 'run_script', what: 'x', at: NOW } }), NOW)).toBe('stopped');
    expect(agentState(on({ error: 'port taken' }), NOW)).toBe('error');
  });

  it('says what runs and what ran, and shows the band only while it matters', () => {
    const client = { name: 'claude-code', lastSeen: NOW - 5000 };
    expect(agentLine(on({ client, current: { tool: 'run_script', what: 'runs the script "hill"', at: NOW - 4000 } }), NOW)).toBe('runs the script "hill" | 4 s');
    expect(agentLine(on({ client, last: { tool: 'check_map', what: 'checks the map', at: NOW - 12_000, ok: true } }), NOW)).toBe('Waiting | last: checks the map, 12 s ago');
    expect(agentLine(on(), NOW)).toBe('No agent has connected yet');
    expect(ago(NOW - 3 * 60_000, NOW)).toBe('3 min ago');
    expect(bandShown(on(), NOW)).toBe(false);
    expect(bandShown(on({ client }), NOW)).toBe(true);
    expect(bandShown(on({ held: true }), NOW)).toBe(true);
    expect(bandShown({ enabled: false, url: null, client }, NOW)).toBe(false);
  });
});

describe('agent band and button', () => {
  beforeAll(() => {
    getTestBed().initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
  });

  afterEach(() => {
    vi.useRealTimers();
    TestBed.resetTestingModule();
  });

  function fakeSession(status: AgentStatus | null) {
    return {
      agentStatus: signal(status),
      terrainJob: signal<{ label: string; progress: number } | null>(null),
      stopAgent: vi.fn(async () => undefined),
      resumeAgent: vi.fn(async () => undefined),
      setAgentEnabled: vi.fn(async () => undefined),
    };
  }

  function render<T>(component: Type<T>, session: ReturnType<typeof fakeSession>) {
    TestBed.configureTestingModule({ providers: [{ provide: EditorSession, useValue: session }] });
    const fixture = TestBed.createComponent(component);
    fixture.detectChanges();
    return fixture;
  }

  it('shows the running call with its progress and Stop, then Let it go on once stopped', () => {
    vi.useFakeTimers({ now: NOW });
    const session = fakeSession(on({ client: { name: 'claude-code', lastSeen: NOW }, current: { tool: 'run_script', what: 'runs the script "hill"', at: NOW } }));
    session.terrainJob.set({ label: 'Agent: hill', progress: 0.4 });
    const fixture = render(AgentBandComponent, session);
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-test=agent-band]')?.getAttribute('data-state')).toBe('working');
    expect(el.textContent).toContain('claude-code');
    expect(el.querySelector('[data-test=agent-line]')?.textContent).toContain('runs the script "hill"');
    expect((el.querySelector('.td-progress i') as HTMLElement).style.width).toBe('40%');
    (el.querySelector('[data-test=agent-stop]') as HTMLButtonElement).click();
    expect(session.stopAgent).toHaveBeenCalled();
    session.agentStatus.set(on({ held: true, client: { name: 'claude-code', lastSeen: NOW } }));
    fixture.detectChanges();
    (el.querySelector('[data-test=agent-resume]') as HTMLButtonElement).click();
    expect(session.resumeAgent).toHaveBeenCalled();
    // Off: no band
    session.agentStatus.set({ enabled: false, url: null });
    fixture.detectChanges();
    expect(el.querySelector('[data-test=agent-band]')).toBeNull();
  });

  it('is not there in the web build, and the button switches agents on in the desktop app', () => {
    expect((render(AgentControlComponent, fakeSession(null)).nativeElement as HTMLElement).querySelector('[data-test=agent-button]')).toBeNull();
    TestBed.resetTestingModule();
    const session = fakeSession({ enabled: false, url: null });
    const fixture = render(AgentControlComponent, session);
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-test=agent-state]')?.textContent?.trim()).toBe('Off');
    (el.querySelector('[data-test=agent-button]') as HTMLButtonElement).click();
    fixture.detectChanges();
    const toggle = el.querySelector('[data-test=agent-switch]') as HTMLInputElement;
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change'));
    expect(session.setAgentEnabled).toHaveBeenCalledWith(true);
    session.agentStatus.set(on());
    fixture.detectChanges();
    expect(el.querySelector('[data-test=agent-url]')?.textContent).toContain('47171');
    expect(el.querySelector('[data-test=agent-state]')?.textContent?.trim()).toBe('On');
  });
});
