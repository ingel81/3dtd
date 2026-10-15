import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, inject, signal } from '@angular/core';
import { MatTooltipModule } from '@angular/material/tooltip';
import { EditorSession } from '../editor-session.service';
import { AGENT_STATE_LABEL, agentLine, agentName, agentState } from './agent-state';

/**
 * The editor's Agent button (desktop app only, docs/AGENT_MCP.md): its tag
 * says whether AI agents may edit maps and what the agent does; it opens a
 * panel with the switch (the same as in the settings), the address to give
 * the agent, and who connected.
 */
@Component({
  selector: 'app-agent-control',
  standalone: true,
  imports: [MatTooltipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:pointerdown)': 'outside($event)', '(document:keydown.escape)': 'open.set(false)' },
  template: `
    @if (view(); as v) {
      <button class="td-btn-ghost td-btn-sm" type="button" [attr.aria-expanded]="open()" (click)="open.set(!open())"
              matTooltip="AI agents that build and change maps (MCP)" [matTooltipDisabled]="open()" data-test="agent-button">
        Agent
        <span class="td-tag" [class.is-ok]="v.state === 'connected'" [class.is-brass]="v.state === 'working'" [class.is-warn]="v.state === 'stopped'"
              [class.is-error]="v.state === 'error'" data-test="agent-state">{{ v.label }}</span>
      </button>
      @if (open()) {
        <div class="ac-panel td-popup td-stack" role="dialog" aria-label="AI agents" data-test="agent-panel">
          <label class="td-setting">
            <span>Allow AI agents to edit maps</span>
            <input class="td-switch" type="checkbox" [checked]="v.enabled" (change)="session.setAgentEnabled($any($event.target).checked)" data-test="agent-switch" />
          </label>
          @if (v.url; as url) {
            <div class="td-setting">
              <span class="ac-url td-trunc" data-test="agent-url">{{ url }}</span>
              <button class="td-btn-secondary td-btn-sm" type="button" (click)="copy(url)">{{ copied() ? 'Copied' : 'Copy address' }}</button>
            </div>
          }
          <p class="td-note" [class.is-error]="v.state === 'error'" [class.is-ok]="v.state === 'connected' || v.state === 'working'" data-test="agent-panel-line">
            @if (v.client) {
              <span class="td-name">{{ v.name }}</span> |
            }
            {{ v.line }}
          </p>
          <p class="td-note">An MCP client on this computer, such as Claude Code, builds and changes the open map while you watch; each change is one undo step. Any program on this computer can connect while this is on.</p>
        </div>
      }
    }
  `,
  styles: [
    `
      :host { position: relative; display: inline-flex; }
      .ac-panel { position: absolute; top: calc(100% + 6px); right: 0; z-index: 30; width: 360px; padding: var(--td-sp-3); }
      .ac-url { min-width: 0; }
    `,
  ],
})
export class AgentControlComponent {
  readonly session = inject(EditorSession);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly open = signal(false);
  readonly copied = signal(false);
  private readonly now = signal(Date.now());

  readonly view = computed(() => {
    const status = this.session.agentStatus();
    if (!status) return null;
    const now = this.now();
    const state = agentState(status, now);
    return { state, label: AGENT_STATE_LABEL[state], enabled: status.enabled, url: status.url, name: agentName(status), client: !!status.client, line: agentLine(status, now) };
  });

  constructor() {
    const timer = setInterval(() => {
      if (this.session.agentStatus()?.enabled) this.now.set(Date.now());
    }, 1000);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  outside(e: PointerEvent): void {
    if (this.open() && !this.host.nativeElement.contains(e.target as Node)) this.open.set(false);
  }

  async copy(url: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(url);
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    } catch {
      // Without the clipboard the address stays readable in the panel
    }
  }
}
