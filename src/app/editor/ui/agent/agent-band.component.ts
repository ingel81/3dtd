import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { AGENT_LABEL } from '../../agent/editor-agent';
import { EditorSession } from '../editor-session.service';
import { agentLine, agentName, agentState, bandShown } from './agent-state';
import { injectT } from '../../../i18n/i18n.service';

/**
 * The agent band over the view (docs/AGENT_MCP.md): while an AI agent works
 * on the map, was stopped or came lately, which agent it is and what it
 * does, with Stop. Stop ends the call that runs (the map goes back to how
 * it was before it) and refuses every call after until "Let it go on".
 */
@Component({
  selector: 'app-agent-band',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (view(); as v) {
      <div class="ab-band td-overlay" role="status" aria-live="polite" data-test="agent-band" [attr.data-state]="v.state">
        <span class="td-caps">{{ t().editor.agent.anAgent }}</span>
        <span class="ab-name td-name">{{ v.name }}</span>
        <span class="ab-line td-trunc" [class.td-tone-teal]="v.state === 'working'" data-test="agent-line">{{ v.line }}</span>
        @if (v.state === 'stopped') {
          <button class="td-btn-secondary td-btn-sm" type="button" (click)="session.agent.resume()" data-test="agent-resume">{{ t().editor.agent.goOn }}</button>
        } @else {
          <button class="td-btn-danger td-btn-sm" type="button" (click)="session.agent.stop()" data-test="agent-stop">{{ t().editor.agent.stop }}</button>
        }
        @if (v.progress !== null) {
          <div class="td-progress is-edge" aria-hidden="true"><i [style.width.%]="v.progress * 100"></i></div>
        }
      </div>
    }
  `,
  styles: [
    `
      :host { position: absolute; left: 50%; bottom: var(--td-sp-3); z-index: 3; transform: translateX(-50%); width: min(620px, calc(100% - 24px)); pointer-events: none; }
      .ab-band { position: relative; display: flex; align-items: center; gap: var(--td-sp-3); padding: 6px 8px 6px 12px; pointer-events: auto; }
      .ab-name { flex: 0 0 auto; max-width: 30%; }
      .ab-line { flex: 1 1 auto; min-width: 0; }
      .td-progress.is-edge { position: absolute; left: 0; right: 0; bottom: 0; }
    `,
  ],
})
export class AgentBandComponent {
  readonly session = inject(EditorSession);
  protected readonly t = injectT();
  /** Ticks each second while the band could show, for "12 s ago" */
  private readonly now = signal(Date.now());

  readonly view = computed(() => {
    const status = this.session.agent.status();
    const now = this.now();
    if (!status || !bandShown(status, now)) return null;
    const state = agentState(status, now);
    const job = this.session.jobs.job();
    // A script playing or the erosion: how far it is
    const progress = state === 'working' && job?.label.startsWith(AGENT_LABEL) ? job.progress : null;
    const t = this.t();
    return { state, name: agentName(t, status), line: agentLine(t, status, now), progress };
  });

  constructor() {
    const timer = setInterval(() => {
      if (this.session.agent.status()?.enabled) this.now.set(Date.now());
    }, 1000);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }
}
